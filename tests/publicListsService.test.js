import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchPublicListBySlug,
  fetchPublicListsByUsername,
  toggleBookmarkPublicList
} from "../src/services/publicListsService.js";

test("fetchPublicListBySlug returns not_found when missing or unconfigured gracefully", async () => {
  const unconf = await fetchPublicListBySlug("rainy-tuesday-abc123", null, { supabaseClient: null });
  assert.equal(unconf.status, "unconfigured");

  const fakeMissing = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    is() {
                      return {
                        maybeSingle: async () => ({ data: null, error: null })
                      };
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  };
  const missing = await fetchPublicListBySlug("rainy-tuesday-abc123", null, { supabaseClient: fakeMissing });
  assert.equal(missing.status, "not_found");
});

test("fetchPublicListBySlug loads public list, curator handle, and viewer bookmark status", async () => {
  const listRow = {
    id: "list_1",
    user_id: "u1",
    name: "Neon Paranoia",
    description: "Late night spirals",
    slug: "neon-paranoia-a1b2c3",
    items: [{ tmdbId: 807, title: "Se7en", year: "1995" }],
    bookmark_count: 4
  };
  const profileRow = { user_id: "u1", username: "noirfan", display_name: "Noir Fan" };

  const fakeSupabase = {
    from(table) {
      if (table === "user_lists") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      is() {
                        return { maybeSingle: async () => ({ data: listRow, error: null }) };
                      }
                    };
                  }
                };
              }
            };
          }
        };
      }
      if (table === "public_profiles") {
        return {
          select() {
            return {
              eq() {
                return { maybeSingle: async () => ({ data: profileRow, error: null }) };
              }
            };
          }
        };
      }
      if (table === "user_list_bookmarks") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return { maybeSingle: async () => ({ data: { list_id: "list_1" }, error: null }) };
                  }
                };
              }
            };
          }
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }
  };

  const res = await fetchPublicListBySlug("neon-paranoia-a1b2c3", "u2", { supabaseClient: fakeSupabase });
  assert.equal(res.status, "ok");
  assert.equal(res.list.name, "Neon Paranoia");
  assert.equal(res.curator.username, "noirfan");
  assert.equal(res.isBookmarked, true);
});

test("toggleBookmarkPublicList inserts and deletes cleanly", async () => {
  const ops = [];
  const fakeSupabase = {
    from(table) {
      return {
        insert: async (row) => {
          ops.push({ op: "insert", table, row });
          return { error: null };
        },
        delete() {
          return {
            eq() {
              return {
                eq: async () => {
                  ops.push({ op: "delete", table });
                  return { error: null };
                }
              };
            }
          };
        }
      };
    }
  };

  const added = await toggleBookmarkPublicList(
    { userId: "u2", listId: "list_1", currentlyBookmarked: false },
    { supabaseClient: fakeSupabase }
  );
  assert.equal(added.ok, true);
  assert.equal(added.isBookmarked, true);

  const removed = await toggleBookmarkPublicList(
    { userId: "u2", listId: "list_1", currentlyBookmarked: true },
    { supabaseClient: fakeSupabase }
  );
  assert.equal(removed.ok, true);
  assert.equal(removed.isBookmarked, false);
  assert.deepEqual(ops.map((o) => o.op), ["insert", "delete"]);
});

test("fetchPublicListsByUsername returns empty array gracefully when unconfigured", async () => {
  const rows = await fetchPublicListsByUsername("noirfan", { supabaseClient: null });
  assert.deepEqual(rows, []);
});
