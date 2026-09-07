import assert from "node:assert/strict";
import { test } from "node:test";

// followUpDueLabel/followUpIsOverdue (src/lib/news/desk-copy.ts) -- the
// Follow-ups object's due-date copy. Direct unit test of the real
// functions (scripts/follow-up-item-render.test.mjs covers the same logic
// as rendered rail-item markup, importing these same real functions).
const { followUpDueLabel, followUpIsOverdue } = await import("../src/lib/news/desk-copy.ts");

const TODAY = new Date("2026-09-06T12:00:00");

test("no due date renders nothing", () => {
  assert.equal(followUpDueLabel(null, TODAY), "");
  assert.equal(followUpDueLabel(undefined, TODAY), "");
});

test("a past due date states 'Overdue N days' in words", () => {
  assert.equal(followUpDueLabel("2026-09-03", TODAY), "Overdue 3 days");
  assert.equal(followUpDueLabel("2026-09-05", TODAY), "Overdue 1 day");
  assert.equal(followUpIsOverdue("2026-09-03", TODAY), true);
});

test("today's due date reads 'due today'", () => {
  assert.equal(followUpDueLabel("2026-09-06", TODAY), "due today");
  assert.equal(followUpIsOverdue("2026-09-06", TODAY), false);
});

test("a future due date shows the weekday and date", () => {
  assert.equal(followUpDueLabel("2026-09-09", TODAY), "due Wed, Sep 9");
  assert.equal(followUpIsOverdue("2026-09-09", TODAY), false);
});
