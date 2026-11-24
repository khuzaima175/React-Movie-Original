import { findMatchingMovie, isSameMovie, normalizeTitleKey, normalizeYearKey } from "./movieIdentity.js";

export const CUSTOM_LISTS_STORAGE_KEY = "cinemavault_custom_lists_v1";

export const CANON_CHECKLISTS = Object.freeze([
  {
    id: "canon_21c_scifi",
    name: "21st Century Sci-Fi Milestones",
    description: "Essential cerebral and visionary science fiction since 2000.",
    items: [
      { title: "Children of Men", year: "2006", director: "Alfonso Cuarón" },
      { title: "Arrival", year: "2016", director: "Denis Villeneuve" },
      { title: "Ex Machina", year: "2014", director: "Alex Garland" },
      { title: "Blade Runner 2049", year: "2017", director: "Denis Villeneuve" },
      { title: "Eternal Sunshine of the Spotless Mind", year: "2004", director: "Michel Gondry" },
      { title: "Her", year: "2013", director: "Spike Jonze" },
      { title: "Under the Skin", year: "2013", director: "Jonathan Glazer" },
      { title: "Moon", year: "2009", director: "Duncan Jones" },
      { title: "Mad Max: Fury Road", year: "2015", director: "George Miller" },
      { title: "Everything Everywhere All at Once", year: "2022", director: "Daniel Kwan, Daniel Scheinert" }
    ]
  },
  {
    id: "canon_noir_essentials",
    name: "Neo-Noir & Paranoia Essentials",
    description: "Rain-slicked moral dread, doomed investigators, and labyrinthine mysteries.",
    items: [
      { title: "Chinatown", year: "1974", director: "Roman Polanski" },
      { title: "Blade Runner", year: "1982", director: "Ridley Scott" },
      { title: "L.A. Confidential", year: "1997", director: "Curtis Hanson" },
      { title: "Se7en", year: "1995", director: "David Fincher" },
      { title: "Zodiac", year: "2007", director: "David Fincher" },
      { title: "Memories of Murder", year: "2003", director: "Bong Joon-ho" },
      { title: "Nightcrawler", year: "2014", director: "Dan Gilroy" },
      { title: "Cure", year: "1997", director: "Kiyoshi Kurosawa" },
      { title: "Blood Simple", year: "1984", director: "Joel Coen" },
      { title: "Drive", year: "2011", director: "Nicolas Winding Refn" }
    ]
  },
  {
    id: "canon_crime_thrillers",
    name: "Modern Crime & Heist Classics",
    description: "Precision craft, obsessive rivalries, and high-stakes tension.",
    items: [
      { title: "Heat", year: "1995", director: "Michael Mann" },
      { title: "No Country for Old Men", year: "2007", director: "Joel Coen, Ethan Coen" },
      { title: "Sicario", year: "2015", director: "Denis Villeneuve" },
      { title: "Goodfellas", year: "1990", director: "Martin Scorsese" },
      { title: "The Departed", year: "2006", director: "Martin Scorsese" },
      { title: "Thief", year: "1981", director: "Michael Mann" },
      { title: "Prisoners", year: "2013", director: "Denis Villeneuve" },
      { title: "Uncut Gems", year: "2019", director: "Josh Safdie, Benny Safdie" },
      { title: "City of God", year: "2002", director: "Fernando Meirelles" },
      { title: "Reservoir Dogs", year: "1992", director: "Quentin Tarantino" }
    ]
  },
  {
    id: "canon_animation_greats",
    name: "Masterworks of Animation",
    description: "Hand-painted emotion, surreal worlds, and boundary-pushing visual storytelling.",
    items: [
      { title: "Spirited Away", year: "2001", director: "Hayao Miyazaki" },
      { title: "Princess Mononoke", year: "1997", director: "Hayao Miyazaki" },
      { title: "Spider-Man: Into the Spider-Verse", year: "2018", director: "Bob Persichetti, Peter Ramsey" },
      { title: "Akira", year: "1988", director: "Katsuhiro Otomo" },
      { title: "Perfect Blue", year: "1997", director: "Satoshi Kon" },
      { title: "WALL·E", year: "2008", director: "Andrew Stanton" },
      { title: "The Iron Giant", year: "1999", director: "Brad Bird" },
      { title: "Fantastic Mr. Fox", year: "2009", director: "Wes Anderson" },
      { title: "Your Name.", year: "2016", director: "Makoto Shinkai" },
      { title: "Grave of the Fireflies", year: "1988", director: "Isao Takahata" }
    ]
  }
]);

