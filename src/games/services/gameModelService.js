/**
 * Lazy Session Loaders for GameVault's Pre-Trained Offline ML Assets (`/models/games/*`).
 * Zero bytes are fetched until a user enters Games mode (`/games*` or `/game/:id`).
 */

import {
  createSessionBinaryIndexLoader,
  parseEmbeddingBinary
} from "../../services/embeddingService.js";
import { parseEaseBinary } from "../../services/easeService.js";

export const GAME_EASE_URL = "/models/games/game_ease_k80.cvea";
export const GAME_COLLAB_URL = "/models/games/game_embeddings_f16.bin";
export const GAME_CONTENT_URL = "/models/games/game_content_f16.bin";
export const GAME_CATALOG_META_URL = "/models/games/game_catalog_meta.bin";
export const GAME_TUNER_URL = "/models/games/game_tuner_axes.json";
export const GAME_WEIGHTS_URL = "/models/games/game_ranker_weights.json";
export const GAME_STEAM_MAP_URL = "/models/games/game_steam_to_igdb.json";
export const GAME_EDITION_ALIASES_URL = "/models/games/game_edition_aliases.json";

export const CATALOG_GENRE_BIT_IDS = Object.freeze([12, 31, 5, 32, 15, 8, 25, 9, 13, 4, 10, 16, 24, 34, 35]);
export const CATALOG_TBA_RELEASE_DAY = -32768;

/**
 * Decodes log2-packed typical playtime byte (`Math.round(Math.log2(1 + hours) * 30)`) into hours.
 */
export function decodeCatalogTypicalHours(byteVal) {
  const b = Number(byteVal);
  if (!Number.isFinite(b) || b <= 0) return 0;
  return Math.max(0, Math.pow(2, b / 30) - 1);
}

/**
 * Parses `game_embeddings_f16.bin` and lifts shrinkage-compressed Spectral-EASE vectors (`||e|| ≈ 0.05-0.14`)
 * into Bayesian-shrunk `[0.25 .. 0.96]` norm space (`v' = v / (||v|| + 0.015)`) so Ridge fold-in (`lambda=20`),
 * multi-persona mixture (`beta=20`), top-loved dot products, and `pointLookup` operate at full dynamic range.
 * Unit-norm indexes (median norm >= 0.35) are returned unchanged.
 */
export function parseGameCollabBinary(arrayBuffer) {
  const index = parseEmbeddingBinary(arrayBuffer);
  if (!index || !index.count || !index.dim || !index.vectors) return index;

  const { count, dim, vectors } = index;
  const sampleStep = Math.max(1, Math.floor(count / 200));
  const sampleNorms = [];
  for (let i = 0; i < count; i += sampleStep) {
    const base = i * dim;
    let sumSq = 0;
    for (let d = 0; d < dim; d++) sumSq += vectors[base + d] * vectors[base + d];
    sampleNorms.push(Math.sqrt(sumSq));
  }
  sampleNorms.sort((a, b) => a - b);
  const medianNorm = sampleNorms[Math.floor(sampleNorms.length / 2)] || 0;
  if (medianNorm <= 1e-8 || medianNorm >= 0.35) {
    return index;
  }

  const shrinkPrior = 0.015;
  for (let i = 0; i < count; i++) {
    const base = i * dim;
    let sumSq = 0;
    for (let d = 0; d < dim; d++) sumSq += vectors[base + d] * vectors[base + d];
    const norm = Math.sqrt(sumSq);
    if (norm <= 1e-10) continue;
    const scale = 1 / (norm + shrinkPrior);
    for (let d = 0; d < dim; d++) vectors[base + d] *= scale;
  }

  return index;
}

/**
 * Parses `game_catalog_meta.bin` (CVGM v1 12 B, v2 14 B, or v3 18 B with IGDB CCU, Steam sentiment & game modes)
 * into dense TypedArrays + O(1) id lookup.
 * Note: `releaseDay` is days since 2000-01-01 UTC (-32768 = TBA), evaluated dynamically against today at runtime.
 */
