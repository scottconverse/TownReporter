import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

describe("meeting section 5 spoken-transition alignment (Finding A)", () => {
  it("matches real spoken transcript transitions, not title words", async () => {
    const { chunkByAgendaItem } = await import("./meeting-story-section5.ts");
    const segments = [
      { segmentIndex: 0, startSeconds: 400, endSeconds: 404, excerpt: "here tonight to speak on agenda item 9C", captionSha256: "h" },
      { segmentIndex: 1, startSeconds: 5200, endSeconds: 5204, excerpt: "Item 9B2 is ordinance 2026-47,", captionSha256: "h" },
      { segmentIndex: 2, startSeconds: 5210, endSeconds: 5214, excerpt: "Item 9 C is ordinance 2026-48,", captionSha256: "h" },
      { segmentIndex: 3, startSeconds: 5220, endSeconds: 5224, excerpt: "Item 9D, resolution 2026-43,", captionSha256: "h" },
      { segmentIndex: 4, startSeconds: 9000, endSeconds: 9004, excerpt: "to the next item.", captionSha256: "h" },
    ];
    const packetItems = [
      { itemNumber: "9C", title: "Ordinance 2026-48" },
      { itemNumber: "9D", title: "Resolution 2026-43" },
    ];
    const chunks = chunkByAgendaItem({ segments, packetItems });
    assert.ok(chunks.length >= 1, "spoken transitions must produce chunks");
    const c = chunks.find((x) => x.item === "9D");
    assert.ok(c, "matched item 9D from spoken transition");
    assert.ok(c!.segmentIndexes.includes(3));
  });

  it("still aligns using ordinance and resolution identifiers", async () => {
    const { chunkByAgendaItem } = await import("./meeting-story-section5.ts");
    const chunks = chunkByAgendaItem({
      segments: [{ segmentIndex: 0, startSeconds: 10, endSeconds: 14, excerpt: "Item 9B2 is ordinance 2026-47,", captionSha256: "h" }],
      packetItems: [{ itemNumber: "9B2", title: "Ordinance 2026-47" }],
    });
    assert.equal(chunks.length, 1);
  });

  it("honest failure: no spoken transition means no chunks and aligned false", async () => {
    const { chunkByAgendaItem, alignMeeting } = await import("./meeting-story-section5.ts");
    const segments = [{ segmentIndex: 0, startSeconds: 0, endSeconds: 4, excerpt: "we call the meeting to order", captionSha256: "h" }];
    const packetItems = [{ itemNumber: "1", title: "MEETING CALLED TO ORDER" }];
    const chunks = chunkByAgendaItem({ segments, packetItems });
    const alignment = alignMeeting({ segments, chunks, packetItems });
    assert.equal(chunks.length, 0);
    assert.equal(alignment.aligned, false);
  });

  it("has a real-transcript fixture recorded", () => {
    const fixture = new URL("./__fixtures__/longmont-transitions.json", import.meta.url);
    assert.equal(existsSync(fixture), true, "real transition fixture must exist");
    const data = JSON.parse(readFileSync(fixture, "utf8"));
    assert.ok(Array.isArray(data.transitions) && data.transitions.length >= 3);
  });
});

describe("meeting section 5 real vote source adapter (Finding B)", () => {
  it("extracts structured votes from a longmontcitycouncil.org meeting page", async () => {
    const { parseStructuredVotePage } = await import("./meeting-vote-sources.ts");
    const html = `<span class="ord-num">R-2026-44</span> <span class="badge badge-passed">Passed</span> <p>Matthew Popkin moved, seconded by Sean McCoy, to approve R-2026-44</p> <span class="tally-yes">7</span> <span class="tally-no">0</span>`;
    const votes = parseStructuredVotePage(html);
    assert.equal(votes.length, 1);
    assert.equal(votes[0]?.item, "R-2026-44");
    assert.equal(votes[0]?.tally, "7-0");
    assert.equal(votes[0]?.mover, "Matthew Popkin");
    assert.equal(votes[0]?.result, "Passed");
    assert.equal(votes[0]?.source, "longmontcitycouncil.org");
  });

  it("records an explicit per-source availability reason instead of a silent null", async () => {
    const { voteSourceAvailability } = await import("./meeting-vote-sources.ts");
    const availability = voteSourceAvailability({ structuredRecordFound: false, minutesFound: false, packetFound: false, transcriptFound: true });
    assert.match(availability.structuredRecord, /not available/i);
    assert.match(availability.minutes, /not available/i);
    assert.match(availability.packet, /not available/i);
    assert.match(availability.transcript, /corroboration/i);
  });

  it("never infers a tally when only transcript corroboration exists", async () => {
    const { extractStructuredVote } = await import("./meeting-story-section5.ts");
    const vote = extractStructuredVote({
      item: "R-2026-51",
      structuredRecord: null,
      minutes: null,
      packet: null,
      transcript: { excerpt: "I think it passed", source: "transcript" },
    });
    assert.equal(vote.established, false);
    assert.equal(vote.tally, null);
  });
});