function randomSuffix(length = 6) {
  return Math.random().toString(36).slice(2, 2 + length).padEnd(length, "0");
}

function getListIdentityFallback(movie = {}) {
  if (movie.imdbID) return String(movie.imdbID);
  if (movie.tmdbId) return `tmdb_${movie.tmdbId}`;
  const t = normalizeTitleKey(movie.title || movie.Title);
  const y = normalizeYearKey(movie.year || movie.Year || movie.release_date);
  return `ty_${t}_${y}`;
}

export function generateListSlug(name = "", uniqueSuffix = null) {
  const base = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "cinema-list";
  const suffix = String(uniqueSuffix || randomSuffix(6))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12) || "list01";
  return `${base}-${suffix}`;
}

export function normalizeListMovieItem(movie = {}, nowIso = new Date().toISOString()) {
  if (!movie || typeof movie !== "object") return null;
  const title = String(movie.title || movie.Title || "").trim();
  if (!title) return null;
  const tmdbNum = Number(movie.tmdbId);
  const tmdbId = Number.isSafeInteger(tmdbNum) && tmdbNum > 0 ? tmdbNum : null;
  const imdbID = movie.imdbID ? String(movie.imdbID).trim() : (tmdbId ? `tmdb_${tmdbId}` : getListIdentityFallback(movie));
  const year = normalizeYearKey(movie.year || movie.Year || movie.release_date) || String(movie.year || "").slice(0, 4);

  return {
    id: movie.id || imdbID,
    imdbID,
    ...(tmdbId ? { tmdbId } : {}),
    title,
    year: year || "",
    poster: movie.poster && movie.poster !== "N/A" ? movie.poster : (movie.Poster && movie.Poster !== "N/A" ? movie.Poster : null),
    director: movie.director || movie.Director || "",
    genre: movie.genre || movie.Genre || "",
    imdbRating: movie.imdbRating ?? (movie.vote_average ? String(movie.vote_average) : null),
    addedAt: movie.addedAt || nowIso
  };
}

export function normalizeCustomList(rawList = {}, nowIso = new Date().toISOString()) {
  if (!rawList || typeof rawList !== "object") return null;
  const name = String(rawList.name || "").trim().slice(0, 80);
  if (!name) return null;

  const dedupedItems = [];
  for (const rawItem of Array.isArray(rawList.items) ? rawList.items : []) {
    const normalized = normalizeListMovieItem(rawItem, nowIso);
    if (!normalized) continue;
    if (!dedupedItems.some((existing) => isSameMovie(existing, normalized))) {
      dedupedItems.push(normalized);
    }
  }

  const isPublic = Boolean(rawList.isPublic ?? rawList.is_public);
  const rawSlug = rawList.slug ? String(rawList.slug).trim().toLowerCase() : null;

  return {
    id: String(rawList.id || `list_${Date.now()}_${randomSuffix(5)}`),
    name,
    description: String(rawList.description || "").trim().slice(0, 300),
    sourceChecklistId: rawList.sourceChecklistId || rawList.source_checklist_id || null,
    items: dedupedItems,
    isPublic,
    slug: rawSlug || (isPublic ? generateListSlug(name) : null),
    bookmarkCount: Math.max(0, Number(rawList.bookmarkCount ?? rawList.bookmark_count ?? 0) || 0),
    createdAt: rawList.createdAt || rawList.created_at || nowIso,
    updatedAt: rawList.updatedAt || rawList.updated_at || nowIso,
    deletedAt: rawList.deletedAt ?? rawList.deleted_at ?? null
  };
}

