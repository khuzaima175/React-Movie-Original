import { hasSupabaseConfig, getSupabaseClientAsync } from "./supabaseClient.js";
import { computeUserEmbedding, l2NormalizeInPlace } from "./embeddingService.js";
import { computeZScoredWeights } from "./scoringUtils.js";
import { isSameMovie } from "./movieIdentity.js";

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "root",
  "system",
  "support",
  "help",
  "api",
  "auth",
  "login",
  "signup",
  "account",
  "settings",
  "profile",
  "profiles",
  "user",
  "users",
  "u",
  "discover",
  "explore",
  "vault",
  "oracle",
  "ai",
  "movie",
  "movies",
  "person",
  "compare",
  "cinemavault",
  "null",
  "undefined"
]);

/**
 * Validates and normalizes a public CinemaVault handle (`^[a-z0-9_]{3,24}$`).
 */
export function validateUsername(raw = "") {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

  if (!cleaned) {
    return { ok: false, username: "", error: "Choose a handle (3–24 letters, numbers, or underscores)." };
  }
  if (cleaned.length < 3 || cleaned.length > 24) {
    return { ok: false, username: cleaned, error: "Handle must be between 3 and 24 characters." };
  }
  if (!USERNAME_RE.test(cleaned)) {
    return { ok: false, username: cleaned, error: "Use only lowercase letters, numbers, and underscores." };
  }
  if (RESERVED_USERNAMES.has(cleaned)) {
    return { ok: false, username: cleaned, error: "That handle is reserved. Please pick another." };
  }
  return { ok: true, username: cleaned, error: null };
}

/**
 * Computes a calibrated 0–99% Taste Twin compatibility score from two 64-D CVEM taste vectors.
 */
export function computeTasteTwinCompatibility(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) return null;
  if (vecA.length !== 64 || vecB.length !== 64) return null;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < 64; i += 1) {
    const a = Number(vecA[i]);
    const b = Number(vecB[i]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (normA <= 1e-8 || normB <= 1e-8) return null;

  const cosine = Math.max(-1, Math.min(1, dot / (Math.sqrt(normA) * Math.sqrt(normB))));
  // Calibrated mapping: cos 1.0 -> 99%, cos 0.0 -> 50%, cos -1.0 -> 5%
  const matchPct = Math.max(5, Math.min(99, Math.round(50 + cosine * 49)));

  let label = "Different Lens";
  if (matchPct >= 86) label = "Taste Twin";
  else if (matchPct >= 72) label = "Strong Overlap";
  else if (matchPct >= 56) label = "Shared Wavelength";

  return {
    matchPct,
    cosine: Number(cosine.toFixed(3)),
    label
  };
}

/**
 * Computes a privacy-safe, L2-normalized 64-D taste vector for a user's public profile
 * from their real (non-sample) watched films.
 */
export function computeProfileTasteVector(watched = [], embeddingIndex = null) {
  if (!embeddingIndex || !Array.isArray(watched) || watched.length < 3) return null;
  const realRated = watched.filter(
    (m) => m && !m.isSample && Number(m.userRating) > 0 && Number(m.tmdbId ?? m.id) > 0
  );
  if (realRated.length < 3) return null;

  const weighted = computeZScoredWeights(realRated);
  const vec = computeUserEmbedding(weighted, embeddingIndex);
  if (!vec || vec.length !== 64) return null;

  const normalized = Float32Array.from(vec);
  l2NormalizeInPlace(normalized);
  let sumSq = 0;
  const out = new Array(64);
  for (let i = 0; i < 64; i += 1) {
    const val = Number.isFinite(normalized[i]) ? Number(normalized[i].toFixed(5)) : 0;
    out[i] = val;
    sumSq += val * val;
  }
  return sumSq > 1e-6 ? out : null;
}

/**
 * Aggregates public community rating rows into average score, count, 1–10 histogram, and written reviews.
 */
export function aggregateCommunityRatings(rows = []) {
  const histogram = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 };
  const validRows = (Array.isArray(rows) ? rows : []).filter(
    (r) => r && Number.isFinite(Number(r.user_rating)) && Number(r.user_rating) >= 1 && Number(r.user_rating) <= 10
  );

  let sum = 0;
  for (const r of validRows) {
    const rating = Math.round(Number(r.user_rating));
    sum += rating;
    histogram[rating] = (histogram[rating] || 0) + 1;
  }

  const reviews = validRows
    .filter((r) => String(r.user_note || "").trim().length > 0)
    .sort((a, b) => {
      const ta = new Date(a.updated_at || a.watched_at || 0).getTime() || 0;
      const tb = new Date(b.updated_at || b.watched_at || 0).getTime() || 0;
      return tb - ta;
    });

  return {
    count: validRows.length,
    average: validRows.length > 0 ? Number((sum / validRows.length).toFixed(1)) : null,
    histogram,
    reviews,
    allRatings: validRows
  };
}

