#!/usr/bin/env python3
"""
CinemaVault Offline Collaborative Embedding & Ranker Weights Trainer (MovieLens -> CVEM v1 float16)

Features (Phase 2):
  1. Maps MovieLens movieId -> tmdbId via links.csv and verifies post-write that every binary ID is a valid tmdbId.
  2. Applies Bayesian norm shrinkage (vec / (||vec|| + shrink)) so low-support items do not dominate cosine search.
  3. Runs an offline chronological holdout check on MovieLens before exporting, and refuses to write a binary
     that does not beat the MovieLens popularity baseline on Recall@20.
  4. Supports --holdout-users (strips each listed user's rolling evaluation window so benchmark vaults have
     zero holdout leakage) and --benchmark / --vault to report item coverage.
"""

import argparse
import json
import os
import struct
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from scipy.sparse.linalg import svds


def compute_svd_vecs(df: pd.DataFrame, dim: int, shrink: float):
    user_means = df.groupby("userId")["rating"].transform("mean")
    user_stds = df.groupby("userId")["rating"].transform("std").fillna(1.0).clip(lower=0.5)
    z = (df["rating"] - user_means) / user_stds
    # Implicit + z-scored preference signal
    signal = np.where(
        df["rating"] >= 3.5,
        1.0 + 0.5 * np.clip(z, 0.0, None),
        np.where(df["rating"] <= 2.0, -0.3, 0.2),
    ).astype(np.float32)

    user_cats = df["userId"].astype("category")
    item_cats = df["tmdbId"].astype("category")
    tmdb_ids = item_cats.cat.categories.to_numpy(dtype=np.uint32)

    mat = csr_matrix(
        (signal, (user_cats.cat.codes, item_cats.cat.codes)),
        shape=(len(user_cats.cat.categories), len(tmdb_ids)),
    )

    eff_dim = min(dim, min(mat.shape) - 2)
    _, s, vt = svds(mat, k=eff_dim)
    order = np.argsort(s)[::-1]
    s = s[order]
    vt = vt[order, :]

    raw_vecs = (vt.T * np.sqrt(s)).astype(np.float32)
    norms = np.linalg.norm(raw_vecs, axis=1, keepdims=True)
    item_vecs = raw_vecs / np.clip(norms + float(shrink), 1e-12, None)
    return tmdb_ids, item_vecs, z.to_numpy(dtype=np.float32)


def run_offline_sanity_check(df: pd.DataFrame, dim: int, shrink: float) -> tuple[float, float]:
    """
    Holds out the last 10 liked films (rating >= 4.0) for up to 50 active users and compares
    SVD Recall@20 against the MovieLens popularity baseline.
    """
    sorted_df = df.sort_values(["userId", "timestamp"]).copy()
    u_counts = sorted_df.groupby("userId")["rating"].count()
    val_users = sorted(u_counts[u_counts >= 60].index)[:50]

    val_holdout = {}
    drop_indices = []
    for u in val_users:
        udf = sorted_df[sorted_df["userId"] == u]
        pos = udf[udf["rating"] >= 4.0]
        if len(pos) >= 15:
            hold = pos.iloc[-10:]
            cut_ts = hold.iloc[0]["timestamp"]
            after = udf[udf["timestamp"] >= cut_ts]
            val_holdout[u] = set(hold["tmdbId"].astype(int).tolist())
            drop_indices.extend(after.index.tolist())

    fit_df = sorted_df.drop(index=drop_indices).copy()
    tmdb_ids, vecs, z_vals = compute_svd_vecs(fit_df, dim=dim, shrink=shrink)
    fit_df["z"] = z_vals
    id_to_idx = {int(t): i for i, t in enumerate(tmdb_ids)}
    pop_order = fit_df.groupby("tmdbId")["rating"].count().sort_values(ascending=False).index.tolist()

    svd_recalls, pop_recalls = [], []
    for u, hold_set in val_holdout.items():
        u_hist = fit_df[fit_df["userId"] == u]
        seen = set(u_hist["tmdbId"].astype(int).tolist())
        u_vec = np.zeros(vecs.shape[1], dtype=np.float32)
        for _, row in u_hist.iterrows():
            idx = id_to_idx.get(int(row["tmdbId"]))
            if idx is not None and row["z"] > 0:
                u_vec += float(row["z"]) * vecs[idx]
        norm = np.linalg.norm(u_vec)
        if norm > 1e-12:
            u_vec /= norm
        scores = vecs @ u_vec
        ranked_idx = np.argsort(scores)[::-1]
        top20 = []
        for idx in ranked_idx:
            tid = int(tmdb_ids[idx])
            if tid not in seen:
                top20.append(tid)
                if len(top20) == 20:
                    break
        svd_recalls.append(len(hold_set.intersection(top20)) / len(hold_set))

        pop_top20 = [int(t) for t in pop_order if int(t) not in seen][:20]
        pop_recalls.append(len(hold_set.intersection(pop_top20)) / len(hold_set))

    return float(np.mean(svd_recalls)), float(np.mean(pop_recalls))


