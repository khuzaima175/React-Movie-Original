/**
 * Deterministic synthetic benchmark: one shared catalog plus three persona vaults.
 * No network, no real user data, safe to commit. Used so the evaluation harness and its
 * tests are runnable anywhere, even when a personal vault is too small to evaluate.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const GENRES = {
  action: 28,
  drama: 18,
  thriller: 53,
  comedy: 35,
  scifi: 878,
  horror: 27,
  romance: 10749,
  documentary: 99
};

const GENRE_IDS = Object.values(GENRES);

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

/**
 * Builds a catalog of films with TMDB-shaped metadata.
 */
export function buildSyntheticCatalog(size = 240, seed = 7) {
  const rng = mulberry32(seed);
  const catalog = [];
  for (let i = 1; i <= size; i++) {
    const g1 = pick(rng, GENRE_IDS);
    const g2 = rng() < 0.5 ? pick(rng, GENRE_IDS) : g1;
    const keywords = new Set();
    while (keywords.size < 3) keywords.add(1 + Math.floor(rng() * 40));
    catalog.push({
      id: i,
      tmdbId: i,
      title: `Film ${i}`,
      year: String(1970 + Math.floor(rng() * 56)),
      tmdbGenreIds: g1 === g2 ? [g1] : [g1, g2],
      tmdbKeywords: [...keywords],
      castIds: [1 + Math.floor(rng() * 60), 1 + Math.floor(rng() * 60), 1 + Math.floor(rng() * 60)],
      crewPersonId: 1 + Math.floor(rng() * 15),
      vote_average: Math.round((5 + rng() * 3.5) * 10) / 10,
      vote_count: Math.floor(50 + rng() * 5000)
    });
  }
  return catalog;
}

/**
 * Persona rating rule: returns a 1-10 rating for a film given the persona's taste.
 * Taste is driven by genre (and, for the auteur, director) so a genre-aware ranker can recover it.
 */
const PERSONAS = {
  auteur: {
    likedGenres: [GENRES.drama],
    likedDirectors: [1, 2, 3]
  },
  thrillerFan: {
    likedGenres: [GENRES.thriller, GENRES.action],
    likedDirectors: []
  },
  genreHopper: {
    likedGenres: [GENRES.comedy, GENRES.scifi, GENRES.horror],
    likedDirectors: []
  }
};

function personaRating(persona, film, rng) {
  const genreHit = film.tmdbGenreIds.some(g => persona.likedGenres.includes(g));
  const directorHit = persona.likedDirectors.includes(film.crewPersonId);
  const noise = Math.round((rng() - 0.5) * 2);
  if (genreHit && directorHit) return Math.min(10, 10 + noise);
  if (genreHit || directorHit) return Math.max(7, Math.min(10, 9 + noise));
  return Math.max(1, Math.min(7, 4 + noise + (rng() < 0.2 ? 2 : 0)));
}

/**
 * Builds one persona vault: `size` films chosen from the catalog, rated by the persona,
 * watched one per day from 2025-01-01 so the temporal split is well defined.
 */
export function buildPersonaVault(name, catalog, size = 120, seed = 11) {
  const persona = PERSONAS[name];
  if (!persona) throw new Error(`Unknown persona: ${name}`);
  const rng = mulberry32(seed + name.length * 101);

  const indices = catalog.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const start = Date.parse("2025-01-01T00:00:00Z");
  return indices.slice(0, size).map((catalogIndex, order) => {
    const film = catalog[catalogIndex];
    return {
      ...film,
      userRating: personaRating(persona, film, rng),
      dateWatched: new Date(start + order * 86400000).toISOString().slice(0, 10)
    };
  });
}

export function buildSyntheticBenchmark() {
  const catalog = buildSyntheticCatalog();
  const vaults = Object.keys(PERSONAS).map(name => ({
    name,
    watched: buildPersonaVault(name, catalog)
  }));
  return { catalog, vaults };
}
