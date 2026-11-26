const INVALID_VALUES = new Set(["n/a", "na", "none", "null", "undefined", "-"]);
const awardsBreakdownSessionCache = new Map();

function pluralize(count, singular, plural) {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural}`;
}

/**
 * Parses an OMDb `Awards` summary string (e.g. "Won 7 Oscars. 92 wins & 143 nominations total")
 * into structured Oscar, major prestige, and total win/nomination fields. Returns null when empty or "N/A".
 */
export function parseAwardsSummary(rawAwards) {
  if (typeof rawAwards !== "string") return null;
  const cleaned = rawAwards.trim().replace(/\s+/g, " ");
  if (!cleaned || INVALID_VALUES.has(cleaned.toLowerCase())) return null;

  let oscarWins = 0;
  let oscarNominations = 0;
  let prestigeLabel = null;

  const oscarWinMatch = cleaned.match(/Won\s+(\d+)\s+Oscars?/i);
  const oscarNomMatch = cleaned.match(/Nominated\s+for\s+(\d+)\s+Oscars?/i);

  if (oscarWinMatch) {
    oscarWins = Number.parseInt(oscarWinMatch[1], 10) || 0;
  } else if (oscarNomMatch) {
    oscarNominations = Number.parseInt(oscarNomMatch[1], 10) || 0;
  } else {
    const prestigeMatch = cleaned.match(/^((?:Won|Nominated\s+for)\s+\d+\s+[^.]+)\./i);
    if (prestigeMatch) {
      prestigeLabel = prestigeMatch[1].trim();
    }
  }

  // OMDb uses either "92 wins & 143 nominations total" or older "Another 4 wins & 7 nominations."
  const remainder = cleaned.replace(/^[^.]*(?:Oscars?|Globes?|BAFTA[^.]*|Emmy[^.]*)\.\s*/i, "");
  const winsMatch = remainder.match(/(?:^|\b)(?:Another\s+)?(\d+)\s+wins?\b/i);
  const nomsMatch = remainder.match(/(?:^|\b)(\d+)\s+nominations?\b/i);

  const wins = winsMatch ? Number.parseInt(winsMatch[1], 10) || 0 : 0;
  const nominations = nomsMatch ? Number.parseInt(nomsMatch[1], 10) || 0 : 0;

  let oscarLabel = null;
  if (oscarWins > 0) {
    oscarLabel = `Won ${pluralize(oscarWins, "Oscar", "Oscars")}`;
  } else if (oscarNominations > 0) {
    oscarLabel = `${pluralize(oscarNominations, "Oscar nomination", "Oscar nominations")}`;
  }

  const totalParts = [];
  if (wins > 0) totalParts.push(pluralize(wins, "win", "wins"));
  if (nominations > 0) totalParts.push(pluralize(nominations, "nomination", "nominations"));
  const totalLabel = totalParts.join(" · ");

  const headline = !oscarLabel && !prestigeLabel && !totalLabel ? cleaned : null;

  return {
    raw: cleaned,
    oscarWins,
    oscarNominations,
    hasOscars: oscarWins > 0 || oscarNominations > 0,
    isOscarWinner: oscarWins > 0,
    oscarLabel,
    prestigeLabel,
    wins,
    nominations,
    totalLabel,
    headline
  };
}

function extractWikidataYear(claim) {
  const timeStr = claim?.qualifiers?.P585?.[0]?.datavalue?.value?.time || "";
  const match = String(timeStr).match(/^[+-]?(\d{4})-/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function classifyAwardBody(awardName = "", ceremonyName = "") {
  const combined = `${ceremonyName} ${awardName}`.toLowerCase();
  if (/academy award|oscar/.test(combined)) {
    return {
      bodyKey: "oscars",
      bodyLabel: ceremonyName || "Academy Awards (Oscars)",
      priority: 1,
      isOscar: true
    };
  }
  if (/golden globe/.test(combined)) {
    return {
      bodyKey: "golden_globes",
      bodyLabel: ceremonyName || "Golden Globe Awards",
      priority: 2,
      isOscar: false
    };
  }
  if (/bafta|british academy/.test(combined)) {
    return {
      bodyKey: "bafta",
      bodyLabel: ceremonyName || "BAFTA Film Awards",
      priority: 3,
      isOscar: false
    };
  }
  if (/cannes|palme d'or|venice|golden lion|berlin|golden bear|sundance/.test(combined)) {
    return {
      bodyKey: "major_festival",
      bodyLabel: ceremonyName || "Major Film Festivals",
      priority: 4,
      isOscar: false
    };
  }
  if (/screen actors guild|sag award|directors guild|writers guild|producers guild|critics'? choice/.test(combined)) {
    return {
      bodyKey: "guilds_critics",
      bodyLabel: ceremonyName || "Guild & Critics Awards",
      priority: 5,
      isOscar: false
    };
  }
  return {
    bodyKey: ceremonyName ? `ceremony:${ceremonyName.toLowerCase()}` : "other",
    bodyLabel: ceremonyName || "Festival & Critics Recognition",
    priority: 6,
    isOscar: false
  };
}

function shortenCategoryLabel(awardName = "", bodyKey = "") {
  const clean = String(awardName || "").trim();
  if (!clean) return "";
  if (bodyKey === "oscars") {
    return clean.replace(/^Academy Award for\s+/i, "").trim() || clean;
  }
  if (bodyKey === "golden_globes") {
    return clean.replace(/^Golden Globe Award for\s+/i, "").trim() || clean;
  }
  if (bodyKey === "bafta") {
    return clean.replace(/^BAFTA (?:Film )?Award for\s+/i, "").trim() || clean;
  }
  return clean;
}

/**
 * Normalizes raw Wikidata `P166` (award received) and `P1411` (nominated for) claims plus
 * resolved English label map into deduplicated, ceremony-grouped award entries.
 */
export function normalizeWikidataAwardsClaims({
  wonClaims = [],
  nominatedClaims = [],
  labels = {}
} = {}) {
  const safeLabels = labels && typeof labels === "object" ? labels : {};
  const mergedByKey = new Map();

  function ingest(claims, outcome) {
    for (const claim of Array.isArray(claims) ? claims : []) {
      const awardId = claim?.mainsnak?.datavalue?.value?.id;
      const awardName = awardId ? String(safeLabels[awardId] || "").trim() : "";
      if (!awardName) continue;

      const year = extractWikidataYear(claim);
      const ceremonyId = claim?.qualifiers?.P805?.[0]?.datavalue?.value?.id || "";
      const ceremonyName = ceremonyId ? String(safeLabels[ceremonyId] || "").trim() : "";

      const peopleSet = new Set();
      for (const prop of ["P1346", "P2453"]) {
        for (const q of claim?.qualifiers?.[prop] || []) {
          const pid = q?.datavalue?.value?.id;
          const pname = pid ? String(safeLabels[pid] || "").trim() : "";
          if (pname) peopleSet.add(pname);
        }
      }

      const dedupeKey = `${awardName.toLowerCase()}::${year || ""}`;
      const existing = mergedByKey.get(dedupeKey);
      if (existing) {
        // Won always supersedes nominated for the same category + year
        if (outcome === "won") existing.outcome = "won";
        if (!existing.ceremony && ceremonyName) existing.ceremony = ceremonyName;
        for (const p of peopleSet) existing.peopleSet.add(p);
        continue;
      }

      mergedByKey.set(dedupeKey, {
        awardId,
        awardName,
        year,
        ceremony: ceremonyName,
        outcome,
        peopleSet
      });
    }
  }

  ingest(wonClaims, "won");
  ingest(nominatedClaims, "nominated");

  const groupsMap = new Map();
  let totalWins = 0;
  let totalNominations = 0;

  for (const item of mergedByKey.values()) {
    if (item.outcome === "won") totalWins += 1;
    else totalNominations += 1;

    const { bodyKey, bodyLabel, priority, isOscar } = classifyAwardBody(item.awardName, item.ceremony);
    const groupKey = `${bodyKey}::${item.year || ""}`;

    if (!groupsMap.has(groupKey)) {
      groupsMap.set(groupKey, {
        id: groupKey,
        title: bodyLabel,
        year: item.year,
        priority,
        isOscar,
        winsCount: 0,
        nominationsCount: 0,
        items: []
      });
    }

    const group = groupsMap.get(groupKey);
    if (item.outcome === "won") group.winsCount += 1;
    else group.nominationsCount += 1;

    group.items.push({
      id: `${item.awardId || item.awardName}:${item.year || "na"}`,
      award: item.awardName,
      category: shortenCategoryLabel(item.awardName, bodyKey),
      outcome: item.outcome,
      year: item.year,
      ceremony: item.ceremony || null,
      recipients: [...item.peopleSet]
    });
  }

  const groups = [...groupsMap.values()]
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => {
        if (a.outcome !== b.outcome) return a.outcome === "won" ? -1 : 1;
        return a.category.localeCompare(b.category);
      })
    }))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (b.winsCount !== a.winsCount) return b.winsCount - a.winsCount;
      return (b.year || 0) - (a.year || 0);
    });

  return {
    groups,
    totalWins,
    totalNominations,
    totalCount: totalWins + totalNominations
  };
}

/**
 * Fetches Wikidata award claims directly via the public MediaWiki API (CORS-enabled with origin=*).
 * Used both inside `api/awards.js` on the server and as a local Vite dev fallback.
 */
export async function fetchWikidataAwardsDirect({
  imdbID = "",
  tmdbId = "",
  fetchFn = fetch,
  signal,
  corsOrigin = false
} = {}) {
  const cleanImdb = /^tt\d{5,10}$/i.test(String(imdbID || "").trim()) ? String(imdbID).trim() : "";
  const cleanTmdb = /^\d{1,10}$/.test(String(tmdbId || "").trim()) ? String(tmdbId).trim() : "";
  if (!cleanImdb && !cleanTmdb) {
    return { status: "empty", qid: null, groups: [], totalWins: 0, totalNominations: 0, totalCount: 0 };
  }

  const originParam = corsOrigin ? "&origin=*" : "";
  const headers = corsOrigin
    ? { Accept: "application/json" }
    : {
        Accept: "application/json",
        "User-Agent": "CinemaVault/1.0 (https://react-movie-original.vercel.app)"
      };

  async function lookupQid(prop, val) {
    const url = `https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      `haswbstatement:${prop}=${val}`
    )}&srlimit=1&format=json${originParam}`;
    const res = await fetchFn(url, { headers, signal });
    if (!res.ok) return null;
    const json = await res.json();
    const title = json?.query?.search?.[0]?.title;
    return /^Q\d+$/.test(String(title || "")) ? title : null;
  }

  let qid = null;
  if (cleanImdb) qid = await lookupQid("P345", cleanImdb);
  if (!qid && cleanTmdb) qid = await lookupQid("P4947", cleanTmdb);

  if (!qid) {
    return { status: "empty", qid: null, groups: [], totalWins: 0, totalNominations: 0, totalCount: 0 };
  }

  const [wonRes, nomRes] = await Promise.all([
    fetchFn(
      `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P166&format=json${originParam}`,
      { headers, signal }
    ),
    fetchFn(
      `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P1411&format=json${originParam}`,
      { headers, signal }
    )
  ]);

  const wonJson = wonRes.ok ? await wonRes.json() : {};
  const nomJson = nomRes.ok ? await nomRes.json() : {};
  const wonClaims = Array.isArray(wonJson?.claims?.P166) ? wonJson.claims.P166 : [];
  const nominatedClaims = Array.isArray(nomJson?.claims?.P1411) ? nomJson.claims.P1411 : [];

  if (wonClaims.length === 0 && nominatedClaims.length === 0) {
    return { status: "empty", qid, groups: [], totalWins: 0, totalNominations: 0, totalCount: 0 };
  }

  const labelIds = new Set();
  for (const claim of [...wonClaims, ...nominatedClaims]) {
    const aid = claim?.mainsnak?.datavalue?.value?.id;
    if (aid) labelIds.add(aid);
    for (const prop of ["P805", "P1346", "P2453"]) {
      for (const q of claim?.qualifiers?.[prop] || []) {
        const qv = q?.datavalue?.value?.id;
        if (qv) labelIds.add(qv);
      }
    }
  }

  // Resolve up to 150 unique QIDs in parallel batches of 50 (Wikidata API max per request)
  const idList = [...labelIds].slice(0, 150);
  const chunks = [];
  for (let i = 0; i < idList.length; i += 50) {
    chunks.push(idList.slice(i, i + 50));
  }

  const labels = {};
  await Promise.all(
    chunks.map(async (chunk) => {
      const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${chunk.join(
        "|"
      )}&props=labels&languages=en&format=json${originParam}`;
      const res = await fetchFn(url, { headers, signal });
      if (!res.ok) return;
      const json = await res.json();
      for (const [id, ent] of Object.entries(json?.entities || {})) {
        const val = ent?.labels?.en?.value;
        if (val) labels[id] = val;
      }
    })
  );

  const normalized = normalizeWikidataAwardsClaims({ wonClaims, nominatedClaims, labels });
  return {
    status: normalized.totalCount > 0 ? "ok" : "empty",
    qid,
    source: "wikidata",
    ...normalized
  };
}

