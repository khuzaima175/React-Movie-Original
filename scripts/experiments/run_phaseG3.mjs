import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

function median(values) {
  const nums = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 1 ? nums[mid] : 0.5 * (nums[mid - 1] + nums[mid]);
}

function l2Norm(vec, offset = 0, len = vec.length) {
  let s = 0;
  for (let d = 0; d < len; d++) {
    const x = vec[offset + d];
    s += x * x;
  }
  return Math.sqrt(s);
}

function retrieveByCosine(personas, index, excludeTmdbIds = new Set(), topK = 30) {
  if (!personas || personas.length === 0 || !index || !index.count) return [];
  const { count, dim, ids, vectors } = index;
  const unitPersonas = personas.map(p => {
    const n = l2Norm(p, 0, dim);
    if (n <= 1e-12) return Float32Array.from(p);
    const u = new Float32Array(dim);
    for (let d = 0; d < dim; d++) u[d] = p[d] / n;
    return u;
  });

  const excluded = new Set([...(excludeTmdbIds || [])].map(Number));
  const results = [];

  for (let i = 0; i < count; i++) {
    const tmdbId = ids[i];
    if (excluded.has(tmdbId)) continue;
    const base = i * dim;
    const normV = l2Norm(vectors, base, dim);
    if (normV <= 1e-12) continue;
    const invNormV = 1 / normV;

    let bestCos = -Infinity;
    for (const p of unitPersonas) {
      let dot = 0;
      for (let d = 0; d < dim; d++) {
        dot += p[d] * (vectors[base + d] * invNormV);
      }
      if (dot > bestCos) bestCos = dot;
    }
    results.push({ tmdbId, cosineSim: bestCos, normV });
  }

  results.sort((a, b) => b.cosineSim - a.cosineSim);
  return results.slice(0, topK);
}

async function resolveMetadataMap(tmdbIds, enrichedItems, tmdbKey) {
  const metaMap = new Map();
  const missingIds = [];

  for (const id of tmdbIds) {
    const hit = enrichedItems[String(id)];
    const yearNum = hit?.year ? Number.parseInt(String(hit.year).slice(0, 4), 10) : NaN;
    if (hit && hit.title && Number.isFinite(yearNum) && hit.vote_count !== undefined && hit.vote_count !== null) {
      metaMap.set(id, {
        tmdbId: id,
        title: hit.title,
        year: yearNum,
        vote_count: Number(hit.vote_count),
        source: "tmdb_enriched"
      });
    } else {
      missingIds.push(id);
    }
  }

  const uniqueMissing = [...new Set(missingIds)];
  for (const id of uniqueMissing) {
    if (!tmdbKey) {
      metaMap.set(id, { tmdbId: id, title: `TMDB#${id}`, year: null, vote_count: null, source: "missing_no_key" });
      continue;
    }
    try {
      const res = await fetch(`https://api.themoviedb.org/3/movie/${id}?api_key=${tmdbKey}`, { cache: "no-store" });
      if (!res.ok) {
        metaMap.set(id, { tmdbId: id, title: `TMDB#${id}`, year: null, vote_count: null, source: `tmdb_api_http_${res.status}` });
        continue;
      }
      const m = await res.json();
      const yearNum = m?.release_date ? Number.parseInt(String(m.release_date).slice(0, 4), 10) : NaN;
      metaMap.set(id, {
        tmdbId: id,
        title: m?.title || `TMDB#${id}`,
        year: Number.isFinite(yearNum) ? yearNum : null,
        vote_count: typeof m?.vote_count === "number" ? m.vote_count : 0,
        source: "tmdb_api"
      });
    } catch (_) {
      metaMap.set(id, { tmdbId: id, title: `TMDB#${id}`, year: null, vote_count: null, source: "tmdb_api_error" });
    }
  }

  return metaMap;
}

