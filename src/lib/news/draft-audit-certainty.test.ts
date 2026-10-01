import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditDraft } from "./draft-audit.ts";

/**
 * Unit DD1, item 5 — the dek overstated the record.
 *
 * The stand-in walkthrough of 2026-09-30 (`A2c-REPORT.md` §5.3) read a drafted
 * story whose body was careful and whose dek was not:
 *
 *   dek:  "State licensing records show the program IS ON PROBATION and was
 *          recommended for adverse action in July."
 *   body: "…shows a RECOMMENDATION FOR PROBATION dated July 30, 2026, with no
 *          final outcome or outcome date listed."
 *
 * The capture says the same thing the body does. "Recommended" is not "in
 * force", and nothing in the draft checker looked at how strongly the dek put
 * what the story's own text only proposed -- the style audit reads the headline
 * and the dek, but it has no reading at all for a claim stated harder above the
 * fold than below it.
 */

const UPGRADED_DEK = {
  headline: "Kid City USA Longmont Families Report One-Week Notice of Oct. 2 Closure",
  dek:
    "A Reddit account says the licensed center at 1941 Terry St. told parents and staff it " +
    "will close permanently next Friday. State licensing records show the program is on " +
    "probation and was recommended for adverse action in July.",
  body:
    "The Colorado Shines page for the center shows a recommendation for probation dated " +
    "July 30, 2026, with no final outcome or outcome date listed.\n\n" +
    "Families were told the closure takes effect Oct. 2, 2026.",
  form: "news",
};

describe("DD1 item 5 — a dek may not state harder than the story does", () => {
  it("flags a dek that turns a recommendation into a fact", () => {
    const audit = auditDraft(UPGRADED_DEK);
    const finding = audit.findings.find((f) => f.code === "unearned-certainty");
    assert.ok(finding, `no certainty finding: ${audit.findings.map((f) => f.code).join(", ")}`);
    assert.equal(finding.severity, "review");
    assert.equal(finding.paragraph, 0, "the finding belongs over the headline and dek");
    assert.match(finding.message, /probation/i);
    assert.match(finding.message, /recommend/i);
    assert.match(finding.snippet, /is on probation/i);
  });

  it("does not flag a dek that keeps the story's own hedge", () => {
    const audit = auditDraft({
      ...UPGRADED_DEK,
      dek:
        "State licensing records show a recommendation for probation dated July 30, 2026, " +
        "with no final outcome listed.",
    });
    assert.equal(
      audit.findings.some((f) => f.code === "unearned-certainty"),
      false,
      audit.findings.map((f) => `${f.code}: ${f.message}`).join("\n"),
    );
  });

  it("does not flag a state the story asserts on its own evidence", () => {
    // Nothing in the draft recommends or proposes it; the licence simply is
    // what it is, and the checker has no business inventing a hedge.
    const audit = auditDraft({
      ...UPGRADED_DEK,
      dek: "State licensing records show the program is on probation.",
      body: "The Colorado Shines page lists the licence as on probation.",
    });
    assert.equal(audit.findings.some((f) => f.code === "unearned-certainty"), false);
  });

  it("catches the same upgrade in the headline and in the body", () => {
    const headline = auditDraft({
      ...UPGRADED_DEK,
      headline: "Centre is on probation, records show",
    });
    assert.equal(
      headline.findings.some((f) => f.code === "unearned-certainty"),
      true,
      "the headline is read by the same check as the dek",
    );

    const body = auditDraft({
      ...UPGRADED_DEK,
      dek: "Families were told the centre will close Oct. 2.",
      body:
        "The state recommended the licence for probation in July.\n\n" +
        "The programme is on probation now.",
    });
    const inBody = body.findings.find((f) => f.code === "unearned-certainty");
    assert.ok(inBody, "the body is read by the same check");
    assert.equal(inBody.paragraph, 2);
  });

  it("leaves a draft with no recommendation anywhere alone", () => {
    const audit = auditDraft({
      headline: "Council delays the budget vote",
      dek: "The vote moves to November.",
      body: "The council delayed the budget vote on Tuesday.",
      form: "news",
    });
    assert.equal(audit.findings.some((f) => f.code === "unearned-certainty"), false);
  });
});