export function parseGameCatalogMetaBinary(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < 16) return null;
  const view = new DataView(arrayBuffer);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  if (magic !== "CVGM") return null;
  const version = view.getUint32(4, true);
  const count = view.getUint32(8, true);
  const recordBytes = view.getUint32(12, true);
  const validV1 = version === 1 && recordBytes === 12;
  const validV2 = version === 2 && recordBytes >= 14;
  const validV3 = version === 3 && recordBytes >= 18;
  if ((!validV1 && !validV2 && !validV3) || count === 0) return null;
  if (arrayBuffer.byteLength < 16 + count * recordBytes) return null;

  const ids = new Uint32Array(count);
  const releaseDay = new Int16Array(count);
  const ratingByte = new Uint8Array(count);
  const voteTier = new Uint8Array(count);
  const platformMask = new Uint8Array(count);
  const specAndFlags = new Uint8Array(count);
  const genreMask = new Uint16Array(count);
  const typicalHours = new Float32Array(count);
  const hasVerifiedTtb = new Uint8Array(count);
  const modeMask = new Uint8Array(count);
  const steamCcuTier = new Uint8Array(count);
  const steamSentiment = new Uint8Array(count);
  const liveFlags = new Uint8Array(count);
  const idToIndex = new Map();

  for (let i = 0; i < count; i++) {
    const off = 16 + i * recordBytes;
    const id = view.getUint32(off, true);
    ids[i] = id;
    releaseDay[i] = view.getInt16(off + 4, true);
    ratingByte[i] = view.getUint8(off + 6);
    voteTier[i] = view.getUint8(off + 7);
    platformMask[i] = view.getUint8(off + 8);
    specAndFlags[i] = view.getUint8(off + 9);
    genreMask[i] = view.getUint16(off + 10, true);
    if (validV2 || validV3) {
      typicalHours[i] = decodeCatalogTypicalHours(view.getUint8(off + 12));
      hasVerifiedTtb[i] = view.getUint8(off + 13) & 0x01;
    }
    if (validV3) {
      modeMask[i] = view.getUint8(off + 14);
      steamCcuTier[i] = view.getUint8(off + 15);
      steamSentiment[i] = view.getUint8(off + 16);
      liveFlags[i] = view.getUint8(off + 17);
    }
    idToIndex.set(id, i);
  }

  return {
    version,
    count,
    ids,
    releaseDay,
    ratingByte,
    voteTier,
    platformMask,
    specAndFlags,
    genreMask,
    typicalHours,
    hasVerifiedTtb,
    modeMask,
    steamCcuTier,
    steamSentiment,
    liveFlags,
    idToIndex
  };
}

function normalizeVec(vec) {
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) normSq += vec[i] * vec[i];
  const norm = Math.sqrt(normSq);
  if (norm <= 1e-10) return vec.slice();
  return vec.map((v) => v / norm);
}

/**
 * Löwdin symmetric orthogonalization for the Intensity (`pacingVec`) and Tone (`toneVec`) neural axes.
 * Unlike order-dependent Gram-Schmidt, both axes rotate equally (~16.5° each) so `cos(u', v') === 0`
 * while preserving exact popularity decorrelation (linear combination of two vectors orthogonal to popVec).
 */
export function orthogonalizeTunerAxes(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const rawU = parsed.intensityVec || parsed.pacingVec;
  const rawV = parsed.toneVec;
  if (!Array.isArray(rawU) || !Array.isArray(rawV) || rawU.length === 0 || rawU.length !== rawV.length) {
    return null;
  }
  if (parsed._lowdinOrthogonalized) {
    return parsed;
  }

  const u = normalizeVec(rawU.map(Number));
  const v = normalizeVec(rawV.map(Number));
  let dot = 0;
  for (let i = 0; i < u.length; i++) dot += u[i] * v[i];
  if (Math.abs(dot) < 1e-4) {
    return {
      ...parsed,
      pacingVec: u,
      intensityVec: u,
      toneVec: v,
      _lowdinOrthogonalized: true
    };
  }

  const sum = new Array(u.length);
  const diff = new Array(u.length);
  for (let i = 0; i < u.length; i++) {
    sum[i] = u[i] + v[i];
    diff[i] = u[i] - v[i];
  }
  const a = normalizeVec(sum);
  const b = normalizeVec(diff);
  const invSqrt2 = Math.SQRT1_2;
  const uOrth = new Array(u.length);
  const vOrth = new Array(u.length);
  for (let i = 0; i < u.length; i++) {
    uOrth[i] = (a[i] + b[i]) * invSqrt2;
    vOrth[i] = (a[i] - b[i]) * invSqrt2;
  }

  return {
    ...parsed,
    pacingVec: uOrth,
    intensityVec: uOrth,
    toneVec: vOrth,
    _lowdinOrthogonalized: true
  };
}

