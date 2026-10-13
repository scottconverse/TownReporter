import assert from "node:assert/strict";
import { test } from "node:test";
import {
  draftLeadInput,
  writeStoryInput,
  rewriteFromLedgerInput,
  runScanInput,
  editorialStartInput,
  darkStepInput,
} from "./request-input.ts";

test("AI request validators preserve deliberate Automatic while old tabs remain unmarked", () => {
  const doors = [
    [draftLeadInput, { leadId: 22 }],
    [writeStoryInput, { text: "Draft from this supplied material." }],
    [rewriteFromLedgerInput, { leadId: 22 }],
    [runScanInput, {}],
    [editorialStartInput, { subject: "The council's decision" }],
    [darkStepInput, { id: 22 }],
  ] as const;
  for (const [schema, input] of doors) {
    const explicit = schema.parse({ ...input, modelChoice: "auto", modelChoiceExplicit: true });
    assert.equal(typeof explicit, "object");
    assert.equal((explicit as { modelChoiceExplicit?: boolean }).modelChoiceExplicit, true);
    const legacy = schema.parse({ ...input, modelChoice: "auto" });
    assert.equal((legacy as { modelChoiceExplicit?: boolean }).modelChoiceExplicit, undefined);
  }
  assert.equal(draftLeadInput.parse(22), 22);
});
