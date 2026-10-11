import assert from "node:assert/strict";
import { it } from "node:test";
import {
  fileLeadInput, editLeadInput, leadStatusInput, leadDuplicateResolutionInput,
  runScanInput, draftLeadInput, rewriteFromLedgerInput, writeStoryInput,
  pullTodoInput, aiFollowUpInput, followUpActionInput,
} from "./request-input.ts";

it("desk validators carry explicit consent to their action handlers", () => {
  const override = ["paper-not-set-up", "editor-test-warning"];
  const cases = [
    [fileLeadInput, { headline: "Tip", why: "", topic: "council" }],
    [editLeadInput, { id: 1, headline: "Tip", why: "", topic: "council" }],
    [leadStatusInput, { id: 1, status: "held" }],
    [leadDuplicateResolutionInput, { id: 1, action: "reopen-prior" }],
    [runScanInput, {}],
    [draftLeadInput, { leadId: 1 }],
    [rewriteFromLedgerInput, { leadId: 1 }],
    [writeStoryInput, { text: "Tip" }],
    [pullTodoInput, { leadId: 1, query: "q" }],
    [aiFollowUpInput, { what: "Check", agentKind: "recheck", schedule: "daily", targets: [] }],
    [followUpActionInput, { id: 1, action: "run-now" }],
  ] as const;
  for (const [schema, input] of cases) {
    const parsed = schema.parse({ ...input, override });
    assert.equal(typeof parsed, "object");
    assert.deepEqual((parsed as { override?: string[] }).override, override);
  }
});

it("override inputs still reject malformed identifiers and consent values", () => {
  assert.equal(editLeadInput.safeParse({ id: -1, headline: "Tip", why: "", topic: "council", override: [] }).success, false);
  assert.equal(runScanInput.safeParse({ override: "paper-not-set-up" }).success, false);
});
