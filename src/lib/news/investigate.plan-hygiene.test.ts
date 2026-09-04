import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePlan } from "./investigate.ts";

/**
 * Dark Desk F3: a model response containing tool-refusal narration —
 * "This command requires approval", "WebSearch was blocked", "MCP tool
 * schema blackout" — must not survive into `claims`, `frontier`,
 * `anomalies`, or `dead_ends`. Before this fix `isSelfReferential` was only
 * applied to `claims`; a live Dark Desk run poisoned the editor's "Still
 * unopened" pile with ~35 frontier rows carrying exactly this narration
 * (see artifacts/dark-desk-review-2026-09-03/DARK-DESK-REVIEW.md, finding
 * F3). This proves the fix at the parser boundary the model's raw JSON
 * actually passes through.
 */
describe("parsePlan filters tool-refusal narration out of every array, not just claims", () => {
  const poisonedResponse = {
    searches: ["Front Range Municipal Solutions LLC registered agent"],
    fetch_urls: ["https://www.sos.state.co.us/biz/frms"],
    claims: [
      {
        text: "This hop directly invoked the WebFetch tool against two distinct hosts",
        kind: "OBSERVATION",
      },
      {
        text: "Front Range Municipal Solutions LLC filed articles of incorporation in 2019",
        kind: "FACT",
        source_url: "https://www.sos.state.co.us/biz/frms",
      },
    ],
    frontier: [
      {
        label: "Bash tool call was denied — still unopened",
        kind: "lead",
        why: "This command requires approval and was refused by the sandbox",
        priority: 9,
      },
      {
        label: "Registered agent's other LLCs",
        kind: "entity",
        why: "Jane Smith is agent for at least one other company",
        priority: 8,
      },
    ],
    anomalies: [
      {
        kind: "changed",
        summary: "MCP tool schema blackout: no servers were reachable from this session",
      },
      {
        kind: "disappeared",
        summary: "The city's 2022 budget PDF returned 404 where it was previously archived",
      },
    ],
    dead_ends: [
      {
        hypothesis: "WebSearch would find the missing contract",
        reason: "ToolSearch returned nothing and ",
      },
      {
        hypothesis: "The contract was awarded without a public bid",
        reason: "The packet shows a sole-source justification memo instead",
      },
    ],
    stop: false,
    summary: "Hop 4 complete",
  };

  const plan = parsePlan(poisonedResponse);

  it("drops the poisoned claim, keeps the real one", () => {
    assert.equal(plan.claims.length, 1);
    assert.match(plan.claims[0].text, /articles of incorporation/);
  });

  it("drops the poisoned frontier item, keeps the real one", () => {
    assert.equal(plan.frontier.length, 1);
    assert.match(plan.frontier[0].label, /Registered agent/);
  });

  it("drops the poisoned anomaly, keeps the real one", () => {
    assert.equal(plan.anomalies.length, 1);
    assert.match(plan.anomalies[0].summary, /2022 budget PDF/);
  });

  it("drops the poisoned dead end, keeps the real one", () => {
    assert.equal(plan.dead_ends.length, 1);
    assert.match(plan.dead_ends[0].hypothesis, /awarded without a public bid/);
    assert.match(plan.dead_ends[0].reason, /sole-source/);
  });

  it("never persists any tool/sandbox vocabulary across the whole plan", () => {
    const everything = JSON.stringify(plan);
    for (const bad of [
      "WebFetch",
      "WebSearch",
      "ToolSearch",
      "tool schema",
      "requires approval",
      "MCP",
    ]) {
      assert.equal(
        everything.toLowerCase().includes(bad.toLowerCase()),
        false,
        `"${bad}" leaked into the persisted plan`,
      );
    }
  });

  it("still runs the searches and fetch_urls the app is supposed to run", () => {
    // Not filtered — these are the model's own instructions to the app, the
    // whole point of F1: the model returns JSON, the app fetches.
    assert.deepEqual(plan.searches, ["Front Range Municipal Solutions LLC registered agent"]);
    assert.deepEqual(plan.fetch_urls, ["https://www.sos.state.co.us/biz/frms"]);
  });
});

describe("parsePlan on a clean response changes nothing", () => {
  it("keeps every field when nothing is self-referential", () => {
    const plan = parsePlan({
      claims: [{ text: "The council approved the budget on a 5-2 vote", kind: "FACT" }],
      frontier: [{ label: "The permit application", why: "not yet located", priority: 5 }],
      anomalies: [{ kind: "missing", summary: "A bash of the pipeline extension went unrecorded" }],
      dead_ends: [{ hypothesis: "The variance was denied", reason: "board minutes confirm it" }],
    });
    assert.equal(plan.claims.length, 1);
    assert.equal(plan.frontier.length, 1);
    assert.equal(plan.anomalies.length, 1);
    assert.equal(plan.dead_ends.length, 1);
  });
});
