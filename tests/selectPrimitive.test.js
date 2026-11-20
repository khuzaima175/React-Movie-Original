import test from "node:test";
import assert from "node:assert/strict";
import { getNextSelectIndex } from "../src/services/selectHelpers.js";

const SAMPLE_OPTIONS = [
  { value: "popular", label: "Most Popular" },
  { value: "rated", label: "Highest Rated" },
  { value: "newest", label: "Newest Releases" },
  { value: "revenue", label: "Highest Box Office" },
];

test("getNextSelectIndex handles ArrowDown and ArrowUp with wraparound", () => {
  assert.equal(getNextSelectIndex(SAMPLE_OPTIONS, 0, "ArrowDown"), 1);
  assert.equal(getNextSelectIndex(SAMPLE_OPTIONS, 3, "ArrowDown"), 0);
  assert.equal(getNextSelectIndex(SAMPLE_OPTIONS, 2, "ArrowUp"), 1);
  assert.equal(getNextSelectIndex(SAMPLE_OPTIONS, 0, "ArrowUp"), 3);
});

test("getNextSelectIndex handles Home and End keys", () => {
  assert.equal(getNextSelectIndex(SAMPLE_OPTIONS, 2, "Home"), 0);
  assert.equal(getNextSelectIndex(SAMPLE_OPTIONS, 1, "End"), 3);
});

test("getNextSelectIndex skips disabled options in both directions and on Home/End", () => {
  const optionsWithDisabled = [
    { value: "a", label: "A", disabled: true },
    { value: "b", label: "B" },
    { value: "c", label: "C", disabled: true },
    { value: "d", label: "D" },
    { value: "e", label: "E", disabled: true },
  ];

  assert.equal(getNextSelectIndex(optionsWithDisabled, 1, "ArrowDown"), 3);
  assert.equal(getNextSelectIndex(optionsWithDisabled, 3, "ArrowDown"), 1);
  assert.equal(getNextSelectIndex(optionsWithDisabled, 3, "ArrowUp"), 1);
  assert.equal(getNextSelectIndex(optionsWithDisabled, 1, "ArrowUp"), 3);
  assert.equal(getNextSelectIndex(optionsWithDisabled, 3, "Home"), 1);
  assert.equal(getNextSelectIndex(optionsWithDisabled, 1, "End"), 3);
});

test("getNextSelectIndex handles negative/out-of-range starting index and empty or all-disabled arrays", () => {
  assert.equal(getNextSelectIndex(SAMPLE_OPTIONS, -1, "ArrowDown"), 0);
  assert.equal(getNextSelectIndex(SAMPLE_OPTIONS, -1, "ArrowUp"), 3);
  assert.equal(getNextSelectIndex([], 0, "ArrowDown"), -1);
  assert.equal(getNextSelectIndex(null, 0, "Home"), -1);
  assert.equal(
    getNextSelectIndex([{ value: "a", label: "A", disabled: true }], 0, "ArrowDown"),
    -1
  );
  assert.equal(getNextSelectIndex(SAMPLE_OPTIONS, 1, "Tab"), 1);
});
