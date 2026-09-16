import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OCR_BATCH_PAGE_LIMIT,
  pageListSummary,
  planMissingOcrBatches,
  unreadOcrPages,
} from "./ocr-batches.ts";

describe("durable OCR batch planning", () => {
  it("covers a complete large packet in bounded consecutive batches", () => {
    assert.deepEqual(planMissingOcrBatches(44, []), [
      { start: 1, end: 12 },
      { start: 13, end: 24 },
      { start: 25, end: 36 },
      { start: 37, end: 44 },
    ]);
  });

  it("resumes after already retained batches without repeating their pages", () => {
    const retained = Array.from({ length: 24 }, (_, index) => index + 1);
    assert.deepEqual(planMissingOcrBatches(44, retained), [
      { start: 25, end: 36 },
      { start: 37, end: 44 },
    ]);
  });

  it("preserves holes and never crosses a retained page inside a batch", () => {
    assert.deepEqual(planMissingOcrBatches(18, [1, 2, 5, 6, 18], 4), [
      { start: 3, end: 4 },
      { start: 7, end: 10 },
      { start: 11, end: 14 },
      { start: 15, end: 17 },
    ]);
  });

  it("reports exactly which pages remain while keeping summaries bounded", () => {
    const unread = unreadOcrPages(20, [1, 2, 4, 20]);
    assert.deepEqual(unread.slice(0, 4), [3, 5, 6, 7]);
    assert.equal(unread.at(-1), 19);
    assert.match(pageListSummary(unread, 3), /^3, 5, 6, and 13 more$/);
  });

  it("keeps the configured safety boundary at twelve pages per provider call", () => {
    const batches = planMissingOcrBatches(100, []);
    assert.ok(batches.every((batch) => batch.end - batch.start + 1 <= OCR_BATCH_PAGE_LIMIT));
    assert.equal(batches.at(-1)?.end, 100);
  });
});
