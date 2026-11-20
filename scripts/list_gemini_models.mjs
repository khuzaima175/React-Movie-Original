import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { parseEnvText } from "./check_secrets_in_history.mjs";
import {
  CURATION_MODEL_CASCADE,
  PUBLIC_CURATION_CASCADE,
  EXPLORE_FOR_YOU_CASCADE,
  FAST_INTERACTIVE_CASCADE
} from "../src/services/geminiService.js";

function readApiKeyFromEnv(rootDir = process.cwd()) {
  const fromProcess = (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_KEY || "").trim();
  if (fromProcess) return fromProcess;

  for (const fileName of [".env.local", ".env"]) {
    const fullPath = path.join(rootDir, fileName);
    if (!fs.existsSync(fullPath)) continue;
    const entries = parseEnvText(fs.readFileSync(fullPath, "utf8"));
    const match =
      entries.find((e) => e.key === "GEMINI_API_KEY") ||
      entries.find((e) => e.key === "VITE_GEMINI_KEY");
    if (match?.value) return match.value;
  }
  return "";
}

async function main() {
  const apiKey = readApiKeyFromEnv();
  if (!apiKey) {
    console.log("No GEMINI_API_KEY / VITE_GEMINI_KEY found in environment or .env files.");
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const pager = await ai.models.list();
    const available = new Set();

    for await (const model of pager) {
      const rawName = String(model?.name || "").trim();
      const shortName = rawName.replace(/^models\//, "");
      if (shortName) available.add(shortName);
    }

    const configured = Array.from(
      new Set([
        ...CURATION_MODEL_CASCADE,
        ...PUBLIC_CURATION_CASCADE,
        ...EXPLORE_FOR_YOU_CASCADE,
        ...FAST_INTERACTIVE_CASCADE
      ])
    );

    for (const id of configured) {
      console.log(`${id}: ${available.has(id) ? "OK" : "MISSING"}`);
    }
  } catch (err) {
    console.log(`Unable to list Gemini models (${err?.status || err?.message || "request failed"}).`);
  }
}

await main();
