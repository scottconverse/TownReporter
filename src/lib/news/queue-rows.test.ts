/**
 * The Queue's rule, pinned (Unit CZ-long-lists).
 *
 * WHAT THESE TESTS ARE FOR. Before this unit the Queue narrowed its list in the
 * component: every lead arrived, and the tab, the search box, the section
 * select and the sort were applied in the browser. The window moved the cut to
 * the server, so the rule now decides which 25 rows an editor's page holds --
 * and a rule that decides what an editor sees has to be pinned somewhere a
 * PGlite instance is not needed. This file is that pin.
 *
 * The order is half the rule. `queueSelect` applies tab, then search, then
 * section, then sort -- the order the route applied them in -- and several of
 * these tests would pass under another order while the screen showed different
 * rows, so the ordering tests state the row they expect by name rather than
 * only counting.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanQueueWindow,
  queueCounts,
  queueMatchesSearch,
  queueNeedle,
  queueSelect,
  queueSort,
  QUEUE_FILTERS,
  QUEUE_SORTS,
  type QueueLead,
} from "./queue-rows.ts";

/** A lead with only the columns the rule reads set to something; the rest are
 *  the empty values the database would hand back. */
function lead(over: Partial<QueueLead> & { id: number }): QueueLead {
  return {
    status: "new",
    headline: `Lead ${over.id}`,
    why: null,
    topic: null,
    newsworthiness: null,
    created_at: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

const PRINTED = [
  {
    slug: "council-approves-budget",
    headline: "Council approves the budget after a long night",
    topic: "city",
    published_at: "2026-09-02T00:00:00.000Z",
  },
];

test("a request that says nothing opens the Open tab, Best first, at the top", () => {
  const w = cleanQueueWindow(undefined);
  assert.equal(w.filter, "open");
  assert.equal(w.sort, "best");
  assert.equal(w.section, "all");
  assert.equal(w.offset, 0);
  assert.equal(w.search, "");
});

test("an unknown tab, sort or section falls back rather than filtering to nothing", () => {
  const w = cleanQueueWindow({ filter: "archived", sort: "sideways", section: "  " });
  assert.equal(w.filter, "open");
  assert.equal(w.sort, "best");
  assert.equal(w.section, "all");
});

test("a section name is trimmed and bounded, so a hand-made request cannot compare a kilobyte per row", () => {
  const long = "x".repeat(500);
  const w = cleanQueueWindow({ section: `  city  ` });
  assert.equal(w.section, "city");
  assert.equal(cleanQueueWindow({ section: long }).section.length, 64);
});

test("the tabs and the sort list are the ones the route draws", () => {
  assert.deepEqual([...QUEUE_FILTERS], ["open", "held", "killed", "printed", "all"]);
  assert.deepEqual([...QUEUE_SORTS], ["best", "newest", "oldest"]);
});

test("the search box reads the headline, the why-now and the section", () => {
  const l = lead({ id: 1, headline: "Bridge closes", why: "The county voted", topic: "county" });
  assert.equal(queueMatchesSearch(l, ""), true);
  assert.equal(queueMatchesSearch(l, "bridge"), true);
  assert.equal(queueMatchesSearch(l, "county voted"), true);
  assert.equal(queueMatchesSearch(l, "county"), true);
  assert.equal(queueMatchesSearch(l, "school board"), false);
});

test("the search is folded and trimmed, so capitals and stray spaces do not miss", () => {
  const l = lead({ id: 1, headline: "Bridge Closes" });
  assert.equal(queueNeedle("  BRIDGE  "), "bridge");
  assert.equal(queueMatchesSearch(l, queueNeedle("  BRIDGE  ")), true);
});

test("Open is every lead that is neither killed nor published, and Held is not in it", () => {
  const rows = [
    lead({ id: 1, status: "new" }),
    lead({ id: 2, status: "held" }),
    lead({ id: 3, status: "killed" }),
    lead({ id: 4, status: "published" }),
  ];
  const open = queueSelect(rows, [], { filter: "open", section: "all", sort: "best", needle: "" });
  /*
    FB6, 7a. The case's own title said "and Held is not in it" while asserting
    [1, 2] -- the held lead, in the tab that says it excludes it. The owner
    reported exactly that as a bug on 2026-09-30, so the title was the intent
    and the expectation was the defect.
  */
  assert.deepEqual(
    open.map((l) => l.id),
    [1],
  );
});

test("the tab is applied before the search, so a killed lead stays out however well it matches", () => {
  const rows = [
    lead({ id: 1, status: "new", headline: "Bridge closes" }),
    lead({ id: 2, status: "killed", headline: "Bridge closes tonight" }),
  ];
  const open = queueSelect(rows, [], { filter: "open", section: "all", sort: "best", needle: "bridge" });
  assert.deepEqual(
    open.map((l) => l.id),
    [1],
  );
});

test("the section and the search both narrow, and a lead has to pass both", () => {
  const rows = [
    lead({ id: 1, headline: "Bridge closes", topic: "city" }),
    lead({ id: 2, headline: "School board meets", topic: "city" }),
    lead({ id: 3, headline: "Bridge closes", topic: "county" }),
  ];
  const out = queueSelect(rows, [], { filter: "all", section: "city", sort: "best", needle: "bridge" });
  assert.deepEqual(
    out.map((l) => l.id),
    [1],
  );
});

test("Best is the scanner's score, highest first", () => {
  const rows = [
    lead({ id: 1, newsworthiness: 3 }),
    lead({ id: 2, newsworthiness: 9 }),
    lead({ id: 3, newsworthiness: 6 }),
  ];
  const out = queueSort(rows, "best", "open");
  assert.deepEqual(
    out.map((l) => l.id),
    [2, 3, 1],
  );
});

test("a lead the scanner never scored sorts below one it did, rather than crashing the sort", () => {
  const rows = [lead({ id: 1, newsworthiness: null }), lead({ id: 2, newsworthiness: 1 })];
  assert.deepEqual(
    queueSort(rows, "best", "open").map((l) => l.id),
    [2, 1],
  );
});

test("Newest and Oldest are the filing time, and the id breaks a tie the same way", () => {
  const rows = [
    lead({ id: 1, created_at: "2026-09-01T00:00:00.000Z" }),
    lead({ id: 3, created_at: "2026-09-03T00:00:00.000Z" }),
    lead({ id: 2, created_at: "2026-09-01T00:00:00.000Z" }),
  ];
  assert.deepEqual(
    queueSort(rows, "newest", "open").map((l) => l.id),
    [3, 2, 1],
  );
  assert.deepEqual(
    queueSort(rows, "oldest", "open").map((l) => l.id),
    [1, 2, 3],
  );
});

test("on the Killed tab, Best is what keeps coming back, not the score", () => {
  const rows = [
    lead({ id: 1, status: "killed", newsworthiness: 99 }),
    lead({ id: 2, status: "killed", newsworthiness: 1, last_resurfaced_at: "2026-09-05T00:00:00.000Z" }),
    lead({ id: 3, status: "killed", newsworthiness: 50, last_resurfaced_at: "2026-09-09T00:00:00.000Z" }),
  ];
  const out = queueSort(rows, "best", "killed");
  assert.deepEqual(
    out.map((l) => l.id),
    [3, 2, 1],
  );
});

test("a killed lead that never came back sorts after one that did, newest kill first", () => {
  const rows = [
    lead({ id: 1, status: "killed" }),
    lead({ id: 2, status: "killed" }),
    lead({ id: 5, status: "killed", last_resurfaced_at: "2026-09-05T00:00:00.000Z" }),
  ];
  assert.deepEqual(
    queueSort(rows, "best", "killed").map((l) => l.id),
    [5, 2, 1],
  );
});

test("the Killed tab's Best order does not leak into the score order on other tabs", () => {
  const rows = [
    lead({ id: 1, status: "new", newsworthiness: 1, last_resurfaced_at: "2026-09-05T00:00:00.000Z" }),
    lead({ id: 2, status: "new", newsworthiness: 9 }),
  ];
  assert.deepEqual(
    queueSelect(rows, [], { filter: "open", section: "all", sort: "best", needle: "" }).map((l) => l.id),
    [2, 1],
  );
});

test("the sort does not reorder the array it was handed", () => {
  const rows = [lead({ id: 1, newsworthiness: 1 }), lead({ id: 2, newsworthiness: 9 })];
  queueSort(rows, "best", "open");
  assert.deepEqual(
    rows.map((l) => l.id),
    [1, 2],
  );
});

test("the Printed tab is the leads the desk matches to a piece that ran", () => {
  const rows = [
    lead({ id: 1, headline: "Council approves the budget after a long night" }),
    lead({ id: 2, headline: "School board meets on Tuesday" }),
  ];
  const out = queueSelect(rows, PRINTED, {
    filter: "printed",
    section: "all",
    sort: "best",
    needle: "",
  });
  assert.deepEqual(
    out.map((l) => l.id),
    [1],
  );
});

test("the printed match reads a lead with no section as readily as one with a section", () => {
  const rows = [lead({ id: 1, headline: "Council approves the budget after a long night", topic: null })];
  assert.equal(
    queueSelect(rows, PRINTED, { filter: "printed", section: "all", sort: "best", needle: "" }).length,
    1,
  );
});

test("with nothing printed the Printed tab is empty rather than the whole queue", () => {
  const rows = [lead({ id: 1 }), lead({ id: 2 })];
  assert.equal(
    queueSelect(rows, [], { filter: "printed", section: "all", sort: "best", needle: "" }).length,
    0,
  );
});

test("the pills count the whole list, not the page", () => {
  const rows = [
    lead({ id: 1, status: "new" }),
    lead({ id: 2, status: "held" }),
    lead({ id: 3, status: "held" }),
    lead({ id: 4, status: "killed" }),
    lead({ id: 5, status: "published" }),
    lead({ id: 6, headline: "Council approves the budget after a long night" }),
  ];
  const counts = queueCounts(rows, PRINTED);
  assert.deepEqual(counts, {
    /*
      FB6, owner report 7a: "Held leads appear under the Open filter/count on
      Today/Queue -- they must not." This read 4 (the two held leads counted as
      open work) and the pill printed it. Open is now 1 and 6 only, and the two
      held leads are the Held tab's own number.
    */
    open: 2,
    held: 2,
    killed: 1,
    printed: 1,
    all: 6,
    publishedLeads: 1,
  });
});

test("the counts and the tabs cannot disagree: each tab's length is its own count", () => {
  const rows = [
    lead({ id: 1, status: "new" }),
    lead({ id: 2, status: "held" }),
    lead({ id: 3, status: "killed" }),
    lead({ id: 4, status: "published" }),
    lead({ id: 5, headline: "Council approves the budget after a long night" }),
  ];
  const counts = queueCounts(rows, PRINTED);
  for (const filter of QUEUE_FILTERS) {
    const shown = queueSelect(rows, PRINTED, { filter, section: "all", sort: "best", needle: "" });
    assert.equal(shown.length, counts[filter], `tab ${filter}`);
  }
});
