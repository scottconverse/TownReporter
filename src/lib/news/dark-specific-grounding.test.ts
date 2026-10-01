import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UNGROUNDED_MARKER,
  findSpecifics,
  groundPlan,
  markUngroundedSpecifics,
  prepareCorpus,
  queryNamesUngroundedSpecific,
  ungroundedSpecifics,
} from "./dark-specific-grounding.ts";
import { emptyPlan, type HopPlan } from "./investigate.ts";

/**
 * Unit DD1, item 1 — the dig invented an address.
 *
 * The stand-in walkthrough of 2026-09-30 (`A2c-REPORT.md` §5.2) found the case
 * file, the run record, two "STILL OPEN" questions, a "BEING TESTED" scenario
 * and two searches all naming **1749 Main Street, Longmont**. No capture in the
 * file contained "1749": the Reddit post, the quoted closure letter and the
 * Colorado Shines licensing record all say **1941 Terry Street**. An editor
 * following "DO THIS NEXT" would have gone to the wrong parcel.
 *
 * The fixtures below are that case. `CAPTURES` is what the file actually held;
 * `LEAD` is the resident's own post, which is ground truth too.
 */

const LEAD =
  "r/longmont: Kid City USA Longmont said to close permanently Oct. 2, 2026. " +
  "The letter left at 1941 Terry Street gave families one week's notice.";

const CAPTURES = [
  "COLORADO SHINES PROGRAM DETAIL — Kid City USA Longmont. License Number: 1770463. " +
    "1941 Terry St, Longmont, CO 80501. Licensed to Serve: Infants, Preschool, Toddlers. " +
    "A recommendation for probation was dated July 30, 2026; no final outcome is listed.",
  "KCTV5 — Dozens of families at Kid City USA on Swann Road, Lee's Summit, Missouri learned " +
    "the facility will close permanently Friday, giving them less than 48 hours' notice. " +
    "Questions were sent to Kid City USA CEO Audrey Bruner.",
];

const CORPUS = [LEAD, ...CAPTURES].join("\n\n");

const invented =
  "The facility at 1749 Main Street transitioned from a prior operator; " +
  "the licence record for 1941 Terry Street is the one that settles it.";

describe("DD1 item 1 — an invented specific never enters durable state unmarked", () => {
  it("finds the address the plan invented and the address the captures carry", () => {
    const found = findSpecifics(invented).map((s) => s.text);
    assert.ok(found.includes("1749 Main Street"), `did not read the address: ${found.join(" | ")}`);
    assert.ok(found.includes("1941 Terry Street"), `did not read the grounded address: ${found.join(" | ")}`);
  });

  it("marks the invented address and leaves the captured one alone", () => {
    const marked = markUngroundedSpecifics(invented, CORPUS);
    assert.match(
      marked,
      /1749 Main Street \(not in any capture yet\)/,
      "the invented address was not marked",
    );
    assert.match(marked, /1941 Terry Street is the one/, "the captured address was disturbed");
    assert.equal(
      ungroundedSpecifics(invented, CORPUS).filter((s) => /1749/.test(s.text)).length,
      1,
      "the invented address was not reported",
    );
  });

  it("leaves a fully grounded sentence byte-for-byte unchanged", () => {
    const grounded =
      "The Colorado Shines record for 1941 Terry Street lists licence 1770463 and a " +
      "recommendation for probation dated July 30, 2026.";
    assert.equal(markUngroundedSpecifics(grounded, CORPUS), grounded);
    assert.deepEqual(ungroundedSpecifics(grounded, CORPUS), []);
  });

  it("grounds through the way each source writes the street suffix", () => {
    // The capture says "1941 Terry St"; the plan writes "1941 Terry Street".
    assert.equal(ungroundedSpecifics("The centre at 1941 Terry Street", CORPUS).length, 0);
    // And the other way round.
    assert.equal(ungroundedSpecifics("The centre at 1941 Terry St", CORPUS).length, 0);
  });

  it("refuses a query that names a specific no capture carries", () => {
    const reason = queryNamesUngroundedSpecific(
      "Kid City USA Longmont 1749 Main Street lease termination eviction Boulder County court",
      CORPUS,
    );
    assert.ok(reason, "the invented address was allowed as a search term");
    assert.match(reason!, /1749 Main Street/);
  });

  it("allows a query built from what the captures say", () => {
    assert.equal(
      queryNamesUngroundedSpecific(
        "Kid City USA Longmont 1941 Terry Street license 1770463 status",
        CORPUS,
      ),
      null,
    );
  });

  it("marks an invented amount, date and licence number, and keeps grounded ones", () => {
    const text =
      "The centre owes $412,000 in back rent from March 3, 2027 under docket 2027-CV-99, " +
      "while the licence 1770463 was recommended for probation on July 30, 2026.";
    const marked = markUngroundedSpecifics(text, CORPUS);
    assert.match(marked, /\$412,000 \(not in any capture yet\)/);
    assert.match(marked, /March 3, 2027 \(not in any capture yet\)/);
    assert.match(marked, /2027-CV-99 \(not in any capture yet\)/);
    assert.match(marked, /licence 1770463 was recommended/, "a grounded licence was disturbed");
    assert.match(marked, /July 30, 2026\./, "a grounded date was disturbed");
  });

  it("marks a person no capture names, and leaves a named one alone", () => {
    const marked = markUngroundedSpecifics(
      "Audrey Bruner signed it; the landlord was Gregory P. Halloran.",
      CORPUS,
    );
    assert.match(marked, /Audrey Bruner signed/, "a captured name was disturbed");
    assert.match(marked, /Gregory P\. Halloran \(not in any capture yet\)/);
  });
});

