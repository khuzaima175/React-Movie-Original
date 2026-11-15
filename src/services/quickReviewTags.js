/**
 * Shared quick-review praise & critique tags and hashtag note helpers
 * for both QuickRateModal (fast 1-click capture) and MovieDetails (full editor).
 */

export const QUICK_REVIEW_TAGS = Object.freeze([
  { id: "Masterpiece", sentiment: "positive" },
  { id: "MindBlowing", sentiment: "positive" },
  { id: "SmartPlot", sentiment: "positive" },
  { id: "TightPacing", sentiment: "positive" },
  { id: "GreatActing", sentiment: "positive" },
  { id: "Cinematography", sentiment: "positive" },
  { id: "EpicScore", sentiment: "positive" },
  { id: "PlotTwist", sentiment: "positive" },
  { id: "MustRewatch", sentiment: "positive" },
  { id: "Emotional", sentiment: "positive" },
  { id: "CultClassic", sentiment: "positive" },
  { id: "Iconic", sentiment: "positive" },
  { id: "SlowPacing", sentiment: "critique" },
  { id: "WeakEnding", sentiment: "critique" },
  { id: "TooBleak", sentiment: "critique" },
  { id: "StyleOverSubstance", sentiment: "critique" },
]);

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTag(rawTag) {
  const clean = String(rawTag || "").trim().replace(/^#+/, "");
  return clean ? `#${clean}` : "";
}

/**
 * Checks whether a normalized #tag token is present on whitespace boundaries.
 */
export function hasQuickTagInNote(currentNote, rawTag) {
  const noteStr = typeof currentNote === "string" ? currentNote : "";
  const tag = normalizeTag(rawTag);
  if (!tag || !noteStr) return false;
  const re = new RegExp(`(^|\\s)${escapeRegExp(tag)}(?=\\s|$)`);
  return re.test(noteStr);
}

/**
 * Toggles a #tag inside a userNote string cleanly while enforcing maxLen on additions.
 */
export function toggleQuickTagInNote(currentNote, rawTag, maxLen = 500) {
  const noteStr = typeof currentNote === "string" ? currentNote : "";
  const tag = normalizeTag(rawTag);
  if (!tag) return noteStr;

  if (hasQuickTagInNote(noteStr, tag)) {
    const removeRe = new RegExp(`(^|\\s)${escapeRegExp(tag)}(?=\\s|$)`, "g");
    return noteStr
      .replace(removeRe, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/^ +| +$/gm, "")
      .trim();
  }

  const trimmed = noteStr.trim();
  const next = trimmed ? `${trimmed} ${tag}` : tag;
  return next.length <= maxLen ? next : noteStr;
}

/**
 * Selects a compact set of 6 contextual quick-tap tags for QuickRateModal
 * based on whether the user is giving a constructive/low rating (<7) or praise (>=7).
 */
export function getContextualQuickTags(rating) {
  if (Number(rating) > 0 && Number(rating) < 7) {
    const critique = QUICK_REVIEW_TAGS.filter((t) => t.sentiment === "critique");
    const craft = QUICK_REVIEW_TAGS.filter((t) => t.id === "GreatActing" || t.id === "Cinematography");
    return [...critique, ...craft];
  }
  const topPraise = ["Masterpiece", "MindBlowing", "SmartPlot", "TightPacing"];
  const topCritique = ["SlowPacing", "WeakEnding"];
  return QUICK_REVIEW_TAGS.filter(
    (t) => topPraise.includes(t.id) || topCritique.includes(t.id)
  );
}
