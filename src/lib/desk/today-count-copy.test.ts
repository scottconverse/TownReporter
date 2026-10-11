import assert from "node:assert/strict";
import test from "node:test";
import {
  todayDarkDeskWaitingCopy,
  todayDarkDeskWaitingCount,
  todayLeadCaption,
  todayScanStatus,
} from "./today-count-copy.ts";

test("Today names its mixed lead pile and separates scan activity from its saved leads", () => {
  assert.equal(todayLeadCaption(), "All open leads · best first");
  assert.equal(todayScanStatus(true), "A scan is still reading sources; its new leads will appear when it finishes.");
});

test("Today counts the same waiting investigation files as Dark Desk, including watched pages", () => {
  assert.equal(todayDarkDeskWaitingCount([
    { status: "open", waiting_follow_up: "Check the next agenda" },
    { status: "open", waiting_watch: "City packet" },
    { status: "open" },
    { status: "closed", waiting_follow_up: "Closed file follow-up" },
  ]), 2);
  assert.deepEqual(todayDarkDeskWaitingCopy(), {
    label: "Dark Desk files waiting",
    note: "Files waiting on an AI follow-up or a watched page.",
  });
});
