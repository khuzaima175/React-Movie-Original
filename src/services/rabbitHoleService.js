import { findMatchingMovie, isSameMovie } from "./movieIdentity.js";

function toDateSortKey(part) {
  const rd = String(part?.release_date || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(rd)) return rd.slice(0, 10);
  const year = String(part?.year || "").trim();
  if (/^\d{4}$/.test(year)) return `${year}-99-99`;
  return null;
}

/**
 * Normalize and chronologically sort a TMDB collection timeline while tagging current film and Vault state.
 */
export function normalizeCollectionTimeline(collectionData, currentMovie, watched = [], watchlist = []) {
  if (!collectionData || !Array.isArray(collectionData.parts) || collectionData.parts.length === 0) {
    return null;
  }

  const watchedList = Array.isArray(watched) ? watched : [];
  const watchlistList = Array.isArray(watchlist) ? watchlist : [];
  const deduped = new Map();

  for (const raw of collectionData.parts) {
    const tmdbId = Number(raw?.tmdbId ?? raw?.id);
    if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0 || deduped.has(tmdbId)) continue;

    const releaseDate = String(raw.release_date || "").trim();
    const year = /^\d{4}/.test(releaseDate)
      ? releaseDate.slice(0, 4)
      : (raw.year && String(raw.year).trim() !== "N/A" ? String(raw.year).trim() : "TBA");
    const imdbID = raw.imdbID || raw.external_ids?.imdb_id || `tmdb_${tmdbId}`;
    const title = String(raw.title || raw.Title || raw.original_title || "Untitled").trim();
    const poster =
      raw.poster ||
      (raw.poster_path ? `https://image.tmdb.org/t/p/w500${raw.poster_path}` : null);
    const voteAvg = raw.vote_average != null && Number.isFinite(Number(raw.vote_average))
      ? Number(Number(raw.vote_average).toFixed(1))
      : null;

    const probe = { tmdbId, imdbID, title, year };
    const matchedWatched = findMatchingMovie(watchedList, probe);
    const matchedWatchlist = !matchedWatched ? findMatchingMovie(watchlistList, probe) : null;
    const isCurrent = Boolean(currentMovie && isSameMovie(probe, currentMovie));

    deduped.set(tmdbId, {
      tmdbId,
      imdbID,
      title,
      year,
      release_date: releaseDate,
      poster,
      vote_average: voteAvg,
      isCurrent,
      isWatched: Boolean(matchedWatched),
      isWatchlist: Boolean(matchedWatchlist),
      userRating: matchedWatched?.userRating ?? null
    });
  }

  if (deduped.size === 0) return null;

  const parts = Array.from(deduped.values()).sort((a, b) => {
    const keyA = toDateSortKey(a);
    const keyB = toDateSortKey(b);
    if (keyA && !keyB) return -1;
    if (!keyA && keyB) return 1;
    if (keyA && keyB) {
      const cmp = keyA.localeCompare(keyB);
      if (cmp !== 0) return cmp;
    }
    return a.tmdbId - b.tmdbId;
  });

  const watchedCount = parts.filter((p) => p.isWatched).length;
  return {
    id: Number(collectionData.id) || null,
    name: String(collectionData.name || "Collection").trim(),
    overview: String(collectionData.overview || "").trim(),
    parts,
    watchedCount,
    totalCount: parts.length
  };
}

/**
 * Find nearest cosine neighbors for a TMDB movie ID in a parsed CVEM index.
 * Explicitly divides by normA * normB so sub-unit shrunk vectors compare cleanly against unit vectors.
 */
export function findEmbeddingNeighborsForMovie(tmdbId, index, { excludeIds = new Set(), limit = 16 } = {}) {
  const targetId = Number(tmdbId);
  if (
    !Number.isSafeInteger(targetId) ||
    targetId <= 0 ||
    !index ||
    !index.dim ||
    !index.count ||
    !index.ids ||
    !index.vectors ||
    !index.idToIndex
  ) {
    return [];
  }

  const targetIdx = index.idToIndex.get(targetId);
  if (targetIdx === undefined) return [];

  const { dim, count, ids, vectors } = index;
  const baseA = targetIdx * dim;
  let sumSqA = 0;
  for (let d = 0; d < dim; d++) {
    const v = vectors[baseA + d];
    sumSqA += v * v;
  }
  const normA = Math.sqrt(sumSqA);
  if (!Number.isFinite(normA) || normA <= 1e-12) return [];

  const scored = [];
  for (let i = 0; i < count; i++) {
    const candId = Number(ids[i]);
    if (!Number.isSafeInteger(candId) || candId <= 0 || candId === targetId) continue;
    if (excludeIds.has(candId) || excludeIds.has(String(candId))) continue;

    const baseB = i * dim;
    let dot = 0;
    let sumSqB = 0;
    for (let d = 0; d < dim; d++) {
      const a = vectors[baseA + d];
      const b = vectors[baseB + d];
      dot += a * b;
      sumSqB += b * b;
    }
    const normB = Math.sqrt(sumSqB);
    if (!Number.isFinite(normB) || normB <= 1e-12) continue;

    const sim = dot / (normA * normB);
    if (Number.isFinite(sim)) {
      scored.push({ tmdbId: candId, sim });
    }
  }

  scored.sort((a, b) => b.sim - a.sim);
  return scored.slice(0, Math.max(0, Number(limit) || 16));
}

