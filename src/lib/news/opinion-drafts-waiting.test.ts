import assert from "node:assert/strict";
import { test } from "node:test";
import { opinionDraftsWaiting } from "./opinion-drafts-waiting.ts";

function row(over: {
  id: number;
  draft_id: number | null;
  finished_at: string | null;
  published_slug: string | null;
}) {
  return over;
}

test("a finished, unpublished opinion draft is waiting to be printed", () => {
  const kept = row({ id: 1, draft_id: 11, finished_at: "2026-11-06T10:00:00Z", published_slug: null });
  assert.deepEqual(opinionDraftsWaiting([kept]), [kept]);
});

test("a request with no draft is not a piece and is not listed", () => {
  const dropped = row({ id: 2, draft_id: null, finished_at: "2026-11-06T10:00:00Z", published_slug: null });
  assert.deepEqual(opinionDraftsWaiting([dropped]), []);
});

test("a piece still being written is left to the Opinion page", () => {
  const dropped = row({ id: 3, draft_id: 12, finished_at: null, published_slug: null });
  assert.deepEqual(opinionDraftsWaiting([dropped]), []);
});

test("a piece already on the paper is not waiting", () => {
  const dropped = row({
    id: 4,
    draft_id: 13,
    finished_at: "2026-11-06T10:00:00Z",
    published_slug: "the-budget",
  });
  assert.deepEqual(opinionDraftsWaiting([dropped]), []);
});

test("the newest stays first", () => {
  const newest = row({ id: 5, draft_id: 15, finished_at: "2026-11-06T12:00:00Z", published_slug: null });
  const older = row({ id: 6, draft_id: 16, finished_at: "2026-11-05T12:00:00Z", published_slug: null });
  assert.deepEqual(opinionDraftsWaiting([newest, older]), [newest, older]);
});