const gameEaseLoader = createSessionBinaryIndexLoader(GAME_EASE_URL, parseEaseBinary);
const gameCollabLoader = createSessionBinaryIndexLoader(GAME_COLLAB_URL, parseGameCollabBinary);
const gameContentLoader = createSessionBinaryIndexLoader(GAME_CONTENT_URL, parseEmbeddingBinary);
const gameCatalogMetaLoader = createSessionBinaryIndexLoader(GAME_CATALOG_META_URL, parseGameCatalogMetaBinary);

let tunerAxesPromise = null;
let weightsPromise = null;
let steamMapPromise = null;
let editionAliasesPromise = null;

async function fetchJsonSafe(url, customFetch = null) {
  const fetchFn = typeof customFetch === "function"
    ? customFetch
    : (typeof window !== "undefined" && typeof window.fetch === "function" ? window.fetch.bind(window) : null);
  if (!fetchFn) return null;
  try {
    const res = await fetchFn(url);
    if (!res || !res.ok) return null;
    const text = await res.text();
    if (!text || text.trimStart().startsWith("<")) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function loadGameEaseIndex(url = GAME_EASE_URL, customFetch = null) {
  return gameEaseLoader.load(url, customFetch);
}

export function loadGameCollabIndex(url = GAME_COLLAB_URL, customFetch = null) {
  return gameCollabLoader.load(url, customFetch);
}

export function loadGameContentIndex(url = GAME_CONTENT_URL, customFetch = null) {
  return gameContentLoader.load(url, customFetch);
}

export function loadGameCatalogMeta(url = GAME_CATALOG_META_URL, customFetch = null) {
  return gameCatalogMetaLoader.load(url, customFetch);
}

export function loadGameTunerAxes(url = GAME_TUNER_URL, customFetch = null) {
  if (!tunerAxesPromise) {
    tunerAxesPromise = fetchJsonSafe(url, customFetch).then((parsed) => orthogonalizeTunerAxes(parsed));
  }
  return tunerAxesPromise;
}

export function loadGameRankerWeights(url = GAME_WEIGHTS_URL, customFetch = null) {
  if (!weightsPromise) {
    weightsPromise = fetchJsonSafe(url, customFetch);
  }
  return weightsPromise;
}

export function loadSteamCrosswalk(url = GAME_STEAM_MAP_URL, customFetch = null) {
  if (!steamMapPromise) {
    steamMapPromise = fetchJsonSafe(url, customFetch);
  }
  return steamMapPromise;
}

export function loadGameEditionAliases(url = GAME_EDITION_ALIASES_URL, customFetch = null) {
  if (!editionAliasesPromise) {
    editionAliasesPromise = fetchJsonSafe(url, customFetch);
  }
  return editionAliasesPromise;
}

/**
 * Loads all core recommendation assets concurrently on first entry into Games mode.
 */
export async function loadGameModelBundle(customFetch = null) {
  const [easeIndex, collabIndex, contentIndex, catalogMeta, tunerAxes, weights, editionAliases] = await Promise.all([
    loadGameEaseIndex(GAME_EASE_URL, customFetch),
    loadGameCollabIndex(GAME_COLLAB_URL, customFetch),
    loadGameContentIndex(GAME_CONTENT_URL, customFetch),
    loadGameCatalogMeta(GAME_CATALOG_META_URL, customFetch),
    loadGameTunerAxes(GAME_TUNER_URL, customFetch),
    loadGameRankerWeights(GAME_WEIGHTS_URL, customFetch),
    loadGameEditionAliases(GAME_EDITION_ALIASES_URL, customFetch)
  ]);
  return { easeIndex, collabIndex, contentIndex, catalogMeta, tunerAxes, weights, editionAliases };
}

export function resetGameModelCaches() {
  gameEaseLoader.reset();
  gameCollabLoader.reset();
  gameContentLoader.reset();
  gameCatalogMetaLoader.reset();
  tunerAxesPromise = null;
  weightsPromise = null;
  steamMapPromise = null;
  editionAliasesPromise = null;
}
