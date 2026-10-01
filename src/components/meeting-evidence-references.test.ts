import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { citationResolution } from "./meeting-source-block-utils.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const panel = fs.readFileSync(path.join(here, "finding-evidence-review.tsx"), "utf8");
const route = fs.readFileSync(path.join(here, "../routes/desk.story.$leadId.tsx"), "utf8");

const noNewer = { artifactId: 9, currentArtifactId: null, newerTranscriptExists: false };
const withNewer = { artifactId: 9, currentArtifactId: 14, newerTranscriptExists: true };

/**
 * "Claims & evidence" on a meeting story.
 *
 * The button at desk.story.$leadId.tsx jumps to #finding-evidence-review, which
 * reviews URL-receipt claims. A draft written from YouTube captions has none --
 * its `source_urls` is empty and its evidence is segment indexes into a
 * transcript -- so the editor pressed the button and landed on an empty panel.
 * These are the two things that must hold instead: the citations are shown, and
 * "no citations" is said in words rather than left blank.
 */
describe("meeting citation evidence in the claims panel", () => {
  it("says a citation still resolves, or does not, from the data the notes already carry", () => {
    // Written from the current artifact: the citation IS the record.
    assert.match(
      citationResolution(noNewer, { currentEvidence: null }),
      /Resolves against artifact 9/,
    );
    // A newer capture that contains the passage.
    assert.match(
      citationResolution(withNewer, {
        currentEvidence: {
          artifactId: 14,
          artifactSha256: "a".repeat(64),
          segmentIndex: 3,
          timestampSeconds: 3725,
          excerpt: "the motion carries",
          captionSha256: "b".repeat(64),
        },
      }),
      /Still resolves in the current transcript \(artifact 14\) at 01:02:05\./,
    );
    // A newer capture that does not: the one state an editor must act on.
    assert.match(
      citationResolution(withNewer, { currentEvidence: null }),
      /No longer resolves: no matching passage was found in the current transcript \(artifact 14\)/,
    );
  });

  it("renders each citation with its excerpt, its timestamp link and its state", () => {
    assert.match(panel, /meetingCitationUrl\(videoId, citation\.timestampSeconds\)/);
    assert.match(panel, /meetingClock\(citation\.timestampSeconds\)/);
    assert.match(panel, /\{citation\.excerpt\}/);
    assert.match(panel, /citationResolution\(evidence, citation\)/);
    // The door to the whole tape, from the address the button promises.
    assert.match(panel, /transcriptViewPath\(evidence\.artifactId\)/);
  });

  it("is wired to the draft's own evidence, not a second read of the tape", () => {
    assert.match(route, /meetingEvidence=\{data\.draftMeetingEvidence\}/);
    assert.match(panel, /meetingEvidence\?: DraftMeetingEvidence \| null/);
  });

  it("says in one plain sentence when there is neither a finding nor a citation", () => {
    assert.match(panel, /no recorded findings and no transcript citations/);
    /*
      FB6 item 8b (A2c-REPORT.md §6 C5). This condition used to be
      `review.rows.length === 0` -- the REVIEW's rows -- while the list printed
      directly under the sentence is built by `evidenceCheckRows` from the
      review AND from the three rows the page holds itself (claims of absence,
      names, style). Any of those can carry "! Needs review" with the review
      empty, and that is exactly what the stand-in walkthrough photographed:
      "there is nothing to review here" above "Evidence check ! Needs review".
      The condition is the LIST's length now, so the sentence and the list it
      sits above cannot disagree.
    */
    assert.match(panel, /review && listRows\.length === 0 && !meetingEvidence/);
    assert.doesNotMatch(
      panel,
      /review\.rows\.length === 0 && !meetingEvidence/,
      "the pane is denying in one line what the row below it asserts in the next",
    );
  });
});
