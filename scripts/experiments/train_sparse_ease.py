#!/usr/bin/env python3
"""
CinemaVault Exact Sparse EASE^R Trainer (Steck 2019, MovieLens 32M -> CVEA v1 binary)
Excludes ALL 625 evaluation users (328 mapped + 300 fresh) for 100% leakage-clean benchmarking.

Solves exact full-rank closed-form EASE^R:
  G = X^T X
  P = (G + lambda * I)^-1
  B = -P / diag(P),  diag(B) = 0

Exports the top-K outgoing neighbors per item (row i of B, so score(j) = sum_{i in watched} w_i * B[i, j])
into a tiny ~3.8 MB binary (CVEA v1: 2-byte uint16 idx + 2-byte float16 weight) that scores in < 1ms in JS!
"""
import os
import gc
import json
import time
import struct
import argparse
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, diags
from scipy.linalg import cho_factor, cho_solve

ROOT = "g:/Important Projects/movie-ratings"


def export_cvea(out_path, tmdb_ids, nbr_idx, nbr_w):
    """
    CVEA v1 binary format:
      [0..4]   magic "CVEA"
      [4..8]   version = 1 (uint32 LE)
      [8..12]  count (uint32 LE)
      [12..16] K neighbors per item (uint32 LE)
      [16 .. 16 + count*4]              tmdb_ids (uint32 LE)
      [.. + count*K*2]                  nbr_idx  (uint16 LE)
      [.. + count*K*2]                  nbr_w    (float16 LE)
    """
    count, K = nbr_idx.shape
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<4sIII", b"CVEA", 1, count, K))
        f.write(tmdb_ids.astype("<u4").tobytes())
        f.write(nbr_idx.astype("<u2").tobytes())
        f.write(nbr_w.astype("<f2").tobytes())
    mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"  -> Exported {os.path.basename(out_path)} ({count} items x K={K}, {mb:.2f} MB)")


