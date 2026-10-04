import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ungroundedDraftSpecifics } from "./draft-specifics.ts";
import { evidenceCheckRows } from "./evidence-check-list.ts";
import { claimsNeedingReview, reviewEvidenceCheckState } from "./evidence-check-state.ts";
import { storedGrounding } from "./finding-evidence-review.ts";

/**
 * Round 2, item 5: a draft may state a name, a number, a vote, a date or an
 * address only when something the check can read says it.
 *
 * THE FAILURE THESE PIN. The real-scan-dev council recap (dev draft 430) put
 * about nine specifics in its back half that appear in none of the sources the
 * desk could read -- among them two 2027 budget reading dates ("Nov. 17" and
 * "Dec. 1") that the readable recap does not give. The desk's evidence check ran
 * over the draft's RECORDED claims, and the writer had recorded none of these,
 * so the invention printed unmarked. One of the sixteen links, timescall.com,
 * refused to be fetched, so the desk cannot even say "no source has this" -- only
 * "no source the check could read has this", which is what the row says.
 *
 * These tests hold the three claims that fix it:
 *
 *   1. `ungroundedDraftSpecifics` reads a finished body against the text the
 *      writer was given and returns the specifics nothing carries -- and returns
 *      NOTHING for a body whose specifics are all in the source (the control that
 *      keeps it from flagging material the desk already has).
 *   2. Those rows reach the Checks pane as `! Needs review` rows, and the
 *      blocker's number counts them, so the number and the pane cannot disagree.
 *   3. `storedGrounding` reads the rows back from the draft's memo, and drops
 *      them when the body has moved since the measurement (a stale row names text
 *      nobody can see).
 */

/** The real body text of dev draft 430, trimmed to the paragraphs these tests read. */
const BODY_430 = [
  "Longmont's City Council approved the city's purchase of the YMCA building unanimously on Sept. 22, along with a lease that lets YMCA childcare keep operating in the building through June 4, 2027.",
  "",
  "The city is buying the building for about $4.5 million using Recreation Impact Fees — paid by developers, not taxes — and plans to turn it into a recreation center.",
  "",
  "On-bill financing passed first reading 5-2, with Crist and Prieto opposed.",
  "",
  "An airport hangar lease assignment passed its second and final reading 5-2, with McCoy and Marsing opposed. It transfers a private hangar lease at Vance Brand Airport to a new owner.",
  "",
  "The 2027 budget ordinances get first and second readings Nov. 17 and Dec. 1.",
].join("\n");

/**
 * The readable capture the desk had for that draft -- the Sept. 22 recap, its
 * supported front half. It deliberately does NOT carry the two reading dates, the
 * hangar's airport name, or the second and final reading of the hangar lease.
 */
const RECAP_430 = [
  "Longmont City Council Recap — September 22: The YMCA Purchase Passes",
  "Council approved the purchase of the former YMCA building for $4.5 million using Recreation Impact Fees paid by residential developers, not taxes. The city plans to convert it into a recreation center. The YMCA will lease part of the building for $5,000 a month to keep childcare running through June 4, 2027.",
  "On-bill financing passed first reading 5-2, with Crist and Prieto opposed.",
  "An airport hangar lease assignment passed 5-2, with McCoy and Marsing opposed.",
].join("\n\n");

const PLACE = { city: "Longmont", state: "Colorado", county: "Boulder" };

