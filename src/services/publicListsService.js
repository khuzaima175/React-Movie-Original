import { getSupabaseClientAsync, hasSupabaseConfig } from "./supabaseClient.js";

async function resolveSupabase(options = {}) {
  if ("supabaseClient" in options) return options.supabaseClient;
  if (!hasSupabaseConfig()) return null;
  return getSupabaseClientAsync();
}

/**
 * Loads a public curated list by its shareable slug along with curator handle and viewer bookmark status.
 */
export async function fetchPublicListBySlug(slug, viewerUserId = null, options = {}) {
  const cleanSlug = String(slug || "").trim().toLowerCase();
  if (!cleanSlug) return { status: "not_found", list: null, curator: null, isBookmarked: false };

  const supabase = await resolveSupabase(options);
  if (!supabase) return { status: "unconfigured", list: null, curator: null, isBookmarked: false };

  const { data: listRow, error } = await supabase
    .from("user_lists")
    .select("id, user_id, name, description, items, source_checklist_id, slug, bookmark_count, updated_at")
    .eq("slug", cleanSlug)
    .eq("is_public", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    return { status: "error", error: error.message, list: null, curator: null, isBookmarked: false };
  }
  if (!listRow) {
    return { status: "not_found", list: null, curator: null, isBookmarked: false };
  }

  const [curatorRes, bookmarkRes] = await Promise.all([
    supabase
      .from("public_profiles")
      .select("user_id, username, display_name")
      .eq("user_id", listRow.user_id)
      .maybeSingle(),
    viewerUserId
      ? supabase
          .from("user_list_bookmarks")
          .select("list_id")
          .eq("user_id", viewerUserId)
          .eq("list_id", listRow.id)
          .maybeSingle()
      : Promise.resolve({ data: null })
  ]);

  return {
    status: "ok",
    list: {
      ...listRow,
      items: Array.isArray(listRow.items) ? listRow.items : []
    },
    curator: curatorRes?.data || null,
    isBookmarked: Boolean(bookmarkRes?.data)
  };
}

/**
 * Fetches all public curated lists belonging to a public `@username` profile.
 */
export async function fetchPublicListsByUsername(username, options = {}) {
  const clean = String(username || "").trim().replace(/^@+/, "").toLowerCase();
  if (!clean) return [];

  const supabase = await resolveSupabase(options);
  if (!supabase) return [];

  const { data: profile } = await supabase
    .from("public_profiles")
    .select("user_id")
    .eq("username", clean)
    .maybeSingle();

  if (!profile?.user_id) return [];

  const { data: rows, error } = await supabase
    .from("user_lists")
    .select("id, name, description, slug, items, bookmark_count, updated_at")
    .eq("user_id", profile.user_id)
    .eq("is_public", true)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(24);

  if (error || !Array.isArray(rows)) return [];
  return rows.map((r) => ({ ...r, items: Array.isArray(r.items) ? r.items : [] }));
}

/**
 * Bookmarks or unbookmarks a public curated list for the authenticated user.
 */
export async function toggleBookmarkPublicList(
  { userId, listId, currentlyBookmarked = false } = {},
  options = {}
) {
  if (!userId || !listId) {
    return { ok: false, error: "Sign in to bookmark curated lists." };
  }

  const supabase = await resolveSupabase(options);
  if (!supabase) return { ok: false, error: "Cloud service unavailable." };

  if (currentlyBookmarked) {
    const { error } = await supabase
      .from("user_list_bookmarks")
      .delete()
      .eq("user_id", userId)
      .eq("list_id", listId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, isBookmarked: false };
  }

  const { error } = await supabase
    .from("user_list_bookmarks")
    .insert({ user_id: userId, list_id: listId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, isBookmarked: true };
}

/**
 * Fetches public curated lists directory ordered by popularity (`popular`) or recency (`recent`).
 */
export async function fetchPublicListsDirectory(
  { query = "", sort = "popular", limit = 24 } = {},
  options = {}
) {
  const supabase = await resolveSupabase(options);
  if (!supabase) return { status: "unconfigured", lists: [] };

  const safeQ = String(query || "").trim().replace(/[%_]/g, " ").slice(0, 60);
  let req = supabase
    .from("user_lists")
    .select("id, user_id, name, description, slug, items, bookmark_count, updated_at")
    .eq("is_public", true)
    .is("deleted_at", null);

  if (safeQ) {
    req = req.ilike("name", `%${safeQ}%`);
  }

  if (sort === "recent") {
    req = req.order("updated_at", { ascending: false });
  } else {
    req = req.order("bookmark_count", { ascending: false }).order("updated_at", { ascending: false });
  }

  const { data: rows, error } = await req.limit(Math.max(1, Math.min(60, Number(limit) || 24)));
  if (error) {
    return { status: "error", error: error.message, lists: [] };
  }

  const listRows = Array.isArray(rows) ? rows : [];
  const userIds = [...new Set(listRows.map((r) => r.user_id).filter(Boolean))];
  const curatorMap = new Map();

  if (userIds.length > 0) {
    const { data: curators } = await supabase
      .from("public_profiles")
      .select("user_id, username, display_name")
      .in("user_id", userIds);
    for (const c of curators || []) {
      curatorMap.set(c.user_id, c);
    }
  }

  return {
    status: "ok",
    lists: listRows.map((row) => {
      const curator = curatorMap.get(row.user_id);
      return {
        ...row,
        items: Array.isArray(row.items) ? row.items : [],
        curatorUsername: curator?.username || null,
        curatorDisplayName: curator?.display_name || null
      };
    })
  };
}
