// guards: an editor sees a failed reporting request as started and cannot learn why it ended.
import { it } from "node:test";
import assert from "node:assert/strict";
import { reportingNotice, reportingRunState } from "./reporting-package-view.ts";

it("shows the failed request and its reason instead of a started message", () => {
  // guards: the editor cannot read when the failed reporting request ended.
  const view = reportingRunState({
    requestId: 1,
    status: "FAILED",
    error: "Codex request timed out.",
    finishedAt: "2026-10-07T12:15:13Z",
    modelLabel: "Codex Sol 6.1",
    assignment: "Report the council meeting",
  }, "America/Denver");
  assert.match(view.label, /fail|did not finish/i);
  assert.match(view.detail, /Codex.*timed out/i);
  assert.match(view.detail, /Oct\.? 7.*6:15 a\.m\./);
  assert.doesNotMatch(view.detail, /2026-10-07T12:15:13Z/);
  assert.match(view.detail, /Codex Sol 6\.1/);
  assert.doesNotMatch(JSON.stringify(view), /reporting started/i);
});

it("replaces a successful start notice when the latest request fails", () => {
  // guards: the editor keeps seeing reporting started after the request has failed.
  assert.equal(reportingNotice({ ok: true }, "FAILED"), "failed");
});