describe("item 5: ungrounded draft specifics", () => {
  it("flags the invented specifics of the 430 pattern and leaves the supported ones alone", () => {
    const rows = ungroundedDraftSpecifics({ body: BODY_430, sources: [RECAP_430], place: PLACE });
    const texts = rows.map((row) => row.text);
    /*
      The two 2027 budget reading dates are real-scan-dev's item 1 of the nine
      unsupported statements: the readable recap gives only "adoption likely
      delayed until after the election", never those dates.
    */
    assert.ok(texts.includes("Nov. 17"), `expected the Nov. 17 reading date, saw ${JSON.stringify(texts)}`);
    assert.ok(texts.includes("Dec. 1"), `expected the Dec. 1 reading date, saw ${JSON.stringify(texts)}`);
    /*
      "Vance Brand Airport" is the name the recap never gives -- the source has
      only "an airport hangar". A name the source did not use is an invention too.
    */
    assert.equal(
      rows.find((row) => row.text === "Vance Brand Airport")?.kind,
      "name",
      `expected the airport name to be flagged as a name, saw ${JSON.stringify(rows)}`,
    );
    /*
      THE CONTROL: the supported front half is untouched. $4.5 million, the 5-2
      votes and Crist, Prieto, McCoy and Marsing are all in the recap, and flagging
      them would fill the pane with rows an editor can do nothing about.
    */
    for (const supported of ["$4.5 million", "5-2", "Crist", "McCoy"]) {
      assert.ok(
        !texts.some((text) => text.toLowerCase().includes(supported.toLowerCase())),
        `${supported} is in the source and must not be flagged; saw ${JSON.stringify(texts)}`,
      );
    }
  });

  it("returns nothing when every specific is in the sources (no false positives)", () => {
    const rows = ungroundedDraftSpecifics({
      body: "The council approved the $4.5 million purchase on a 5-2 vote on Sept. 22, 2026.",
      sources: ["The council approved the $4.5 million purchase on a 5-2 vote on Sept. 22, 2026."],
      place: PLACE,
    });
    assert.deepEqual(rows, []);
  });

  it("does not read a URL path as an invented date or number", () => {
    const body =
      "The story is at https://www.timescall.com/2026/09/23/longmont-council-creates-technology-board/ and the date 2026/09/23 is in the path, not a fact.";
    const rows = ungroundedDraftSpecifics({ body, sources: ["nothing here"], place: PLACE });
    assert.deepEqual(rows, [], `a URL path must not be read as a specific; saw ${JSON.stringify(rows)}`);
  });

  it("reads a vote tally only when a vote word is near it", () => {
    const voted = ungroundedDraftSpecifics({
      body: "The hangar lease passed 5-2 on second reading.",
      sources: ["unrelated"],
      place: PLACE,
    });
    assert.deepEqual(
      voted.filter((row) => row.kind === "vote").map((row) => row.text),
      ["5-2"],
      "a tally beside a vote word is a vote",
    );
    const ranged = ungroundedDraftSpecifics({
      body: "The trail is open 5-2 for dogs on leashes.",
      sources: ["unrelated"],
      place: PLACE,
    });
    assert.deepEqual(
      ranged.filter((row) => row.kind === "vote"),
      [],
      "a bare range with no vote word is not a vote",
    );
  });

  it("grounds a date the source spells with a different spacing", () => {
    const rows = ungroundedDraftSpecifics({
      body: "The vote was 5-2 on Nov. 17.",
      sources: ["The council voted 5 – 2 on Nov 17."],
      place: PLACE,
    });
    assert.deepEqual(rows, [], `a spaced tally and an abbreviation must still ground; saw ${JSON.stringify(rows)}`);
  });
});

