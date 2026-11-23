# MovieLens 32M Holdout Evaluation (Leakage-Clean)

- Dataset: `.data/fresh_300_users.json` + `.data/item_embeddings_clean2_f16.bin` (10 held-out `>=8★` films per user)
- Users evaluated (Fast arms): `20`
- Users evaluated (All 6 arms incl. Gemini 4 Hydrogen): `1`

## Table A: Head-to-Head Across All 6 Arms (Matched Hydrogen Subset)

| Arm | Users | Hit Rate (>=1/10) | Mean Hits@10 | Recall@10 | NDCG@10 | LT Recall@10 | LT NDCG@10 | Mean ln(Votes) | Catalog Match |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| local_ranker | 1 | 100.0% | 1 | 0.1 | **0.0737** | — | — | 8.877 | 1.000 |
| track1_math_hydrogen | 1 | 100.0% | 2 | 0.2 | **0.2343** | — | — | 0 | 1.000 |
| track1_math_flashlite | 1 | 100.0% | 1 | 0.1 | **0.1169** | — | — | 0 | 1.000 |
| fullvault_hydrogen | 1 | 0.0% | 0 | 0 | **0** | — | — | 7.378 | 1 |
| fullvault_flashlite | 1 | 0.0% | 0 | 0 | **0** | — | — | 8.399 | 0.95 |
| dossier_flashlite | 1 | 100.0% | 1 | 0.1 | **0.1169** | — | — | 0 | 1.000 |

## Table B: Broader Multi-User Benchmark (Local Ranker vs. Math+Flash-Lite vs. Full-Vault Flash-Lite)

| Arm | Users | Hit Rate (>=1/10) | Mean Hits@10 | Recall@10 | NDCG@10 | LT Recall@10 | LT NDCG@10 | Mean ln(Votes) | Catalog Match |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| local_ranker | 20 | 35.0% | 0.75 | 0.075 | **0.062** | 0 | 0 | 8.667 | 1.000 |
| track1_math_flashlite | 20 | 45.0% | 0.7 | 0.07 | **0.0683** | 0.011 | 0.0022 | 0 | 1.000 |
| fullvault_flashlite | 20 | 40.0% | 0.4 | 0.04 | **0.0288** | 0.011 | 0.0041 | 8.212 | 0.908 |
| track1_math_gemini36flash | 3 | 33.3% | 0.3333 | 0.0333 | **0.0124** | 0.0476 | 0.0177 | 0 | 1.000 |