/**
 * Finds films the profile owner loved (>= 8/10) that the current viewer hasn't seen yet.
 */
export function pickUnseenFavoritesFromProfile(profileRatings = [], viewerWatched = [], limit = 8) {
  const watchedList = Array.isArray(viewerWatched) ? viewerWatched : [];
  const candidates = (Array.isArray(profileRatings) ? profileRatings : []).filter((r) => {
    if (!r || Number(r.user_rating) < 8) return false;
    const candidateObj = {
      tmdbId: r.tmdb_id,
      imdbID: r.imdb_id,
      title: r.title,
      year: r.year
    };
    return !watchedList.some((w) => isSameMovie(w, candidateObj));
  });

  candidates.sort(
    (a, b) =>
      Number(b.user_rating || 0) - Number(a.user_rating || 0) ||
      (new Date(b.updated_at || 0).getTime() || 0) - (new Date(a.updated_at || 0).getTime() || 0)
  );

  return candidates.slice(0, limit);
}

/**
 * Fetches the authenticated user's own community profile settings from `public.profiles`.
 */
export async function fetchMyCommunitySettings(userId) {
  if (!userId || !hasSupabaseConfig()) return null;
  const supabase = await getSupabaseClientAsync();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, username, bio, is_public, favorite_movie_keys, taste_vector")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Failed to load community profile settings:", error.message);
    return null;
  }
  return data
    ? {
        displayName: data.display_name || "",
        username: data.username || "",
        bio: data.bio || "",
        isPublic: Boolean(data.is_public),
        favoriteMovieKeys: Array.isArray(data.favorite_movie_keys) ? data.favorite_movie_keys : [],
        tasteVector: Array.isArray(data.taste_vector) ? data.taste_vector : null
      }
    : null;
}

/**
 * Saves opt-in community profile settings on `public.profiles`.
 * Database triggers automatically sync or hide `public_profiles` & `community_ratings`.
 */
export async function savePublicProfileSettings({
  userId,
  displayName,
  username,
  bio,
  isPublic,
  favoriteMovieKeys = [],
  tasteVector = null
}) {
  if (!userId || !hasSupabaseConfig()) {
    return { ok: false, error: "Sign in to update your public profile." };
  }

  let normalizedUsername = null;
  if (isPublic || String(username || "").trim()) {
    const check = validateUsername(username);
    if (!check.ok) {
      return { ok: false, error: check.error };
    }
    normalizedUsername = check.username;
  }

  const trimmedBio = String(bio || "").trim().slice(0, 240);
  const safeFavs = (Array.isArray(favoriteMovieKeys) ? favoriteMovieKeys : [])
    .map((k) => String(k || "").trim())
    .filter(Boolean)
    .slice(0, 4);

  const safeVector =
    isPublic && Array.isArray(tasteVector) && tasteVector.length === 64
      ? tasteVector.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0))
      : null;

  const supabase = await getSupabaseClientAsync();
  if (!supabase) return { ok: false, error: "Cloud service unavailable." };

  const payload = {
    id: userId,
    ...(displayName !== undefined ? { display_name: String(displayName || "").trim() || null } : {}),
    username: normalizedUsername,
    bio: trimmedBio || null,
    is_public: Boolean(isPublic && normalizedUsername),
    favorite_movie_keys: safeFavs,
    taste_vector: safeVector
  };

  const { data, error } = await supabase
    .from("profiles")
    .upsert(payload, { onConflict: "id" })
    .select("username, bio, is_public, favorite_movie_keys")
    .single();

  if (error) {
    if (error.code === "23505" || String(error.message || "").toLowerCase().includes("duplicate")) {
      return { ok: false, error: `The handle @${normalizedUsername} is already taken.` };
    }
    return { ok: false, error: error.message || "Could not save public profile settings." };
  }

  return {
    ok: true,
    profile: {
      username: data.username || "",
      bio: data.bio || "",
      isPublic: Boolean(data.is_public),
      favoriteMovieKeys: Array.isArray(data.favorite_movie_keys) ? data.favorite_movie_keys : []
    }
  };
}

