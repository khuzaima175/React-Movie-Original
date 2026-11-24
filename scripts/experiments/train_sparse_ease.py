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

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))


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


def solve_ease_and_export(G_orig, tmdb_ids, item_counts_arr, lam, K, out_path, store_neg=0, pop_gamma=0.0, F=None, forward_eta=0.0):
    t0 = time.time()
    n = G_orig.shape[0]
    G = G_orig.copy()
    diag_idx = np.arange(n)
    g_diag_plus_lam = (G[diag_idx, diag_idx] + np.float32(lam)).astype(np.float32)
    G[diag_idx, diag_idx] += np.float32(lam)

    # Exact Cholesky inversion in float32 (SPD matrix!)
    print(f"  Solving Cholesky ({n}x{n}, lambda={lam}, pop_gamma={pop_gamma}, forward_eta={forward_eta})...")
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

    # Optional forward causal transition blend: B = (1 - eta) * B_ease + eta * B_fwd
    if F is not None and forward_eta > 0.0:
        eta = np.float32(forward_eta)
        one_minus_eta = np.float32(1.0 - forward_eta)
        denom = np.maximum(g_diag_plus_lam, np.float32(1e-9))
        chunk = 1024
        for r0 in range(0, n, chunk):
            r1 = min(n, r0 + chunk)
            P[r0:r1] *= one_minus_eta
            P[r0:r1] += eta * (F[r0:r1] / denom[r0:r1, None])
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


