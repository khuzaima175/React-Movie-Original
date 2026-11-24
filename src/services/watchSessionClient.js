import { getSupabaseClientAsync, hasSupabaseConfig } from "./supabaseClient.js";
import { generateRoomCode } from "./watchTogetherService.js";

const ROOM_CODE_RE = /^[A-Z0-9]{8}$/;

export function normalizeRoomCode(rawCode = "") {
  const cleaned = String(rawCode || "").trim().toUpperCase();
  return ROOM_CODE_RE.test(cleaned) ? cleaned : null;
}

async function resolveSupabase(options = {}) {
  if ("supabaseClient" in options) return options.supabaseClient;
  if (!hasSupabaseConfig()) return null;
  return getSupabaseClientAsync();
}

function isRowExpired(row, now = Date.now()) {
  if (!row?.expires_at) return false;
  const ts = Date.parse(row.expires_at);
  return Number.isFinite(ts) && ts <= now;
}

/**
 * Creates a 48-hour Watch Together swipe room via `create_watch_session` RPC.
 */
export async function createWatchSession(
  {
    roomCode = null,
    hostName = "Host",
    hostVector = null,
    hostWatchedIds = [],
    hostAvoidRules = [],
    deckItems = [],
    region = "US",
    providerIds = []
  } = {},
  options = {}
) {
  const supabase = await resolveSupabase(options);
  if (!supabase) {
    return { ok: false, status: "unconfigured", error: "Cloud rooms require Supabase configuration." };
  }

  const code = normalizeRoomCode(roomCode) || generateRoomCode(8);
  const safeVector =
    Array.isArray(hostVector) && hostVector.length === 64
      ? hostVector.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0))
      : null;

  const { data, error } = await supabase.rpc("create_watch_session", {
    p_room_code: code,
    p_host_name: String(hostName || "Host").slice(0, 48),
    p_host_vector: safeVector,
    p_host_watched_ids: (Array.isArray(hostWatchedIds) ? hostWatchedIds : [])
      .map(Number)
      .filter((n) => Number.isSafeInteger(n) && n > 0),
    p_host_avoid_rules: Array.isArray(hostAvoidRules) ? hostAvoidRules : [],
    p_deck_items: Array.isArray(deckItems) ? deckItems : [],
    p_region: String(region || "US"),
    p_provider_ids: (Array.isArray(providerIds) ? providerIds : [])
      .map(Number)
      .filter((n) => Number.isSafeInteger(n) && n > 0)
  });

  if (error || !data) {
    return {
      ok: false,
      status: "error",
      error: error?.message || "Could not create Watch Together room."
    };
  }
  return { ok: true, status: "ok", session: data };
}

/**
 * Fetches an active Watch Together room by its 8-character code.
 */
export async function fetchWatchSession(rawCode, options = {}) {
  const code = normalizeRoomCode(rawCode);
  if (!code) {
    return { status: "not_found", session: null };
  }

  const supabase = await resolveSupabase(options);
  if (!supabase) {
    return { status: "unconfigured", session: null };
  }

  const { data, error } = await supabase.rpc("get_watch_session_by_code", {
    p_room_code: code
  });

  if (error) {
    return { status: "error", session: null, error: error.message };
  }
  if (!data) {
    return { status: "not_found", session: null };
  }
  if (isRowExpired(data, options.now)) {
    return { status: "expired", session: null };
  }
  return { status: "ok", session: data };
}

/**
 * Joins an active Watch Together room as the guest partner and optionally updates the merged deck.
 */
export async function joinWatchSession(
  {
    roomCode,
    guestName = "Partner",
    guestVector = null,
    guestWatchedIds = [],
    guestAvoidRules = [],
    deckItems = null
  } = {},
  options = {}
) {
  const code = normalizeRoomCode(roomCode);
  if (!code) return { ok: false, status: "not_found", error: "Invalid room code." };

  const supabase = await resolveSupabase(options);
  if (!supabase) return { ok: false, status: "unconfigured", error: "Cloud service unavailable." };

  const safeVector =
    Array.isArray(guestVector) && guestVector.length === 64
      ? guestVector.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0))
      : null;

  const { data, error } = await supabase.rpc("join_watch_session", {
    p_room_code: code,
    p_guest_name: String(guestName || "Partner").slice(0, 48),
    p_guest_vector: safeVector,
    p_guest_watched_ids: (Array.isArray(guestWatchedIds) ? guestWatchedIds : [])
      .map(Number)
      .filter((n) => Number.isSafeInteger(n) && n > 0),
    p_guest_avoid_rules: Array.isArray(guestAvoidRules) ? guestAvoidRules : [],
    p_deck_items: Array.isArray(deckItems) ? deckItems : null
  });

  if (error || !data) {
    return {
      ok: false,
      status: error ? "error" : "expired",
      error: error?.message || "This Movie Night room has expired or was not found."
    };
  }
  return { ok: true, status: "ok", session: data };
}

/**
 * Records a participant swipe vote (`yes` or `no`) on a deck movie.
 */
export async function submitWatchVote(
  { roomCode, role = "host", tmdbId, vote = "yes" } = {},
  options = {}
) {
  const code = normalizeRoomCode(roomCode);
  const cleanId = Number(tmdbId);
  if (!code || !Number.isSafeInteger(cleanId) || cleanId <= 0) {
    return { ok: false, status: "invalid", error: "Invalid room code or film ID." };
  }

  const supabase = await resolveSupabase(options);
  if (!supabase) return { ok: false, status: "unconfigured", error: "Cloud service unavailable." };

  const { data, error } = await supabase.rpc("submit_watch_session_vote", {
    p_room_code: code,
    p_role: role === "guest" ? "guest" : "host",
    p_tmdb_id: cleanId,
    p_vote: vote === "no" ? "no" : "yes"
  });

  if (error || !data) {
    return {
      ok: false,
      status: "error",
      error: error?.message || "Could not submit swipe vote."
    };
  }
  return { ok: true, status: "ok", session: data };
}