def solve_ease_and_export(G_orig, tmdb_ids, item_counts_arr, lam, K, out_path, store_neg=0, pop_gamma=0.0):
    t0 = time.time()
    n = G_orig.shape[0]
    G = G_orig.copy()
    diag_idx = np.arange(n)
    G[diag_idx, diag_idx] += np.float32(lam)

    # Exact Cholesky inversion in float32 (SPD matrix!)
    print(f"  Solving Cholesky ({n}x{n}, lambda={lam}, pop_gamma={pop_gamma})...")
    c, lower = cho_factor(G, overwrite_a=True, check_finite=False)
    del G
    gc.collect()

    eye = np.eye(n, dtype=np.float32)
    P = cho_solve((c, lower), eye, overwrite_b=True, check_finite=False)
    del c, eye
    gc.collect()

    diag_P = np.diag(P).copy()
    # B = -P / diag_P[None, :] (column j divided by P[j, j]), diag(B) = 0
    P /= (-diag_P[None, :])
    P[diag_idx, diag_idx] = 0.0

    # Optional light column popularity damping (Steck 2020) baked in before top-K pruning
    if pop_gamma > 0.0 and item_counts_arr is not None:
        damp = (np.maximum(item_counts_arr.astype(np.float32), 50.0) / 1000.0) ** np.float32(-pop_gamma)
        P *= damp[None, :]

    nbr_idx = np.zeros((n, K), dtype=np.uint16)
    nbr_w = np.zeros((n, K), dtype=np.float32)

    pos_K = K - store_neg
    for i in range(n):
        row = P[i]
        top_pos = np.argpartition(row, -pos_K)[-pos_K:]
        top_pos = top_pos[np.argsort(row[top_pos])[::-1]]
        if store_neg > 0:
            top_neg = np.argpartition(row, store_neg)[:store_neg]
            top_neg = top_neg[np.argsort(row[top_neg])]
            chosen = np.concatenate([top_pos, top_neg])
        else:
            chosen = top_pos
        nbr_idx[i] = chosen.astype(np.uint16)
        nbr_w[i] = row[chosen]

    del P
    gc.collect()
    print(f"  EASE^R (lambda={lam}) solved in {time.time() - t0:.1f}s")
    export_cvea(out_path, tmdb_ids, nbr_idx, nbr_w)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-items", type=int, default=14000, help="Top N most-rated items from prod_ids")
    parser.add_argument("--k", type=int, default=64, help="Sparse top-K outgoing neighbors per item")
    parser.add_argument("--clean", action="store_true", default=True, help="Exclude 625 eval users (default True)")
    parser.add_argument("--production", action="store_true", help="Train on ALL 32M users for production")
    parser.add_argument("--lam", type=float, default=None, help="Single lambda for production export")
    parser.add_argument("--pop-gamma", type=float, default=0.0, help="Light column popularity damping exponent")
    parser.add_argument("--out", type=str, default=None)
    args = parser.parse_args()

    t_start = time.time()
    with open(os.path.join(ROOT, "public/models/item_embeddings_f16.bin"), "rb") as f:
        _, _, count, _ = struct.unpack("<4sIII", f.read(16))
        prod_ids = np.frombuffer(f.read(count * 4), dtype="<u4")

    exclude_ids = set()
    if not args.production:
        with open(os.path.join(ROOT, ".data/user_id_map.json"), "r", encoding="utf-8") as f:
            for info in json.load(f).get("mapping", {}).values():
                if info.get("status") in ("unique", "unique_dominant") and info.get("ml32m_userId") is not None:
                    exclude_ids.add(int(info["ml32m_userId"]))
        with open(os.path.join(ROOT, ".data/fresh_300_exclude_ids.json"), "r", encoding="utf-8") as f:
            extra = json.load(f)
            for key in ("excludeAllMl32mUserIds", "freshUserIds"):
                for u in extra.get(key, []):
                    exclude_ids.add(int(u))
        print(f"CLEAN MODE: Excluding {len(exclude_ids)} evaluation users.")
    else:
        print("PRODUCTION MODE: Training on 100% of MovieLens 32M users.")

    ml_dir = os.path.join(ROOT, ".data/ml-32m")
    links = pd.read_csv(os.path.join(ml_dir, "links.csv"), usecols=["movieId", "tmdbId"]).dropna(subset=["tmdbId"])
    links["tmdbId"] = links["tmdbId"].astype(np.uint32)
    links = links.drop_duplicates(subset=["tmdbId"])
    links = links[links["tmdbId"].isin(set(prod_ids.tolist()))].copy()

    print("Loading ratings.csv...")
    ratings = pd.read_csv(
        os.path.join(ml_dir, "ratings.csv"),
        usecols=["userId", "movieId", "rating"],
        dtype={"userId": np.int32, "movieId": np.int32, "rating": np.float32},
    )
    if exclude_ids:
        ratings = ratings[~ratings["userId"].isin(exclude_ids)].copy()
    merged = ratings.merge(links, on="movieId", how="inner")
    del ratings
    gc.collect()

    # Keep positive interactions (>= 3.5 stars) — classic EASE^R implicit+explicit formulation
    # Plus keep top max_items movies by rating count (guarantees all catalog movies with solid signal)
    pos = merged[merged["rating"] >= 3.5].copy()
    del merged
    gc.collect()

    item_counts = pos["tmdbId"].value_counts()
    top_series = item_counts.head(args.max_items)
    top_tmdb_ids = top_series.index.to_numpy(dtype=np.uint32)
    top_item_counts = top_series.to_numpy(dtype=np.float32)
    min_cnt = int(top_item_counts[-1])
    print(f"Selected top {len(top_tmdb_ids)} items (min positive ratings={min_cnt}, covering {pos['tmdbId'].isin(set(top_tmdb_ids.tolist())).mean()*100:.2f}% of positive ratings)")

    pos = pos[pos["tmdbId"].isin(set(top_tmdb_ids.tolist()))].copy()
    # Continuous positive signal: 3.5->0.8, 4.0->1.0, 4.5->1.15, 5.0->1.3
    vals = (0.8 + 0.333 * (pos["rating"].to_numpy(dtype=np.float32) - 3.5)).astype(np.float32)
    user_cats = pos["userId"].astype("category")
    item_cats = pd.Categorical(pos["tmdbId"], categories=top_tmdb_ids)

    X = csr_matrix(
        (vals, (user_cats.cat.codes.to_numpy(), item_cats.codes)),
        shape=(len(user_cats.cat.categories), len(top_tmdb_ids)),
        dtype=np.float32,
    )
    del pos, vals, user_cats, item_cats
    gc.collect()

    print(f"Sparse X shape={X.shape}, nnz={X.nnz:,}. Computing Gram matrix G = X^T X...")
    t_g = time.time()
    G = (X.T @ X).toarray().astype(np.float32)
    del X
    gc.collect()
    print(f"Gram matrix G ({G.shape}, {G.nbytes/1e6:.0f} MB) computed in {time.time() - t_g:.1f}s")

    out_dir = os.path.join(ROOT, ".data/math_lab_ease")
    if args.lam is not None and args.out:
        out_path = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)
        solve_ease_and_export(G, top_tmdb_ids, top_item_counts, args.lam, args.k, out_path, store_neg=0, pop_gamma=args.pop_gamma)
    else:
        for lam in [300.0, 800.0, 2000.0]:
            solve_ease_and_export(
                G, top_tmdb_ids, top_item_counts, lam, args.k,
                os.path.join(out_dir, f"ease_exact_L{int(lam)}_k{args.k}.cvea"),
                store_neg=0,
                pop_gamma=args.pop_gamma
            )
    print(f"Done in {time.time() - t_start:.1f}s!")


if __name__ == "__main__":
    main()
