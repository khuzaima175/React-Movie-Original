import { CORE_TASTE_DECK } from "./tasteDeckService.js";
import { prepareQuickRatePayload, prepareWatchlistPayload } from "./ratingTiers.js";

export const SAMPLE_VAULT_MIN_WATCHED = 14;

const SAMPLE_WATCHED_SPECS = [
  { imdbID: "tt0816692", rating: 10, daysAgo: 7, userNote: "Unforgettable score and practical scale." },
  { imdbID: "tt1856101", rating: 10, daysAgo: 28, userNote: "Every frame breathes quiet existential melancholy." },
  { imdbID: "tt6751668", rating: 9, daysAgo: 55, userNote: "Razor-sharp tonal control and class satire." },
  { imdbID: "tt0468569", rating: 9, daysAgo: 92 },
  { imdbID: "tt0133093", rating: 9, daysAgo: 130 },
  { imdbID: "tt1392214", rating: 8, daysAgo: 168, userNote: "Relentless atmospheric dread without cheap tricks." },
  { imdbID: "tt0209144", rating: 8, daysAgo: 205 },
  { imdbID: "tt2582802", rating: 9, daysAgo: 245 },
  { imdbID: "tt0068646", rating: 10, daysAgo: 290 },
  { imdbID: "tt15239678", rating: 8, daysAgo: 335 },
  { imdbID: "tt0245429", rating: 9, daysAgo: 380 },
  { imdbID: "tt8946378", rating: 7, daysAgo: 425 },
  { imdbID: "tt1745960", rating: 4, daysAgo: 480, userNote: "Fun aerial stunts, too thin on character friction." },
  { imdbID: "tt3783958", rating: 3, daysAgo: 540, userNote: "Stylish nostalgia, not my pacing." }
];

const SAMPLE_WATCHLIST_IDS = [
  "tt0114369",
  "tt0482571",
  "tt0078748",
  "tt13238346",
  "tt0118694",
  "tt6710474"
];

/**
 * Identifies demo sample records so they can be cleared without touching real user ratings.
 */
export function isSampleItem(movie) {
  return Boolean(movie && typeof movie === "object" && movie.isSample === true);
}

/**
 * Generates a realistic 14-film rated vault + 6-film watchlist for first-time visitors.
 */
export function buildSampleVault({ now = Date.now() } = {}) {
  const deckById = new Map(CORE_TASTE_DECK.map((entry) => [entry.imdbID, entry]));
  const watched = [];
  const watchlist = [];

  for (const spec of SAMPLE_WATCHED_SPECS) {
    const base = deckById.get(spec.imdbID);
    if (!base) continue;
    const watchedAtMs = now - spec.daysAgo * 86_400_000;
    const payload = prepareQuickRatePayload(
      {
        ...base,
        ...(spec.userNote ? { userNote: spec.userNote } : {})
      },
      spec.rating,
      watchedAtMs
    );
    if (payload) {
      watched.push({ ...payload, isSample: true });
    }
  }

  for (const imdbID of SAMPLE_WATCHLIST_IDS) {
    const base = deckById.get(imdbID);
    if (!base) continue;
    const payload = prepareWatchlistPayload(base);
    if (payload) {
      watchlist.push({ ...payload, isSample: true });
    }
  }

  return { watched, watchlist };
}
