#!/usr/bin/env python3
"""
CinemaVault v6.2 Leakage-Clean Cross-Space Cold Projector Trainer

Fits Ridge W: [MiniLM-384 + TF-IDF(genres, keywords, director, cast)] -> 64-D clean2 SVD
strictly via 5-fold Out-of-Fold (OOF) CV across the 9,122 warm overlap films between
`.data/tmdb_enriched.json` (9,620 films) and `.data/item_embeddings_clean2_f16.bin`
(already stripped of all 625 evaluation users).

Every candidate film's exported 64-D projected vector in OOF mode is strictly out-of-sample
(predicted by a Ridge model fit without that film's own SVD target or metadata TF-IDF IDF).
"""

import os
import json
import time
import struct
import argparse
import numpy as np
from scipy.linalg import solve as scipy_solve
from scipy.sparse import csr_matrix, hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.model_selection import KFold
from sentence_transformers import SentenceTransformer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))

GENERIC_META_KEYWORD_IDS = {187056, 9715, 9717, 179430, 179431, 209714, 158718}


def resolve_path(p):
    return p if os.path.isabs(p) else os.path.join(ROOT, p)


def load_cvem(bin_path):
    with open(bin_path, "rb") as f:
        magic, version, count, dim = struct.unpack("<4sIII", f.read(16))
        if magic != b"CVEM" or version != 1:
            raise ValueError(f"Unsupported CVEM header in {bin_path}: {magic} v{version}")
        ids = np.frombuffer(f.read(count * 4), dtype="<u4").copy()
        vecs = np.frombuffer(f.read(count * dim * 2), dtype="<f2").astype(np.float32).reshape(count, dim)
    return ids, vecs


def export_cvem(out_path, ids, vecs):
    vecs = np.asarray(vecs, dtype=np.float32)
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    vecs = vecs / np.clip(norms, 1e-12, None)
    vecs_f16 = vecs.astype("<f2")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<4sIII", b"CVEM", 1, len(ids), vecs.shape[1]))
        f.write(np.asarray(ids, dtype="<u4").tobytes())
        f.write(vecs_f16.tobytes())
    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"Exported {len(ids)} x {vecs.shape[1]} projected embeddings -> {out_path} ({size_mb:.2f} MB)")


def build_doc(item):
    title = str(item.get("title") or "").strip()
    year = str(item.get("year") or (item.get("release_date") or "")[:4]).strip()
    tagline = str(item.get("tagline") or "").strip()
    overview = str(item.get("overview") or item.get("plot") or "").strip()
    parts = [f"{title} ({year})" if (title and year) else title, tagline, overview]
    return ". ".join([p for p in parts if p and p != "N/A"])


def build_meta_token_doc(item):
    tokens = []
    for gid in item.get("tmdbGenreIds") or item.get("genre_ids") or []:
        try:
            g = int(gid)
            if g > 0:
                tokens.append(f"g_{g}")
        except (TypeError, ValueError):
            pass
    for kw in item.get("tmdbKeywords") or []:
        try:
            k = int(kw)
            if k > 0 and k not in GENERIC_META_KEYWORD_IDS:
                tokens.append(f"k_{k}")
        except (TypeError, ValueError):
            pass
    crew_id = item.get("crewPersonId")
    if crew_id:
        try:
            c = int(crew_id)
            if c > 0:
                tokens.append(f"d_{c}")
        except (TypeError, ValueError):
            pass
    for cid in (item.get("castIds") or [])[:6]:
        try:
            c = int(cid)
            if c > 0:
                tokens.append(f"c_{c}")
        except (TypeError, ValueError):
            pass
    year_str = str(item.get("year") or (item.get("release_date") or "")[:4]).strip()
    if year_str.isdigit() and 1910 <= int(year_str) <= 2030:
        tokens.append(f"dec_{(int(year_str) // 10) * 10}")
    return " ".join(tokens)


