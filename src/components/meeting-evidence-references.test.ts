import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { citationResolution } from "./meeting-source-block-utils.ts";

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
});
