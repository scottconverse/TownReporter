import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasCitation,
  isSelfReferential,
  labelAfterCitationCheck,
  CLAIM_HYGIENE_RULES,
} from "./claim-hygiene.ts";

/**
 * Every string here is a real claim, produced by Opus, Sonnet or Haiku on the
 * same live investigation pack during a ten-run comparison. All three models
 * filed them, so this is not a small-model problem and cannot be fixed by
 * choosing a different one.
 */
const REAL_SELF_REFERENTIAL = [
  "The literal outbound URL of Reddit submission 1oimdib remains unmapped 20 hops after the HTML page rendered successfully",
  "/u/nmvh5's account tenure, karma, and posting history have never been examined in twenty-six hops",
  "This hop directly invoked the WebFetch tool against two distinct hosts (old.reddit.com and firestoneco.gov)",
  "SELF-INDICTING METHODOLOGICAL FINDING: twenty-five hops searched for the record of a contract",
  "Twelve zero-auth, non-rendering fetch targets have been identified and queued this hop",
  "Firestone Boulevard's jurisdiction remains unverified after 25 hops despite six attempts",
  "The City of Firestone's sitemap.xml and robots.txt would have resolved in hop 6",
];

const REAL_FINDINGS = [
  "The Town of Firestone Board of Trustees approved Resolution 25-41 awarding the frontage road contract",
  "Firestone Boulevard is maintained by Weld County, not the Town of Firestone",
  "CDOT's STIP lists project 24-HA-0142 at I-25 Exit 240 with a 2026 letting date",
  "A resident posted that construction began without a public notice",
  "The registered agent for Acme Paving LLC is also the agent for two other bidders",
];

/**
 * Dark Desk F1/F3: on its Claude leg the dig used to be handed a
 * live-but-denied tool surface (Bash, WebSearch, WebFetch, MCP — see
 * ai-claude-code.server.ts's `noTools`). Denied, the model would narrate the
 * refusal straight into the JSON it was returning. These are the shapes seen
 * in prod (dark_signals / frontier_items), reworded generically.
 */
const TOOL_REFUSAL_NARRATION = [
  "This command requires approval — the operator must allow Bash before it can run",
  "WebSearch returned no results because the tool call was refused",
  "WebFetch was blocked by the sandbox policy for this host",
  "MCP tool schema blackout: no servers were reachable from this session",
  "ToolSearch returned nothing for the requested capability",
  "Bash(curl https://firestoneco.gov) — permission denied by the CLI",
  "Attempted a sandbox escape via the command line to reach the live filesystem",
  "curl was blocked by an allow-rule before it could reach the host",
  "The MCP server requires pre-approval that this session does not have",
];

/**
 * The false-positive guard: ordinary civic text that happens to share a word
 * with the tool-refusal vocabulary above (approval, permission, sandbox,
 * bash, curl, mcp, denied, blocked) but is not tool-refusal narration. A
 * filter that eats these is worse than the poisoned rows it was meant to
 * catch.
 */
const CIVIC_TEXT_SHARING_VOCABULARY = [
  "The council approved the budget on a 5-2 vote",
  "The permit application was filed with the zoning office last week",
  "A bash of the pipeline extension was thrown at the community center",
  "The playground sandbox at Roosevelt Park was resurfaced this spring",
  "The variance request was denied by the board of adjustment",
  "Construction access was blocked by the contractor's own fencing",
  "The county clerk requires approval from two commissioners before recording",
  "MCP, the Metro Coordinating Partnership, co-signed the grant application",
];

describe("isSelfReferential", () => {
  it("catches every self-referential claim the models actually produced", () => {
    for (const t of REAL_SELF_REFERENTIAL) {
      assert.equal(isSelfReferential(t), true, `missed: ${t.slice(0, 70)}`);
    }
  });

  it("catches tool-refusal / sandbox-escape narration", () => {
    for (const t of TOOL_REFUSAL_NARRATION) {
      assert.equal(isSelfReferential(t), true, `missed: ${t.slice(0, 70)}`);
    }
  });

  it("does not drop ordinary civic text that shares a word with the tool vocabulary", () => {
    for (const t of CIVIC_TEXT_SHARING_VOCABULARY) {
      assert.equal(isSelfReferential(t), false, `wrongly dropped: ${t.slice(0, 70)}`);
    }
  });

  /** A filter that eats real findings is worse than no filter. */
  it("keeps every real finding", () => {
    for (const t of REAL_FINDINGS) {
      assert.equal(isSelfReferential(t), false, `wrongly dropped: ${t.slice(0, 70)}`);
    }
  });

  it("does not trip on the word hop in ordinary use", () => {
    assert.equal(isSelfReferential("The hop-on hop-off bus route was cut"), false);
    assert.equal(isSelfReferential("Hops are grown in the county"), false);
  });

  it("handles nothing without throwing", () => {
    assert.equal(isSelfReferential(""), false);
    assert.equal(isSelfReferential("   "), false);
  });
});

describe("a FACT needs a receipt", () => {
  /**
   * FACT is the one label the confidence clamp cannot correct — its ceiling is
   * 1.0. Across ten runs the models labelled 17-29% of claims FACT.
   */
  it("downgrades a FACT with nothing behind it", () => {
    assert.equal(labelAfterCitationCheck("FACT", {}), "INFERENCE");
    assert.equal(labelAfterCitationCheck("FACT", { source_url: "" }), "INFERENCE");
    assert.equal(labelAfterCitationCheck("FACT", { source_url: "not a url" }), "INFERENCE");
    assert.equal(labelAfterCitationCheck("FACT", { artifact_version_id: 0 }), "INFERENCE");
  });

  it("leaves a cited FACT alone, whichever receipt it carries", () => {
    assert.equal(labelAfterCitationCheck("FACT", { source_url: "https://firestoneco.gov/a" }), "FACT");
    assert.equal(labelAfterCitationCheck("FACT", { artifact_version_id: 42 }), "FACT");
    assert.equal(labelAfterCitationCheck("FACT", { capture_event_id: 7 }), "FACT");
  });

  it("never touches the other labels", () => {
    for (const k of ["OBSERVATION", "ALLEGATION", "INFERENCE", "HYPOTHESIS", "UNKNOWN"]) {
      assert.equal(labelAfterCitationCheck(k, {}), k);
    }
  });

  it("downgrades rather than drops, so the lead survives", () => {
    // The desk's non-gating rule: weak evidence keeps being investigated, it
    // just may not be called established.
    assert.notEqual(labelAfterCitationCheck("FACT", {}), "");
  });

  it("knows a citation from a hopeful string", () => {
    assert.equal(hasCitation({ source_url: "https://x.gov/a" }), true);
    assert.equal(hasCitation({ source_url: "see the packet" }), false);
    assert.equal(hasCitation({}), false);
  });
});

describe("the prompt states both rules", () => {
  it("tells the model to aim right, not just be filtered", () => {
    assert.match(CLAIM_HYGIENE_RULES, /CLAIMS ARE ABOUT THE TOWN/);
    assert.match(CLAIM_HYGIENE_RULES, /A FACT REQUIRES A CITATION/);
    assert.match(CLAIM_HYGIENE_RULES, /belong in frontier or questions/);
  });
});
