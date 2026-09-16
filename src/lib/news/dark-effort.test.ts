import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { grokPlanner } from "./investigate.ts";

describe("Dark Desk per-round effort", () => {
  it("passes the immutable effort snapshot to a planner call", async () => {
    let seenEffort: unknown = null;
    const plan = await grokPlanner(
      "Investigate the council packet",
      "codex-balanced",
      null,
      undefined,
      1,
      undefined,
      "planning",
      undefined,
      "xhigh",
      async (_system, _user, _maxTokens, opts) => {
        seenEffort = opts?.reasoningEffort;
        return {
          ok: true,
          text: JSON.stringify({
            searches: [{ query: "council packet contract", reason: "find the record" }],
            fetch_urls: [],
            entities: [],
            relationships: [],
            claims: [],
            frontier: [],
            anomalies: [],
            dead_ends: [],
          }),
        };
      },
    );

    assert.equal(seenEffort, "xhigh");
    assert.ok(plan, "the fake planner result was parsed without invoking a provider");
  });
});
