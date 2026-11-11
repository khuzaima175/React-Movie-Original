#!/usr/bin/env python3
"""
Offline Cinematic DNA distiller: films JSON -> public/models/cinematic_dna_u8.bin (CDNA v1).

Input  (--input): [{"tmdbId": 1, "title": "...", "year": 1999, "director": "...", "overview": "..."}]
Needs  GEMINI_API_KEY in the environment. Packs --pack films per prompt; output is positional
JSON [tmdbId, a1..a16] to keep tokens low. Progress is cached in --cache so re-runs resume.
"""
import argparse, json, os, struct, time

AXES = ["pacing", "melancholy", "cerebral_depth", "visual_style", "tension", "warmth", "violence",
        "humor", "realism", "emotional_intensity", "narrative_complexity", "moral_ambiguity",
        "romance", "spectacle", "dialogue_focus", "originality"]


def build_prompt(films):
    lines = [f'{f["tmdbId"]} | {f["title"]} ({f.get("year", "?")}) dir. {f.get("director", "?")} | {(f.get("overview") or "")[:240]}'
             for f in films]
    return (
        "Act as a film-school critic. Score each film 0-100 on these 16 axes in order: "
        + ", ".join(AXES)
        + ". Return ONLY a JSON array of arrays [tmdbId, v1..v16], one per film, same ids.\n\n"
        + "\n".join(lines)
    )


def parse_rows(text, expected_ids):
    rows = json.loads(text)
    out = {}
    for r in rows:
        if len(r) == len(AXES) + 1 and int(r[0]) in expected_ids and all(0 <= v <= 100 for v in r[1:]):
            out[int(r[0])] = [int(v) for v in r[1:]]
    return out


def write_binary(path, table):
    ids = sorted(table)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sIII", b"CDNA", 1, len(ids), len(AXES)))
        f.write(struct.pack(f"<{len(ids)}I", *ids))
        for i in ids:
            f.write(bytes(table[i]))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--out", default="public/models/cinematic_dna_u8.bin")
    p.add_argument("--cache", default=".data/dna_cache.json")
    p.add_argument("--model", default="gemini-3.8-flash")
    p.add_argument("--pack", type=int, default=10)
    p.add_argument("--limit", type=int, default=0, help="max films (use a small number to test cost first)")
    a = p.parse_args()

    from google import genai
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("VITE_GEMINI_KEY")
    if not key and os.path.exists(".env"):  # fall back to the project's own .env
        for line in open(".env", encoding="utf-8"):
            if line.startswith("VITE_GEMINI_KEY="):
                key = line.split("=", 1)[1].strip().strip('"\'')
    if not key:
        raise SystemExit("Set GEMINI_API_KEY (or VITE_GEMINI_KEY in .env)")
    client = genai.Client(api_key=key, http_options={"timeout": 45000})  # ms; avoids hanging on slow models
    films = json.load(open(a.input, encoding="utf-8"))
    if a.limit:
        films = films[: a.limit]
    table = {int(k): v for k, v in json.load(open(a.cache)).items()} if os.path.exists(a.cache) else {}
    todo = [f for f in films if int(f["tmdbId"]) not in table]

    for s in range(0, len(todo), a.pack):
        batch = todo[s : s + a.pack]
        ids = {int(f["tmdbId"]) for f in batch}
        text = None
        for model in [a.model, "gemini-3.7-flash", "gemini-3.5-flash", "gemini-2.5-flash"]:
            for attempt in range(2):  # retry once per model on transient errors (503/429)
                try:
                    text = client.models.generate_content(
                        model=model, contents=build_prompt(batch),
                        config={"response_mime_type": "application/json"}).text
                    break
                except Exception as e:
                    print(f"batch {s // a.pack} {model} try {attempt + 1} failed: {str(e)[:80]}")
                    time.sleep(3 * (attempt + 1))
            if text:
                break
        if text:
            try:
                table.update(parse_rows(text, ids))
            except Exception as e:
                print(f"batch {s // a.pack} unparsable: {e}")
        os.makedirs(os.path.dirname(os.path.abspath(a.cache)), exist_ok=True)
        json.dump(table, open(a.cache, "w"))
        print(f"{len(table)}/{len(films)} scored")

    if not table:
        raise SystemExit("No films scored; not writing an empty binary.")
    write_binary(a.out, table)
    print(f"Wrote {len(table)} films x {len(AXES)} axes to {a.out}")


if __name__ == "__main__":
    main()