describe("item 5: the grounding rows reach the pane and the blocker", () => {
  it("draws each ungrounded specific as a ! Needs review row with no record to open", () => {
    const groundingRows = ungroundedDraftSpecifics({ body: BODY_430, sources: [RECAP_430], place: PLACE });
    const listRows = evidenceCheckRows({
      rows: [],
      claimRows: [],
      manualClaimRows: [],
      openClaims: [],
      nameCheck: null,
      styleFindings: [],
      groundingRows,
    });
    assert.equal(listRows.length, groundingRows.length);
    for (const row of listRows) {
      assert.equal(row.chip, "! Needs review", row.key);
      assert.equal(row.tone, "warn", row.key);
      /* Nothing to open: the source the writer should have had is not a capture. */
      assert.equal(row.action, null, row.key);
      assert.equal(row.ref, null, row.key);
      assert.match(row.note, /Not in any source the check could read/, row.key);
    }
  });

  it("counts them in the blocker so the number and the pane cannot disagree", () => {
    const groundingRows = ungroundedDraftSpecifics({ body: BODY_430, sources: [RECAP_430], place: PLACE });
    const review = { rows: [], claimRows: [], manualClaimRows: [], groundingRows };
    /*
      The tripwire the pane relies on: `claimsNeedingReview` over a review that
      carries grounding rows equals the count of `! Needs review` rows the pane
      draws from the same review.
    */
    const paneRows = evidenceCheckRows({
      rows: review.rows,
      claimRows: review.claimRows,
      manualClaimRows: review.manualClaimRows,
      openClaims: [],
      nameCheck: null,
      styleFindings: [],
      groundingRows: review.groundingRows,
    });
    const needsReview = paneRows.filter((row) => row.chip === "! Needs review").length;
    assert.equal(claimsNeedingReview(review.rows, review.claimRows, review.manualClaimRows, review.groundingRows), needsReview);
    assert.ok(needsReview > 0, "the 430 pattern must leave rows behind");
    /*
      And the run reads as having run: a draft whose only finding is an invented
      figure is the run's own output, exactly like a finding or an absence claim.
    */
    const state = reviewEvidenceCheckState({ review, recorded: false, openClaims: 0 });
    assert.equal(state.ran, true);
    assert.equal(state.toReview, needsReview);
  });

  it("leaves the pane and the count at zero when the writer invented nothing", () => {
    const review = { rows: [], claimRows: [], manualClaimRows: [], groundingRows: [] };
    const paneRows = evidenceCheckRows({
      rows: [],
      claimRows: [],
      manualClaimRows: [],
      openClaims: [],
      nameCheck: null,
      styleFindings: [],
      groundingRows: [],
    });
    assert.equal(paneRows.length, 0);
    assert.equal(claimsNeedingReview(review.rows, review.claimRows, review.manualClaimRows, review.groundingRows), 0);
    assert.equal(reviewEvidenceCheckState({ review, recorded: false, openClaims: 0 }).ran, false);
  });
});

describe("item 5: storedGrounding reads the rows back honestly", () => {
  const stored = (body: string, rows: { kind: string; text: string }[]) =>
    JSON.stringify({ draftGrounding: { version: 1, checkedText: body, rows } });

  it("returns the rows when the stored body is the draft's body", () => {
    const body = "The 2027 budget ordinances get first readings Nov. 17 and Dec. 1.";
    const draft = {
      body,
      research_json: stored(body, [
        { kind: "date", text: "Nov. 17" },
        { kind: "date", text: "Dec. 1" },
      ]),
    };
    assert.deepEqual(storedGrounding(draft), [
      { kind: "date", text: "Nov. 17" },
      { kind: "date", text: "Dec. 1" },
    ]);
  });

  it("drops the rows once the body has moved (an editor's edit)", () => {
    const measured = "The budget gets first readings Nov. 17 and Dec. 1.";
    const draft = {
      body: `${measured} EDITOR ADDED A SENTENCE.`,
      research_json: stored(measured, [{ kind: "date", text: "Nov. 17" }]),
    };
    assert.deepEqual(storedGrounding(draft), [], "a stale row names text nobody can see");
  });

  it("tolerates a draft with no grounding, or a malformed one", () => {
    assert.deepEqual(storedGrounding({ body: "x", research_json: "{}" }), []);
    assert.deepEqual(storedGrounding({ body: "x", research_json: null }), []);
    assert.deepEqual(storedGrounding({ body: "x", research_json: "not json" }), []);
    assert.deepEqual(
      storedGrounding({ body: "x", research_json: JSON.stringify({ draftGrounding: { version: 2 } }) }),
      [],
      "an unknown version is not read",
    );
    assert.deepEqual(
      storedGrounding({
        body: "x",
        research_json: stored("x", [{ kind: "banana", text: "y" }, { kind: "date", text: "" }]),
      }),
      [],
      "an unknown kind and an empty text are dropped",
    );
  });
});
