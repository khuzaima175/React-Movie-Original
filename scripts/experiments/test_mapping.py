import os
import json
import collections

root = "g:/Important Projects/movie-ratings"

# 1. Load small ratings and find the 328 eligible users
ratings_path = os.path.join(root, ".data/ml-latest-small/ratings.csv")
benchmark_uids = {"89", "263", "409", "561"}

user_ratings = collections.defaultdict(list)
with open(ratings_path, "r", encoding="utf-8") as f:
    f.readline()
    for line in f:
        uid, mid, r, ts = line.strip().split(",")
        if uid in benchmark_uids:
            continue
        user_ratings[uid].append((mid, r, int(ts)))

eligible_users = []
for uid, ratings in user_ratings.items():
    if len(ratings) < 60:
        continue
    ratings.sort(key=lambda x: x[2])
    pos = [x for x in ratings if float(x[1]) * 2 >= 8]
    if len(pos) >= 15:
        eligible_users.append(uid)

eligible_users.sort(key=int)
print(f"Eligible users: {len(eligible_users)}")

# Build lookup tuple -> list of small uids
tuple_to_small = collections.defaultdict(list)
for uid in eligible_users:
    for mid, r, ts in user_ratings[uid]:
        tuple_to_small[(mid, r, str(ts))].append(uid)

# Scan ml-32m/ratings.csv
ratings_32m_path = os.path.join(root, ".data/ml-32m/ratings.csv")
# user_matches: small_uid -> dict of (u_32m -> match_count)
user_matches = collections.defaultdict(lambda: collections.defaultdict(int))

print(f"Scanning {ratings_32m_path}...")
matched_tuples = 0
with open(ratings_32m_path, "r", encoding="utf-8") as f:
    f.readline()
    for line in f:
        u_32m, mid, r, ts = line.strip().split(",")
        key = (mid, r, ts)
        if key in tuple_to_small:
            matched_tuples += 1
            for s_uid in tuple_to_small[key]:
                user_matches[s_uid][u_32m] += 1

print(f"Total matched tuple occurrences: {matched_tuples}")

mapping = {}
unique_count = 0
ambiguous_count = 0
unmatched_count = 0

for uid in eligible_users:
    matches = user_matches.get(uid, {})
    if not matches:
        unmatched_count += 1
        mapping[uid] = {
            "status": "unmatched",
            "ml32m_userId": None,
            "matched_ratings": 0
        }
    elif len(matches) == 1:
        u_32m, cnt = next(iter(matches.items()))
        unique_count += 1
        mapping[uid] = {
            "status": "unique",
            "ml32m_userId": int(u_32m),
            "matched_ratings": cnt,
            "total_ratings": len(user_ratings[uid])
        }
    else:
        # Multiple candidates: check if one candidate has the vast majority of matches
        sorted_cands = sorted(matches.items(), key=lambda x: x[1], reverse=True)
        top_cand, top_cnt = sorted_cands[0]
        second_cand, second_cnt = sorted_cands[1]
        if top_cnt >= 20 and top_cnt > 10 * second_cnt:
            unique_count += 1
            mapping[uid] = {
                "status": "unique_dominant",
                "ml32m_userId": int(top_cand),
                "matched_ratings": top_cnt,
                "total_ratings": len(user_ratings[uid]),
                "other_matches": dict(sorted_cands[1:5])
            }
        else:
            ambiguous_count += 1
            mapping[uid] = {
                "status": "ambiguous",
                "candidates": dict(sorted_cands[:5]),
                "total_ratings": len(user_ratings[uid])
            }

print(f"Results across {len(eligible_users)} users:")
print(f"  Uniquely resolved: {unique_count}")
print(f"  Ambiguous: {ambiguous_count}")
print(f"  Unmatched: {unmatched_count}")

out_path = os.path.join(root, ".data/user_id_map.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump({
        "summary": {
            "total_eligible": len(eligible_users),
            "unique": unique_count,
            "ambiguous": ambiguous_count,
            "unmatched": unmatched_count
        },
        "mapping": mapping
    }, f, indent=2)

print(f"Saved mapping to {out_path}")