async function main() {
  loadDotEnv(path.join(ROOT, ".env"));
  const tmdbKey = process.env.VITE_TMDB_KEY?.trim() || "";

  const [{ extractTasteProfile }, { parseEmbeddingBinary, computeUserPersonas, retrieveByEmbedding }] =
    await Promise.all([
      import("../../src/services/tmdbService.js"),
      import("../../src/services/embeddingService.js")
    ]);

  const embBuf = fs.readFileSync(path.join(ROOT, "public/models/item_embeddings_f16.bin"));
  const embeddingIndex = parseEmbeddingBinary(
    embBuf.buffer.slice(embBuf.byteOffset, embBuf.byteOffset + embBuf.byteLength)
  );
  const { vaults } = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/benchmark_vaults.json"), "utf8"));
  const enriched = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/tmdb_enriched.json"), "utf8"));
  const enrichedItems = enriched.items || {};

  const targetVaultNames = ["ml-user-561", "ml-user-409"];
  const rawVaultRuns = [];
  const allTmdbIdsNeeded = new Set();

  for (const name of targetVaultNames) {
    const vault = vaults.find(v => v.name === name);
    if (!vault) throw new Error(`Vault ${name} not found`);
    const watchedCopy = (vault.watched || []).map(x => ({ ...x }));
    const profile = await extractTasteProfile(watchedCopy, []);
    const personas = computeUserPersonas(profile.weightedRatings, embeddingIndex);
    const excludeWatched = new Set(watchedCopy.map(m => Number(m?.tmdbId ?? m?.id ?? 0)));

    const dotList = retrieveByEmbedding(personas, embeddingIndex, excludeWatched, 30).map(item => {
      const idx = embeddingIndex.idToIndex.get(item.tmdbId);
      const normV = idx !== undefined ? l2Norm(embeddingIndex.vectors, idx * embeddingIndex.dim, embeddingIndex.dim) : null;
      return { tmdbId: item.tmdbId, rawScore: item.collabSim, normV };
    });

    const cosList = retrieveByCosine(personas, embeddingIndex, excludeWatched, 30).map(item => ({
      tmdbId: item.tmdbId,
      rawScore: item.cosineSim,
      normV: item.normV
    }));

    for (const x of [...dotList, ...cosList]) allTmdbIdsNeeded.add(x.tmdbId);

    rawVaultRuns.push({
      name,
      personaCount: personas.length,
      personaNorms: personas.map(p => Number(l2Norm(p, 0, embeddingIndex.dim).toFixed(6))),
      dotList,
      cosList
    });
  }

  const metaMap = await resolveMetadataMap([...allTmdbIdsNeeded], enrichedItems, tmdbKey);

  const report = {
    generatedAt: new Date().toISOString(),
    uniqueIdsResolved: metaMap.size,
    resolvedFromEnriched: [...metaMap.values()].filter(m => m.source === "tmdb_enriched").length,
    resolvedFromTmdbApi: [...metaMap.values()].filter(m => m.source === "tmdb_api").length,
    resolvedErrors: [...metaMap.values()].filter(m => !["tmdb_enriched", "tmdb_api"].includes(m.source)).length,
    vaults: []
  };

  for (const run of rawVaultRuns) {
    const decorate = (list) =>
      list.map((item, idx) => {
        const m = metaMap.get(item.tmdbId) || {};
        const vc = typeof m.vote_count === "number" ? m.vote_count : null;
        const log10vc = vc !== null && vc > 0 ? Number(Math.log10(vc).toFixed(4)) : null;
        return {
          rank: idx + 1,
          tmdbId: item.tmdbId,
          title: m.title ?? `TMDB#${item.tmdbId}`,
          year: m.year ?? null,
          vote_count: vc,
          log10VoteCount: log10vc,
          rawScore: Number(item.rawScore.toFixed(6)),
          normV: item.normV !== null ? Number(item.normV.toFixed(4)) : null,
          source: m.source
        };
      });

    const dotDecorated = decorate(run.dotList);
    const cosDecorated = decorate(run.cosList);

    const summarize = (items) => {
      const years = items.map(x => x.year).filter(y => Number.isFinite(y));
      const logVcs = items.map(x => x.log10VoteCount).filter(v => Number.isFinite(v));
      const vcs = items.map(x => x.vote_count).filter(v => Number.isFinite(v));
      const lt1980 = years.filter(y => y < 1980).length;
      return {
        count: items.length,
        validYearCount: years.length,
        validVoteCount: logVcs.length,
        medianYear: median(years),
        medianLog10VoteCount: median(logVcs) !== null ? Number(median(logVcs).toFixed(4)) : null,
        medianVoteCount: median(vcs),
        lt1980Count: lt1980
      };
    };

    const dotIds = new Set(dotDecorated.map(x => x.tmdbId));
    const overlapCount = cosDecorated.filter(x => dotIds.has(x.tmdbId)).length;

    const vReport = {
      name: run.name,
      personaCount: run.personaCount,
      personaNorms: run.personaNorms,
      overlapCount,
      dotProductSummary: summarize(dotDecorated),
      cosineSummary: summarize(cosDecorated),
      dotProductTop30: dotDecorated,
      cosineTop30: cosDecorated
    };
    report.vaults.push(vReport);

    console.log(
      `\n================================================================================\nVAULT ${run.name} | personas=${run.personaCount} (norms=${JSON.stringify(run.personaNorms)}) | overlap=${overlapCount}/30`
    );
    console.log("DOT-PRODUCT Summary:", JSON.stringify(vReport.dotProductSummary));
    for (const x of dotDecorated) {
      console.log(
        `  DOT #${String(x.rank).padStart(2)} | ${x.title} | ${x.year} | log10(vc)=${x.log10VoteCount} (vc=${x.vote_count}) | score=${x.rawScore} | ||v||=${x.normV}`
      );
    }
    console.log("COSINE Summary:", JSON.stringify(vReport.cosineSummary));
    for (const x of cosDecorated) {
      console.log(
        `  COS #${String(x.rank).padStart(2)} | ${x.title} | ${x.year} | log10(vc)=${x.log10VoteCount} (vc=${x.vote_count}) | score=${x.rawScore} | ||v||=${x.normV}`
      );
    }
  }

  const outPath = path.join(ROOT, ".data/phaseG3_results.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nSaved G3 results to ${outPath} (enriched=${report.resolvedFromEnriched}, api=${report.resolvedFromTmdbApi}, err=${report.resolvedErrors})`);
}

main().catch(err => {
  console.error("G3 failed:", err);
  process.exit(1);
});
