/**
 * The Sources rule, pinned (Unit CZ-long-lists).
 *
 * WHAT THESE TESTS ARE FOR. Before this unit the Sources screen narrowed its
 * list in the component: every source arrived, and the tab and the search box
 * were applied in the browser. The window moved the cut to the server, so this
 * rule now decides which 25 rows an editor's page holds and what the four pills
 * read -- and a rule that decides what an editor sees has to be pinned
 * somewhere a PGlite instance is not needed. This file is that pin.
 *
 * The counts are half the rule, and the half most easily got wrong: they are
 * taken over EVERY source, not over the page, and "On watch" is two statuses
 * while "Files up to" is one of them.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanSourceWindow,
  KEEPS_FAILING_AFTER,
  keepsFailing,
  onWatch,
  selectSourceRows,
  sourceCounts,
  sourceMatchesSearch,
  sourceTabRows,
  SOURCE_TABS,
  type SourceRowLike,
} from "./source-rows.ts";

/** A source with only the columns the rule reads set to something; the rest are
 *  the empty values the database would hand back. */
function source(over: Partial<SourceRowLike> & { id: number }): SourceRowLike {
  return {
    title: `Source ${over.id}`,
    url: `https://example.test/${over.id}`,
    kind: "news",
    tier: "B",
    status: "accepted",
    last_error: null,
    ...over,
  };
}

test("a request that says nothing opens the watch list at the top", () => {
  const w = cleanSourceWindow(undefined);
  assert.equal(w.filter, "accepted");
  assert.equal(w.offset, 0);
  assert.equal(w.search, "");
});

test("an unknown tab falls back to the watch list rather than filtering to nothing", () => {
  assert.equal(cleanSourceWindow({ filter: "archived" }).filter, "accepted");
  assert.equal(cleanSourceWindow({ filter: 7 }).filter, "accepted");
});

test("the tabs are the four the drawing draws, in its order", () => {
  assert.deepEqual([...SOURCE_TABS], ["accepted", "proposed", "rejected", "unchecked"]);
});

test("a paused source is still on watch -- it is the same row, held", () => {
  assert.equal(onWatch({ status: "accepted" }), true);
  assert.equal(onWatch({ status: "paused" }), true);
  assert.equal(onWatch({ status: "proposed" }), false);
  assert.equal(onWatch({ status: "rejected" }), false);
});

test("the search box reads the title, the address, the kind and the tier", () => {
  const s = source({ id: 1, title: "City Hall", url: "https://city.example.test/agendas", kind: "record", tier: "A" });
  assert.equal(sourceMatchesSearch(s, ""), true);
  assert.equal(sourceMatchesSearch(s, "city hall"), true);
  assert.equal(sourceMatchesSearch(s, "agendas"), true);
  assert.equal(sourceMatchesSearch(s, "record"), true);
  assert.equal(sourceMatchesSearch(s, "a"), true);
  assert.equal(sourceMatchesSearch(s, "school board"), false);
});

test("the search is folded and trimmed, so capitals and stray spaces do not miss", () => {
  const rows = [source({ id: 1, title: "City Hall" })];
  assert.deepEqual(
    selectSourceRows(rows, { filter: "accepted", search: "  CITY  " }).map((s) => s.id),
    [1],
  );
});

test("the watch list holds accepted and paused, and nothing else", () => {
  const rows = [
    source({ id: 1, status: "accepted" }),
    source({ id: 2, status: "paused" }),
    source({ id: 3, status: "proposed" }),
    source({ id: 4, status: "rejected" }),
  ];
  assert.deepEqual(
    sourceTabRows(rows, "accepted").map((s) => s.id),
    [1, 2],
  );
});

test("Could not check is the watch list narrowed to the rows the pass failed to read", () => {
  const rows = [
    source({ id: 1, status: "accepted", last_error: "timed out" }),
    source({ id: 2, status: "paused", last_error: "404" }),
    source({ id: 3, status: "accepted" }),
    source({ id: 4, status: "proposed", last_error: "timed out" }),
    source({ id: 5, status: "rejected", last_error: "404" }),
  ];
  assert.deepEqual(
    sourceTabRows(rows, "unchecked").map((s) => s.id),
    [1, 2],
  );
});

test("the tab is applied before the search, so a rejected row stays out however well it matches", () => {
  const rows = [
    source({ id: 1, status: "accepted", title: "City Hall" }),
    source({ id: 2, status: "rejected", title: "City Hall" }),
  ];
  assert.deepEqual(
    selectSourceRows(rows, { filter: "accepted", search: "city hall" }).map((s) => s.id),
    [1],
  );
});

test("the tab and the search both narrow, and a source has to pass both", () => {
  const rows = [
    source({ id: 1, status: "proposed", title: "City Hall" }),
    source({ id: 2, status: "proposed", title: "School board" }),
    source({ id: 3, status: "accepted", title: "City Hall" }),
  ];
  assert.deepEqual(
    selectSourceRows(rows, { filter: "proposed", search: "city hall" }).map((s) => s.id),
    [1],
  );
});

