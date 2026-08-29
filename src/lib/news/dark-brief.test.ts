import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BRIEF_SYSTEM,
  asVerdict,
  briefIsUseful,
  briefPack,
  parseBrief,
} from "./dark-brief.ts";

describe("parseBrief", () => {
  it("reads a full brief", () => {
    const b = parseBrief({
      headline: "Three bids, one agent",
      tldr: "Three LLCs share a registered agent.",
      connections: ["Agent X appears on all three filings"],
      hypothesis: "The same person controls all three bidders",
      strength: 0.4,
      supports: ["Shared agent", "Same quarter"],
      benign: "One agent serves many small firms; that is their job",
      kills_it: "The Secretary of State filings for all three LLCs",
      verdict: "promising",
      why_verdict: "Two independent records line up",
      next: "Pull the SOS filings",
      sections: { record: "a", tested: "b", open: "c", known: "d" },
    });
    assert.equal(b.verdict, "promising");
    assert.equal(b.strength, 0.4);
    assert.equal(b.connections.length, 1);
    assert.equal(b.sections.open, "c");
    assert.match(b.generated_at, /^\d{4}-/);
  });

  /**
   * A summary panel that breaks the page is worse than no summary panel — it
   * sits above four sections the editor still needs.
   */
  it("never throws, whatever the model returns", () => {
    for (const junk of [null, undefined, "", 42, [], { sections: "nope" }, { strength: "x" }]) {
      const b = parseBrief(junk);
      assert.equal(typeof b.headline, "string");
      assert.equal(typeof b.sections.record, "string");
      assert.equal(typeof b.strength, "number");
    }
  });

  /**
   * An unscored hypothesis renders as a confident one. The difference between
   * "the evidence supports this" and "I find this interesting" is the whole
   * value of the number.
   */
  it("treats a missing or broken strength as zero, never as certainty", () => {
    assert.equal(parseBrief({}).strength, 0);
    assert.equal(parseBrief({ strength: "high" }).strength, 0);
    assert.equal(parseBrief({ strength: 5 }).strength, 1);
    assert.equal(parseBrief({ strength: -2 }).strength, 0);
  });

  it("only accepts the four verdicts", () => {
    assert.equal(asVerdict("promising"), "promising");
    assert.equal(asVerdict("PROMISING"), "promising");
    assert.equal(asVerdict("definitely a scandal"), "unknown");
    assert.equal(asVerdict(null), "unknown");
  });

  it("knows an empty brief from a real one", () => {
    assert.equal(briefIsUseful(null), false);
    assert.equal(briefIsUseful(parseBrief({})), false);
    assert.equal(briefIsUseful(parseBrief({ headline: "Something" })), true);
  });
});

describe("BRIEF_SYSTEM", () => {
  /** The three things that stop a speculative brief becoming an accusation. */
  it("demands connections, a benign explanation and a falsifier", () => {
    assert.match(BRIEF_SYSTEM, /CONNECTIONS/);
    assert.match(BRIEF_SYSTEM, /BENIGN EXPLANATION/);
    assert.match(BRIEF_SYSTEM, /WHAT WOULD KILL IT/);
    assert.match(BRIEF_SYSTEM, /never concluding/);
    assert.match(BRIEF_SYSTEM, /Be willing to say dead/);
  });

  it("refuses the shrug that pretends to be a hypothesis", () => {
    assert.match(BRIEF_SYSTEM, /there may be irregularities/);
    assert.match(BRIEF_SYSTEM, /that is not a hypothesis, it is a shrug/);
  });
});

describe("briefPack", () => {
  it("leads with what is established, not with the longest list", () => {
    const pack = briefPack({
      title: "Test file",
      facts: [{ body: "A fact", evidence: "a source" }],
      hypotheses: ["A hypothesis"],
      questions: ["A question"],
      findings: ["A finding"],
      entities: [{ name: "Acme LLC", kind: "company" }],
      artifacts: [{ title: "Packet", url: "https://x.gov/p" }],
    });
    assert.ok(pack.indexOf("WHAT WE KNOW") < pack.indexOf("STILL OPEN"));
    assert.match(pack, /Acme LLC \(company\)/);
    assert.match(pack, /https:\/\/x\.gov\/p/);
  });

  it("says '(none yet)' rather than leaving a section blank", () => {
    const pack = briefPack({
      title: "Empty file",
      facts: [],
      hypotheses: [],
      questions: [],
      findings: [],
      entities: [],
      artifacts: [],
    });
    assert.equal((pack.match(/\(none yet\)/g) ?? []).length, 6);
  });
});
