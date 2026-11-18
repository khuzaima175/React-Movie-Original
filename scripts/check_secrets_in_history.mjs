import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const PLACEHOLDER_RE = /^your_.*_here$/i;
const SCANNABLE_KEY_RE = /KEY|TOKEN|SECRET/i;

/**
 * Parse .env-style text into scannable-shaped key/value pairs without leaking secrets.
 */
export function parseEnvText(text = "") {
  const entries = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!value || PLACEHOLDER_RE.test(value)) continue;
    entries.push({ key, value });
  }
  return entries;
}

/**
 * True when an env entry holds a credential-like key whose value is long enough to scan cleanly.
 */
export function isScannable(entry) {
  if (!entry || typeof entry.key !== "string" || typeof entry.value !== "string") {
    return false;
  }
  return SCANNABLE_KEY_RE.test(entry.key) && entry.value.length >= 8;
}

function scanEnvFiles(rootDir = process.cwd()) {
  const envFiles = [".env", ".env.local"];
  let foundAny = false;

  for (const fileName of envFiles) {
    const fullPath = path.join(rootDir, fileName);
    if (!fs.existsSync(fullPath)) continue;
    const raw = fs.readFileSync(fullPath, "utf8");
    for (const entry of parseEnvText(raw)) {
      if (!isScannable(entry)) continue;
      const out = execFileSync(
        "git",
        ["log", "--all", `-S${entry.value}`, "--format=%h"],
        { cwd: rootDir, encoding: "utf8" }
      ).trim();
      const commits = out ? out.split(/\r?\n/).filter(Boolean) : [];
      if (commits.length > 0) {
        foundAny = true;
        console.log(`${fileName}::${entry.key}: FOUND in ${commits.length} commit(s)`);
      } else {
        console.log(`${fileName}::${entry.key}: CLEAN`);
      }
    }
  }

  return foundAny ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = scanEnvFiles();
}