/**
 * Fetches a public user's profile, recent community ratings/reviews, and follower counts by `@username`.
 */
export async function fetchPublicProfileByUsername(rawUsername, currentUserId = null) {
  if (!hasSupabaseConfig()) return { status: "unconfigured", profile: null, ratings: [] };
  const cleaned = String(rawUsername || "").trim().replace(/^@+/, "").toLowerCase();
  if (!USERNAME_RE.test(cleaned)) {
    return { status: "not_found", profile: null, ratings: [] };
  }

  const supabase = await getSupabaseClientAsync();
  if (!supabase) return { status: "unconfigured", profile: null, ratings: [] };

  const { data: profile, error: profileErr } = await supabase
    .from("public_profiles")
    .select("user_id, username, display_name, bio, favorite_movie_keys, taste_vector, watched_count, updated_at")
    .eq("username", cleaned)
    .maybeSingle();

  if (profileErr) {
    return { status: "error", error: profileErr.message, profile: null, ratings: [] };
  }
  if (!profile) {
    return { status: "not_found", profile: null, ratings: [] };
  }

  const [ratingsRes, followersRes, followingRes, myFollowRes] = await Promise.all([
    supabase
      .from("community_ratings")
      .select("id, user_id, username, display_name, movie_key, tmdb_id, imdb_id, title, year, poster, user_rating, user_note, contains_spoilers, craft_breakdown, watched_at, updated_at")
      .eq("user_id", profile.user_id)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("user_follows")
      .select("follower_id", { count: "exact", head: true })
      .eq("following_id", profile.user_id),
    supabase
      .from("user_follows")
      .select("following_id", { count: "exact", head: true })
      .eq("follower_id", profile.user_id),
    currentUserId && currentUserId !== profile.user_id
      ? supabase
          .from("user_follows")
          .select("follower_id")
          .eq("follower_id", currentUserId)
          .eq("following_id", profile.user_id)
          .maybeSingle()
      : Promise.resolve({ data: null })
  ]);

  return {
    status: "ok",
    profile,
    ratings: Array.isArray(ratingsRes.data) ? ratingsRes.data : [],
    followerCount: followersRes.count ?? 0,
    followingCount: followingRes.count ?? 0,
    isFollowing: Boolean(myFollowRes.data)
  };
}

/**
 * Fetches all public community ratings & reviews for a specific movie (by TMDB ID or IMDb ID).
 */
export async function fetchMovieCommunityRatings({ tmdbId, imdbID } = {}) {
  if (!hasSupabaseConfig()) return aggregateCommunityRatings([]);
  const cleanTmdb = Number(tmdbId);
  const cleanImdb = String(imdbID || "").trim();
  const hasTmdb = Number.isFinite(cleanTmdb) && cleanTmdb > 0;
  const hasImdb = /^tt\d+$/i.test(cleanImdb);
  if (!hasTmdb && !hasImdb) return aggregateCommunityRatings([]);

  const supabase = await getSupabaseClientAsync();
  if (!supabase) return aggregateCommunityRatings([]);

  let query = supabase
    .from("community_ratings")
    .select("id, user_id, username, display_name, movie_key, tmdb_id, imdb_id, user_rating, user_note, contains_spoilers, craft_breakdown, watched_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(80);

  if (hasTmdb && hasImdb) {
    query = query.or(`tmdb_id.eq.${cleanTmdb},imdb_id.eq.${cleanImdb}`);
  } else if (hasTmdb) {
    query = query.eq("tmdb_id", cleanTmdb);
  } else {
    query = query.eq("imdb_id", cleanImdb);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("Failed to load community ratings for movie:", error.message);
    return aggregateCommunityRatings([]);
  }
  return aggregateCommunityRatings(data || []);
}

/**
 * Follows or unfollows a public CinemaVault user.
 */
export async function toggleFollowUser({ followerId, followingId, currentlyFollowing }) {
  if (!followerId || !followingId || followerId === followingId || !hasSupabaseConfig()) {
    return { ok: false, error: "Sign in to follow other film lovers." };
  }
  const supabase = await getSupabaseClientAsync();
  if (!supabase) return { ok: false, error: "Cloud service unavailable." };

  if (currentlyFollowing) {
    const { error } = await supabase
      .from("user_follows")
      .delete()
      .eq("follower_id", followerId)
      .eq("following_id", followingId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, isFollowing: false };
  }

  const { error } = await supabase
    .from("user_follows")
    .insert({ follower_id: followerId, following_id: followingId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, isFollowing: true };
}