def verify_written_binary(out_path: str, valid_tmdb_ids: set[int], expected_count: int, expected_dim: int):
    with open(out_path, "rb") as f:
        buf = f.read()
    expected_bytes = 16 + expected_count * 4 + expected_count * expected_dim * 2
    if len(buf) != expected_bytes:
        raise RuntimeError(f"Post-write check failed: expected {expected_bytes} bytes, got {len(buf)}")
    magic, version, count, dim = struct.unpack("<4sIII", buf[:16])
    if magic != b"CVEM" or version != 1 or count != expected_count or dim != expected_dim:
        raise RuntimeError(f"Post-write header check failed: {magic} v{version} count={count} dim={dim}")
    written_ids = np.frombuffer(buf, dtype="<u4", count=expected_count, offset=16)
    invalid = [int(x) for x in written_ids if int(x) not in valid_tmdb_ids]
    if invalid:
        raise RuntimeError(f"Post-write ID check failed: {len(invalid)} IDs not in links.csv tmdbId set")


def train_and_export(
    ml_dir: str,
    out_path: str,
    weights_out: str = "public/models/ranker_weights.json",
    top_k_movies: int = 20000,
    dim: int = 64,
    shrink: float = 0.5,
    holdout_users: list[int] | None = None,
    benchmark_path: str | None = None,
):
    ratings_path = os.path.join(ml_dir, "ratings.csv")
    links_path = os.path.join(ml_dir, "links.csv")

    ratings = pd.read_csv(
        ratings_path,
        usecols=["userId", "movieId", "rating", "timestamp"],
        dtype={"userId": np.int32, "movieId": np.int32, "rating": np.float32, "timestamp": np.int64},
    )
    links = pd.read_csv(links_path, usecols=["movieId", "tmdbId"]).dropna(subset=["tmdbId"])
    links["tmdbId"] = links["tmdbId"].astype(np.uint32)
    links = links.drop_duplicates(subset=["tmdbId"])
    valid_tmdb_set = set(links["tmdbId"].astype(int).tolist())

    merged = ratings.merge(links, on="movieId", how="inner")

    # Strip the rolling holdout window (last 30 positive ratings + anything after) for benchmark users
    if holdout_users:
        merged = merged.sort_values(["userId", "timestamp"]).copy()
        drop_idx = []
        for u in holdout_users:
            udf = merged[merged["userId"] == u]
            # Keep only the first (len - 100) or strip last 30 positives in the 100-item window
            udf_recent = udf.iloc[-100:] if len(udf) > 100 else udf
            pos = udf_recent[udf_recent["rating"] >= 4.0]
            if len(pos) >= 10:
                hold_count = min(30, max(10, len(pos) - 5))
                cut_ts = pos.iloc[-hold_count]["timestamp"]
                drop_idx.extend(udf[udf["timestamp"] >= cut_ts].index.tolist())
        if drop_idx:
            merged = merged.drop(index=drop_idx).copy()
            print(f"Stripped {len(drop_idx)} holdout-window ratings across benchmark users {holdout_users}")

    counts = merged.groupby("tmdbId")["rating"].count()
    popular_tmdb = counts.nlargest(top_k_movies).index
    filtered = merged[merged["tmdbId"].isin(popular_tmdb)].copy()

    svd_r20, pop_r20 = run_offline_sanity_check(filtered, dim=dim, shrink=shrink)
    print(f"Offline MovieLens Sanity Check (50 users): SVD Recall@20 = {svd_r20:.4f} vs Popularity Recall@20 = {pop_r20:.4f}")
    if svd_r20 <= pop_r20:
        raise RuntimeError(
            f"Refusing to export embeddings: SVD Recall@20 ({svd_r20:.4f}) did not beat popularity ({pop_r20:.4f})"
        )

    tmdb_ids, item_vecs, _ = compute_svd_vecs(filtered, dim=dim, shrink=shrink)
    item_vecs_f16 = item_vecs.astype("<f2")

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "wb") as f:
        header = struct.pack("<4sIII", b"CVEM", 1, len(tmdb_ids), item_vecs.shape[1])
        f.write(header)
        f.write(tmdb_ids.astype("<u4").tobytes())
        f.write(item_vecs_f16.tobytes())

    verify_written_binary(out_path, valid_tmdb_set, len(tmdb_ids), item_vecs.shape[1])

    ranker_weights = {
        "_source": "hand-set-prior",
        "bias": -1.1,
        "collabSim": 2.4,
        "contentSim": 1.4,
        "genreOverlap": 1.1,
        "keywordOverlap": 0.8,
        "crewMatch": 0.7,
        "castMatch": 0.5,
        "bayesianRatingNorm": 1.2,
        "noveltyBonus": 0.35,
        "negativeKeywordPenalty": -2.0,
        "providerMatch": 0.25,
    }
    if weights_out:
        os.makedirs(os.path.dirname(os.path.abspath(weights_out)), exist_ok=True)
        with open(weights_out, "w", encoding="utf-8") as wf:
            json.dump(ranker_weights, wf, indent=2)

    print(
        f"Exported {len(tmdb_ids)} verified tmdbId embeddings (dim={item_vecs.shape[1]}) "
        f"to {out_path} ({os.path.getsize(out_path) / (1024*1024):.2f} MB)"
    )

    if benchmark_path and os.path.exists(benchmark_path):
        with open(benchmark_path, "r", encoding="utf-8") as bf:
            bench = json.load(bf)
        idx_set = set(int(x) for x in tmdb_ids)
        cat_ids = [int(c.get("tmdbId") or c.get("id")) for c in bench.get("catalog", [])]
        cat_cov = sum(1 for cid in cat_ids if cid in idx_set)
        print(f"Benchmark catalog coverage: {cat_cov}/{len(cat_ids)} ({cat_cov / max(1, len(cat_ids)):.1%})")
        for v in bench.get("vaults", []):
            v_ids = [int(m.get("tmdbId") or m.get("id")) for m in v.get("watched", [])]
            v_cov = sum(1 for vid in v_ids if vid in idx_set)
            print(f"  Vault {v.get('name')}: {v_cov}/{len(v_ids)} ({v_cov / max(1, len(v_ids)):.1%})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ml-dir", required=True, help="Directory containing ratings.csv and links.csv")
    parser.add_argument("--out", default="public/models/item_embeddings_f16.bin", help="Output binary path")
    parser.add_argument("--weights-out", default="public/models/ranker_weights.json", help="Output ranker weights JSON path")
    parser.add_argument("--max-items", type=int, default=20000)
    parser.add_argument("--dim", type=int, default=64)
    parser.add_argument("--shrink", type=float, default=0.5)
    parser.add_argument("--holdout-users", default="", help="Comma-separated MovieLens userIds to strip holdout windows for")
    parser.add_argument("--benchmark", default="", help="Optional benchmark JSON path to report coverage")
    args = parser.parse_args()
    holdout_u = [int(x) for x in args.holdout_users.split(",") if x.strip()] if args.holdout_users else None
    train_and_export(
        args.ml_dir,
        args.out,
        args.weights_out,
        args.max_items,
        args.dim,
        args.shrink,
        holdout_u,
        args.benchmark or None,
    )
