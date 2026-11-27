/**
 * Player Hardware & Platform Rig Profile Service for GameVault.
 * Stores the user's platforms (PC / PS5 / PS4 / Xbox / Switch / Steam Deck) and PC GPU spec tier
 * locally so GameVault tailors starter calibration, compatibility badges, and recommendations
 * (e.g., an Entry/GTX 750 Ti PC sees playable classics & 2D indies instead of unplayable 2025 UE5 AAAs).
 */

export const GAME_RIG_STORAGE_KEY = "gamevault_rig_profile_v1";

export const RIG_PLATFORM_CHOICES = Object.freeze([
  { id: "pc", label: "PC / Laptop", family: "pc", short: "PC" },
  { id: "ps5", label: "PlayStation 5", family: "playstation", short: "PS5" },
  { id: "ps4", label: "PlayStation 4", family: "playstation", short: "PS4" },
  { id: "xbox", label: "Xbox Series X|S / One", family: "xbox", short: "Xbox" },
  { id: "switch", label: "Nintendo Switch", family: "nintendo", short: "Switch" },
  { id: "handheld", label: "Steam Deck / Handheld", family: "pc", short: "Steam Deck" }
]);

export const PC_SPEC_TIERS = Object.freeze([
  {
    id: "entry",
    label: "Entry / Older PC",
    gpuExamples: "GTX 750 Ti · GTX 960 · GTX 1050 · Intel UHD / Integrated",
    desc: "Great for pre-2019 classics, esports, strategy, sims, and modern 2D/indie masterpieces."
  },
  {
    id: "mid",
    label: "Mid-Range PC",
    gpuExamples: "GTX 1060 · GTX 1660 · RTX 2060 · RTX 3060 · RX 6600",
    desc: "Smooth 1080p across most modern games including RDR2, Elden Ring, and Cyberpunk."
  },
  {
    id: "high",
    label: "High-End / Enthusiast PC",
    gpuExamples: "RTX 3080 · RTX 4070+ · RTX 5070+ · RX 7800 XT+",
    desc: "Unlocks every 2024–2026 AAA blockbuster at high/ultra settings."
  }
]);

export const DEFAULT_RIG_PROFILE = Object.freeze({
  completed: false,
  platforms: ["pc"],
  pcSpecTier: "mid",
  detectedGpu: "",
  respectRigLimits: true
});

export function loadRigProfile() {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_RIG_PROFILE };
    const raw = localStorage.getItem(GAME_RIG_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RIG_PROFILE };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_RIG_PROFILE,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
      platforms: Array.isArray(parsed?.platforms) && parsed.platforms.length > 0 ? parsed.platforms : ["pc"]
    };
  } catch {
    return { ...DEFAULT_RIG_PROFILE };
  }
}

export function saveRigProfileToStorage(profile) {
  const clean = {
    completed: Boolean(profile?.completed ?? true),
    platforms: Array.isArray(profile?.platforms) && profile.platforms.length > 0 ? profile.platforms : ["pc"],
    pcSpecTier: ["entry", "mid", "high"].includes(profile?.pcSpecTier) ? profile.pcSpecTier : "mid",
    detectedGpu: String(profile?.detectedGpu || "").trim().slice(0, 120),
    respectRigLimits: profile?.respectRigLimits !== false
  };
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(GAME_RIG_STORAGE_KEY, JSON.stringify(clean));
    }
  } catch {
    // ignore storage quota errors
  }
  return clean;
}

/**
 * Classifies a WebGL GPU renderer string into "entry" | "mid" | "high" locally (100% client-side).
 */
export function classifyGpuRenderer(raw = "") {
  const s = String(raw || "").toLowerCase();
  if (!s) return null;

  // High-end modern GPUs
  if (
    /rtx\s*(3080|3090|4070|4080|4090|5070|5080|5090)/.test(s) ||
    /rx\s*(6800|6900|6950|7800|7900|9070)/.test(s) ||
    /apple\s*m[34]\s*(pro|max|ultra)/.test(s)
  ) {
    return "high";
  }

  // Entry / older / integrated GPUs
  if (
    /gtx\s*(5\d\d|6\d\d|7\d\d|8\d\d|950|960|1030|1050)/.test(s) ||
    /\bgt\s*\d{3,4}\b/.test(s) ||
    /mx\s*(1\d\d|2\d\d|3\d\d|4\d\d|5\d\d)/.test(s) ||
    /intel.*(uhd|hd graphics|iris|integrated)/.test(s) ||
    /vega\s*[3678]\b/.test(s) ||
    /radeon.*(r5|r7|hd\s*\d|rx\s*460|rx\s*550|rx\s*560)/.test(s) ||
    /swiftshader|llvmpipe/.test(s)
  ) {
    return "entry";
  }

  // Mid-range GPUs
  if (
    /rtx\s*(20\d\d|3050|3060|3070|4050|4060|5060)/.test(s) ||
    /gtx\s*(970|980|1060|1070|1080|1650|1660)/.test(s) ||
    /rx\s*(570|580|590|5500|5600|5700|6500|6600|6700|7600|7700)/.test(s) ||
    /arc\s*a[57]\d\d/.test(s) ||
    /apple\s*m[1-4]/.test(s)
  ) {
    return "mid";
  }

  return "mid";
}