def encode_minilm_384(items, model_name, cache_path=None):
    ids = np.array([int(it["tmdbId"]) for it in items], dtype=np.int64)
    if cache_path and os.path.exists(cache_path):
        try:
            cached = np.load(cache_path)
            if np.array_equal(cached["ids"], ids) and cached["embs"].shape == (len(ids), 384):
                print(f"Loaded cached MiniLM-384 embeddings from {cache_path} ({len(ids)} x 384)")
                return cached["embs"].astype(np.float32)
        except Exception:
            pass

    texts = [build_doc(it) for it in items]
    print(f"Encoding {len(texts)} movie descriptions with {model_name}...")
    t0 = time.time()
    model = SentenceTransformer(model_name)
    embs = model.encode(texts, batch_size=128, show_progress_bar=False, normalize_embeddings=True)
    embs = np.asarray(embs, dtype=np.float32)
    print(f"Encoded MiniLM-384 shape={embs.shape} in {time.time() - t0:.1f}s")

    if cache_path:
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        np.savez(cache_path, ids=ids, embs=embs)
    return embs


def compute_kernel(X_text_a, M_a, X_text_b, M_b, text_scale):
    k_text = (X_text_a @ X_text_b.T).astype(np.float64) * (float(text_scale) ** 2)
    k_meta = (M_a @ M_b.T).toarray().astype(np.float64)
    return k_text + k_meta


def fit_predict_dual_ridge(X_text_tr, M_tr, Y_tr, X_text_va, M_va, alpha, text_scale):
    """Exact kernel-centered Dual Ridge equivalent to Ridge(alpha=alpha, fit_intercept=True)."""
    K_tr = compute_kernel(X_text_tr, M_tr, X_text_tr, M_tr, text_scale)
    row_mean = K_tr.mean(axis=0, keepdims=True)
    col_mean = K_tr.mean(axis=1, keepdims=True)
    tot_mean = K_tr.mean()
    K_tr_c = K_tr - row_mean - col_mean + tot_mean
    K_tr_c[np.diag_indices_from(K_tr_c)] += float(alpha)

    Y_mean = Y_tr.mean(axis=0, keepdims=True).astype(np.float64)
    Y_tr_c = Y_tr.astype(np.float64) - Y_mean
    A = scipy_solve(K_tr_c, Y_tr_c, assume_a="pos")

    K_va = compute_kernel(X_text_va, M_va, X_text_tr, M_tr, text_scale)
    K_va_c = K_va - K_va.mean(axis=1, keepdims=True) - row_mean + tot_mean
    return (K_va_c @ A + Y_mean).astype(np.float32)


