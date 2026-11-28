/**
 * Lazy Session Loaders for GameVault's 6 Pre-Trained Offline ML Assets (`/models/games/*`).
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
export const GAME_TUNER_URL = "/models/games/game_tuner_axes.json";
export const GAME_WEIGHTS_URL = "/models/games/game_ranker_weights.json";
export const GAME_STEAM_MAP_URL = "/models/games/game_steam_to_igdb.json";
export const GAME_EDITION_ALIASES_URL = "/models/games/game_edition_aliases.json";

const gameEaseLoader = createSessionBinaryIndexLoader(GAME_EASE_URL, parseEaseBinary);
const gameCollabLoader = createSessionBinaryIndexLoader(GAME_COLLAB_URL, parseEmbeddingBinary);
const gameContentLoader = createSessionBinaryIndexLoader(GAME_CONTENT_URL, parseEmbeddingBinary);

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

export function loadGameTunerAxes(url = GAME_TUNER_URL, customFetch = null) {
  if (!tunerAxesPromise) {
    tunerAxesPromise = fetchJsonSafe(url, customFetch).then((parsed) => {
      if (!parsed || !Array.isArray(parsed.toneVec) || (!Array.isArray(parsed.pacingVec) && !Array.isArray(parsed.intensityVec))) {
        return null;
      }
      return {
        ...parsed,
        pacingVec: parsed.pacingVec || parsed.intensityVec,
        intensityVec: parsed.intensityVec || parsed.pacingVec
      };
    });
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
 * Loads all 6 core recommendation assets concurrently on first entry into Games mode.
 */
export async function loadGameModelBundle(customFetch = null) {
  const [easeIndex, collabIndex, contentIndex, tunerAxes, weights, editionAliases] = await Promise.all([
    loadGameEaseIndex(GAME_EASE_URL, customFetch),
    loadGameCollabIndex(GAME_COLLAB_URL, customFetch),
    loadGameContentIndex(GAME_CONTENT_URL, customFetch),
    loadGameTunerAxes(GAME_TUNER_URL, customFetch),
    loadGameRankerWeights(GAME_WEIGHTS_URL, customFetch),
    loadGameEditionAliases(GAME_EDITION_ALIASES_URL, customFetch)
  ]);
  return { easeIndex, collabIndex, contentIndex, tunerAxes, weights, editionAliases };
}

export function resetGameModelCaches() {
  gameEaseLoader.reset();
  gameCollabLoader.reset();
  gameContentLoader.reset();
  tunerAxesPromise = null;
  weightsPromise = null;
  steamMapPromise = null;
  editionAliasesPromise = null;
}