export function getActiveCustomLists(lists = []) {
  return (Array.isArray(lists) ? lists : [])
    .filter((l) => l && !l.deletedAt)
    .sort((a, b) => (Date.parse(b.updatedAt || 0) || 0) - (Date.parse(a.updatedAt || 0) || 0));
}

export function createCustomList(
  lists = [],
  { name, description = "", sourceChecklistId = null, initialItems = [], isPublic = false } = {},
  nowIso = new Date().toISOString()
) {
  const created = normalizeCustomList(
    {
      id: `list_${Date.now()}_${randomSuffix(5)}`,
      name,
      description,
      sourceChecklistId,
      items: initialItems,
      isPublic,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null
    },
    nowIso
  );
  if (!created) return Array.isArray(lists) ? lists : [];
  return [created, ...(Array.isArray(lists) ? lists : [])];
}

export function renameCustomList(
  lists = [],
  listId,
  { name, description } = {},
  nowIso = new Date().toISOString()
) {
  return (Array.isArray(lists) ? lists : []).map((list) => {
    if (!list || list.id !== listId) return list;
    const nextName = name !== undefined ? String(name).trim().slice(0, 80) : list.name;
    if (!nextName) return list;
    return {
      ...list,
      name: nextName,
      description: description !== undefined ? String(description).trim().slice(0, 300) : list.description,
      updatedAt: nowIso
    };
  });
}

export function setListVisibility(
  lists = [],
  listId,
  { isPublic, slug = null } = {},
  nowIso = new Date().toISOString()
) {
  return (Array.isArray(lists) ? lists : []).map((list) => {
    if (!list || list.id !== listId) return list;
    const nextPublic = Boolean(isPublic);
    const nextSlug = slug || list.slug || (nextPublic ? generateListSlug(list.name) : null);
    return {
      ...list,
      isPublic: nextPublic,
      slug: nextSlug,
      updatedAt: nowIso
    };
  });
}

export function deleteCustomList(lists = [], listId, nowIso = new Date().toISOString()) {
  return (Array.isArray(lists) ? lists : []).map((list) => {
    if (!list || list.id !== listId) return list;
    return {
      ...list,
      isPublic: false,
      deletedAt: nowIso,
      updatedAt: nowIso
    };
  });
}

export function toggleMovieInList(
  lists = [],
  listId,
  movie,
  nowIso = new Date().toISOString()
) {
  const normalizedMovie = normalizeListMovieItem(movie, nowIso);
  if (!normalizedMovie) {
    return { lists: Array.isArray(lists) ? lists : [], added: false };
  }

  let added = false;
  const nextLists = (Array.isArray(lists) ? lists : []).map((list) => {
    if (!list || list.id !== listId || list.deletedAt) return list;
    const items = Array.isArray(list.items) ? list.items : [];
    const exists = items.some((item) => isSameMovie(item, normalizedMovie));
    if (exists) {
      added = false;
      return {
        ...list,
        items: items.filter((item) => !isSameMovie(item, normalizedMovie)),
        updatedAt: nowIso
      };
    }
    added = true;
    return {
      ...list,
      items: [normalizedMovie, ...items],
      updatedAt: nowIso
    };
  });

  return { lists: nextLists, added };
}

export function getListsContainingMovie(lists = [], movie) {
  if (!movie) return [];
  return getActiveCustomLists(lists).filter(
    (list) => Array.isArray(list.items) && list.items.some((item) => isSameMovie(item, movie))
  );
}

