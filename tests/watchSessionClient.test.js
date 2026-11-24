import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRoomCode,
  createWatchSession,
  fetchWatchSession,
  joinWatchSession,
  submitWatchVote
} from "../src/services/watchSessionClient.js";

test("normalizeRoomCode uppercases and validates 8-char alphanumeric codes", () => {
  assert.equal(normalizeRoomCode(" ab12cd34 "), "AB12CD34");
  assert.equal(normalizeRoomCode("invalid!"), null);
  assert.equal(normalizeRoomCode("SHORT"), null);
});

test("fetchWatchSession handles expired rooms and unknown rooms cleanly", async () => {
  const expiredRow = {
    room_code: "ABCD1234",
    expires_at: "2020-01-01T00:00:00.000Z"
  };

  const fakeSupabaseExpired = {
    rpc: async () => ({ data: expiredRow, error: null })
  };
  const expiredRes = await fetchWatchSession("abcd1234", {
    supabaseClient: fakeSupabaseExpired,
    now: Date.parse("2026-11-24T00:00:00.000Z")
  });
  assert.equal(expiredRes.status, "expired");

  const fakeSupabaseMissing = {
    rpc: async () => ({ data: null, error: null })
  };
  const missingRes = await fetchWatchSession("ZZZZ9999", { supabaseClient: fakeSupabaseMissing });
  assert.equal(missingRes.status, "not_found");
});

test("createWatchSession, joinWatchSession, and submitWatchVote round-trip via Supabase RPCs", async () => {
  const calls = [];
  const sessionRow = {
    room_code: "MOVIE888",
    host_name: "Alex",
    guest_name: "Sam",
    deck_items: [{ tmdbId: 27205, title: "Inception" }],
    host_votes: { 27205: "yes" },
    guest_votes: {},
    expires_at: "2026-11-26T00:00:00.000Z"
  };
  const fakeSupabase = {
    rpc: async (fn, params) => {
      calls.push({ fn, params });
      if (fn === "create_watch_session") return { data: sessionRow, error: null };
      if (fn === "join_watch_session") return { data: sessionRow, error: null };
      if (fn === "submit_watch_session_vote") {
        return {
          data: { ...sessionRow, guest_votes: { 27205: "yes" } },
          error: null
        };
      }
      return { data: null, error: null };
    }
  };

  const created = await createWatchSession(
    { hostName: "Alex", roomCode: "MOVIE888", deckItems: sessionRow.deck_items },
    { supabaseClient: fakeSupabase }
  );
  assert.equal(created.ok, true);
  assert.equal(created.session.room_code, "MOVIE888");

  const joined = await joinWatchSession(
    { roomCode: "movie888", guestName: "Sam", guestVector: new Array(64).fill(0) },
    { supabaseClient: fakeSupabase }
  );
  assert.equal(joined.ok, true);

  const voted = await submitWatchVote(
    { roomCode: "MOVIE888", role: "guest", tmdbId: 27205, vote: "yes" },
    { supabaseClient: fakeSupabase }
  );
  assert.equal(voted.ok, true);
  assert.equal(voted.session.guest_votes[27205], "yes");
  assert.deepEqual(
    calls.map((c) => c.fn),
    ["create_watch_session", "join_watch_session", "submit_watch_session_vote"]
  );
});

test("gracefully degrades when Supabase is unconfigured", async () => {
  const res = await fetchWatchSession("ABCD1234", { supabaseClient: null });
  assert.equal(res.status, "unconfigured");
});
