import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPoisonedSignal } from "./dark.ts";

/**
 * Dark Desk F3: `isSelfReferential` used to be applied only to `claims`
 * (investigate.ts). The synthesis pass's `dark_signals` insert is a
 * separate JSON-returning call with its own free-text fields
 * (observation/pattern/linkage_map/alternatives/counter_narrative/
 * what_would_kill/pathway), and it was not filtered at all — a signal built
 * entirely from tool-refusal narration would insert straight into
 * dark_signals. This proves `isPoisonedSignal` rejects a wholly operational
 * response without deleting a real lead because one field is awkward.
 */
describe("isPoisonedSignal", () => {
  it("catches tool-refusal narration in the name", () => {
    assert.equal(
      isPoisonedSignal({ name: "WebFetch was blocked by the sandbox policy" }),
      true,
    );
  });

  it("keeps a real named lead even when one field contains operational narration", () => {
    assert.equal(
      isPoisonedSignal({
        name: "Contract award pattern",
        observation: "This command requires approval and the fetch was refused",
      }),
      false,
    );
  });

  it("rejects a response whose substantive fields are all operational narration", () => {
    assert.equal(isPoisonedSignal({
      name: "WebFetch was blocked by the sandbox policy",
      observation: "This command requires approval and the fetch was refused",
      pattern: "ToolSearch returned nothing",
      linkage_map: "MCP tool schema blackout",
      alternatives: "curl was blocked by an allow-rule",
      counter_narrative: "Bash tool call was denied",
      what_would_kill: "WebSearch access, currently refused",
      pathway: "attempted a sandbox escape via the command line",
    }), true);
  });

  it("leaves a real signal alone", () => {
    assert.equal(
      isPoisonedSignal({
        name: "Same registered agent across three LLCs",
        posture: "Fiscal Fray",
        observation: "Jane Smith is the registered agent for all three bidders",
        pattern: "All three won bids in the same quarter",
        linkage_map: "Front Range Municipal Solutions LLC -> Jane Smith -> Peak Range Holdings LLC",
        alternatives: "One agent serving several small LLCs is ordinary for a filing service",
        counter_narrative: "INCOMPLETE — has not checked whether the filing service is common locally",
        what_would_kill: "A filing-service directory showing Jane Smith serves dozens of unrelated LLCs",
        pathway: "Search the Secretary of State's registered-agent index for Jane Smith",
        handoff: "MONITOR",
      }),
      false,
    );
  });

  it("does not false-positive on ordinary civic vocabulary that shares a word", () => {
    assert.equal(
      isPoisonedSignal({
        name: "Budget approval pattern",
        observation: "The council approved the budget on a 5-2 vote",
        pattern: "The variance request was denied by the board of adjustment",
      }),
      false,
    );
  });

  it("handles a signal with no free-text fields set", () => {
    assert.equal(isPoisonedSignal({ name: "Bare signal" }), false);
  });
});
