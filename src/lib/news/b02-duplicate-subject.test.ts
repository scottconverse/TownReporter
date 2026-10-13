import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchStrength, type NewsroomPlace } from "./lead-match.ts";
import { duplicateLinkState, printedDupChip, STALE_DUPLICATE_LABEL } from "./desk-copy.ts";

/**
 * B02 (2026-10-13): a lead was filed as a duplicate over a shared TOWN and a
 * shared section, with nothing else in common.
 *
 * The owner's walk: St. Vrain Valley Schools' open house dates came in
 * flagged "possible duplicate of" a City Council study session, and the same
 * school lead was chipped "Looks already printed" against a Head Start story
 * -- three different stories, one town. Opening Compare, the page itself said
 * "The saved link does not match the current story evidence", and the Queue
 * went on drawing the row as a duplicate anyway.
 *
 * These assertions are the behaviour, not the wording:
 *
 *   1. Red on the old code: `printedDupChip` returned a chip for the school
 *      open house vs the Head Start story. The old rule's last arm was
 *      `sameTopic && names >= 2`, and "vrain valley" is two shared names.
 *   2. Red on the old code: the Queue called a saved link that this page's own
 *      check already refused a duplicate. `duplicateLinkState` did not exist;
 *      the row drew "Possible duplicate · compare".
 *   3. Green both before and after, pinned so the fix cannot be "match
 *      nothing": two leads about the same garage are still a pair.
 */

const PLACE: NewsroomPlace = { city: "Longmont", state: "Colorado", county: "Boulder" };

/* The two rows the editor was looking at, verbatim from the desk screenshots. */
const OPEN_HOUSE =
  "St. Vrain Valley Schools Schedules 2026 Open House Dates";
const COUNCIL_SESSION =
  "City Council Study Session on Housing and Development";
const HEAD_START =
  "Wild Plum Center Holds Head Start Designation for St. Vrain Valley, Serving Low-Income Children Birth to 5";
const HEAD_START_URL =
  "https://example.org/wild-plum-head-start-designation/";

/* Two tellings of one story: the same named building, the same work, the same
 * numbers -- a shared subject ("garage"/"parking") under a shared name. */
const GARAGE_1 =
  "Safety & Justice Center parking garage under construction; spaces to rise from 45 to 87";
const GARAGE_2 =
  "Safety and Justice Center garage construction is set to increase public parking from 45 to 87 spaces";

describe("B02: a duplicate needs a shared subject, not just the town", () => {
  it("does not chip the school open house as already printed against the Head Start story", () => {
    const chip = printedDupChip(
      { headline: OPEN_HOUSE, topic: "schools" },
      [
        {
          slug: "wild-plum-head-start",
          headline: HEAD_START,
          topic: "schools",
          published_at: new Date().toISOString(),
          source_urls: HEAD_START_URL,
        } as never,
      ],
      PLACE,
    );
    assert.equal(chip, null);
  });

  it("does not file the school open house as a match for the council session", () => {
    assert.equal(
      matchStrength(
        { headline: OPEN_HOUSE, topic: "schools", source_urls: [] },
        { headline: COUNCIL_SESSION, topic: "government", source_urls: [] },
        PLACE,
      ),
      null,
    );
  });

  it("keeps the two garage-stories a match: same building, same work", () => {
    assert.equal(
      matchStrength(
        { headline: GARAGE_1, topic: "infrastructure", source_urls: [] },
        { headline: GARAGE_2, topic: "infrastructure", source_urls: [] },
        PLACE,
      ),
      "possible",
    );
  });
});

describe("B02: a saved link this page's own check refuses is not shown as a duplicate", () => {
  it("calls the school-vs-council saved link stale", () => {
    const state = duplicateLinkState(
      { headline: OPEN_HOUSE, topic: "schools", source_urls: "[]" },
      { headline: COUNCIL_SESSION, topic: "government", source_urls: "[]" },
      PLACE,
    );
    assert.equal(state, "stale");
    assert.equal(STALE_DUPLICATE_LABEL, "Saved link no longer matches");
  });

  it("leaves the two garage leads alone -- a link that still holds reads as it does today", () => {
    assert.equal(
      duplicateLinkState(
        { headline: GARAGE_1, topic: "government", source_urls: "[]" },
        { headline: GARAGE_2, topic: "government", source_urls: "[]" },
        PLACE,
      ),
      "matches",
    );
  });

  it("never clears a link the desk filed to carry new facts against a killed lead", () => {
    assert.equal(
      duplicateLinkState(
        { headline: OPEN_HOUSE, topic: "schools", source_urls: "[]", dup_kind: "developing" },
        { headline: COUNCIL_SESSION, topic: "government", source_urls: "[]" },
        PLACE,
      ),
      "matches",
    );
  });
});

