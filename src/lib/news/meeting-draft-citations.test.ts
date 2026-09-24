import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { citationWasUsed, deriveFocusedUsedCitations, deriveUsedCitations, type CandidateCitation } from "./meeting-draft-citations.ts";

/**
 * The rule the whole design rests on: citations are derived from what the draft
 * says, never inherited. A redraft is a new draft and gets a new derivation, so
 * the link table describes the draft rather than the material available to it.
 */
const used: CandidateCitation = {
  item: "9",
  segmentIndex: 4612,
  captionSha256: "aaa",
  excerpt: "the council approved ordinance 2026-46 on a six to one vote",
};

const unused: CandidateCitation = {
  item: "5",
  segmentIndex: 1258,
  captionSha256: "bbb",
  excerpt: "the manager discussed downtown parking permits and signage",
};

describe("meeting draft citation derivation", () => {
  it("keeps a citation the draft actually quotes", () => {
    const text = "Council approved ordinance 2026-46 on a six to one vote Tuesday.";
    assert.equal(citationWasUsed(used, text), true);
  });

  it("drops a citation the draft never touched", () => {
    /*
      This is the redraft case. The new draft is about the ordinance; the parking
      passage was available but unused. Carrying it over would make the draft
      appear to cite the tape for something it never said.
    */
    const text = "Council approved ordinance 2026-46 on a six to one vote Tuesday.";
    assert.equal(citationWasUsed(unused, text), false);
  });

  it("does not match on shared vocabulary alone", () => {
    // The draft mentions an ordinance; the parking passage is still not used.
    const text = "An ordinance about downtown was introduced, with votes expected.";
    assert.equal(citationWasUsed(unused, text), false, "sharing topic words is not a citation");
  });

  it("keeps a genuinely used long passage even when paraphrased", () => {
    const long: CandidateCitation = {
      item: "3", segmentIndex: 40, captionSha256: "ccc",
      excerpt: "the applicant presented revised landscaping plans along the western boundary and requested approval of the amended site development plan",
    };
    const text = "The applicant presented revised landscaping plans along the western boundary and asked the commission to approve the amended site development plan.";
    assert.equal(citationWasUsed(long, text), true);
  });

  it("does not claim a citation from a three-word excerpt with no substance", () => {
    const thin: CandidateCitation = { item: "1", segmentIndex: 2, captionSha256: "d", excerpt: "yes we do" };
    assert.equal(citationWasUsed(thin, "The vote was yes we do."), false);
  });

  it("derives only the used citations, in link-writer shape", () => {
    const derived = deriveUsedCitations({
      candidates: [used, unused],
      headline: "Council approves ordinance 2026-46",
      dek: "The vote was six to one.",
      body: "Council approved ordinance 2026-46 on a six to one vote Tuesday evening.",
    });
    assert.equal(derived.length, 1, "only the used passage is linked");
    assert.deepEqual(derived[0], { segmentIndex: 4612, captionSha256: "aaa" });
  });

  it("derives nothing when the draft uses no transcript material", () => {
    const derived = deriveUsedCitations({
      candidates: [used, unused],
      headline: "A note about the meeting",
      dek: "",
      body: "The council met on Tuesday.",
    });
    assert.deepEqual(derived, [], "no citations means no link row is written");
  });

  it("links a paraphrase whose evidence spans adjacent caption fragments", () => {
    const candidates: CandidateCitation[] = [
      { item: "9", segmentIndex: 100, captionSha256: "tape", excerpt: "the applicant requested" },
      { item: "9", segmentIndex: 101, captionSha256: "tape", excerpt: "approval to reduce the garage setback" },
      { item: "9", segmentIndex: 102, captionSha256: "tape", excerpt: "to zero feet along the western property line" },
      { item: "9", segmentIndex: 103, captionSha256: "tape", excerpt: "subject to a complete parcel survey" },
    ];
    const derived = deriveUsedCitations({
      candidates,
      headline: "Commission approves garage variance",
      dek: "A zero-foot setback was approved.",
      body: "The commission approved a garage setback reduction to zero feet along the western property line, conditioned on a complete parcel survey.",
    });
    assert.ok(derived.length >= 2, "the supporting span is linked even though each fragment is too small alone");
    assert.ok(derived.every((citation) => citation.captionSha256 === "tape"));
  });

  it("does not link an unrelated nearby passage merely because it is from the same meeting", () => {
    const candidates: CandidateCitation[] = [
      { item: "5", segmentIndex: 200, captionSha256: "tape", excerpt: "parking permit prices downtown" },
      { item: "5", segmentIndex: 201, captionSha256: "tape", excerpt: "new signs and meter maintenance" },
      { item: "5", segmentIndex: 202, captionSha256: "tape", excerpt: "garage enforcement begins Monday" },
    ];
    const derived = deriveUsedCitations({
      candidates,
      headline: "Commission approves a residential variance",
      dek: "A setback was reduced.",
      body: "The applicant must submit a parcel survey before receiving the permit.",
    });
    assert.deepEqual(derived, [], "same-meeting proximity is not evidence that the draft used the passage");
  });

  it("limits focused citations to writer-visible segments and keeps an asserted short vote outcome anchor", () => {
    const candidates: CandidateCitation[] = [
      { item: "4", segmentIndex: 529, captionSha256: "focus", excerpt: "Motion to revive marijuana hospitality ordinance amendments" },
      { item: "4", segmentIndex: 530, captionSha256: "vote", excerpt: "carries four to three" },
      { item: "8", segmentIndex: 610, captionSha256: "unrelated", excerpt: "Dry Creek annexation traffic condition failed three to four" },
    ];
    const derived = deriveFocusedUsedCitations({
      candidates,
      visibleSegmentIndexes: [529, 530],
      anchorSegmentIndexes: [530, 610],
      headline: "Council revives marijuana hospitality licensing rules",
      dek: "The motion passed 4-3.",
      body: "Council revived marijuana hospitality ordinance amendments after a 4-3 vote.",
    });
    assert.deepEqual(derived.map((citation) => citation.segmentIndex), [529, 530]);
    assert.ok(derived.every((citation) => citation.captionSha256 !== "unrelated"));
  });

  it("does not cite tape when the draft makes no transcript-derived claim", () => {
    const candidates: CandidateCitation[] = [
      { item: "4", segmentIndex: 529, captionSha256: "focus", excerpt: "Motion to revive marijuana hospitality ordinance amendments" },
      { item: "4", segmentIndex: 530, captionSha256: "vote", excerpt: "carries four to three" },
    ];
    const derived = deriveFocusedUsedCitations({
      candidates,
      visibleSegmentIndexes: [529, 530],
      anchorSegmentIndexes: [530],
      headline: "Council meeting recap",
      dek: "Officials met Tuesday.",
      body: "Council discussed several issues during the regular meeting.",
    });
    assert.deepEqual(derived, []);
  });

  it("never promotes a validated anchor that was absent from the writer evidence", () => {
    const derived = deriveFocusedUsedCitations({
      candidates: [{ item: "4", segmentIndex: 530, captionSha256: "vote", excerpt: "carries four to three" }],
      visibleSegmentIndexes: [],
      anchorSegmentIndexes: [530],
      headline: "Council motion passes 4-3",
      dek: "",
      body: "The marijuana hospitality motion passed 4-3.",
    });
    assert.deepEqual(derived, []);
  });

  it("prioritizes a distant carried-vote anchor and strong middle quote while excluding pre-focus minutes", () => {
    const candidates: CandidateCitation[] = [
      ...Array.from({ length: 64 }, (_, offset) => ({
        item: "4",
        segmentIndex: 106 + offset,
        captionSha256: "minutes",
        excerpt: offset % 3 === 0 ? "Council motion to approve amended minutes" : "The motion was made and seconded before approval.",
      })),
      { item: "4", segmentIndex: 182, captionSha256: "minutes", excerpt: "The minutes are approved as amended." },
      { item: "4", segmentIndex: 197, captionSha256: "focus", excerpt: "Council directs staff to revive marijuana hospitality ordinance" },
      { item: "4", segmentIndex: 200, captionSha256: "focus", excerpt: "Retail sales licenses should be prioritized" },
      { item: "4", segmentIndex: 205, captionSha256: "focus", excerpt: "Marijuana business licenses could add city revenue" },
      { item: "4", segmentIndex: 330, captionSha256: "middle-quote", excerpt: "lean on the work that staff has already done" },
      { item: "4", segmentIndex: 529, captionSha256: "vote", excerpt: "Okay. And that carries four to three." },
      { item: "4", segmentIndex: 530, captionSha256: "vote", excerpt: "The motion will direct staff to bring it back." },
      { item: "4", segmentIndex: 531, captionSha256: "vote", excerpt: "Marijuana hospitality ordinance, four to three." },
    ];
    const derived = deriveFocusedUsedCitations({
      candidates,
      visibleSegmentIndexes: candidates.map((candidate) => candidate.segmentIndex),
      anchorSegmentIndexes: [197, 200, 205, 529, 530, 531],
      headline: "Council votes 4-3 to revive marijuana hospitality ordinance",
      dek: "The council voted 4-3 to direct staff to return the proposal.",
      body: "Council voted 4-3 on Sept. 22 to direct staff to bring back the marijuana hospitality ordinance, prioritizing retail sales licenses. Martin said the motion would \"lean on the work that staff has already done.\"",
    });
    const indexes = derived.map((citation) => citation.segmentIndex);
    assert.ok(indexes.includes(529), "the explicit carried-vote segment must be cited");
    assert.ok(indexes.includes(330), "a strong verbatim match from the middle of the focused item should survive the cap");
    assert.ok(indexes.every((index) => index >= 195), "minutes before the selected motion must not be linked");
    assert.ok(indexes.length <= 20);
  });

  it("does not treat a tally alone as proof that a motion carried", () => {
    const derived = deriveFocusedUsedCitations({
      candidates: [{ item: "4", segmentIndex: 529, captionSha256: "vote", excerpt: "Okay. And that carries four to three." }],
      visibleSegmentIndexes: [529],
      anchorSegmentIndexes: [529],
      headline: "Council's marijuana licensing vote was 4-3",
      dek: "",
      body: "Council voted 4-3 on the marijuana licensing proposal, but the available record does not establish the motion's result.",
    });
    assert.deepEqual(derived, [], "without a result assertion, the carried anchor is not used");
  });

  it("stops same-item citations when the transcript moves to a different ordinance", () => {
    const candidates: CandidateCitation[] = [
      { item: "4", segmentIndex: 1248, captionSha256: "target", excerpt: "matter. um ordinance um 2026-57," },
      { item: "4", segmentIndex: 1275, captionSha256: "target-vote", excerpt: "Okay, and that carries unanimously." },
      { item: "4", segmentIndex: 1277, captionSha256: "next-ordinance", excerpt: "item B, ordinance 2026-58," },
      { item: "4", segmentIndex: 1278, captionSha256: "next-ordinance", excerpt: "a bill for an ordinance amending title" },
      { item: "4", segmentIndex: 1279, captionSha256: "next-ordinance", excerpt: "two of the Longmont Municipal Code" },
      { item: "4", segmentIndex: 1281, captionSha256: "next-ordinance", excerpt: "advisory board. Are there any questions" },
      { item: "4", segmentIndex: 1283, captionSha256: "next-ordinance", excerpt: "now open the public hearing on ordinance" },
      { item: "4", segmentIndex: 1291, captionSha256: "next-ordinance", excerpt: "a tossup between whether I should talk" },
      { item: "4", segmentIndex: 1293, captionSha256: "next-ordinance", excerpt: "in open uh public." },
      { item: "4", segmentIndex: 1295, captionSha256: "next-ordinance", excerpt: "Well, I have a specific request for council" },
      { item: "4", segmentIndex: 1412, captionSha256: "later-agenda", excerpt: "motion to pass and adopt ordinance" },
    ];
    const derived = deriveFocusedUsedCitations({
      candidates,
      visibleSegmentIndexes: candidates.map((candidate) => candidate.segmentIndex),
      anchorSegmentIndexes: [1248, 1275],
      headline: "Council unanimously adopts supplemental FY2026 appropriations ordinance",
      dek: "Ordinance 2026-57 passed on second reading with no public hearing testimony and no council questions.",
      body: "Longmont City Council unanimously adopted Ordinance 2026-57 on September 22, 2026, authorizing additional city appropriations for expenses and liabilities in the fiscal year that began January 1, 2026. A motion to pass and adopt the ordinance was made and seconded. The presiding officer confirmed the motion carried unanimously.",
    });

    const indexes = derived.map((citation) => citation.segmentIndex);
    assert.ok(indexes.includes(1248), "the selected ordinance passage remains cited");
    assert.ok(indexes.includes(1275), "the selected ordinance's later vote result remains cited");
    assert.ok(indexes.every((index) => index < 1277), "the next numbered ordinance starts a hard citation boundary");
    assert.ok(!indexes.includes(1412), "a later agenda motion cannot re-enter the earlier story's citations");
  });
});