def select_best_alpha_inner(X_text_tr, meta_docs_tr, Y_tr, alphas, text_scale):
    """3-fold inner CV strictly inside the outer training fold to pick Ridge alpha."""
    inner_kf = KFold(n_splits=3, shuffle=True, random_state=123)
    best_alpha = alphas[0]
    best_cos = -1.0

    Y_tr_norm = Y_tr / np.clip(np.linalg.norm(Y_tr, axis=1, keepdims=True), 1e-12, None)
    fold_cache = []
    for itr, ival in inner_kf.split(X_text_tr):
        vec = TfidfVectorizer(token_pattern=r"(?u)\S+", min_df=2, sublinear_tf=True, norm="l2")
        M_tr = vec.fit_transform([meta_docs_tr[i] for i in itr])
        M_val = vec.transform([meta_docs_tr[i] for i in ival])

        K_tr = compute_kernel(X_text_tr[itr], M_tr, X_text_tr[itr], M_tr, text_scale)
        row_mean = K_tr.mean(axis=0, keepdims=True)
        col_mean = K_tr.mean(axis=1, keepdims=True)
        tot_mean = K_tr.mean()
        K_tr_c = K_tr - row_mean - col_mean + tot_mean

        K_va = compute_kernel(X_text_tr[ival], M_val, X_text_tr[itr], M_tr, text_scale)
        K_va_c = K_va - K_va.mean(axis=1, keepdims=True) - row_mean + tot_mean

        Y_mean = Y_tr[itr].mean(axis=0, keepdims=True).astype(np.float64)
        Y_tr_c = Y_tr[itr].astype(np.float64) - Y_mean
        fold_cache.append((K_tr_c, K_va_c, Y_tr_c, Y_mean, Y_tr_norm[ival]))

    for alpha in alphas:
        cos_scores = []
        for K_tr_c, K_va_c, Y_tr_c, Y_mean, Y_va_norm in fold_cache:
            K_reg = K_tr_c.copy()
            K_reg[np.diag_indices_from(K_reg)] += float(alpha)
            A = scipy_solve(K_reg, Y_tr_c, assume_a="pos")
            pred = (K_va_c @ A + Y_mean).astype(np.float32)
            pred_norm = pred / np.clip(np.linalg.norm(pred, axis=1, keepdims=True), 1e-12, None)
            cos = np.sum(pred_norm * Y_va_norm, axis=1)
            cos_scores.append(float(np.mean(cos)))
        mean_cos = float(np.mean(cos_scores))
        if mean_cos > best_cos:
            best_cos = mean_cos
            best_alpha = alpha
    return best_alpha, best_cos


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--svd", type=str, default=".data/item_embeddings_clean2_f16.bin")
    parser.add_argument("--tmdb", type=str, default=".data/tmdb_enriched.json")
    parser.add_argument("--catalog", type=str, default=".data/v6_lab/content_catalog_with_2024_2026.json")
    parser.add_argument("--out", type=str, default=".data/v6_lab/cold_proj_64_clean.bin")
    parser.add_argument("--model", type=str, default="sentence-transformers/all-MiniLM-L6-v2")
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--alphas", type=str, default="1.0,3.0,10.0,30.0")
    parser.add_argument("--text-scale", type=float, default=1.0)
    parser.add_argument("--unit-target", action="store_true")
    parser.add_argument("--production-cold", action="store_true", help="Fit on all overlap films and export cold 2024-2026 films")
    args = parser.parse_args()

    t0 = time.time()
    svd_ids, svd_vecs = load_cvem(resolve_path(args.svd))
    svd_map = {int(tid): i for i, tid in enumerate(svd_ids)}
    dim = svd_vecs.shape[1]

    with open(resolve_path(args.tmdb), "r", encoding="utf-8") as f:
        tmdb_raw = json.load(f).get("items", {})
    with open(resolve_path(args.catalog), "r", encoding="utf-8") as f:
        catalog_list = json.load(f)
    catalog_by_id = {int(x["tmdbId"]): x for x in catalog_list if x.get("tmdbId")}

    # Merge tmdb_enriched metadata with catalog text for all 9,620 historical films
    items_9620 = []
    for k, m in tmdb_raw.items():
        tid = int(m.get("tmdbId") or k)
        cat_entry = catalog_by_id.get(tid, {})
        merged = {
            **m,
            "tmdbId": tid,
            "title": cat_entry.get("title") or m.get("title") or "",
            "year": cat_entry.get("year") or m.get("year") or "",
            "tagline": cat_entry.get("tagline") or "",
            "overview": cat_entry.get("overview") or "",
        }
        items_9620.append(merged)
    items_9620.sort(key=lambda x: x["tmdbId"])

    cache_path = resolve_path(".data/v6_lab/minilm_384_9620_cache.npz")
    embs_9620 = encode_minilm_384(items_9620, args.model, cache_path=cache_path)
    meta_docs_9620 = [build_meta_token_doc(it) for it in items_9620]

    overlap_indices = [i for i, it in enumerate(items_9620) if it["tmdbId"] in svd_map]
    non_overlap_indices = [i for i, it in enumerate(items_9620) if it["tmdbId"] not in svd_map]
    print(f"Historical catalog: {len(items_9620)} | SVD overlap: {len(overlap_indices)} | non-overlap: {len(non_overlap_indices)}")

    Y_overlap = np.array([svd_vecs[svd_map[items_9620[i]["tmdbId"]]] for i in overlap_indices], dtype=np.float32)
    if args.unit_target:
        Y_overlap = Y_overlap / np.clip(np.linalg.norm(Y_overlap, axis=1, keepdims=True), 1e-12, None)
    Y_overlap_unit = Y_overlap / np.clip(np.linalg.norm(Y_overlap, axis=1, keepdims=True), 1e-12, None)

    X_text_ov = embs_9620[overlap_indices]
    meta_ov = [meta_docs_9620[i] for i in overlap_indices]
    alphas = [float(x.strip()) for x in args.alphas.split(",") if x.strip()]

    kf = KFold(n_splits=args.folds, shuffle=True, random_state=42)
    oof_preds = np.zeros((len(overlap_indices), dim), dtype=np.float32)
    fold_cos = []
    chosen_alphas = []

    for fold_idx, (tr_idx, va_idx) in enumerate(kf.split(overlap_indices)):
        best_alpha, inner_cos = select_best_alpha_inner(
            X_text_ov[tr_idx], [meta_ov[i] for i in tr_idx], Y_overlap[tr_idx], alphas, args.text_scale
        )
        chosen_alphas.append(best_alpha)

        vec = TfidfVectorizer(token_pattern=r"(?u)\S+", min_df=2, sublinear_tf=True, norm="l2")
        M_tr = vec.fit_transform([meta_ov[i] for i in tr_idx])
        M_va = vec.transform([meta_ov[i] for i in va_idx])

        pred_va = fit_predict_dual_ridge(
            X_text_ov[tr_idx], M_tr, Y_overlap[tr_idx], X_text_ov[va_idx], M_va, best_alpha, args.text_scale
        )
        oof_preds[va_idx] = pred_va

        pred_unit = pred_va / np.clip(np.linalg.norm(pred_va, axis=1, keepdims=True), 1e-12, None)
        cos = float(np.mean(np.sum(pred_unit * Y_overlap_unit[va_idx], axis=1)))
        fold_cos.append(cos)
        print(f"Fold {fold_idx + 1}/{args.folds}: alpha={best_alpha} (inner_cos={inner_cos:.4f}) -> OOF cos={cos:.4f} (vocab={len(vec.vocabulary_)})", flush=True)

    print(f"Mean 5-fold OOF SVD cosine alignment: {np.mean(fold_cos):.4f} +/- {np.std(fold_cos):.4f}", flush=True)

    # Fit full model on all overlap items for non-overlap / cold 2024-2026 items
    final_alpha = float(np.median(chosen_alphas))
    full_vec = TfidfVectorizer(token_pattern=r"(?u)\S+", min_df=2, sublinear_tf=True, norm="l2")
    M_full = full_vec.fit_transform(meta_ov)

    if args.production_cold:
        cold_items = [x for x in catalog_list if int(x["tmdbId"]) not in svd_map]
        cold_embs = encode_minilm_384(cold_items, args.model)
        M_cold = full_vec.transform([build_meta_token_doc(it) for it in cold_items])
        cold_preds = fit_predict_dual_ridge(
            X_text_ov, M_full, Y_overlap, cold_embs, M_cold, final_alpha, args.text_scale
        )
        cold_ids = [int(it["tmdbId"]) for it in cold_items]
        export_cvem(resolve_path(args.out), cold_ids, cold_preds)
    else:
        out_preds = np.zeros((len(items_9620), dim), dtype=np.float32)
        for pos, ov_idx in enumerate(overlap_indices):
            out_preds[ov_idx] = oof_preds[pos]
        if non_overlap_indices:
            M_non = full_vec.transform([meta_docs_9620[i] for i in non_overlap_indices])
            non_preds = fit_predict_dual_ridge(
                X_text_ov, M_full, Y_overlap, embs_9620[non_overlap_indices], M_non, final_alpha, args.text_scale
            )
            for pos, ni in enumerate(non_overlap_indices):
                out_preds[ni] = non_preds[pos]
        out_ids = [it["tmdbId"] for it in items_9620]
        export_cvem(resolve_path(args.out), out_ids, out_preds)

    print(f"Done in {time.time() - t0:.1f}s.")


if __name__ == "__main__":
    main()
