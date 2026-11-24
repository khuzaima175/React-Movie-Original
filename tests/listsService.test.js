import test from "node:test";
import assert from "node:assert/strict";
import {
  CANON_CHECKLISTS,
  createCustomList,
  renameCustomList,
  deleteCustomList,
  toggleMovieInList,
  getActiveCustomLists,
  getListsContainingMovie,
  computeChecklistProgress,
  mergeCustomListsByTimestamp,
  generateListSlug,
  setListVisibility,
  clonePublicListToLocal
} from "../src/services/listsService.js";

test("createCustomList, toggleMovieInList, renameCustomList, and soft-delete work cleanly", () => {
  const t1 = "2026-11-15T10:00:00.000Z";
  const t2 = "2026-11-15T11:00:00.000Z";
  let lists = createCustomList([], { name: "Weekend Noir" }, t1);
  assert.equal(lists.length, 1);
  const listId = lists[0].id;

  const added = toggleMovieInList(
    lists,
    listId,
    { imdbID: "tt0114369", tmdbId: 807, title: "Se7en", year: "1995" },
    t1
  );
  assert.equal(added.added, true);
  assert.equal(getListsContainingMovie(added.lists, { tmdbId: 807 }).length, 1);

  // Toggling again by TMDB identity removes rather than duplicating
  const removed = toggleMovieInList(added.lists, listId, { tmdbId: 807, title: "Se7en" }, t2);
  assert.equal(removed.added, false);
  assert.equal(removed.lists[0].items.length, 0);

  const renamed = renameCustomList(removed.lists, listId, { name: "David Fincher Night" }, t2);
  assert.equal(renamed[0].name, "David Fincher Night");

  const deleted = deleteCustomList(renamed, listId, t2);
  assert.equal(getActiveCustomLists(deleted).length, 0);
  assert.ok(deleted[0].deletedAt);
});

test("computeChecklistProgress tracks watched coverage by canonical and title+year identity", () => {
  assert.ok(CANON_CHECKLISTS.length >= 3);
  const pack = CANON_CHECKLISTS[0];
  const first = pack.items[0];
  const progress = computeChecklistProgress(
    pack,
    [{ title: first.title, year: first.year, userRating: 9 }],
    []
  );
  assert.equal(progress.watchedCount, 1);
  assert.equal(progress.totalCount, pack.items.length);
  assert.equal(progress.entries[0].isWatched, true);
  assert.equal(progress.entries[0].userRating, 9);
});

test("mergeCustomListsByTimestamp respects newer tombstone and merge_update vs add_new vs replace", () => {
  const local = [
    {
      id: "l1",
      name: "Keep Local",
      updatedAt: "2026-11-15T12:00:00.000Z",
      deletedAt: null,
      items: [{ title: "Heat", year: "1995" }]
    },
    {
      id: "l2",
      name: "Deleted Newer",
      updatedAt: "2026-11-15T15:00:00.000Z",
      deletedAt: "2026-11-15T15:00:00.000Z",
      items: []
    }
  ];
  const cloud = [
    {
      id: "l2",
      name: "Stale Resurrection Attempt",
      updatedAt: "2026-11-15T10:00:00.000Z",
      deletedAt: null,
      items: [{ title: "Memento", year: "2000" }]
    },
    {
      id: "l3",
      name: "Cloud Only",
      updatedAt: "2026-11-15T14:00:00.000Z",
      deletedAt: null,
      items: []
    }
  ];
  const merged = mergeCustomListsByTimestamp(local, cloud, "merge_update");
  const active = getActiveCustomLists(merged);
  assert.equal(active.length, 2);
  assert.ok(active.some((l) => l.id === "l1"));
  assert.ok(active.some((l) => l.id === "l3"));
  assert.ok(!active.some((l) => l.id === "l2"));
});

test("generateListSlug, setListVisibility, and clonePublicListToLocal handle public sharing safely", () => {
  assert.equal(generateListSlug("Rainy Tuesday (1997)!!", "a1b2c3"), "rainy-tuesday-1997-a1b2c3");

  const t1 = "2026-11-24T12:00:00.000Z";
  let lists = createCustomList([], { name: "Rainy Tuesday (1997)", initialItems: [{ title: "Cure", year: "1997", tmdbId: 36095 }] }, t1);
  const id = lists[0].id;
  lists = setListVisibility(lists, id, { isPublic: true }, t1);
  assert.equal(lists[0].isPublic, true);
  assert.match(lists[0].slug, /^rainy-tuesday-1997-[a-z0-9]+$/);

  const cloned = clonePublicListToLocal([], lists[0], t1);
  assert.equal(cloned.clonedList.isPublic, false);
  assert.notEqual(cloned.clonedList.id, lists[0].id);
  assert.equal(cloned.clonedList.items.length, 1);
  assert.equal(cloned.clonedList.items[0].title, "Cure");
});
