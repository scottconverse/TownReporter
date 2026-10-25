import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  DRAFTS_NAV_COUNT_KEY,
  draftPillCount,
  shareDraftsCountWithNav,
} from "./drafts-count.ts";

/*
  D2: right after a reload the side-nav Drafts number and the Drafts screen's
  "All" pill could disagree for a moment -- two requests, two moments. The nav now
  takes the list's own count, and a pill with no list yet prints no number rather
  than a confident 0.

  Both halves are plain functions over a query cache and a counts object, so the
  rule is checked here instead of through a rendered shell.
*/

describe("the nav's Drafts count comes from the list", () => {
  it("writes the list's count into the nav's cache entry", () => {
    const qc = new QueryClient();
    shareDraftsCountWithNav(qc, 7);
    assert.equal(qc.getQueryData(DRAFTS_NAV_COUNT_KEY), 7);
  });

  it("leaves the nav alone until a list has actually counted", () => {
    const qc = new QueryClient();
    qc.setQueryData(DRAFTS_NAV_COUNT_KEY, 4);
    shareDraftsCountWithNav(qc, undefined);
    assert.equal(qc.getQueryData(DRAFTS_NAV_COUNT_KEY), 4, "an unanswered list does not blank the nav");
    shareDraftsCountWithNav(qc, Number.NaN);
    assert.equal(qc.getQueryData(DRAFTS_NAV_COUNT_KEY), 4, "a non-number is not a count");
  });

  it("keeps the key under the shared drafts-desk prefix", () => {
    // Every write that invalidates ["drafts-desk"] has to reach this entry.
    assert.equal(DRAFTS_NAV_COUNT_KEY[0], "drafts-desk");
    assert.equal(DRAFTS_NAV_COUNT_KEY.length, 2);
  });
});

describe("a pill prints a number only when the list has counted", () => {
  it("returns the count for a counted pill", () => {
    const counts: Record<string, number> = { all: 12, running: 1 };
    assert.equal(draftPillCount(counts, "all"), 12);
  });

  it("returns null before the list answers, where 0 used to be printed", () => {
    assert.equal(draftPillCount(undefined, "all"), null);
    assert.equal(draftPillCount({}, "all"), null);
  });

  it("keeps a real zero a zero", () => {
    assert.equal(draftPillCount({ all: 0 }, "all"), 0);
  });
});
