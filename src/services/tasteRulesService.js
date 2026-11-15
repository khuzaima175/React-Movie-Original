/**
 * Steerable Taste Rules Service (v5.1)
 *
 * Manages editable user taste memory rules ("Prefer ..." / "Avoid ...") with:
 * - Zero top-level dependency on geminiService.js (prevents ESM circular imports)
 * - Unqualified vs. qualified genre negation guard (never blacklists Drama/Action broadly)
 * - Word-boundary candidate matching + deterministic cache hash segments
 * - Fast Gemini auto-drafting with offline vault heuristic fallback
 */

import { GENRE_NAME_TO_ID } from "./moodPolicy.js";

export const MAX_TASTE_RULES = 8;
export const MAX_RULE_TEXT_LENGTH = 140;

const GENRE_ALIAS_TO_ID = {
  ...GENRE_NAME_TO_ID,
  actions: 28,
  adventures: 12,
  animations: 16,
  animated: 16,
  comedies: 35,
  crimes: 80,
  docs: 99,
  documentaries: 99,
  dramas: 18,
  families: 10751,
  fantasies: 14,
  histories: 36,
  historical: 36,
  horrors: 27,
  musicals: 10402,
  mysteries: 9648,
  romances: 10749,
  thrillers: 53,
  wars: 10752,
  westerns: 37
};

const PLURAL_GENRE_SINGULAR = {
  dramas: "drama",
  thrillers: "thriller",
  horrors: "horror",
  comedies: "comedy",
  musicals: "musical",
  westerns: "western",
  romances: "romance",
  mysteries: "mystery",
  fantasies: "fantasy",
  documentaries: "documentary",
  animations: "animation",
  adventures: "adventure",
  crimes: "crime"
};

const STOP_WORDS = new Set([
  "a", "an", "and", "any", "are", "as", "at", "be", "but", "by", "for", "from",
  "in", "into", "is", "it", "less", "like", "more", "movie", "movies", "film",
  "films", "flick", "flicks", "cinema", "no", "not", "of", "on", "or", "skip",
  "stuff", "than", "that", "the", "this", "to", "too", "very", "with", "without",
  "avoid", "never", "exclude", "dislike", "hate", "prefer", "love", "enjoy"
]);

