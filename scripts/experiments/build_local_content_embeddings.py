#!/usr/bin/env python3
"""
Builds 64-D float16 CVEM v1 semantic content embeddings locally using SentenceTransformers
(`all-MiniLM-L6-v2`, 384-D -> PCA 64-D L2-normalized) from pure movie text (title + tagline + overview).
Zero MovieLens / rating leakage!
"""
import os
import json
import time
import struct
import argparse
import numpy as np
from sklearn.decomposition import PCA
from sentence_transformers import SentenceTransformer

ROOT = "g:/Important Projects/movie-ratings"


def build_doc(item):
    title = str(item.get("title") or "").strip()
    year = str(item.get("year") or (item.get("release_date") or "")[:4]).strip()
    tagline = str(item.get("tagline") or "").strip()
    overview = str(item.get("overview") or item.get("plot") or "").strip()
    parts = [f"{title} ({year})" if (title and year) else title, tagline, overview]
    return ". ".join([p for p in parts if p and p != "N/A"])


def export_cvem(out_path, ids, vecs):
    vecs = vecs.astype(np.float32)
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    vecs = vecs / np.clip(norms, 1e-12, None)
    vecs_f16 = vecs.astype("<f2")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<4sIII", b"CVEM", 1, len(ids), vecs.shape[1]))
        f.write(np.asarray(ids, dtype="<u4").tobytes())
        f.write(vecs_f16.tobytes())
    print(f"Exported {len(ids)} x {vecs.shape[1]} content embeddings -> {out_path} ({os.path.getsize(out_path)/(1024*1024):.2f} MB)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=str, default=".data/tmdb_enriched.json")
    parser.add_argument("--out", type=str, default=".data/v6_lab/content_64_f16.bin")
    parser.add_argument("--model", type=str, default="sentence-transformers/all-MiniLM-L6-v2")
    parser.add_argument("--dims", type=int, default=64)
    args = parser.parse_args()

    t0 = time.time()
    in_path = args.input if os.path.isabs(args.input) else os.path.join(ROOT, args.input)
    with open(in_path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    items = raw if isinstance(raw, list) else (raw["items"] if isinstance(raw.get("items"), list) else list(raw.get("items", {}).values()))

    ids = []
    texts = []
    for item in items:
        tid = int(item.get("tmdbId") or item.get("id") or 0)
        txt = build_doc(item)
        if tid > 0 and txt:
            ids.append(tid)
            texts.append(txt)

    print(f"Encoding {len(texts)} movie descriptions with {args.model}...")
    model = SentenceTransformer(args.model)
    embs = model.encode(texts, batch_size=128, show_progress_bar=False, normalize_embeddings=True)
    print(f"Encoded shape={embs.shape} in {time.time() - t0:.1f}s")

    if args.dims < embs.shape[1]:
        pca = PCA(n_components=args.dims, random_state=42)
        embs_red = pca.fit_transform(embs)
        print(f"PCA {embs.shape[1]} -> {args.dims} explained variance: {pca.explained_variance_ratio_.sum()*100:.1f}%")
    else:
        embs_red = embs

    out_path = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)
    export_cvem(out_path, ids, embs_red)
    # Also export 128-D version for comparison!
    if args.dims == 64 and embs.shape[1] >= 128:
        pca128 = PCA(n_components=128, random_state=42)
        embs_128 = pca128.fit_transform(embs)
        export_cvem(out_path.replace("_64_", "_128_"), ids, embs_128)
    print(f"Done in {time.time() - t0:.1f}s!")


if __name__ == "__main__":
    main()
