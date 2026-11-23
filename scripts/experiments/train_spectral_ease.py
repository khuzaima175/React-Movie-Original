#!/usr/bin/env python3
"""
CinemaVault Spectral EASE^R & GF-CF Clean Embedding Lab (MovieLens 32M -> CVEM v1 float16)
Excludes ALL 328 mapped + 300 fresh evaluation users (.data/user_id_map.json + .data/fresh_300_exclude_ids.json)
so every single candidate .bin is 100% leakage-clean.

Computes ONE high-rank SVD per matrix normalization and exports multiple CVEM v1 binaries
for rapid evaluation in math_lab_300.mjs.
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
from scipy.sparse.linalg import svds

ROOT = "g:/Important Projects/movie-ratings"


def get_production_tmdb_ids(prod_path):
    with open(prod_path, "rb") as f:
        magic, version, count, dim = struct.unpack("<4sIII", f.read(16))
        if magic != b"CVEM":
            raise ValueError(f"Invalid magic: {magic}")
        ids = np.frombuffer(f.read(count * 4), dtype="<u4")
    return ids, count, dim


def export_cvem(out_path, prod_ids, raw_vecs, shrink=0.5, l2_norm=True):
    raw_vecs = raw_vecs.astype(np.float32)
    if l2_norm:
        norms = np.linalg.norm(raw_vecs, axis=1, keepdims=True)
        item_vecs = raw_vecs / np.clip(norms + float(shrink), 1e-12, None)
    else:
        item_vecs = raw_vecs
    item_vecs_f16 = item_vecs.astype("<f2")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<4sIII", b"CVEM", 1, len(prod_ids), item_vecs.shape[1]))
        f.write(prod_ids.astype("<u4").tobytes())
        f.write(item_vecs_f16.tobytes())
    mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"  -> Exported {os.path.basename(out_path)} (dim={item_vecs.shape[1]}, {mb:.2f} MB)")


def load_clean_matrix(prod_ids, exclude_ids, mode="baseline"):
    ml_dir = os.path.join(ROOT, ".data/ml-32m")
    links = pd.read_csv(os.path.join(ml_dir, "links.csv"), usecols=["movieId", "tmdbId"]).dropna(subset=["tmdbId"])
    links["tmdbId"] = links["tmdbId"].astype(np.uint32)
    links = links.drop_duplicates(subset=["tmdbId"])
    prod_set = set(prod_ids.tolist())
    links = links[links["tmdbId"].isin(prod_set)].copy()

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

    if mode == "baseline":
        signal = np.where(
            merged["rating"] >= 3.5,
            1.0 + 0.5 * np.clip(z, 0.0, None),
            np.where(merged["rating"] <= 2.0, -0.3, 0.2),
        ).astype(np.float32)
    elif mode == "implicit_pos":
        # Pure positive-weighted implicit + rating contrast (classic EASE/GF-CF)
        signal = np.where(
            merged["rating"] >= 3.5,
            1.0 + 0.4 * np.clip(z, 0.0, 2.5),
            np.where(merged["rating"] >= 3.0, 0.35, 0.0),
        ).astype(np.float32)
        keep = signal > 0
        merged = merged[keep]
        signal = signal[keep]
    else:
        raise ValueError(f"Unknown mode: {mode}")

    user_cats = merged["userId"].astype("category")
    tmdb_cat = pd.Categorical(merged["tmdbId"], categories=prod_ids)
    mat = csr_matrix(
        (signal, (user_cats.cat.codes, tmdb_cat.codes)),
        shape=(len(user_cats.cat.categories), len(prod_ids)),
    )
    del merged, user_means, user_stds, z, signal, user_cats, tmdb_cat
    gc.collect()
    return mat


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--k", type=int, default=128)
    parser.add_argument("--out-dir", type=str, default=".data/math_lab_bins")
    args = parser.parse_args()

    t0 = time.time()
    prod_ids, prod_count, prod_dim = get_production_tmdb_ids(os.path.join(ROOT, "public/models/item_embeddings_f16.bin"))
    print(f"Target catalog: {prod_count} items (prod dim={prod_dim})")

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
    print(f"Excluding {len(exclude_ids)} evaluation users (100% leakage-clean).")

    out_dir = os.path.join(ROOT, args.out_dir)

    # ---- Matrix 1: Current signal matrix, k=128 + Spectral EASE / Power Scaling ----
    print("\n[1/2] Building baseline-signal sparse matrix...")
    mat1 = load_clean_matrix(prod_ids, exclude_ids, mode="baseline")
    print(f"  Matrix shape={mat1.shape}, nnz={mat1.nnz:,}. Running svds(k={args.k})...")
    ts = time.time()
    _, s1, vt1 = svds(mat1, k=args.k)
    order = np.argsort(s1)[::-1]
    s1, vt1 = s1[order], vt1[order, :]
    print(f"  SVD1 done in {time.time() - ts:.1f}s (s_max={s1[0]:.1f}, s_64={s1[63]:.1f}, s_{args.k}={s1[-1]:.1f})")

    # Export k=128 raw sqrt(s) vs power-scaled vs Spectral EASE
    export_cvem(os.path.join(out_dir, "svd128_p050.bin"), prod_ids, vt1.T * (s1 ** 0.5), shrink=0.5)
    export_cvem(os.path.join(out_dir, "svd128_p025.bin"), prod_ids, vt1.T * (s1 ** 0.25), shrink=0.1)
    export_cvem(os.path.join(out_dir, "svd64_p025.bin"), prod_ids, vt1[:64].T * (s1[:64] ** 0.25), shrink=0.1)
    # Spectral EASE: filter w_i = sqrt(s_i^2 / (s_i^2 + lambda))
    for lam_scale in [0.15, 0.40]:
        lam = float((s1[0] * lam_scale) ** 2)
        filt = np.sqrt((s1 ** 2) / (s1 ** 2 + lam))
        export_cvem(os.path.join(out_dir, f"svd128_ease_{int(lam_scale*100)}.bin"), prod_ids, vt1.T * filt, shrink=0.05)

    del s1, vt1
    gc.collect()

    # ---- Matrix 2: GF-CF / Symmetric Degree-Normalized matrix (D_u^-0.4 * X * D_i^-0.25) ----
    print("\n[2/2] Building GF-CF degree-normalized matrix (dampens power users + popularity bias)...")
    # Compute user & item L2/degree norms on |X|
    abs_mat = abs(mat1)
    u_deg = np.asarray(abs_mat.sum(axis=1)).ravel()
    i_deg = np.asarray(abs_mat.sum(axis=0)).ravel()
    u_inv = np.where(u_deg > 0, (u_deg + 5.0) ** (-0.40), 0.0).astype(np.float32)
    i_inv = np.where(i_deg > 0, (i_deg + 20.0) ** (-0.25), 0.0).astype(np.float32)
    mat_norm = diags(u_inv) @ mat1 @ diags(i_inv)
    del mat1, abs_mat
    gc.collect()

    print(f"  Running GF-CF svds(k={args.k})...")
    ts = time.time()
    _, s2, vt2 = svds(mat_norm, k=args.k)
    order = np.argsort(s2)[::-1]
    s2, vt2 = s2[order], vt2[order, :]
    print(f"  SVD2 done in {time.time() - ts:.1f}s (s_max={s2[0]:.2f}, s_64={s2[63]:.2f}, s_{args.k}={s2[-1]:.2f})")

    # Re-scale item vectors slightly back with item popularity prior or pure unit
    export_cvem(os.path.join(out_dir, "gfcf64_p050.bin"), prod_ids, vt2[:64].T * (s2[:64] ** 0.5), shrink=0.05)
    export_cvem(os.path.join(out_dir, "gfcf128_p050.bin"), prod_ids, vt2.T * (s2 ** 0.5), shrink=0.05)
    export_cvem(os.path.join(out_dir, "gfcf128_p025.bin"), prod_ids, vt2.T * (s2 ** 0.25), shrink=0.02)
    lam_gf = float((s2[0] * 0.25) ** 2)
    filt_gf = np.sqrt((s2 ** 2) / (s2 ** 2 + lam_gf))
    export_cvem(os.path.join(out_dir, "gfcf128_ease25.bin"), prod_ids, vt2.T * filt_gf, shrink=0.02)

    print(f"\nAll candidate clean binaries generated in {time.time() - t0:.1f}s!")


if __name__ == "__main__":
    main()
