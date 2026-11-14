#!/usr/bin/env python3
"""
CinemaVault Clean Collaborative Embedding Trainer (MovieLens 32M -> Clean CVEM v1 float16)
Reproduces scripts/colab_train_embeddings.py EXACTLY, excluding all ratings from the 328
eligible test users (mapped via .data/user_id_map.json).

Output: .data/item_embeddings_clean_f16.bin in the exact same format and movie order
as the production file public/models/item_embeddings_f16.bin.
"""

import os
import sys
import gc
import json
import time
import struct
import argparse
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from scipy.sparse.linalg import svds

root = "g:/Important Projects/movie-ratings"

def get_production_tmdb_ids(prod_path):
    with open(prod_path, "rb") as f:
        header = f.read(16)
        magic, version, count, dim = struct.unpack("<4sIII", header)
        if magic != b"CVEM":
            raise ValueError(f"Invalid magic: {magic}")
        ids = np.frombuffer(f.read(count * 4), dtype="<u4")
    return ids, count, dim

def main():
    parser = argparse.ArgumentParser(description="Clean CVEM v1 retraining (exact colab hyperparameters)")
    parser.add_argument("--extra-exclude", type=str, default=None, help="JSON file containing freshUserIds / excludeAllMl32mUserIds")
    parser.add_argument("--out", type=str, default=".data/item_embeddings_clean_f16.bin", help="Output binary path (relative to repo root or absolute)")
    args = parser.parse_args()

    start_time = time.time()
    print("=" * 70)
    print("CINEMAVAULT LEAKAGE-FREE EMBEDDING RETRAINER")
    print("=" * 70)

    prod_bin_path = os.path.join(root, "public/models/item_embeddings_f16.bin")
    prod_ids, prod_count, prod_dim = get_production_tmdb_ids(prod_bin_path)
    print(f"Production model: {prod_count} items, dim={prod_dim}")

    map_path = os.path.join(root, ".data/user_id_map.json")
    with open(map_path, "r", encoding="utf-8") as f:
        map_data = json.load(f)

    exclude_32m_users = set()
    for uid, info in map_data.get("mapping", {}).items():
        if info.get("status") in ("unique", "unique_dominant") and info.get("ml32m_userId") is not None:
            exclude_32m_users.add(int(info["ml32m_userId"]))

    if args.extra_exclude:
        extra_path = args.extra_exclude if os.path.isabs(args.extra_exclude) else os.path.join(root, args.extra_exclude)
        with open(extra_path, "r", encoding="utf-8") as f:
            extra_data = json.load(f)
        if isinstance(extra_data, list):
            for u in extra_data:
                exclude_32m_users.add(int(u))
        elif isinstance(extra_data, dict):
            for key in ("excludeAllMl32mUserIds", "freshUserIds"):
                for u in extra_data.get(key, []):
                    exclude_32m_users.add(int(u))

    print(f"Loaded {len(exclude_32m_users)} mapped 32M user IDs to EXCLUDE from training.")

    # 1. Load MovieLens 32M links and ratings
    ml_dir = os.path.join(root, ".data/ml-32m")
    links_path = os.path.join(ml_dir, "links.csv")
    ratings_path = os.path.join(ml_dir, "ratings.csv")

    print(f"Loading links from {links_path}...")
    links = pd.read_csv(links_path, usecols=["movieId", "tmdbId"]).dropna(subset=["tmdbId"])
    links["tmdbId"] = links["tmdbId"].astype(np.uint32)
    links = links.drop_duplicates(subset=["tmdbId"])
    prod_set = set(prod_ids.tolist())
    links = links[links["tmdbId"].isin(prod_set)].copy()
    print(f"Links matching target 25k movies: {len(links)}")

    print(f"Loading ratings from {ratings_path}...")
    t0 = time.time()
    ratings = pd.read_csv(
        ratings_path,
        usecols=["userId", "movieId", "rating", "timestamp"],
        dtype={"userId": np.int32, "movieId": np.int32, "rating": np.float32, "timestamp": np.int64},
    )
    print(f"Loaded {len(ratings):,} ratings in {time.time() - t0:.1f}s.")

    # Exclude the 328 mapped users
    orig_len = len(ratings)
    ratings = ratings[~ratings["userId"].isin(exclude_32m_users)].copy()
    dropped = orig_len - len(ratings)
    print(f"Excluded {dropped:,} ratings from the {len(exclude_32m_users)} mapped evaluation users.")

    # Merge with target movies
    merged = ratings.merge(links, on="movieId", how="inner")
    del ratings
    gc.collect()
    print(f"Merged dataframe: {len(merged):,} ratings across {merged['userId'].nunique():,} users and {merged['tmdbId'].nunique():,} items.")

    # Exact preprocessing from scripts/colab_train_embeddings.py
    print("Computing per-user Z-scores and implicit preference signal...")
    t0 = time.time()
    user_means = merged.groupby("userId")["rating"].transform("mean")
    user_stds = merged.groupby("userId")["rating"].transform("std").fillna(1.0).clip(lower=0.5)
    z = (merged["rating"] - user_means) / user_stds

    # Implicit + z-scored preference signal (EXACT formula from colab_train_embeddings.py)
    signal = np.where(
        merged["rating"] >= 3.5,
        1.0 + 0.5 * np.clip(z, 0.0, None),
        np.where(merged["rating"] <= 2.0, -0.3, 0.2),
    ).astype(np.float32)

    user_cats = merged["userId"].astype("category")
    # Enforce EXACT movie order matching production file
    tmdb_cat = pd.Categorical(merged["tmdbId"], categories=prod_ids)
    item_codes = tmdb_cat.codes

    print(f"Constructing sparse CSR user-item matrix...")
    mat = csr_matrix(
        (signal, (user_cats.cat.codes, item_codes)),
        shape=(len(user_cats.cat.categories), len(prod_ids)),
    )
    print(f"Matrix shape: {mat.shape}, non-zero entries: {mat.nnz:,} in {time.time() - t0:.1f}s.")

    del merged, user_means, user_stds, z, signal, user_cats, tmdb_cat, item_codes
    gc.collect()

    # Exact SVD from colab_train_embeddings.py
    print(f"Computing Truncated SVD (k={prod_dim}) with scipy.sparse.linalg.svds...")
    t_svd = time.time()
    eff_dim = min(prod_dim, min(mat.shape) - 2)
    _, s, vt = svds(mat, k=eff_dim)
    order = np.argsort(s)[::-1]
    s = s[order]
    vt = vt[order, :]
    print(f"SVD completed in {time.time() - t_svd:.1f}s. Singular values min={s.min():.2f}, max={s.max():.2f}")

    # Exact scaling and shrinkage from colab_train_embeddings.py
    shrink = 0.5
    raw_vecs = (vt.T * np.sqrt(s)).astype(np.float32)
    norms = np.linalg.norm(raw_vecs, axis=1, keepdims=True)
    item_vecs = raw_vecs / np.clip(norms + float(shrink), 1e-12, None)
    item_vecs_f16 = item_vecs.astype("<f2")

    # Export clean binary
    out_path = args.out if os.path.isabs(args.out) else os.path.join(root, args.out)
    print(f"Writing clean embeddings to {out_path}...")
    with open(out_path, "wb") as f:
        header = struct.pack("<4sIII", b"CVEM", 1, len(prod_ids), item_vecs.shape[1])
        f.write(header)
        f.write(prod_ids.astype("<u4").tobytes())
        f.write(item_vecs_f16.tobytes())

    out_size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"Successfully exported {len(prod_ids)} clean embeddings to {out_path} ({out_size_mb:.2f} MB)")
    print(f"Total time elapsed: {time.time() - start_time:.1f}s.")
    print("=" * 70)

if __name__ == "__main__":
    main()
