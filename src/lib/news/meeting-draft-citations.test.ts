import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { citationWasUsed, deriveUsedCitations, type CandidateCitation } from "./meeting-draft-citations.ts";

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
});

