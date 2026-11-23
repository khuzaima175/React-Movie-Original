#!/usr/bin/env python3
"""
Fine-grained Spectral EASE^R sweep on clean MovieLens 32M (100% leakage-clean: excludes 625 eval users).
Tests dim=64 vs dim=128, lam_scale in [0.35, 0.50, 0.70, 0.95, 1.30], and Bayesian shrinkage [0.05, 0.25].
"""
import os
import gc
import json
import time
import struct
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from scipy.sparse.linalg import svds

ROOT = "g:/Important Projects/movie-ratings"


def export_cvem(out_path, prod_ids, raw_vecs, shrink=0.05):
    raw_vecs = raw_vecs.astype(np.float32)
    norms = np.linalg.norm(raw_vecs, axis=1, keepdims=True)
    item_vecs = raw_vecs / np.clip(norms + float(shrink), 1e-12, None)
    item_vecs_f16 = item_vecs.astype("<f2")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<4sIII", b"CVEM", 1, len(prod_ids), item_vecs.shape[1]))
        f.write(prod_ids.astype("<u4").tobytes())
        f.write(item_vecs_f16.tobytes())
    print(f"  -> {os.path.basename(out_path)} (dim={item_vecs.shape[1]}, {os.path.getsize(out_path)/(1024*1024):.2f} MB)")


def main():
    t0 = time.time()
    with open(os.path.join(ROOT, "public/models/item_embeddings_f16.bin"), "rb") as f:
        _, _, count, _ = struct.unpack("<4sIII", f.read(16))
        prod_ids = np.frombuffer(f.read(count * 4), dtype="<u4")

    exclude_ids = set()
    with open(os.path.join(ROOT, ".data/user_id_map.json"), "r", encoding="utf-8") as f:
        for info in json.load(f).get("mapping", {}).values():
            if info.get("status") in ("unique", "unique_dominant") and info.get("ml32m_userId") is not None:
                exclude_ids.add(int(info["ml32m_userId"]))
    with open(os.path.join(ROOT, ".data/fresh_300_exclude_ids.json"), "r", encoding="utf-8") as f:
        extra = json.load(f)
        for key in ("excludeAllMl32mUserIds", "freshUserIds"):
            for u in extra.get(key, []):
                exclude_ids.add(int(u))

    ml_dir = os.path.join(ROOT, ".data/ml-32m")
    links = pd.read_csv(os.path.join(ml_dir, "links.csv"), usecols=["movieId", "tmdbId"]).dropna(subset=["tmdbId"])
    links["tmdbId"] = links["tmdbId"].astype(np.uint32)
    links = links.drop_duplicates(subset=["tmdbId"])
    links = links[links["tmdbId"].isin(set(prod_ids.tolist()))].copy()

    ratings = pd.read_csv(
        os.path.join(ml_dir, "ratings.csv"),
        usecols=["userId", "movieId", "rating"],
        dtype={"userId": np.int32, "movieId": np.int32, "rating": np.float32},
    )
    ratings = ratings[~ratings["userId"].isin(exclude_ids)].copy()
    merged = ratings.merge(links, on="movieId", how="inner")
    del ratings
    gc.collect()

    user_means = merged.groupby("userId")["rating"].transform("mean")
    user_stds = merged.groupby("userId")["rating"].transform("std").fillna(1.0).clip(lower=0.5)
    z = (merged["rating"] - user_means) / user_stds
    signal = np.where(
        merged["rating"] >= 3.5,
        1.0 + 0.5 * np.clip(z, 0.0, None),
        np.where(merged["rating"] <= 2.0, -0.3, 0.2),
    ).astype(np.float32)

    user_cats = merged["userId"].astype("category")
    tmdb_cat = pd.Categorical(merged["tmdbId"], categories=prod_ids)
    mat = csr_matrix(
        (signal, (user_cats.cat.codes, tmdb_cat.codes)),
        shape=(len(user_cats.cat.categories), len(prod_ids)),
    )
    del merged, user_means, user_stds, z, signal, user_cats, tmdb_cat
    gc.collect()

    print(f"Running svds(k=128) on {mat.shape} (nnz={mat.nnz:,})...")
    ts = time.time()
    _, s, vt = svds(mat, k=128)
    order = np.argsort(s)[::-1]
    s, vt = s[order], vt[order, :]
    print(f"SVD done in {time.time() - ts:.1f}s (s1={s[0]:.1f}, s64={s[63]:.1f}, s128={s[127]:.1f})")

    out_dir = os.path.join(ROOT, ".data/math_lab_sweep")
    # Also save s and vt so we don't have to re-run SVD if we want more curves!
    os.makedirs(out_dir, exist_ok=True)
    np.savez(os.path.join(out_dir, "svd128_clean.npz"), s=s, vt=vt, prod_ids=prod_ids)

    # Sweep Spectral EASE filter: w_i = sqrt(s_i^2 / (s_i^2 + lambda)) AND true EASE^R power: s_i / sqrt(s_i^2 + lam)
    for lam_scale in [0.40, 0.55, 0.75, 1.00, 1.40]:
        lam = float((s[0] * lam_scale) ** 2)
        filt128 = np.sqrt((s ** 2) / (s ** 2 + lam))
        export_cvem(os.path.join(out_dir, f"ease128_L{int(lam_scale*100):03d}_sh005.bin"), prod_ids, vt.T * filt128, shrink=0.05)

    # Test shrinkage on L=0.55 and L=0.75 + dim=64 comparison (3.15 MB vs 6.20 MB)
    for shrink in [0.15, 0.35]:
        lam = float((s[0] * 0.55) ** 2)
        filt128 = np.sqrt((s ** 2) / (s ** 2 + lam))
        export_cvem(os.path.join(out_dir, f"ease128_L055_sh{int(shrink*100):03d}.bin"), prod_ids, vt.T * filt128, shrink=shrink)

    for lam_scale in [0.40, 0.65, 1.00]:
        lam = float((s[0] * lam_scale) ** 2)
        filt64 = np.sqrt((s[:64] ** 2) / (s[:64] ** 2 + lam))
        export_cvem(os.path.join(out_dir, f"ease64_L{int(lam_scale*100):03d}_sh005.bin"), prod_ids, vt[:64].T * filt64, shrink=0.05)

    print(f"Sweep complete in {time.time() - t0:.1f}s!")


if __name__ == "__main__":
    main()
