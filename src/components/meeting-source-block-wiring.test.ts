import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const route = fs.readFileSync(path.join(here, "../routes/desk.story.$leadId.tsx"), "utf8");
const block = fs.readFileSync(path.join(here, "meeting-source-block.tsx"), "utf8");

describe("meeting source block wiring", () => {
  it("renders meeting provenance before the empty-versus-filled notes branch", () => {
    const notesRoot = route.indexOf('<div className="notes" id="evidence-review">');
    const sourceBlock = route.indexOf("{meetingSourceBlock}", notesRoot);
    const notesBranch = route.indexOf("{!filled ? (", notesRoot);
    assert.ok(notesRoot >= 0 && sourceBlock > notesRoot, "the provenance block is rendered in the notes pane");
    assert.ok(sourceBlock < notesBranch, "filled reporting notes cannot hide meeting provenance");
    assert.equal(route.indexOf("{meetingSourceBlock}", sourceBlock + 1), -1, "the block has one render location");
  });

  it("links every persisted used citation to its own timestamp", () => {
    assert.match(block, /citations\.map\(\(c\)/);
    assert.match(block, /meetingCitationUrl\(videoId, c\.timestampSeconds\)/);
    assert.doesNotMatch(block, /citations\[0\].*timestampSeconds/);
  });

  it("shows old and current revision excerpts and wires redraft to the existing draft mutation", () => {
    assert.match(block, /Used by this draft \(artifact A\):/);
    assert.match(block, /const current = citation\.currentEvidence/);
    assert.match(block, /Current transcript \(artifact \{current\.artifactId\}/);
    assert.match(block, /Current transcript comparison unavailable:/);
    assert.doesNotMatch(block, /currentBySegment\s*=\s*new Map\(candidates/,
      "lead candidate excerpts must never be shown as the newer transcript");
    assert.match(block, /Redraft from current transcript/);
    assert.match(route, /onMeetingRedraft=.*draft\.mutate\(\)/);
    assert.match(route, /onRedraft=\{onMeetingRedraft\}/);
  });

  it("wires citation-only review to the current draft evidence token", () => {
    assert.match(block, /onReverify\?: \(review: \{ confirmedSegmentIndexes: number\[\]; note: string \}\) => void/);
    assert.match(block, /Save review against current transcript/);
    assert.match(route, /resolveDraftMeetingReview\(\{ data:/);
    assert.match(route, /acceptedArtifactId: data\.draftMeetingEvidence\.currentArtifactId/);
    assert.match(route, /onReverify=\{onReverifyMeetingCitations\}/);
    assert.match(route, /evidenceToken=\{evidenceToken\}/);
  });

  it("exposes prior draft bodies and A-to-B review records in an on-demand history panel", () => {
    assert.match(route, /Draft history and transcript revisions/);
    assert.match(route, /getDraftHistoryItem\(\{ data: \{ leadId, draftId: selectedDraftId! \} \}\)/);
    assert.match(route, /Original A segment .*accepted B segment/);
    assert.match(route, /Original transcript artifact/);
  });
});
