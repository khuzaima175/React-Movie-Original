# Standalone Bucket E Recall by Injection Size (`clean2` Index)

- Generated: `2026-11-15T03:20:01.766Z`
- Caller parity: mirrors `getMovieRecommendations` in `src/services/geminiService.js` (`catalogMax` via `getCollabCatalogMax` on full `collabSimMap` before `excludeIds`, `repulsionWeight = |repulsion| / collabSim = 0.234375`, train-vault `excludeIds`).
- **SCOPE CAVEAT: This standalone script measures Bucket E (retrieveAlignedEmbeddingNeighbors) in isolation against the 25k embedding index. Because the offline harness does not execute live TMDB Buckets A-D, these numbers CANNOT measure how much additional value larger Bucket E injection sizes (e.g., 30->60) add beyond candidates that Buckets A-D already retrieve. Production defaults (maxNeighbors=30 under 'any', 15 under explicit mood in src/services/geminiService.js) remain unchanged.**

## Index Coverage Ceiling & 30 → 60 Marginal Gains

| Cohort | Valid Users | Holdout Pos (Indexed / Total) | Index Ceiling Micro | Ceiling Macro | Marginal Hits 30→60 | Marginal Hits/User | New Users Hit (0→>=1) | Hit Rate 30→60 | Recall Gain 30→60 (Macro / Indexed) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 328 >=8★ | 328 | 3235/3280 | 98.63% | 98.63% | +287 | +0.8750 | +38 | +11.59% | +0.0875 / +0.0884 |
| 328 >=9★ | 304 | 2967/3000 | 98.90% | 98.91% | +296 | +0.9737 | +43 | +14.14% | +0.0980 / +0.0987 |
| fresh_300 >=8★ | 300 | 2999/3000 | 99.97% | 99.97% | +258 | +0.8600 | +39 | +13.00% | +0.0860 / +0.0860 |
| fresh_300 >=9★ | 284 | 2813/2814 | 99.96% | 99.96% | +263 | +0.9261 | +30 | +10.56% | +0.0926 / +0.0926 |

## 328 >=8★ (n=328, Index Ceiling=98.63% micro)

| `topK` | Total Hits | Recall@K (Macro) | Recall@K (Micro) | Indexed-Only Recall (Macro) | Indexed-Only Recall (Micro) | Per-User Hit Rate (`>=1` hit) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 15 | 344 | 0.1049 | 0.1049 | 0.1059 | 0.1063 | 53.05% (174/328) |
| 30 | 541 | 0.1649 | 0.1649 | 0.1665 | 0.1672 | 67.38% (221/328) |
| 45 | 701 | 0.2137 | 0.2137 | 0.2158 | 0.2167 | 73.78% (242/328) |
| 60 | 828 | 0.2524 | 0.2524 | 0.2549 | 0.2560 | 78.96% (259/328) |
| 80 | 962 | 0.2933 | 0.2933 | 0.2970 | 0.2974 | 84.76% (278/328) |
| 100 | 1098 | 0.3348 | 0.3348 | 0.3388 | 0.3394 | 86.89% (285/328) |
| 150 | 1343 | 0.4095 | 0.4095 | 0.4147 | 0.4151 | 91.16% (299/328) |

## 328 >=9★ (n=304, Index Ceiling=98.90% micro)

| `topK` | Total Hits | Recall@K (Macro) | Recall@K (Micro) | Indexed-Only Recall (Macro) | Indexed-Only Recall (Micro) | Per-User Hit Rate (`>=1` hit) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 15 | 344 | 0.1163 | 0.1147 | 0.1176 | 0.1159 | 55.26% (168/304) |
| 30 | 542 | 0.1825 | 0.1807 | 0.1844 | 0.1827 | 72.37% (220/304) |
| 45 | 692 | 0.2322 | 0.2307 | 0.2346 | 0.2332 | 81.25% (247/304) |
| 60 | 838 | 0.2804 | 0.2793 | 0.2831 | 0.2824 | 86.51% (263/304) |
| 80 | 998 | 0.3334 | 0.3327 | 0.3367 | 0.3364 | 90.79% (276/304) |
| 100 | 1135 | 0.3793 | 0.3783 | 0.3832 | 0.3825 | 94.41% (287/304) |
| 150 | 1372 | 0.4585 | 0.4573 | 0.4631 | 0.4624 | 97.37% (296/304) |

## fresh_300 >=8★ (n=300, Index Ceiling=99.97% micro)

| `topK` | Total Hits | Recall@K (Macro) | Recall@K (Micro) | Indexed-Only Recall (Macro) | Indexed-Only Recall (Micro) | Per-User Hit Rate (`>=1` hit) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 15 | 294 | 0.0980 | 0.0980 | 0.0980 | 0.0980 | 55.67% (167/300) |
| 30 | 477 | 0.1590 | 0.1590 | 0.1590 | 0.1591 | 70.33% (211/300) |
| 45 | 623 | 0.2077 | 0.2077 | 0.2077 | 0.2077 | 78.33% (235/300) |
| 60 | 735 | 0.2450 | 0.2450 | 0.2450 | 0.2451 | 83.33% (250/300) |
| 80 | 861 | 0.2870 | 0.2870 | 0.2870 | 0.2871 | 86.67% (260/300) |
| 100 | 999 | 0.3330 | 0.3330 | 0.3330 | 0.3331 | 91.67% (275/300) |
| 150 | 1213 | 0.4043 | 0.4043 | 0.4043 | 0.4045 | 94.67% (284/300) |

## fresh_300 >=9★ (n=284, Index Ceiling=99.96% micro)

| `topK` | Total Hits | Recall@K (Macro) | Recall@K (Micro) | Indexed-Only Recall (Macro) | Indexed-Only Recall (Micro) | Per-User Hit Rate (`>=1` hit) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 15 | 343 | 0.1227 | 0.1219 | 0.1227 | 0.1219 | 66.90% (190/284) |
| 30 | 559 | 0.1991 | 0.1986 | 0.1991 | 0.1987 | 82.04% (233/284) |
| 45 | 703 | 0.2498 | 0.2498 | 0.2498 | 0.2499 | 87.32% (248/284) |
| 60 | 822 | 0.2917 | 0.2921 | 0.2917 | 0.2922 | 92.61% (263/284) |
| 80 | 984 | 0.3494 | 0.3497 | 0.3494 | 0.3498 | 94.72% (269/284) |
| 100 | 1101 | 0.3908 | 0.3913 | 0.3908 | 0.3914 | 97.18% (276/284) |
| 150 | 1322 | 0.4698 | 0.4698 | 0.4698 | 0.4700 | 98.24% (279/284) |
