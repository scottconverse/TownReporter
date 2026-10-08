// guards: unsourced planner notes must not tell editors that evidence disproved a hypothesis
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groundBrief } from "./dark.ts";
import { parseBrief } from "./dark-brief.ts";
import { hypothesisStatusForPlan } from "./investigate.ts";

describe("Dark Desk contradictions", () => {
  it("keeps search instructions out of evidence status and grounds both cited records", () => {
    assert.equal(hypothesisStatusForPlan("", "Search the city ledger for the ordinary explanation"), "active");

    const pair = {
      first: { text: "The contract states the total was $4,100.", captureId: 31 },
      second: { text: "The public ledger states the total was $9,100.", captureId: 32 },
    };
    const ungrounded = {
      first: { text: "The contract states the total was $4,100.", captureId: 99 },
      second: { text: "The public ledger states the total was $9,100.", captureId: 32 },
    };
    const brief = parseBrief({ contradictions: [pair, ungrounded] });
    const corpus = {
      normalised: "",
      captures: [
        { captureEventId: 31, text: pair.first.text },
        { captureEventId: 32, text: pair.second.text },
      ],
    };
    assert.deepEqual(groundBrief(brief, corpus as never).contradictions, [pair]);
  });
});
