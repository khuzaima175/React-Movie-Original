"""Distill 128-D Pacing and Tone direction vectors from content_embeddings_f16.bin."""
from __future__ import annotations

import json
import math
import random
import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CONTENT_BIN = ROOT / "public" / "models" / "content_embeddings_f16.bin"
ENRICHED_JSON = ROOT / ".data" / "tmdb_enriched.json"
OUT_JSON = ROOT / "public" / "models" / "tuner_axes.json"


def load_cvem_f16(path: Path) -> tuple[dict[int, np.ndarray], int]:
    data = path.read_bytes()
    magic, version, count, dim = struct.unpack("<4sIII", data[:16])
    if magic != b"CVEM" or version != 1:
        raise ValueError(f"Unexpected CVEM header: {magic!r}, v{version}")
    id_end = 16 + count * 4
    ids = np.frombuffer(data, dtype="<u4", count=count, offset=16)
    vecs = np.frombuffer(data, dtype="<f2", count=count * dim, offset=id_end).astype(np.float32)
    vecs = vecs.reshape(count, dim)
    mapping = {int(tid): vecs[i] for i, tid in enumerate(ids)}
    return mapping, dim


def auc_score(pos_scores: list[float], neg_scores: list[float]) -> float:
    wins = 0.0
    total = len(pos_scores) * len(neg_scores)
    if total == 0:
        return 0.5
    for p in pos_scores:
        for n in neg_scores:
            if p > n:
                wins += 1.0
            elif p == n:
                wins += 0.5
    return wins / total


def build_contrastive_axis(
    pos_vecs: list[np.ndarray], neg_vecs: list[np.ndarray], seed: int = 42
) -> tuple[list[float], float]:
    rng = random.Random(seed)
    pos_idx = list(range(len(pos_vecs)))
    neg_idx = list(range(len(neg_vecs)))
    rng.shuffle(pos_idx)
    rng.shuffle(neg_idx)

    pos_split = max(10, int(len(pos_idx) * 0.8))
    neg_split = max(10, int(len(neg_idx) * 0.8))

    train_pos = np.mean([pos_vecs[i] for i in pos_idx[:pos_split]], axis=0)
    train_neg = np.mean([neg_vecs[i] for i in neg_idx[:neg_split]], axis=0)
    axis = train_pos - train_neg
    norm = float(np.linalg.norm(axis))
    if norm <= 1e-12:
        raise RuntimeError("Degenerate contrastive axis")
    axis = axis / norm

    val_pos = [float(np.dot(pos_vecs[i], axis)) for i in pos_idx[pos_split:]]
    val_neg = [float(np.dot(neg_vecs[i], axis)) for i in neg_idx[neg_split:]]
    heldout_auc = auc_score(val_pos, val_neg)
    return [round(float(x), 5) for x in axis], heldout_auc


def main() -> None:
    vecs_by_id, dim = load_cvem_f16(CONTENT_BIN)
    raw = json.loads(ENRICHED_JSON.read_text(encoding="utf-8"))
    raw_items = raw["items"].values() if isinstance(raw["items"], dict) else raw["items"]

    fast_vecs, slow_vecs = [], []
    warm_vecs, bleak_vecs = [], []

    sorted_items = sorted(raw_items, key=lambda m: int(m.get("vote_count") or 0), reverse=True)
    for item in sorted_items:
        tid = int(item.get("tmdbId") or 0)
        if tid not in vecs_by_id or int(item.get("vote_count") or 0) < 200:
            continue
        genres = set(int(g) for g in (item.get("tmdbGenreIds") or []))
        vec = vecs_by_id[tid]

        # Pacing anchors: kinetic Action+Thriller vs pure contemplative Drama/History
        if 28 in genres and (53 in genres or 12 in genres) and 18 not in genres and 35 not in genres:
            if len(fast_vecs) < 120:
                fast_vecs.append(vec)
        elif 18 in genres and not (genres & {28, 53, 35, 27, 12, 878}):
            if len(slow_vecs) < 120:
                slow_vecs.append(vec)

        # Tone anchors: warm Family/Comedy/Animation/Romance vs bleak Horror/War/Crime+Thriller
        if (10751 in genres or 16 in genres or (35 in genres and 10749 in genres)) and not (
            genres & {27, 80, 53, 10752}
        ):
            if len(warm_vecs) < 120:
                warm_vecs.append(vec)
        elif (27 in genres or 10752 in genres or (80 in genres and 53 in genres)) and not (
            genres & {35, 10751, 16, 10749, 10402}
        ):
            if len(bleak_vecs) < 120:
                bleak_vecs.append(vec)

    pacing_vec, pacing_auc = build_contrastive_axis(fast_vecs, slow_vecs, seed=42)
    tone_vec, tone_auc = build_contrastive_axis(warm_vecs, bleak_vecs, seed=42)

    payload = {
        "version": 1,
        "dim": dim,
        "pacingVec": pacing_vec,
        "toneVec": tone_vec,
    }
    OUT_JSON.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(
        f"Wrote {OUT_JSON} ({OUT_JSON.stat().st_size} bytes) | "
        f"Pacing AUC={pacing_auc:.3f} ({len(fast_vecs)}/{len(slow_vecs)}) | "
        f"Tone AUC={tone_auc:.3f} ({len(warm_vecs)}/{len(bleak_vecs)})"
    )


if __name__ == "__main__":
    main()