function cleanStr(val) {
  return String(val ?? "").replace(/\s+/g, " ").trim();
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePolarity(raw) {
  return String(raw || "").trim().toLowerCase() === "avoid" ? "avoid" : "prefer";
}

function resolveGenreAlias(token) {
  const cleaned = cleanStr(token).toLowerCase();
  if (!cleaned) return null;
  const id = GENRE_ALIAS_TO_ID[cleaned] ?? GENRE_NAME_TO_ID[cleaned];
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function stripClauseDirectives(clause) {
  let current = cleanStr(clause)
    .toLowerCase()
    .replace(/^['"]+|['".!?;:]+$/g, "")
    .trim();
  // Strip repeated leading negation/preference prefixes and trailing generic nouns
  const leadRe = /^(?:no|avoid|never|skip|exclude|without|dislike|hate|don't|dont|not|less|prefer|more|love|enjoy|favorite|favour|into|want|only|much|excessive)\s+/i;
  const trailRe = /\s+(?:movies?|films?|flicks?|cinema|pictures?|shows?|series|stuff|ones?)$/i;
  for (let i = 0; i < 4; i++) {
    const next = current
      .replace(leadRe, "")
      .replace(trailRe, "")
      .replace(/^['"]+|['".!?;:]+$/g, "")
      .trim();
    if (next === current) break;
    current = next;
  }
  return current.replace(/^['"]+|['".!?;:]+$/g, "").trim();
}

function singularizeTrailingGenreWord(phrase) {
  const parts = cleanStr(phrase).toLowerCase().split(" ");
  if (parts.length === 0) return "";
  const last = parts[parts.length - 1];
  if (PLURAL_GENRE_SINGULAR[last]) {
    parts[parts.length - 1] = PLURAL_GENRE_SINGULAR[last];
  }
  return parts.join(" ");
}

/**
 * Extracts genreIds and keyword phrases from a taste rule while protecting against
 * the broad-genre blacklist trap:
 * - Unqualified negations ("No horror", "Avoid documentaries") -> populate avoidGenreIds
 * - Qualified genre negations ("No slow-burn period dramas") -> leave avoidGenreIds empty,
 *   extract multi-word phrase into keywords for word-boundary matching & LLM curation.
 */
export function extractRuleSignals(text = "", polarity = "prefer") {
  const normalizedPolarity = normalizePolarity(polarity);
  const cleanedFull = cleanStr(text);
  if (!cleanedFull) return { genreIds: [], keywords: [] };

  const genreIdSet = new Set();
  const keywordSet = new Set();

  const clauses = cleanedFull
    .split(/\s*(?:,|;|\band\b|\bor\b|&|\/)\s*/i)
    .map((c) => stripClauseDirectives(c))
    .filter((c) => c.length >= 2);

  for (const clause of clauses) {
    const bareGenreId = resolveGenreAlias(clause);
    if (bareGenreId) {
      genreIdSet.add(bareGenreId);
      continue;
    }

    const canonical = singularizeTrailingGenreWord(clause);
    if (normalizedPolarity === "prefer") {
      // Safe for "prefer" rules to extract genre boost IDs alongside multi-word phrases
      if (/sci[\s-]?fi|science\s+fiction/i.test(clause)) {
        genreIdSet.add(878);
      }
      const tokens = clause.split(/[\s]+/);
      for (const tok of tokens) {
        const gid = resolveGenreAlias(tok);
        if (gid) genreIdSet.add(gid);
      }
    }

    if (canonical && canonical.length >= 3 && !STOP_WORDS.has(canonical)) {
      keywordSet.add(canonical);
    }

    // For 3+ token qualified phrases (e.g. "slow-burn period drama"), also index trailing bigram ("period drama")
    const words = canonical.split(/\s+/).filter(Boolean);
    if (words.length >= 3) {
      const trailingBigram = words.slice(-2).join(" ");
      if (trailingBigram.length >= 5 && !STOP_WORDS.has(words[words.length - 1])) {
        keywordSet.add(trailingBigram);
      }
    }
  }

  return {
    genreIds: Array.from(genreIdSet),
    keywords: Array.from(keywordSet)
  };
}

function stableRuleId(text, polarity, idx = 0) {
  let hash = 2166136261;
  const seed = `${normalizePolarity(polarity)}:${cleanStr(text).toLowerCase()}`;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `tr_${(hash >>> 0).toString(36)}_${idx}`;
}

export function normalizeTasteRules(rawRules = []) {
  if (!Array.isArray(rawRules)) return [];
  const deduped = [];
  const seenKeys = new Set();

  for (let i = 0; i < rawRules.length; i++) {
    const item = rawRules[i];
    if (!item || typeof item !== "object") continue;
    const rawText = cleanStr(item.text || "").slice(0, MAX_RULE_TEXT_LENGTH).trim();
    if (!rawText) continue;

    const polarity = normalizePolarity(item.polarity);
    const dedupeKey = `${polarity}:${rawText.toLowerCase()}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const signals = extractRuleSignals(rawText, polarity);
    deduped.push({
      id: cleanStr(item.id) || stableRuleId(rawText, polarity, i),
      text: rawText,
      polarity,
      genreIds: signals.genreIds,
      keywords: signals.keywords,
      pinned: Boolean(item.pinned),
      active: item.active !== false,
      source: cleanStr(item.source || "user") || "user",
      updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : Date.now()
    });

    if (deduped.length >= MAX_TASTE_RULES) break;
  }

  return deduped;
}

export function compileActiveTasteRules(rules = []) {
  const normalized = normalizeTasteRules(rules);
  const activeRules = normalized.filter((r) => r.active);
  const preferRules = activeRules.filter((r) => r.polarity === "prefer");
  const avoidRules = activeRules.filter((r) => r.polarity === "avoid");

  const avoidGenreSet = new Set();
  const preferGenreSet = new Set();
  const avoidKwSet = new Set();
  const preferKwSet = new Set();

  for (const rule of avoidRules) {
    for (const gid of rule.genreIds || []) avoidGenreSet.add(gid);
    for (const kw of rule.keywords || []) avoidKwSet.add(kw);
  }
  for (const rule of preferRules) {
    for (const gid of rule.genreIds || []) preferGenreSet.add(gid);
    for (const kw of rule.keywords || []) preferKwSet.add(kw);
  }

  return {
    activeRules,
    preferRules,
    avoidRules,
    avoidGenreIds: Array.from(avoidGenreSet),
    preferGenreIds: Array.from(preferGenreSet),
    avoidKeywords: Array.from(avoidKwSet),
    preferKeywords: Array.from(preferKwSet)
  };
}

function getCandidateGenreIdSet(candidate = {}) {
  const ids = new Set();
  const rawIds = [
    ...(Array.isArray(candidate?.tmdbGenreIds) ? candidate.tmdbGenreIds : []),
    ...(Array.isArray(candidate?.genre_ids) ? candidate.genre_ids : [])
  ];
  for (const id of rawIds) {
    const n = Number(id);
    if (Number.isSafeInteger(n) && n > 0) ids.add(n);
  }
  if (typeof candidate?.genre === "string" && candidate.genre.trim()) {
    for (const g of candidate.genre.split(",")) {
      const resolved = resolveGenreAlias(g);
      if (resolved) ids.add(resolved);
    }
  }
  return ids;
}

function getCandidateSearchText(candidate = {}) {
  const keywords = Array.isArray(candidate?.keywordNames)
    ? candidate.keywordNames.join(" ")
    : "";
  return cleanStr([
    candidate?.title,
    candidate?.genre,
    keywords,
    candidate?.tagline,
    candidate?.overview,
    candidate?.plot
  ].filter(Boolean).join(" "));
}

function buildPhraseRegex(phrase) {
  const cleaned = cleanStr(phrase);
  if (!cleaned) return null;
  const pattern = escapeRegex(cleaned).replace(/(?:\\-|-|\s)+/g, "[\\s-]+");
  const startsWord = /^[a-z0-9]/i.test(cleaned);
  const endsWord = /[a-z0-9]$/i.test(cleaned);
  return new RegExp(`${startsWord ? "\\b" : ""}${pattern}${endsWord ? "\\b" : ""}`, "i");
}

function candidateMatchesRuleList(candidate = {}, rules = []) {
  if (!candidate || !Array.isArray(rules) || rules.length === 0) {
    return { matched: false, matchedRuleText: null };
  }

  const candGenres = getCandidateGenreIdSet(candidate);
  const corpus = getCandidateSearchText(candidate);

  for (const rule of rules) {
    if (!rule || rule.active === false) continue;

    const ruleGenres = Array.isArray(rule.genreIds) ? rule.genreIds : [];
    for (const gid of ruleGenres) {
      if (candGenres.has(gid)) {
        return { matched: true, matchedRuleText: rule.text };
      }
    }

    const ruleKeywords = Array.isArray(rule.keywords) ? rule.keywords : [];
    for (const kw of ruleKeywords) {
      const regex = buildPhraseRegex(kw);
      if (regex && corpus && regex.test(corpus)) {
        return { matched: true, matchedRuleText: rule.text };
      }
    }
  }

  return { matched: false, matchedRuleText: null };
}

export function candidateMatchesAvoidRule(candidate = {}, avoidRules = []) {
  return candidateMatchesRuleList(candidate, avoidRules);
}

export function candidateMatchesPreferRule(candidate = {}, preferRules = []) {
  return candidateMatchesRuleList(candidate, preferRules);
}

export function buildTasteRulesHashSegment(rules = []) {
  const { activeRules } = compileActiveTasteRules(rules);
  if (activeRules.length === 0) return "";
  const canonical = activeRules
    .map((r) => `${r.polarity}:${r.text.toLowerCase()}`)
    .sort()
    .join("|");
  let hash = 2166136261;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `tr_${(hash >>> 0).toString(36)}`;
}

function countNoteTokens(items = [], extractText) {
  const counts = new Map();
  for (const item of items) {
    const raw = cleanStr(extractText(item)).toLowerCase();
    if (!raw) continue;
    const tokens = raw.split(/[^a-z0-9-]+/).filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
    for (const t of new Set(tokens)) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function draftTasteRulesFallback(watched = [], profile = {}, feedbackLog = []) {
  const list = Array.isArray(watched) ? watched.filter(Boolean) : [];
  const liked = list.filter((m) => Number(m.userRating) >= 8);
  const disliked = list.filter((m) => Number(m.userRating) > 0 && Number(m.userRating) <= 4);
  const dismissed = (Array.isArray(feedbackLog) ? feedbackLog : []).filter((f) => f?.status === "dismissed");

  const drafts = [];
  const topGenres = Array.isArray(profile?.lovedGenreNames) && profile.lovedGenreNames.length > 0
    ? profile.lovedGenreNames.slice(0, 2)
    : [];

  const lovedTokens = countNoteTokens(liked, (m) => [m.userNote, ...(Array.isArray(m.keywordNames) ? m.keywordNames : [])].filter(Boolean).join(" "));
  const lovedKeywords = lovedTokens.filter(([, count]) => count >= 2).slice(0, 3).map(([tok]) => tok);
  if (lovedKeywords.length > 0) {
    drafts.push({
      text: `Prefer ${lovedKeywords.join(", ")}${topGenres.length > 0 ? ` ${topGenres[0]}` : ""}`.slice(0, MAX_RULE_TEXT_LENGTH),
      polarity: "prefer",
      source: "auto-fallback"
    });
  } else if (topGenres.length > 0) {
    drafts.push({
      text: `Prefer ${topGenres.join(" and ")} with distinctive atmosphere`.slice(0, MAX_RULE_TEXT_LENGTH),
      polarity: "prefer",
      source: "auto-fallback"
    });
  }

  const dislikedTokens = countNoteTokens(
    [...disliked, ...dismissed],
    (m) => [m.userNote, m.reason, ...(Array.isArray(m.keywordNames) ? m.keywordNames : [])].filter(Boolean).join(" ")
  );
  const avoidedTerms = dislikedTokens.filter(([, count]) => count >= 2).slice(0, 3).map(([tok]) => tok);
  if (avoidedTerms.length > 0) {
    drafts.push({
      text: `Avoid ${avoidedTerms.join(", ")}`.slice(0, MAX_RULE_TEXT_LENGTH),
      polarity: "avoid",
      source: "auto-fallback"
    });
  } else if (disliked.length > 0) {
    const genreCounts = new Map();
    for (const d of disliked) {
      for (const g of String(d.genre || "").split(",")) {
        const cleanG = cleanStr(g);
        if (cleanG && cleanG !== "N/A") genreCounts.set(cleanG, (genreCounts.get(cleanG) || 0) + 1);
      }
    }
    const worstGenre = Array.from(genreCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (worstGenre) {
      drafts.push({
        text: `Avoid ${worstGenre.toLowerCase()}`,
        polarity: "avoid",
        source: "auto-fallback"
      });
    }
  }

  return normalizeTasteRules(drafts.map((d, idx) => ({ ...d, id: stableRuleId(d.text, d.polarity, idx) })));
}

function mergePinnedAndDraftedRules(existingRules = [], draftedRules = []) {
  const existing = normalizeTasteRules(existingRules);
  const pinned = existing.filter((r) => r.pinned);
  const nonPinned = existing.filter((r) => !r.pinned);
  return normalizeTasteRules([...pinned, ...draftedRules, ...nonPinned]);
}

export async function draftTasteRulesWithGemini(ai, options = {}) {
  const watched = Array.isArray(options?.watched) ? options.watched : [];
  const profile = options?.profile || {};
  const feedbackLog = Array.isArray(options?.feedbackLog) ? options.feedbackLog : [];
  const existingRules = Array.isArray(options?.existingRules) ? options.existingRules : [];

  const fallback = () => mergePinnedAndDraftedRules(
    existingRules,
    draftTasteRulesFallback(watched, profile, feedbackLog)
  );

  if (!ai?.models?.generateContent) {
    return fallback();
  }

  try {
    let deps = options?.geminiDeps;
    if (!deps || typeof deps.executeCascade !== "function") {
      const gemMod = await import("./geminiService.js");
      deps = {
        executeCascade: gemMod.executeCascade,
        sanitizeAndParseJSON: gemMod.sanitizeAndParseJSON,
        FAST_INTERACTIVE_CASCADE: gemMod.FAST_INTERACTIVE_CASCADE
      };
    }

    const TypeMap = deps.Type || { OBJECT: "OBJECT", ARRAY: "ARRAY", STRING: "STRING" };
    const favNotes = watched
      .filter((m) => Number(m.userRating) >= 8)
      .slice(0, 12)
      .map((m) => `- "${m.title}" (${m.userRating}/10)${m.userNote ? `: ${cleanStr(m.userNote).slice(0, 100)}` : ""}`)
      .join("\n");
    const badNotes = watched
      .filter((m) => Number(m.userRating) > 0 && Number(m.userRating) <= 4)
      .slice(0, 8)
      .map((m) => `- "${m.title}" (${m.userRating}/10)${m.userNote ? `: ${cleanStr(m.userNote).slice(0, 100)}` : ""}`)
      .join("\n");
    const dismissedNotes = feedbackLog
      .filter((f) => f?.status === "dismissed" && f?.reason)
      .slice(0, 5)
      .map((f) => `- Dismissed "${f.title}": ${cleanStr(f.reason).slice(0, 80)}`)
      .join("\n");

    const prompt = `Synthesize 4 to 6 short, actionable movie taste rules from this viewer's vault so they can edit and pin them.
Each rule must be concrete (under 100 chars), either polarity "prefer" or "avoid".

FAVORITES:
${favNotes || "None recorded yet."}

DISLIKED:
${badNotes || "None recorded."}
${dismissedNotes ? `\nDISMISSED:\n${dismissedNotes}` : ""}`;

    const config = {
      responseMimeType: "application/json",
      responseSchema: {
        type: TypeMap.OBJECT,
        properties: {
          rules: {
            type: TypeMap.ARRAY,
            items: {
              type: TypeMap.OBJECT,
              properties: {
                text: { type: TypeMap.STRING },
                polarity: { type: TypeMap.STRING }
              },
              required: ["text", "polarity"]
            }
          }
        },
        required: ["rules"]
      }
    };

    const res = await deps.executeCascade(
      ai,
      deps.FAST_INTERACTIVE_CASCADE,
      { contents: prompt, config },
      { cascadeType: "fast" }
    );
    if (!res?.text) return fallback();

    const parsed = deps.sanitizeAndParseJSON(res.text);
    const rawList = Array.isArray(parsed?.rules) ? parsed.rules : [];
    const normalizedAiRules = normalizeTasteRules(
      rawList.map((r, idx) => ({
        text: r?.text,
        polarity: normalizePolarity(r?.polarity),
        source: "ai-draft",
        id: stableRuleId(r?.text || "", normalizePolarity(r?.polarity), idx),
        pinned: false,
        active: true
      }))
    );

    if (normalizedAiRules.length === 0) return fallback();
    return mergePinnedAndDraftedRules(existingRules, normalizedAiRules);
  } catch (_) {
    return fallback();
  }
}