function planWith(frontierLabel: string, query: string, hypothesis: string): HopPlan {
  const plan = emptyPlan();
  plan.summary = `Hop complete. The facility at ${frontierLabel} is the one to check.`;
  plan.questions = [`Who owns the property at ${frontierLabel}, Longmont, and what are the lease terms?`];
  plan.searches = [query];
  plan.hypotheses.push({ text: hypothesis, supporting: "", contradicting: "" });
  plan.frontier.push({
    label: frontierLabel,
    kind: "lead",
    why: `Investigate the property at ${frontierLabel}`,
    priority: 9,
    queries: [query],
  });
  return plan;
}

describe("DD1 item 1 — groundPlan holds the whole hop before it is written down", () => {
  const inventedPlan = planWith(
    "1749 Main Street",
    "Kid City USA Longmont 1749 Main Street lease termination eviction Boulder County court",
    "The operator at 1749 Main Street is a different entity from the licensee.",
  );

  const grounded = groundPlan(inventedPlan, CORPUS).plan;

  it("carries no unmarked 1749 Main Street anywhere in the hop", () => {
    const blob = JSON.stringify({
      summary: grounded.summary,
      questions: grounded.questions,
      searches: grounded.searches,
      hypotheses: grounded.hypotheses,
      frontier: grounded.frontier,
    });
    const unmarked = [
      ...blob.matchAll(/1749 Main Street(?! \(not in any capture yet\))/g),
    ];
    assert.equal(unmarked.length, 0, `unmarked invented address in: ${blob}`);
    assert.ok(blob.includes("1749 Main Street"), "the fixture stopped containing the address");
  });

  it("drops the planned search that named the invented address", () => {
    assert.deepEqual(grounded.searches, []);
    assert.deepEqual(grounded.frontier[0]?.queries ?? [], []);
  });

  it("keeps a hop that only names what the captures say, unchanged", () => {
    const good = planWith(
      "1941 Terry Street",
      "Kid City USA Longmont 1941 Terry Street license 1770463 status",
      "The licensee at 1941 Terry Street is Kid City USA.",
    );
    const out = groundPlan(good, CORPUS).plan;
    assert.deepEqual(out.searches, good.searches);
    assert.deepEqual(out.questions, good.questions);
    assert.equal(out.summary, good.summary);
    assert.deepEqual(out.frontier[0], good.frontier[0]);
  });

  it("names the marker the editor will read", () => {
    assert.equal(UNGROUNDED_MARKER, "(not in any capture yet)");
  });
});

/*
  The rule must not launder itself. A marked specific is one no capture
  carries, and the file's own summary, hypotheses and frontier items are what a
  later hop reads back -- so the marked form has to be taken out of the corpus
  whole, or "1749 Main Street (not in any capture yet)" would ground "1749 Main
  Street" one hop later and the mark would be a delay rather than a refusal.
*/
describe("DD1 item 1 — a marked specific cannot ground itself on the next hop", () => {
  const marked = `The facility at 1749 Main Street ${UNGROUNDED_MARKER} transitioned from a prior operator.`;

  it("does not read the marked form as evidence for the thing it marks", () => {
    assert.equal(ungroundedSpecifics("The property at 1749 Main Street", marked).length, 1);
    assert.equal(ungroundedSpecifics("The property at 1749 Main Street", prepareCorpus(marked)).length, 1);
  });

  it("still grounds what the same sentence says about the real address", () => {
    const corpus = `${marked}\n\nCOLORADO SHINES: 1941 Terry St, Longmont, CO 80501.`;
    assert.equal(ungroundedSpecifics("The centre at 1941 Terry Street", corpus).length, 0);
  });

  it("marks a specific twice over into one marker, not two", () => {
    const once = markUngroundedSpecifics(marked, "1941 Terry Street only.");
    const twice = markUngroundedSpecifics(once, "1941 Terry Street only.");
    assert.equal(twice, once, "marking is not idempotent");
  });
});