export function clonePublicListToLocal(
  lists = [],
  publicList = null,
  nowIso = new Date().toISOString()
) {
  if (!publicList || !publicList.name) {
    return { lists: Array.isArray(lists) ? lists : [], clonedList: null };
  }
  const nextLists = createCustomList(
    lists,
    {
      name: publicList.name,
      description: publicList.description || "",
      sourceChecklistId: publicList.sourceChecklistId || publicList.source_checklist_id || null,
      initialItems: Array.isArray(publicList.items) ? publicList.items : [],
      isPublic: false
    },
    nowIso
  );
  return { lists: nextLists, clonedList: nextLists[0] || null };
}

export function computeChecklistProgress(checklist, watched = [], watchlist = []) {
  const items = Array.isArray(checklist?.items) ? checklist.items : [];
  let watchedCount = 0;
  let watchlistCount = 0;

  const entries = items.map((item) => {
    const watchedMatch = findMatchingMovie(watched, item);
    const watchlistMatch = watchedMatch ? null : findMatchingMovie(watchlist, item);
    const isWatched = Boolean(watchedMatch);
    const isWatchlist = Boolean(watchlistMatch);
    if (isWatched) watchedCount += 1;
    else if (isWatchlist) watchlistCount += 1;

    return {
      ...item,
      tmdbId: watchedMatch?.tmdbId ?? watchlistMatch?.tmdbId ?? item.tmdbId ?? null,
      imdbID: watchedMatch?.imdbID ?? watchlistMatch?.imdbID ?? item.imdbID ?? null,
      poster: watchedMatch?.poster || watchlistMatch?.poster || item.poster || null,
      isWatched,
      isWatchlist,
      userRating: isWatched ? (Number(watchedMatch?.userRating) || null) : null
    };
  });

  const totalCount = entries.length;
  const completionPct = totalCount > 0 ? Math.round((watchedCount / totalCount) * 100) : 0;

  return {
    id: checklist?.id || "",
    name: checklist?.name || "",
    description: checklist?.description || "",
    watchedCount,
    watchlistCount,
    totalCount,
    completionPct,
    entries
  };
}

function mergeItemArrays(primaryItems = [], secondaryItems = []) {
  const out = [...(Array.isArray(primaryItems) ? primaryItems : [])];
  for (const item of Array.isArray(secondaryItems) ? secondaryItems : []) {
    if (!item) continue;
    if (!out.some((existing) => isSameMovie(existing, item))) {
      out.push(item);
    }
  }
  return out;
}

export function mergeCustomListsByTimestamp(
  baseLists = [],
  incomingLists = [],
  mode = "merge_update"
) {
  const base = (Array.isArray(baseLists) ? baseLists : [])
    .map((l) => normalizeCustomList(l))
    .filter(Boolean);
  const incoming = (Array.isArray(incomingLists) ? incomingLists : [])
    .map((l) => normalizeCustomList(l))
    .filter(Boolean);

  if (mode === "replace") {
    const incomingIds = new Set(incoming.map((l) => l.id));
    const tombstones = base.filter((l) => l.deletedAt && !incomingIds.has(l.id));
    return [...incoming, ...tombstones];
  }

  const byId = new Map(base.map((l) => [l.id, l]));

  for (const inc of incoming) {
    const cur = byId.get(inc.id);
    if (!cur) {
      byId.set(inc.id, inc);
      continue;
    }
    if (mode === "add_new") continue;

    const curTs = Date.parse(cur.updatedAt || 0) || 0;
    const incTs = Date.parse(inc.updatedAt || 0) || 0;

    if (incTs > curTs) {
      byId.set(inc.id, {
        ...inc,
        items: inc.deletedAt ? [] : inc.items
      });
    } else if (incTs === curTs && !cur.deletedAt && !inc.deletedAt) {
      byId.set(inc.id, {
        ...cur,
        items: mergeItemArrays(cur.items, inc.items)
      });
    }
  }

  return [...byId.values()];
}
