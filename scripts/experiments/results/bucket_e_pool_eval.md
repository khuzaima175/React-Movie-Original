# Bucket E Alone (`rankCandidatePool`) Evaluation (`clean2` Index)

- Generated: `2026-11-15T04:26:36.637Z`
- Index: `.data/item_embeddings_clean2_f16.bin`
- Protocol: Calls `retrieveAlignedEmbeddingNeighbors` with production `catalogMax` and `repulsionWeight = |repulsion| / collabSim`, takes Bucket E's top-`K` alone (`K ∈ {30, 60, 80}`), maps onto the enriched offline catalog (no Buckets A–D), and ranks with production `rankCandidatePool` (`DEFAULT_RANKER_WEIGHTS`, `topK = 30`, `coldOnly: true` structured fallback, recent-release reserve).

| Cohort | Valid Users | `K` | Mean Mapped Pool | Mean Pool Ceiling | `NDCG@10` | `NDCG@10` d vs `K=30` (95% CI) | `Recall@10` | `Recall@10` d vs `K=30` (95% CI) | `Hit@10` (>=1) |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- | :---: | :--- | :---: |
| 328 >=8★ | 328 | 30 | 29.80 | 0.1649 | 0.0914 | baseline | 0.0814 | baseline | 0.4970 |
| 328 >=8★ | 328 | 60 | 59.53 | 0.2524 | 0.0908 | -0.0007 [-0.0018, +0.0004] | 0.0802 | -0.0012 [-0.0034, +0.0006] | 0.4878 |
| 328 >=8★ | 328 | 80 | 79.33 | 0.2933 | 0.0909 | -0.0005 [-0.0017, +0.0006] | 0.0805 | -0.0009 [-0.0027, +0.0009] | 0.4878 |
| 328 >=9★ | 304 | 30 | 29.84 | 0.1825 | 0.1144 | baseline | 0.0977 | baseline | 0.5395 |
| 328 >=9★ | 304 | 60 | 59.61 | 0.2804 | 0.1147 | +0.0003 [-0.0011, +0.0021] | 0.0977 | +0.0000 [-0.0020, +0.0020] | 0.5395 |
| 328 >=9★ | 304 | 80 | 79.42 | 0.3334 | 0.1146 | +0.0002 [-0.0011, +0.0019] | 0.0977 | +0.0000 [-0.0020, +0.0020] | 0.5395 |
| fresh_300 >=8★ | 300 | 30 | 29.54 | 0.1590 | 0.0760 | baseline | 0.0757 | baseline | 0.4467 |
| fresh_300 >=8★ | 300 | 60 | 59.03 | 0.2450 | 0.0775 | +0.0015 [-0.0006, +0.0041] | 0.0767 | +0.0010 [-0.0010, +0.0030] | 0.4500 |
| fresh_300 >=8★ | 300 | 80 | 78.61 | 0.2870 | 0.0782 | +0.0022 [-0.0003, +0.0051] | 0.0773 | +0.0017 [-0.0007, +0.0040] | 0.4500 |
| fresh_300 >=9★ | 284 | 30 | 29.58 | 0.1991 | 0.1238 | baseline | 0.1018 | baseline | 0.6021 |
| fresh_300 >=9★ | 284 | 60 | 59.12 | 0.2917 | 0.1227 | -0.0010 [-0.0023, +0.0004] | 0.1000 | -0.0018 [-0.0039, +0.0004] | 0.5951 |
| fresh_300 >=9★ | 284 | 80 | 78.75 | 0.3494 | 0.1224 | -0.0014 [-0.0028, +0.0002] | 0.0993 | -0.0025 [-0.0049, -0.0000] * | 0.5951 |
