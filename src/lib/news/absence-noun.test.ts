import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { namedDocument, runAbsenceGate } from "./absence-gate.ts";

/**
 * Unit DD1, item 4 — the absence sentence named a non-document.
 *
 * The stand-in walkthrough of 2026-09-30 (`A2c-REPORT.md` §5.4) found the
 * drafted story saying, twice:
 *
 *   "TownReporter did not find **Report** among the documents it opened:
 *    Local Daycare closure linked to flurry of other abrupt closures across
 *    the country since Oct 2025, leaving families stranded."
 *
 * Three things are wrong with it and only one is cosmetic. "Report" is a bare
 * noun with no article, so the sentence does not parse. It is capitalised, so
 * it reads as the title of a document the desk went looking for. And the list
 * it is set against is a Reddit thread, so the sentence reads as though the
 * thread were the report it was looking for.
 */

const DOMAIN = "longmontcolorado.gov";
const CITY = "Longmont";

/** The sentence the model wrote, which the gate rewrote into the broken one. */
const SOURCE_SENTENCE = "No Report has been published about the closure of the centre.";
const REDDIT_TITLE =
  "Local Daycare closure linked to flurry of other abrupt closures across the country since Oct 2025, leaving families stranded.";

const findingNothing = async () => [{ url: `https://www.${DOMAIN}/survey`, title: "Rochester survey" }];

function base() {
  return {
    headline: "Kid City USA Longmont families report a one-week notice of closure",
    dek: "A Reddit account says the centre told parents it will close.",
    body: `${SOURCE_SENTENCE}\n\nStaff said nothing publicly.`,
    integrity_notes: "",
    unanswered: [] as string[],
    openedTitles: [REDDIT_TITLE],
    knownUrls: [] as string[],
    domains: [DOMAIN],
    city: CITY,
    paperName: "TownReporter",
    search: findingNothing,
    redraftAllowed: false,
  };
}

describe("DD1 item 4 — the absence sentence parses and does not misname the list", () => {
  it("writes a noun phrase, not the bare word Report", async () => {
    const out = await runAbsenceGate(base());
    assert.doesNotMatch(out.body, /did not find Report\b/, out.body);
    assert.match(
      out.body,
      /TownReporter did not find a report among the documents it opened: /,
      out.body,
    );
    // The list of what was opened is still there and still named.
    assert.match(out.body, /Local Daycare closure linked to flurry/);
  });

  it("does not present the opened thread as if it were the document searched for", async () => {
    const out = await runAbsenceGate(base());
    assert.doesNotMatch(
      out.body,
      /did not find (?:the |a )?Report among the documents it opened: Local Daycare/,
      out.body,
    );
  });

  it("keeps a named document phrase that already reads as one", async () => {
    const out = await runAbsenceGate({
      ...base(),
      body: "No city survey page confirming the closure was obtained for this piece.",
      openedTitles: ["Recycling ordinance"],
    });
    assert.match(out.body, /did not find a city survey page among the documents it opened: /, out.body);
  });

  it("still falls back to 'that document' when the sentence names none", async () => {
    assert.equal(namedDocument("Staff said nothing publicly."), null);
    // A sentence that claims an absence without naming a document at all --
    // "unverified" is a trigger, and there is no noun to carry.
    const out = await runAbsenceGate({ ...base(), body: "The closure date remains unverified." });
    assert.match(out.body, /did not find that document among the documents it opened/);
  });

  it("says the same phrase in the editor's check line", async () => {
    const out = await runAbsenceGate(base());
    assert.doesNotMatch(out.integrity_notes, /the story says Report\b/, out.integrity_notes);
    assert.match(out.integrity_notes, /the story says a report was not found/);
  });
});
