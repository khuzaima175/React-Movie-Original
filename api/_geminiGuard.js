export const MAX_GEMINI_CONTENT_CHARS = 60000;
export const MAX_GEMINI_OUTPUT_TOKENS = 16384;

/**
 * Validates and bounds incoming /api/gemini request payloads to protect shared quota.
 */
export function sanitizeGeminiRequest(body = {}) {
  const contents = body?.contents;
  if (contents === undefined || contents === null) {
    return { ok: false, status: 400, error: "Missing contents" };
  }
  if (typeof contents === "string" && !contents.trim()) {
    return { ok: false, status: 400, error: "Contents cannot be empty" };
  }
  if (Array.isArray(contents) && contents.length === 0) {
    return { ok: false, status: 400, error: "Contents cannot be empty" };
  }

  let serializedLen = 0;
  try {
    serializedLen = JSON.stringify(contents)?.length ?? 0;
  } catch {
    return { ok: false, status: 400, error: "Invalid contents payload" };
  }
  if (serializedLen > MAX_GEMINI_CONTENT_CHARS) {
    return { ok: false, status: 413, error: "Prompt exceeds maximum allowed size" };
  }

  const rawConfig = body?.config;
  const config =
    rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? { ...rawConfig }
      : {};

  delete config.tools;
  delete config.toolConfig;
  delete config.cachedContent;

  const requestedTokens = Number(config.maxOutputTokens);
  config.maxOutputTokens =
    Number.isFinite(requestedTokens) && requestedTokens > 0
      ? Math.min(Math.floor(requestedTokens), MAX_GEMINI_OUTPUT_TOKENS)
      : MAX_GEMINI_OUTPUT_TOKENS;

  return { ok: true, contents, config };
}
