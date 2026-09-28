import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanListWindow,
  PAGE_SIZE,
  showingLine,
  takeWindow,
  WINDOW_MAX,
} from "./list-window.ts";

const FILTERS = ["all", "open", "held"] as const;

test("a request that says nothing gets the first page of the default filter", () => {
  const w = cleanListWindow(undefined, FILTERS, "all");
  assert.deepEqual(w, { limit: PAGE_SIZE, offset: 0, search: "", filter: "all" });
});

test("limit and offset are whole numbers, so a fractional request cannot slice mid-row", () => {
  const w = cleanListWindow({ limit: 25.9, offset: 3.7 }, FILTERS, "all");
  assert.equal(w.limit, 25);
  assert.equal(w.offset, 3);
});

test("a request for the whole list is clamped, not honoured", () => {
  const w = cleanListWindow({ limit: 999999, offset: 0 }, FILTERS, "all");
  assert.equal(w.limit, WINDOW_MAX);
});

test("a nonsense limit falls back to one page rather than to nothing or to everything", () => {
  for (const limit of [0, -5, Number.NaN, "twenty-five", null, {}]) {
    const w = cleanListWindow({ limit, offset: 0 }, FILTERS, "all");
    assert.equal(w.limit, PAGE_SIZE, `limit ${String(limit)}`);
  }
});

test("a negative offset is pulled back to the top of the list", () => {
  assert.equal(cleanListWindow({ offset: -100 }, FILTERS, "all").offset, 0);
});

test("an unknown filter falls back, so a URL cannot open a list this screen does not have", () => {
  assert.equal(cleanListWindow({ filter: "secret" }, FILTERS, "all").filter, "all");
  assert.equal(cleanListWindow({ filter: "held" }, FILTERS, "all").filter, "held");
});

test("search is trimmed and cut to a search box's length", () => {
  assert.equal(cleanListWindow({ search: "  council  " }, FILTERS, "all").search, "council");
  assert.equal(cleanListWindow({ search: "x".repeat(500) }, FILTERS, "all").search.length, 200);
  assert.equal(cleanListWindow({ search: 42 }, FILTERS, "all").search, "");
});

test("the window is cut off the filtered list, and total counts all of it", () => {
  const rows = Array.from({ length: 60 }, (_, i) => i);
  const first = takeWindow(rows, 0, PAGE_SIZE);
  assert.equal(first.rows.length, 25);
  assert.equal(first.rows[0], 0);
  assert.equal(first.total, 60);
  const second = takeWindow(rows, 25, PAGE_SIZE);
  assert.equal(second.rows[0], 25);
  assert.equal(second.rows.length, 25);
  const third = takeWindow(rows, 50, PAGE_SIZE);
  assert.equal(third.rows.length, 10);
  assert.equal(third.total, 60);
});

test("the footer counts what was drawn, not what was asked for", () => {
  assert.equal(showingLine(25, 1588, "suggested sources"), "Showing 25 of 1,588 suggested sources");
  // The last page is short: "Showing 60 of 38" would be a lie.
  assert.equal(showingLine(60, 38, "leads"), "Showing 38 of 38 leads");
});

test("an empty list says nothing rather than 'Showing 0 of 0'", () => {
  assert.equal(showingLine(0, 0, "leads"), "");
});