def compute_temporal_matrices(pos, user_codes, item_codes, vals, n_items, tau_days, forward_eta, default_fwd_bin_days=45.0):
    """Build session-kernel Gram G_sess (O(nnz) via X_bin^T X_bin) and/or forward transition F."""
    ts = pos["timestamp"].to_numpy(dtype=np.int64)
    tmin = pos.groupby("userId")["timestamp"].transform("min").to_numpy(dtype=np.int64)
    bin_days = (tau_days / 2.0) if tau_days > 0.0 else default_fwd_bin_days
    bin_sec = max(1, int(round(bin_days * 86400.0)))
    bin_id = (ts - tmin) // bin_sec
    stride = int(bin_id.max()) + 3

    G_sess = None
    if tau_days > 0.0:
        t_s = time.time()
        overlap = np.float32(np.exp(-0.5))
        u_all = np.concatenate([user_codes, user_codes])
        b_all = np.concatenate([bin_id, bin_id + 1])
        i_all = np.concatenate([item_codes, item_codes])
        v_all = np.concatenate([vals, vals * overlap]).astype(np.float32)
        keys = u_all.astype(np.int64) * stride + b_all.astype(np.int64)
        uniq_keys, row_codes = np.unique(keys, return_inverse=True)
        X_bin = csr_matrix((v_all, (row_codes, i_all)), shape=(len(uniq_keys), n_items), dtype=np.float32)
        G_sess = (X_bin.T @ X_bin).toarray().astype(np.float32)
        del u_all, b_all, i_all, v_all, keys, uniq_keys, row_codes, X_bin
        gc.collect()
        print(f"Session-kernel Gram G_sess (tau={tau_days}d, bin={bin_days:.1f}d) computed in {time.time() - t_s:.1f}s")

    F = None
    if forward_eta > 0.0:
        t_f = time.time()
        keys_w = user_codes.astype(np.int64) * stride + bin_id.astype(np.int64)
        uniq_w, row_w = np.unique(keys_w, return_inverse=True)
        u_w = uniq_w // stride
        b_w = uniq_w % stride
        is_adj = (u_w[:-1] == u_w[1:]) & (b_w[1:] == b_w[:-1] + 1)
        idx_cur = np.nonzero(is_adj)[0]
        if len(idx_cur) > 0:
            X_win = csr_matrix((vals, (row_w, item_codes)), shape=(len(uniq_w), n_items), dtype=np.float32)
            F = (X_win[idx_cur].T @ X_win[idx_cur + 1]).toarray().astype(np.float32)
            np.fill_diagonal(F, 0.0)
            del X_win
        else:
            F = np.zeros((n_items, n_items), dtype=np.float32)
        n_adj = len(idx_cur)
        del keys_w, uniq_w, row_w, u_w, b_w, is_adj, idx_cur
        gc.collect()
        print(f"Forward transition F (bin={bin_days:.1f}d, adj_pairs={n_adj:,}, eta={forward_eta}) computed in {time.time() - t_f:.1f}s")

    return G_sess, F


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-items", type=int, default=14000, help="Top N most-rated items from prod_ids")
    parser.add_argument("--k", type=int, default=64, help="Sparse top-K outgoing neighbors per item")
    parser.add_argument("--clean", action="store_true", default=True, help="Exclude 625 eval users (default True)")
    parser.add_argument("--production", action="store_true", help="Train on ALL 32M users for production")
    parser.add_argument("--lam", type=float, default=None, help="Single lambda for production export")
    parser.add_argument("--pop-gamma", type=float, default=0.0, help="Light column popularity damping exponent")
    parser.add_argument("--session-tau-days", type=float, default=0.0, help="Session-kernel temporal half-width tau in days (0 = disabled)")
    parser.add_argument("--session-weight", type=float, default=0.5, help="Blend weight s_w for session-kernel Gram matrix")
    parser.add_argument("--forward-eta", type=float, default=0.0, help="Forward causal transition blend weight eta (0 = disabled)")
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

    use_temporal = args.session_tau_days > 0.0 or args.forward_eta > 0.0
    usecols = ["userId", "movieId", "rating", "timestamp"] if use_temporal else ["userId", "movieId", "rating"]
    dtypes = {"userId": np.int32, "movieId": np.int32, "rating": np.float32}
    if use_temporal:
        dtypes["timestamp"] = np.int64

    print("Loading ratings.csv...")
    ratings = pd.read_csv(
        os.path.join(ml_dir, "ratings.csv"),
        usecols=usecols,
        dtype=dtypes,
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
    user_codes = user_cats.cat.codes.to_numpy()
    item_codes = item_cats.codes
    n_users = len(user_cats.cat.categories)
    n_items = len(top_tmdb_ids)

    X = csr_matrix(
        (vals, (user_codes, item_codes)),
        shape=(n_users, n_items),
        dtype=np.float32,
    )

    print(f"Sparse X shape={X.shape}, nnz={X.nnz:,}. Computing Gram matrix G = X^T X...")
    t_g = time.time()
    G = (X.T @ X).toarray().astype(np.float32)
    del X
    gc.collect()
    print(f"Gram matrix G ({G.shape}, {G.nbytes/1e6:.0f} MB) computed in {time.time() - t_g:.1f}s")

    G_sess, F = (None, None)
    if use_temporal:
        G_sess, F = compute_temporal_matrices(
            pos, user_codes, item_codes, vals, n_items,
            args.session_tau_days, args.forward_eta
        )

    del pos, vals, user_cats, item_cats, user_codes, item_codes
    gc.collect()

    if G_sess is not None:
        s_w = float(args.session_weight)
        norm_match = float(np.trace(G)) / max(float(np.trace(G_sess)), 1e-9)
        print(f"Blending G = (1 - {s_w:.2f}) * G_global + {s_w:.2f} * ({norm_match:.4f} * G_sess)...")
        G *= np.float32(1.0 - s_w)
        G += np.float32(s_w * norm_match) * G_sess
        del G_sess
        gc.collect()

    out_dir = os.path.join(ROOT, ".data/math_lab_ease")
    if args.lam is not None and args.out:
        out_path = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)
        solve_ease_and_export(
            G, top_tmdb_ids, top_item_counts, args.lam, args.k, out_path,
            store_neg=0, pop_gamma=args.pop_gamma, F=F, forward_eta=args.forward_eta
        )
    else:
        for lam in [300.0, 800.0, 2000.0]:
            solve_ease_and_export(
                G, top_tmdb_ids, top_item_counts, lam, args.k,
                os.path.join(out_dir, f"ease_exact_L{int(lam)}_k{args.k}.cvea"),
                store_neg=0,
                pop_gamma=args.pop_gamma,
                F=F,
                forward_eta=args.forward_eta,
            )
    print(f"Done in {time.time() - t_start:.1f}s!")


if __name__ == "__main__":
    main()