function getCardTmdbId(card) {
  const id = Number(card?.tmdbId ?? card?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Blend local CVEM cosine neighbors with live TMDB recommendations/similar results,
 * deduplicate across both sources, boost hybrid overlaps, and annotate Vault state.
 */
export function buildHybridSimilarFilms({
  currentMovie,
  embeddingNeighbors = [],
  hydratedEmbeddingCards = [],
  tmdbRecommendations = [],
  collectionPartIds = new Set(),
  watched = [],
  watchlist = [],
  limit = 14
} = {}) {
  const watchedList = Array.isArray(watched) ? watched : [];
  const watchlistList = Array.isArray(watchlist) ? watchlist : [];
  const maxItems = Math.max(0, Number(limit) || 14);
  if (maxItems === 0) return [];

  const simById = new Map();
  for (const n of Array.isArray(embeddingNeighbors) ? embeddingNeighbors : []) {
    const id = Number(n?.tmdbId);
    if (Number.isSafeInteger(id) && id > 0) {
      simById.set(id, Number(n.sim) || 0);
    }
  }

  const vectorById = new Map();
  for (const card of Array.isArray(hydratedEmbeddingCards) ? hydratedEmbeddingCards : []) {
    if (!card) continue;
    if (currentMovie && isSameMovie(card, currentMovie)) continue;
    const id = getCardTmdbId(card);
    if (!id || vectorById.has(id)) continue;
    vectorById.set(id, card);
  }

  const tmdbById = new Map();
  const tmdbOrdered = [];
  for (const card of Array.isArray(tmdbRecommendations) ? tmdbRecommendations : []) {
    if (!card) continue;
    if (currentMovie && isSameMovie(card, currentMovie)) continue;
    const id = getCardTmdbId(card);
    if (!id || tmdbById.has(id)) continue;
    tmdbById.set(id, card);
    tmdbOrdered.push({ id, card });
  }

  const hybridEntries = [];
  const tmdbOnlyEntries = [];
  for (const { id, card } of tmdbOrdered) {
    if (vectorById.has(id) || simById.has(id)) {
      const vecCard = vectorById.get(id);
      hybridEntries.push({
        id,
        card: { ...(vecCard || {}), ...card, tmdbId: id, imdbID: card.imdbID || vecCard?.imdbID || `tmdb_${id}` },
        matchOrigin: "hybrid",
        similarityScore: simById.get(id) ?? null
      });
    } else {
      tmdbOnlyEntries.push({
        id,
        card: { ...card, tmdbId: id, imdbID: card.imdbID || `tmdb_${id}` },
        matchOrigin: "tmdb",
        similarityScore: null
      });
    }
  }

  hybridEntries.sort((a, b) => (b.similarityScore || 0) - (a.similarityScore || 0));

  const hybridIds = new Set(hybridEntries.map((e) => e.id));
  const vectorOnlyEntries = Array.from(vectorById.entries())
    .filter(([id]) => !hybridIds.has(id) && !tmdbById.has(id))
    .sort((a, b) => (simById.get(b[0]) || 0) - (simById.get(a[0]) || 0))
    .map(([id, card]) => ({
      id,
      card: { ...card, tmdbId: id, imdbID: card.imdbID || `tmdb_${id}` },
      matchOrigin: "vault-vector",
      similarityScore: simById.get(id) ?? null
    }));

  // Interleave fresh TMDB recs and local CVEM vector cards after top hybrid hits
  const interleaved = [];
  const maxRem = Math.max(tmdbOnlyEntries.length, vectorOnlyEntries.length);
  for (let i = 0; i < maxRem; i++) {
    if (i < tmdbOnlyEntries.length) interleaved.push(tmdbOnlyEntries[i]);
    if (i < vectorOnlyEntries.length) interleaved.push(vectorOnlyEntries[i]);
  }

  const combined = [...hybridEntries, ...interleaved].sort((a, b) => {
    const aColl = collectionPartIds?.has(a.id) ? 1 : 0;
    const bColl = collectionPartIds?.has(b.id) ? 1 : 0;
    if (aColl !== bColl) return aColl - bColl;
    return 0;
  });

  const output = [];
  const acceptedCards = [];

  for (const entry of combined) {
    if (output.length >= maxItems) break;
    if (acceptedCards.some((existing) => isSameMovie(existing, entry.card))) continue;

    acceptedCards.push(entry.card);
    const matchedWatched = findMatchingMovie(watchedList, entry.card);
    const matchedWatchlist = !matchedWatched ? findMatchingMovie(watchlistList, entry.card) : null;

    output.push({
      ...entry.card,
      matchOrigin: entry.matchOrigin,
      similarityScore: entry.similarityScore,
      inCollection: Boolean(collectionPartIds?.has(entry.id)),
      isWatched: Boolean(matchedWatched),
      isWatchlist: Boolean(matchedWatchlist),
      userRating: matchedWatched?.userRating ?? entry.card.userRating ?? null
    });
  }

  return output;
}
