#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { encodeEmbeddingBinary, l2NormalizeInPlace } from "../src/services/embeddingService.js";

function parseArgs(argv) {
  const args = {
    input: "",
    out: "public/models/content_embeddings_f16.bin",
    cache: ".data/content_embed_cache.json",
    model: "gemini-embedding-001",
    dims: 64,
    batchSize: 50,
    minYear: 0
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--input" && v) { args.input = v; i++; }
    else if (k === "--out" && v) { args.out = v; i++; }
    else if (k === "--cache" && v) { args.cache = v; i++; }
    else if (k === "--model" && v) { args.model = v; i++; }
    else if (k === "--dims" && v) { args.dims = Number(v) || 64; i++; }
    else if (k === "--batch-size" && v) { args.batchSize = Math.max(1, Number(v) || 50); i++; }
    else if (k === "--min-year" && v) { args.minYear = Number(v) || 0; i++; }
  }
  return args;
}

function buildMovieDocumentText(item) {
  const title = String(item.title || "").trim();
  const year = String(item.year || item.release_date?.slice?.(0, 4) || "").trim();
  const tagline = String(item.tagline || "").trim();
  const overview = String(item.overview || item.plot || "").trim();
  return [
    title ? `${title}${year ? ` (${year})` : ""}` : "",
    tagline,
    overview
  ].filter(Boolean).join(". ");
}

async function loadJsonCache(cachePath) {
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveJsonCache(cachePath, cacheObj) {
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cacheObj), "utf8");
}

async function embedBatch(ai, model, texts, outputDimensionality) {
  const res = await ai.models.embedContent({
    model,
    contents: texts,
    config: {
      outputDimensionality,
      taskType: "SEMANTIC_SIMILARITY"
    }
  });

  if (Array.isArray(res?.embeddings) && res.embeddings.length === texts.length) {
    return res.embeddings.map(e => e?.values || []);
  }
  if (texts.length === 1 && Array.isArray(res?.embedding?.values)) {
    return [res.embedding.values];
  }

  // Per-item fallback if SDK response shape does not batch-align cleanly
  const out = [];
  for (const text of texts) {
    const single = await ai.models.embedContent({
      model,
      contents: text,
      config: { outputDimensionality, taskType: "SEMANTIC_SIMILARITY" }
    });
    const values = single?.embedding?.values || single?.embeddings?.[0]?.values || [];
    out.push(values);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    console.error("Usage: node scripts/build_content_embeddings.mjs --input <catalog.json> [--out public/models/content_embeddings_f16.bin] [--min-year 2024]");
    process.exit(1);
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_KEY;
  if (!apiKey) {
    console.error("Error: GEMINI_API_KEY (or VITE_GEMINI_KEY) is required to generate content embeddings.");
    process.exit(1);
  }

  const rawCatalog = JSON.parse(await readFile(args.input, "utf8"));
  const catalog = (Array.isArray(rawCatalog) ? rawCatalog : rawCatalog.items || [])
    .map(item => ({
      tmdbId: Number(item?.tmdbId ?? item?.id ?? 0),
      yearNum: Number(String(item?.year || item?.release_date || "").slice(0, 4)) || 0,
      text: buildMovieDocumentText(item)
    }))
    .filter(item => item.tmdbId > 0 && item.text.length > 0 && (!args.minYear || item.yearNum >= args.minYear));

  const cache = await loadJsonCache(args.cache);
  const ai = new GoogleGenAI({ apiKey });

  const pending = catalog.filter(item => !Array.isArray(cache[String(item.tmdbId)]) || cache[String(item.tmdbId)].length !== args.dims);
  console.log(`Catalog items: ${catalog.length}, cached: ${catalog.length - pending.length}, pending: ${pending.length}`);

  for (let i = 0; i < pending.length; i += args.batchSize) {
    const batch = pending.slice(i, i + args.batchSize);
    const vectors = await embedBatch(ai, args.model, batch.map(b => b.text), args.dims);

    for (let j = 0; j < batch.length; j++) {
      const vec = vectors[j];
      if (!Array.isArray(vec) || vec.length !== args.dims) continue;
      const arr = Float32Array.from(vec);
      l2NormalizeInPlace(arr, 0, args.dims);
      cache[String(batch[j].tmdbId)] = Array.from(arr, x => Number(x.toFixed(6)));
    }

    await saveJsonCache(args.cache, cache);
    console.log(`Embedded ${Math.min(i + batch.length, pending.length)}/${pending.length}`);
  }

  const entries = [];
  for (const item of catalog) {
    const vec = cache[String(item.tmdbId)];
    if (Array.isArray(vec) && vec.length === args.dims) {
      entries.push({ tmdbId: item.tmdbId, vector: vec });
    }
  }

  if (entries.length === 0) {
    console.error("No valid embedded vectors produced; skipping binary write.");
    process.exit(1);
  }

  const binary = encodeEmbeddingBinary(entries);
  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, Buffer.from(binary));
  console.log(`Wrote ${entries.length} content embeddings (${args.dims}-d f16) to ${args.out}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
