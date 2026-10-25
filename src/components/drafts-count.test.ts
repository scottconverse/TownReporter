import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { DRAFTS_NAV_COUNT_KEY, draftPillCount, shareDraftsCountWithNav } from "./drafts-count.ts";

describe("the Drafts number is one number", () => {
  it("hands the list's own count to the side nav", () => {
    const qc = new QueryClient();
    shareDraftsCountWithNav(qc, 7);
    assert.equal(qc.getQueryData(DRAFTS_NAV_COUNT_KEY), 7);
    shareDraftsCountWithNav(qc, 0);
    assert.equal(qc.getQueryData(DRAFTS_NAV_COUNT_KEY), 0);
  });

  it("does not invent a count before the list has arrived", () => {
    const qc = new QueryClient();
    shareDraftsCountWithNav(qc, undefined);
    assert.equal(qc.getQueryData(DRAFTS_NAV_COUNT_KEY), undefined);
  });

  it("a pill has no number until the list is counted, and a real 0 stays 0", () => {
    assert.equal(draftPillCount(undefined, "all"), null);
    assert.equal(draftPillCount({ all: 0 }, "all"), 0);
    assert.equal(draftPillCount({ all: 4 }, "all"), 4);
  });
});
