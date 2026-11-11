#!/usr/bin/env node
/**
 * Builds LOCAL-ONLY benchmark vaults from the public MovieLens "ml-latest-small" dataset so the
 * evaluation harness always has realistic multi-user data.
 *
 *   node scripts/build_benchmark_vaults.mjs --ml-dir .data/ml-latest-small --out .data/benchmark_vaults.json
 *
 * Options: --users 4  --per-user 100  --catalog-extra 250  --seed 1
 *
 * Needs a TMDB key (VITE_TMDB_KEY in .env, or TMDB_KEY in the environment).
 * Output goes to .data/, which is gitignored: GroupLens does not permit redistributing MovieLens
 * data, so never commit the output.
 *
 * Caveat: embeddings trained on MovieLens have already seen these users' ratings, so collabSim
 * results on these vaults are leaky. They are valid for non-collaborative features.
 */
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readTmdbKey() {
  if (process.env.TMDB_KEY) return process.env.TMDB_KEY.trim();
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return "";
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*VITE_TMDB_KEY\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "").trim();
  }
  return "";
}

function readCsv(file, columns) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(",");
  const idx = columns.map(c => header.indexOf(c));
  return lines.slice(1).map(line => {
    const parts = line.split(",");
    return Object.fromEntries(columns.map((c, i) => [c, parts[idx[i]]]));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchDetails(tmdbId, key, cache) {
  if (cache[tmdbId] !== undefined) return cache[tmdbId];
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${key}&append_to_response=keywords,credits`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) {
        cache[tmdbId] = null;
        return null;
      }
      if (res.status === 429) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      const crew = d.credits?.crew || [];
      const director = crew.find(c => c.job === "Director");
      const fallbackCrew = crew.find(c => ["Screenplay", "Writer", "Story"].includes(c.job));
      const film = {
        id: d.id,
        tmdbId: d.id,
        title: d.title,
        year: d.release_date ? d.release_date.slice(0, 4) : "N/A",
        tmdbGenreIds: (d.genres || []).map(g => g.id),
        tmdbKeywords: (d.keywords?.keywords || []).slice(0, 10).map(k => k.id),
        castIds: (d.credits?.cast || []).slice(0, 6).map(c => c.id),
        crewPersonId: (director || fallbackCrew)?.id || null,
        vote_average: d.vote_average,
        vote_count: d.vote_count
      };
      cache[tmdbId] = film;
      return film;
    } catch (err) {
      if (attempt === 3) return null;
      await sleep(500);
    }
  }
  return null;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mlDir = path.resolve(args["ml-dir"] || ".data/ml-latest-small");
  const outPath = path.resolve(args.out || ".data/benchmark_vaults.json");
  const userCount = Number(args.users) || 4;
  const perUser = Number(args["per-user"]) || 100;
  const catalogExtra = Number(args["catalog-extra"]) || 250;
  const seed = Number(args.seed) || 1;

  const key = readTmdbKey();
  if (!key) {
    console.error("No TMDB key found (set VITE_TMDB_KEY in .env or TMDB_KEY in the environment).");
    process.exit(2);
  }

  const links = new Map(
    readCsv(path.join(mlDir, "links.csv"), ["movieId", "tmdbId"])
      .filter(r => r.tmdbId)
      .map(r => [r.movieId, Number(r.tmdbId)])
  );
  const ratings = readCsv(path.join(mlDir, "ratings.csv"), ["userId", "movieId", "rating", "timestamp"])
    .filter(r => links.has(r.movieId))
    .map(r => ({
      userId: r.userId,
      tmdbId: links.get(r.movieId),
      rating: Number(r.rating),
      ts: Number(r.timestamp)
    }));

  const byUser = new Map();
  const popularity = new Map();
  for (const r of ratings) {
    if (!byUser.has(r.userId)) byUser.set(r.userId, []);
    byUser.get(r.userId).push(r);
    popularity.set(r.tmdbId, (popularity.get(r.tmdbId) || 0) + 1);
  }

  // Eligible: enough ratings, and a healthy mix of liked (>= 4 stars) and other films.
  const eligible = [...byUser.entries()]
    .filter(([, list]) => {
      if (list.length < perUser + 20) return false;
      const liked = list.filter(r => r.rating >= 4).length / list.length;
      return liked >= 0.3 && liked <= 0.7;
    })
    .map(([userId]) => userId)
    .sort((a, b) => Number(a) - Number(b));

  if (eligible.length < userCount) {
    console.error(`Only ${eligible.length} eligible users; need ${userCount}.`);
    process.exit(1);
  }

  // Evenly spaced picks (seed shifts the starting point) so users are not neighbours in id order.
  const rng = mulberry32(seed);
  const stride = Math.floor(eligible.length / userCount);
  const start = Math.floor(rng() * stride);
  const chosen = Array.from({ length: userCount }, (_, i) => eligible[start + i * stride]);

  const wanted = new Set();
  const vaultRatings = {};
  for (const userId of chosen) {
    const recent = byUser
      .get(userId)
      .slice()
      .sort((a, b) => a.ts - b.ts)
      .slice(-perUser);
    vaultRatings[userId] = recent;
    recent.forEach(r => wanted.add(r.tmdbId));
  }

  const popular = [...popularity.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, catalogExtra)
    .map(([id]) => id);
  popular.forEach(id => wanted.add(id));

  const cachePath = path.resolve(".data/tmdb_cache.json");
  const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : {};
  const ids = [...wanted];
  console.log(`Fetching TMDB metadata for ${ids.length} films (${Object.keys(cache).length} cached)...`);

  const films = await mapLimit(ids, 8, id => fetchDetails(id, key, cache));
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache));

  const filmById = new Map();
  films.forEach(f => f && filmById.set(f.tmdbId, f));

  const vaults = chosen.map(userId => {
    const watched = vaultRatings[userId]
      .map(r => {
        const film = filmById.get(r.tmdbId);
        if (!film) return null;
        return {
          ...film,
          userRating: Math.round(r.rating * 2),
          dateWatched: new Date(r.ts * 1000).toISOString().slice(0, 10)
        };
      })
      .filter(Boolean);
    return { name: `ml-user-${userId}`, watched };
  });

  const catalog = [...filmById.values()];
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ catalog, vaults }));
  console.log(
    `Wrote ${path.relative(process.cwd(), outPath)}: ${catalog.length} catalog films, ` +
      vaults.map(v => `${v.name} (${v.watched.length})`).join(", ")
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