test("the rows keep the server's order rather than being re-sorted here", () => {
  const rows = [source({ id: 9 }), source({ id: 3 }), source({ id: 5 })];
  assert.deepEqual(
    selectSourceRows(rows, { filter: "accepted", search: "" }).map((s) => s.id),
    [9, 3, 5],
  );
});

test("the pills count the whole list, not the page, and On watch is two statuses", () => {
  const rows = [
    source({ id: 1, status: "accepted" }),
    source({ id: 2, status: "accepted", last_error: "timed out" }),
    source({ id: 3, status: "paused" }),
    source({ id: 4, status: "proposed" }),
    source({ id: 5, status: "proposed" }),
    source({ id: 6, status: "rejected" }),
  ];
  assert.deepEqual(sourceCounts(rows), {
    // 1, 2 and 3: a paused source is on watch with the accepted ones.
    accepted: 3,
    proposed: 2,
    rejected: 1,
    // 2: a paused source can be unreadable too.
    unchecked: 1,
    // 1 and 2: "Files up to" is what the scanner may actually read, so the
    // paused row is deliberately not in it.
    watching: 2,
  });
});

test("a status the desk does not use is on no list and in no count", () => {
  const rows = [source({ id: 1, status: "accepted" }), source({ id: 2, status: "archived" })];
  assert.deepEqual(
    sourceTabRows(rows, "accepted").map((s) => s.id),
    [1],
  );
  assert.deepEqual(sourceCounts(rows), {
    accepted: 1,
    proposed: 0,
    rejected: 0,
    unchecked: 0,
    watching: 1,
  });
});

test("an empty list counts zero everywhere rather than throwing", () => {
  assert.deepEqual(sourceCounts([]), {
    accepted: 0,
    proposed: 0,
    rejected: 0,
    unchecked: 0,
    watching: 0,
  });
});

test("the counts and the tabs cannot disagree: each tab's length is its own count", () => {
  const rows = [
    source({ id: 1, status: "accepted" }),
    source({ id: 2, status: "accepted", last_error: "timed out" }),
    source({ id: 3, status: "paused", last_error: "404" }),
    source({ id: 4, status: "proposed" }),
    source({ id: 5, status: "rejected" }),
    source({ id: 6, status: "accepted" }),
  ];
  const counts = sourceCounts(rows);
  for (const filter of SOURCE_TABS) {
    const shown = sourceTabRows(rows, filter);
    assert.equal(shown.length, counts[filter], `tab ${filter}`);
  }
});

/*
  ── SH0-1 / SH0-2: "KEEPS FAILING" ───────────────────────────────────────────

  The predicate behind the flag, and the threshold it turns on. The count is
  written by the scan (SH0-1, pinned in `source-failure-streak.postgres.test.ts`)
  and read here; the two halves have to agree on what "three in a row" means or
  the row says a number the database does not hold.
*/

test("two failures in a row is a bad afternoon, not a pattern", () => {
  assert.equal(keepsFailing(source({ id: 1, consecutive_failures: 2, last_error: "404" })), false);
});

test("the flag turns on at the threshold and stays on above it", () => {
  assert.equal(keepsFailing(source({ id: 2, consecutive_failures: 3, last_error: "404" })), true);
  assert.equal(keepsFailing(source({ id: 3, consecutive_failures: 4, last_error: "404" })), true);
});

test("a source with no recorded streak is never flagged", () => {
  /* The migration backfills nothing: a row that predates 0115, or a row read by
     a select that did not ask for the column, has no history and must not be
     given one. */
  assert.equal(keepsFailing(source({ id: 4 })), false);
  assert.equal(keepsFailing(source({ id: 5, consecutive_failures: null })), false);
  assert.equal(keepsFailing(source({ id: 6, consecutive_failures: 0 })), false);
});

test("a paused source is never flagged, however long its streak", () => {
  /* The word would be false: pause means the desk has stopped trying. */
  assert.equal(
    keepsFailing(source({ id: 7, status: "paused", consecutive_failures: 9, last_error: "404" })),
    false,
  );
  assert.equal(
    keepsFailing(source({ id: 8, status: "proposed", consecutive_failures: 9 })),
    false,
  );
  assert.equal(
    keepsFailing(source({ id: 9, status: "rejected", consecutive_failures: 9 })),
    false,
  );
});

test("the threshold is three consecutive failed attempts", () => {
  assert.equal(KEEPS_FAILING_AFTER, 3);
});

test("the flag needs no error text of its own: the count is the whole test", () => {
  /* `last_error` is cleared by the next success, and the count is cleared with
     it, so the two move together -- but a row whose count reached the threshold
     is flagged on that alone. */
  assert.equal(keepsFailing(source({ id: 10, consecutive_failures: 3, last_error: null })), true);
});
