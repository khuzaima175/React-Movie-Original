/**
 * Tracks Gemini API spend (incl. thinking tokens) and gates the paid Argon model behind a hard cap.
 * Prices are USD per 1M tokens: [input, output].
 */
const KEY = "cv_ai_spend_usd";
const ARGON_INTRO_END = Date.parse("2026-12-01T00:00:00Z"); // intro price valid through Nov 30
const FLASH = [0.75, 3.75];

export function estimateCostUsd(model, usage, now = new Date()) {
  if (!usage) return 0;
  let rate = FLASH;
  if (String(model).includes("argon")) rate = now.getTime() < ARGON_INTRO_END ? [2, 10] : [4, 20];
  const input = usage.promptTokenCount || 0;
  const output = (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
  return (input * rate[0] + output * rate[1]) / 1e6;
}

export function createSpendTracker({ storage, capUsd = 6, now = () => new Date() } = {}) {
  const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  let sessionBlocked = false;
  const read = () => {
    const n = Number(store?.getItem(KEY));
    return Number.isFinite(n) ? n : 0;
  };
  return {
    spent: read,
    record(model, usage) {
      const cost = estimateCostUsd(model, usage, now());
      if (cost > 0) store?.setItem(KEY, read() + cost);
      return cost;
    },
    canUseArgon: () => !sessionBlocked && read() < capUsd,
    markArgonUnavailable() {
      sessionBlocked = true;
    },
  };
}

export const spendTracker = createSpendTracker();