export function detectLocalGpuInfo() {
  if (typeof document === "undefined") return { renderer: "", tier: null };
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return { renderer: "", tier: null };
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "") : "";
    return {
      renderer: renderer.trim(),
      tier: classifyGpuRenderer(renderer)
    };
  } catch {
    return { renderer: "", tier: null };
  }
}

const LIGHTWEIGHT_GENRE_RE = /indie|card|board|puzzle|visual novel|point-and-click|turn-based|platform|arcade|quiz/i;

/**
 * Estimates the minimum PC hardware tier ("entry" | "mid" | "high") needed to run a game smoothly.
 */
export function estimateGameSpecTier(game = {}) {
  if (game?.specTier && ["entry", "mid", "high"].includes(game.specTier)) {
    return game.specTier;
  }
  const year = Number(game?.year || 0);
  const genresText = (Array.isArray(game?.genres) ? game.genres : []).join(" ");
  const isLightweight = LIGHTWEIGHT_GENRE_RE.test(genresText) && !/shooter|racing/i.test(genresText);

  if (year > 0 && year <= 2016) return "entry";
  if (isLightweight) return "entry";
  if (year >= 2022) return "high";
  if (year >= 2017) return "mid";
  return "entry";
}

const TIER_RANK = { entry: 0, mid: 1, high: 2 };

/**
 * Evaluates whether a game fits the user's configured console/PC rig.
 * If the user owns a PS5/Xbox Series/Switch in addition to an Entry PC, modern console games remain compatible!
 */
export function isGameCompatibleWithRig(game = {}, rigProfile = null) {
  if (!rigProfile || !rigProfile.completed) {
    return { compatible: true, badgeLabel: "", tier: estimateGameSpecTier(game) };
  }
  const platforms = Array.isArray(rigProfile.platforms) ? rigProfile.platforms : ["pc"];
  const hasModernConsole = platforms.includes("ps5") || platforms.includes("xbox");
  const hasOnlyEntryPc =
    platforms.every((p) => p === "pc" || p === "handheld") && rigProfile.pcSpecTier === "entry";

  const reqTier = estimateGameSpecTier(game);
  const userTier = hasModernConsole
    ? "high"
    : platforms.includes("pc")
      ? rigProfile.pcSpecTier || "mid"
      : platforms.includes("ps4") || platforms.includes("handheld")
        ? "mid"
        : "entry";

  if (TIER_RANK[reqTier] <= TIER_RANK[userTier]) {
    return {
      compatible: true,
      badgeLabel: hasOnlyEntryPc ? "Runs on Your PC" : "",
      tier: reqTier
    };
  }

  return {
    compatible: false,
    badgeLabel: reqTier === "high" ? "Heavy Modern AAA (Check Specs)" : "Demanding GPU",
    tier: reqTier
  };
}

export function getRigPlatformFamilies(rigProfile = null) {
  if (!rigProfile?.completed || !Array.isArray(rigProfile.platforms) || rigProfile.platforms.length === 0) {
    return [];
  }
  const fams = new Set();
  for (const pid of rigProfile.platforms) {
    const found = RIG_PLATFORM_CHOICES.find((p) => p.id === pid);
    if (found) fams.add(found.family);
  }
  return [...fams];
}

export function getDefaultPlatformFocus(rigProfile = null) {
  const fams = getRigPlatformFamilies(rigProfile);
  return fams.length === 1 ? fams[0] : "all";
}

export function getDefaultPlatformLabel(rigProfile = null) {
  const first = rigProfile?.platforms?.[0];
  const found = RIG_PLATFORM_CHOICES.find((p) => p.id === first);
  return found ? found.short : "PC";
}
