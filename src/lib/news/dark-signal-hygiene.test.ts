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
 * dark_signals. This proves `isPoisonedSignal` catches it in every field,
 * not just `observation`, and leaves a real signal alone.
 */
describe("isPoisonedSignal", () => {
  it("catches tool-refusal narration in the name", () => {
    assert.equal(
      isPoisonedSignal({ name: "WebFetch was blocked by the sandbox policy" }),
      true,
    );
  });

  it("catches it in observation even when the name is clean", () => {
    assert.equal(
      isPoisonedSignal({
        name: "Contract award pattern",
        observation: "This command requires approval and the fetch was refused",
      }),
      true,
    );
  });

  it("catches it in pattern, linkage_map, alternatives, counter_narrative, what_would_kill, or pathway", () => {
    const base = { name: "Contract award pattern" };
    assert.equal(isPoisonedSignal({ ...base, pattern: "ToolSearch returned nothing" }), true);
    assert.equal(isPoisonedSignal({ ...base, linkage_map: "MCP tool schema blackout" }), true);
    assert.equal(
      isPoisonedSignal({ ...base, alternatives: "curl was blocked by an allow-rule" }),
      true,
    );
    assert.equal(
      isPoisonedSignal({ ...base, counter_narrative: "Bash tool call was denied" }),
      true,
    );
    assert.equal(
      isPoisonedSignal({ ...base, what_would_kill: "WebSearch access, currently refused" }),
      true,
    );
    assert.equal(
      isPoisonedSignal({ ...base, pathway: "attempted a sandbox escape via the command line" }),
      true,
    );
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