/**
 * Loads detailed per-category awards & nominations on demand (when the user opens the dropdown).
 * Uses the Vercel edge-cached `/api/awards` endpoint in production, falling back seamlessly to
 * Wikidata's CORS-enabled API in local Vite dev mode.
 */
export async function fetchMovieAwardsBreakdown({ imdbID = "", tmdbId = "", signal } = {}) {
  const cleanImdb = /^tt\d{5,10}$/i.test(String(imdbID || "").trim()) ? String(imdbID).trim() : "";
  const cleanTmdb = /^\d{1,10}$/.test(String(tmdbId || "").trim()) ? String(tmdbId).trim() : "";
  if (!cleanImdb && !cleanTmdb) {
    return { status: "empty", groups: [], totalWins: 0, totalNominations: 0, totalCount: 0 };
  }

  const cacheKey = `${cleanImdb}|${cleanTmdb}`;
  if (awardsBreakdownSessionCache.has(cacheKey)) {
    return awardsBreakdownSessionCache.get(cacheKey);
  }

  const params = new URLSearchParams();
  if (cleanImdb) params.set("imdb", cleanImdb);
  if (cleanTmdb) params.set("tmdb", cleanTmdb);

  try {
    const proxyRes = await fetch(`/api/awards?${params.toString()}`, { signal });
    const contentType = String(proxyRes.headers.get("content-type") || "").toLowerCase();
    if (proxyRes.ok && contentType.includes("application/json")) {
      const payload = await proxyRes.json();
      if (payload && Array.isArray(payload.groups)) {
        awardsBreakdownSessionCache.set(cacheKey, payload);
        return payload;
      }
    }
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    // Fall through to direct CORS Wikidata lookup (e.g. local Vite dev server without /api)
  }

  try {
    const direct = await fetchWikidataAwardsDirect({
      imdbID: cleanImdb,
      tmdbId: cleanTmdb,
      signal,
      corsOrigin: true
    });
    if (direct.status === "ok" || direct.status === "empty") {
      awardsBreakdownSessionCache.set(cacheKey, direct);
    }
    return direct;
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    return { status: "error", groups: [], totalWins: 0, totalNominations: 0, totalCount: 0 };
  }
}
