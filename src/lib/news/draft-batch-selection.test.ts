import assert from "node:assert/strict";
import test from "node:test";
import { resolveDraftBatchSelection } from "./draft-batch-selection.ts";

test("keeps the real selection visible while the full lead pool is loading", () => {
  const result = resolveDraftBatchSelection([17], [], false);
  assert.equal(result.selectedCount, 1);
  assert.equal(result.loading, true);
  assert.equal(result.startableIds.length, 0);
});

test("names the existing draft that makes a selected lead ineligible", () => {
  const result = resolveDraftBatchSelection([17], [
    { id: 17, headline: "Lead with an existing draft", has_draft: true },
  ], true);
  assert.equal(result.selectedCount, 1);
  assert.equal(result.startableIds.length, 0);
  assert.equal(result.excluded[0]?.reason, "This lead already has a draft.");
});

test("keeps eligible and ineligible leads in the dialog's real selection", () => {
  const result = resolveDraftBatchSelection([17, 18], [
    { id: 17, headline: "Lead with an existing draft", has_draft: true },
    { id: 18, headline: "Lead that can be drafted" },
  ], true);
  assert.equal(result.selectedCount, 2);
  assert.deepEqual(result.startableIds, [18]);
  assert.deepEqual(result.excluded.map(({ headline, reason }) => [headline, reason]), [
    ["Lead with an existing draft", "This lead already has a draft."],
  ]);
});
