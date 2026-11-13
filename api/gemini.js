import { GoogleGenAI } from "@google/genai";

const ALLOWED_GEMINI_MODEL_RE = /^[a-z0-9._-]+$/i;

function sanitizeUpstreamMessage(message, secret) {
  const text = String(message || "Upstream Gemini request failed");
  return secret ? text.split(secret).join("[REDACTED]") : text;
}

function parseJsonBody(rawBody) {
  if (rawBody === undefined || rawBody === null) return {};
  if (typeof rawBody === "string") {
    return rawBody.trim() ? JSON.parse(rawBody) : {};
  }
  if (typeof rawBody === "object") return rawBody;
  throw new Error("Unsupported request body type");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader?.("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body;
  try {
    body = parseJsonBody(req.body);
  } catch (_) {
    return res.status(400).json({ error: "Invalid JSON request body" });
  }

  const model = typeof body?.model === "string" ? body.model.trim() : "";
  if (!model || !ALLOWED_GEMINI_MODEL_RE.test(model) || body?.contents === undefined) {
    return res.status(400).json({ error: "Invalid Gemini model or missing contents" });
  }

  const apiKey = (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_KEY || "").trim();
  if (!apiKey) {
    return res.status(503).json({ error: "Server Gemini credentials are not configured" });
  }

  const ai = typeof req.aiFactory === "function"
    ? req.aiFactory(apiKey)
    : new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model,
      contents: body.contents,
      config: body.config || {}
    });
    return res.status(200).json({
      text: response?.text ?? "",
      usageMetadata: response?.usageMetadata ?? null
    });
  } catch (err) {
    const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600
      ? err.status
      : 502;
    return res.status(status).json({
      error: sanitizeUpstreamMessage(err?.message, apiKey)
    });
  }
}
