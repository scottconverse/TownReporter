import assert from "node:assert/strict";
import test from "node:test";
import {
  isCurrentRoutineApproval,
  replaceRoutineApproval,
} from "./routine-notice-permissions-state.ts";

test("a changed source URL is unchecked until the owner explicitly replaces the saved address", () => {
  const oldApproval = {
    sourceId: 17,
    sourceUrl: "https://library.example/notices",
    formatKey: "library-notice" as const,
  };
  const replacement = { id: 17, url: "https://library.example/calendar" };

  assert.equal(isCurrentRoutineApproval([oldApproval], replacement, "library-notice"), false);
  assert.deepEqual(replaceRoutineApproval([oldApproval], replacement, "library-notice"), [
    { sourceId: 17, sourceUrl: replacement.url, formatKey: "library-notice" },
  ]);
});