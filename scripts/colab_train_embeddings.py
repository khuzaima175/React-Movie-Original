#!/usr/bin/env python3
"""
CinemaVault Offline Collaborative Embedding Trainer (MovieLens 25M / 32M -> CVEM v1 float16)
Usage in Google Colab or local Python environment:
  python scripts/colab_train_embeddings.py --ml-dir ./ml-25m --out ./public/models/item_embeddings_f16.bin
"""

import argparse
import os
import struct
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from scipy.sparse.linalg import svds


def train_and_export(ml_dir: str, out_path: str, top_k_movies: int = 20000, dim: int = 64):
    ratings_path = os.path.join(ml_dir, "ratings.csv")
    links_path = os.path.join(ml_dir, "links.csv")

    ratings = pd.read_csv(ratings_path, usecols=["userId", "movieId", "rating"])
    links = pd.read_csv(links_path, usecols=["movieId", "tmdbId"]).dropna(subset=["tmdbId"])
    links["tmdbId"] = links["tmdbId"].astype(np.uint32)
    links = links.drop_duplicates(subset=["tmdbId"])

    merged = ratings.merge(links, on="movieId", how="inner")
    counts = merged.groupby("tmdbId")["rating"].count()
    popular_tmdb = counts.nlargest(top_k_movies).index
    filtered = merged[merged["tmdbId"].isin(popular_tmdb)].copy()

    user_means = filtered.groupby("userId")["rating"].transform("mean")
    user_stds = filtered.groupby("userId")["rating"].transform("std").fillna(1.0).clip(lower=0.5)
    filtered["z"] = (filtered["rating"] - user_means) / user_stds

    user_cats = filtered["userId"].astype("category")
    item_cats = filtered["tmdbId"].astype("category")
    tmdb_ids = item_cats.cat.categories.to_numpy(dtype=np.uint32)

    mat = csr_matrix(
        (filtered["z"].to_numpy(dtype=np.float32), (user_cats.cat.codes, item_cats.cat.codes)),
        shape=(len(user_cats.cat.categories), len(tmdb_ids)),
    )

    _, s, vt = svds(mat, k=dim)
    order = np.argsort(s)[::-1]
    s = s[order]
    vt = vt[order, :]

    item_vecs = (vt.T * np.sqrt(s)).astype(np.float32)
    norms = np.linalg.norm(item_vecs, axis=1, keepdims=True)
    item_vecs = item_vecs / np.clip(norms, 1e-12, None)
    item_vecs_f16 = item_vecs.astype("<f2")

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "wb") as f:
        header = struct.pack("<4sIII", b"CVEM", 1, len(tmdb_ids), dim)
        f.write(header)
        f.write(tmdb_ids.astype("<u4").tobytes())
        f.write(item_vecs_f16.tobytes())

    print(f"Exported {len(tmdb_ids)} embeddings (dim={dim}) to {out_path} ({os.path.getsize(out_path) / (1024*1024):.2f} MB)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ml-dir", required=True, help="Directory containing ratings.csv and links.csv")
    parser.add_argument("--out", default="public/models/item_embeddings_f16.bin", help="Output binary path")
    parser.add_argument("--max-items", type=int, default=20000)
    parser.add_argument("--dim", type=int, default=64)
    args = parser.parse_args()
    train_and_export(args.ml_dir, args.out, args.max_items, args.dim)
