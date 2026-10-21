/**
 * The ranked source table's rules, pinned (dynamic sources unit 8, spec
 * 6a/6b).
 *
 * The screen is a React component and cannot be loaded here, so every rule the
 * owner asked for lives in `source-table.ts` and is tested here: the default
 * sort (score, highest first, no score last), a header press sorting by a new
 * column at its natural end and the same header reversing, the counts strip's
 * filter, and the words on the five button presses.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  BUTTON_WORDS,
  buttonWord,
  DEFAULT_SORT,
  minutesBetweenReads,
  moreLinksWords,
  movesFrom,
  sortOn,
  sortSourceRowList,
  sortSuggestedSites,
  STATUS_WORDS,
  viewForFilter,
  type SortableSourceRow,
} from "./source-table.ts";

function row(over: Partial<SortableSourceRow> & { id: number }): SortableSourceRow {
  return {
    id: over.id,
    title: over.title ?? `Source ${over.id}`,
    url: over.url ?? `https://s${over.id}.example.test/`,
    status: over.status ?? "accepted",
    score: over.score ?? null,
    leads90: over.leads90 ?? 0,
    reads90: over.reads90 ?? 0,
    lastLeadAt: over.lastLeadAt ?? null,
    nextDueAt: over.nextDueAt ?? null,
    rhythm: over.rhythm ?? null,
    intervalMinutes: over.intervalMinutes ?? null,
    lastObservationAt: over.lastObservationAt ?? null,
  };
}

test("the table opens on news score, highest first, and a source with no score is last", () => {
  const rows = [
    row({ id: 1, score: null }),
    row({ id: 2, score: 0.2 }),
    row({ id: 3, score: 1.5 }),
  ];
  assert.deepEqual(
    sortSourceRowList(rows, DEFAULT_SORT).map((r) => r.id),
    [3, 2, 1],
  );
  // Reversing the score column must NOT put "not enough reads" on top: an
  // absence is not the lowest score.
  assert.deepEqual(
    sortSourceRowList(rows, { key: "score", direction: "asc" }).map((r) => r.id),
    [2, 3, 1],
  );
});

test("clicking a new column sorts by it at its useful end; clicking it again reverses", () => {
  assert.deepEqual(sortOn("score", DEFAULT_SORT), { key: "score", direction: "asc" });
  assert.deepEqual(sortOn("reads", DEFAULT_SORT), { key: "reads", direction: "desc" });
  assert.deepEqual(sortOn("source", DEFAULT_SORT), { key: "source", direction: "asc" });
  assert.deepEqual(sortOn("lastLead", DEFAULT_SORT), { key: "lastLead", direction: "asc" });
  const reversed = sortOn("source", { key: "source", direction: "asc" });
  assert.deepEqual(reversed, { key: "source", direction: "desc" });
});

test("the sort reads the column it names", () => {
  const rows = [
    row({ id: 1, title: "zeta", reads90: 40, leads90: 2, lastLeadAt: "2026-09-01T00:00:00.000Z" }),
    row({ id: 2, title: "alpha", reads90: 10, leads90: 9, lastLeadAt: null }),
    row({ id: 3, title: "mike", reads90: 25, leads90: 5, lastLeadAt: "2026-10-01T00:00:00.000Z" }),
  ];
  assert.deepEqual(
    sortSourceRowList(rows, { key: "source", direction: "asc" }).map((r) => r.id),
    [2, 3, 1],
  );
  assert.deepEqual(
    sortSourceRowList(rows, { key: "reads", direction: "desc" }).map((r) => r.id),
    [1, 3, 2],
  );
  assert.deepEqual(
    sortSourceRowList(rows, { key: "leads", direction: "desc" }).map((r) => r.id),
    [2, 3, 1],
  );
  // A source with no last lead sorts last, the same rule as "no score yet".
  assert.deepEqual(
    sortSourceRowList(rows, { key: "lastLead", direction: "desc" }).map((r) => r.id),
    [3, 1, 2],
  );
});

test("the counts strip narrows the table to one status, and null shows every row", () => {
  const rows = [
    row({ id: 1, status: "accepted", score: 0.4 }),
    row({ id: 2, status: "trial", score: 0.9 }),
    row({ id: 3, status: "trial", score: 0.1 }),
    row({ id: 4, status: "dormant", score: 0.6 }),
  ];
  // Spec 6b: the trial filter is sorted by score, so the editor's first row is
  // the trial source most likely to be worth keeping.
  assert.deepEqual(
    sortSourceRowList(rows, DEFAULT_SORT, "trial").map((r) => r.id),
    [2, 3],
  );
  assert.deepEqual(
    sortSourceRowList(rows, DEFAULT_SORT, "accepted").map((r) => r.id),
    [1],
  );
  assert.equal(sortSourceRowList(rows, DEFAULT_SORT, null).length, 4);
});

test("every press on a source has its own words, and every one is reversible", () => {
  // Spec 6a's five presses, in the owner's words.
  assert.equal(buttonWord("trial", "accepted"), "Accept now");
  assert.equal(buttonWord("trial", "dormant"), "Drop now");
  assert.equal(buttonWord("dormant", "trial"), "Re-try");
  assert.equal(buttonWord("accepted", "trial"), "Put on trial");
  assert.equal(buttonWord("accepted", "dormant"), "Make it dormant");
  // Nothing is a one-way door: each status offers the other two.
  for (const from of ["accepted", "trial", "dormant"]) {
    assert.equal(movesFrom(from).length, 2);
    for (const to of movesFrom(from)) {
      assert.ok(BUTTON_WORDS[from]![to].length > 0);
    }
  }
  // The chip words the Sources screen reads.
  assert.equal(STATUS_WORDS.trial, "On trial");
  assert.equal(STATUS_WORDS.dormant, "Dormant (checked once a month)");
  assert.equal(STATUS_WORDS.rejected, "Rejected");
  assert.equal(STATUS_WORDS.proposed, "Suggested");
});

test("suggested sites are one row per website, biggest count first (5f)", () => {
  const sites = [
    { site: "three.example.test", count: 1 },
    { site: "two.example.test", count: 4 },
    { site: "one.example.test", count: 4 },
    { site: "aaa.example.test", count: 4 },
  ];
  assert.deepEqual(
    sortSuggestedSites(sites).map((s) => [s.site, s.count]),
    [
      ["aaa.example.test", 4],
      ["one.example.test", 4],
      ["two.example.test", 4],
      ["three.example.test", 1],
    ],
  );
  // The input is left alone: the panel sorts a copy of the query result.
  assert.equal(sites[0]!.site, "three.example.test");
});

test("the suggested count is a press that shows the by-website list, and Show all clears it", () => {
  assert.equal(viewForFilter("suggested"), "suggested-sites");
  assert.equal(viewForFilter("trial"), "table");
  assert.equal(viewForFilter("accepted"), "table");
  assert.equal(viewForFilter("dormant"), "table");
  assert.equal(viewForFilter(null), "table");
});

test("a source says how many other links on its site are waiting, and says nothing at zero", () => {
  assert.equal(moreLinksWords(0), null);
  assert.equal(moreLinksWords(1), "1 more link on this site");
  assert.equal(moreLinksWords(12), "12 more links on this site");
});

test("older-shaped data without a suggested-site list or a link count draws nothing instead of crashing", () => {
  assert.equal(moreLinksWords(undefined), null);
  assert.deepEqual(sortSuggestedSites([]), []);
});

test("how often reads the detected rhythm before the interval", () => {
  assert.equal(minutesBetweenReads({ rhythm: "weekly:thu", intervalMinutes: 1440 }), 7 * 24 * 60);
  assert.equal(minutesBetweenReads({ rhythm: "monthly:2", intervalMinutes: 1440 }), 30 * 24 * 60);
  assert.equal(minutesBetweenReads({ rhythm: null, intervalMinutes: 720 }), 720);
  assert.equal(minutesBetweenReads({ rhythm: null, intervalMinutes: null }), 24 * 60);
});
