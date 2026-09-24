import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const modPath = new URL("./meeting-story-section5.ts", import.meta.url);
const migrationPath = new URL("../../../migrations/0071_meeting_capture_section5.sql", import.meta.url);

describe("meeting section 5 agenda-item chunking", () => {
  it("chunks by agenda item using the packet item list, not time windows", async () => {
    assert.equal(existsSync(modPath), true, "meeting-story-section5.ts must exist");
    const { chunkByAgendaItem } = await import("./meeting-story-section5.ts");
    const segments = [
      { segmentIndex: 0, startSeconds: 0, endSeconds: 60, captionSha256: "fixture-sha", excerpt: "Good evening. We call the meeting to order and take roll call." },
      { segmentIndex: 1, startSeconds: 60, endSeconds: 120, captionSha256: "fixture-sha", excerpt: "Item 1, approval of the minutes. Motion to approve the minutes by Mayor Prom, seconded by Council Member Coloffer." },
      { segmentIndex: 2, startSeconds: 120, endSeconds: 300, captionSha256: "fixture-sha", excerpt: "Council discussed a correction to the May 12 minutes before voting." },
      { segmentIndex: 3, startSeconds: 300, endSeconds: 360, captionSha256: "fixture-sha", excerpt: "A speaker repeated that item 1 should record the corrected attendance." },
      { segmentIndex: 4, startSeconds: 600, endSeconds: 660, captionSha256: "fixture-sha", excerpt: "Item 2, the airport rates and charges study. The consultant presented the landing fee analysis." },
      { segmentIndex: 5, startSeconds: 660, endSeconds: 1200, captionSha256: "fixture-sha", excerpt: "The consultant said the proposed fee would raise annual revenue by $240,000." },
      { segmentIndex: 6, startSeconds: 2400, endSeconds: 2460, captionSha256: "fixture-sha", excerpt: "Item 3, second reading of Ordinance O-2026-54. Council member Popkin moved to approve." },
      { segmentIndex: 7, startSeconds: 2460, endSeconds: 3000, captionSha256: "fixture-sha", excerpt: "The ordinance passed after council debated the effective date." },
    ];
    const chunks = chunkByAgendaItem({
      segments,
      packetItems: [
        { itemNumber: "1", title: "Approval of the Minutes" },
        { itemNumber: "2", title: "Airport Rates and Charges Study" },
        { itemNumber: "3", title: "Second Reading of Ordinance O-2026-54" },
      ],
    });
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0]?.item, "1");
    assert.deepEqual(chunks[0]!.segmentIndexes, [1, 2, 3], "the first item includes its full discussion, including a repeated item mention");
    assert.equal(chunks[1]?.item, "2");
    assert.deepEqual(chunks[1]!.segmentIndexes, [4, 5], "the second item stops at the next agenda boundary");
    assert.equal(chunks[2]?.item, "3");
    assert.deepEqual(chunks[2]!.segmentIndexes, [6, 7], "the final item reaches the end of the transcript");
    assert.ok(chunks.every((c) => c.segmentIndexes.length > 0));
    const allIndexes = chunks.flatMap((chunk) => chunk.segmentIndexes);
    assert.equal(new Set(allIndexes).size, allIndexes.length, "agenda chunks must never overlap");
  });

  it("reports unalignable when the packet does not match the transcript", async () => {
    const { alignMeeting, chunkByAgendaItem } = await import("./meeting-story-section5.ts");
    const segments = [
      { segmentIndex: 0, startSeconds: 0, endSeconds: 60, captionSha256: "fixture-sha", excerpt: "We call the meeting to order." },
      { segmentIndex: 1, startSeconds: 60, endSeconds: 120, captionSha256: "fixture-sha", excerpt: "Discussion of a completely unrelated zoning variance." },
    ];
    const chunks = chunkByAgendaItem({ segments, packetItems: [{ itemNumber: "1", title: "Approval of the Minutes" }] });
    const alignment = alignMeeting({ segments, chunks, packetItems: [{ itemNumber: "1", title: "Approval of the Minutes" }] });
    assert.equal(alignment.aligned, false);
    assert.match(alignment.reason ?? "", /align|transition/i);
  });

  it("stops a previous item's span when the clerk announces a numbered item in words", async () => {
    const { chunkByAgendaItem, spokenTransitionKey } = await import("./meeting-story-section5.ts");
    assert.deepEqual(spokenTransitionKey("we are now on to item six, study session"), { kind: "item", value: "6" });
    const segments = [
      { segmentIndex: 314, startSeconds: 1256, endSeconds: 1260, captionSha256: "fixture-sha", excerpt: "no special reports and presentations" },
      { segmentIndex: 315, startSeconds: 1260, endSeconds: 1264, captionSha256: "fixture-sha", excerpt: "we are now on to item six, study session" },
      { segmentIndex: 316, startSeconds: 1264, endSeconds: 1268, captionSha256: "fixture-sha", excerpt: "Council discussed the proposed utility budget." },
      { segmentIndex: 317, startSeconds: 1268, endSeconds: 1272, captionSha256: "fixture-sha", excerpt: "Item seven, mayor and council comments." },
    ];
    const chunks = chunkByAgendaItem({
      segments,
      packetItems: [
        { itemNumber: "5", title: "SPECIAL REPORTS AND PRESENTATIONS" },
        { itemNumber: "6", title: "STUDY SESSION ITEMS" },
        { itemNumber: "7", title: "MAYOR AND COUNCIL COMMENTS" },
      ],
    });
    assert.deepEqual(chunks.map((chunk) => [chunk.item, chunk.segmentIndexes]), [
      ["5", [314]], ["6", [315, 316]], ["7", [317]],
    ]);
  });
});

describe("meeting section 5 structured vote extraction", () => {
  it("prefers structured record over minutes, packet, and transcript", async () => {
    const { extractStructuredVote } = await import("./meeting-story-section5.ts");
    const vote = extractStructuredVote({
      item: "R-2026-51",
      structuredRecord: { motion: "Approve the resolution", mover: "Popkin", seconder: "Coloffer", tally: "7-0", result: "Passed", source: "longmontcitycouncil.org" },
      minutes: { motion: "Approve the resolution", mover: "Popkin", seconder: "Coloffer", tally: "7-0", result: "Passed", source: "minutes" },
      packet: null,
      transcript: { excerpt: "motion carried", source: "transcript" },
    });
    assert.equal(vote.established, true);
    assert.equal(vote.source, "longmontcitycouncil.org");
    assert.equal(vote.tally, "7-0");
    assert.equal(vote.mover, "Popkin");
    assert.equal(vote.seconder, "Coloffer");
    assert.equal(vote.result, "Passed");
  });

  it("falls back to minutes then packet when no structured record exists", async () => {
    const { extractStructuredVote } = await import("./meeting-story-section5.ts");
    const fromMinutes = extractStructuredVote({
      item: "R-2026-51",
      structuredRecord: null,
      minutes: { motion: "Approve", mover: "A", seconder: "B", tally: "6-1", result: "Passed", source: "minutes" },
      packet: null,
      transcript: null,
    });
    assert.equal(fromMinutes.source, "minutes");
    const fromPacket = extractStructuredVote({
      item: "R-2026-51",
      structuredRecord: null,
      minutes: null,
      packet: { motion: "Approve", mover: "A", seconder: "B", tally: "5-2", result: "Passed", source: "packet" },
      transcript: null,
    });
    assert.equal(fromPacket.source, "packet");
  });

  it("reports not established rather than inferring approved without a tally", async () => {
    const { extractStructuredVote } = await import("./meeting-story-section5.ts");
    const vote = extractStructuredVote({
      item: "R-2026-51",
      structuredRecord: null,
      minutes: null,
      packet: null,
      transcript: { excerpt: "I think it passed, we're good", source: "transcript" },
    });
    assert.equal(vote.established, false);
    assert.equal(vote.result, "not established");
    assert.equal(vote.tally, null);
  });

  it("surfaces disagreement instead of silently resolving it", async () => {
    const { extractStructuredVote } = await import("./meeting-story-section5.ts");
    const vote = extractStructuredVote({
      item: "R-2026-51",
      structuredRecord: { motion: "Approve", mover: "A", seconder: "B", tally: "7-0", result: "Passed", source: "longmontcitycouncil.org" },
      minutes: { motion: "Approve", mover: "A", seconder: "B", tally: "6-1", result: "Passed", source: "minutes" },
      packet: null,
      transcript: null,
    });
    assert.equal(vote.established, true);
    assert.equal(vote.tally, "7-0");
    assert.equal(vote.disagreements.length, 1);
    assert.match(vote.disagreements[0] ?? "", /7-0/);
    assert.match(vote.disagreements[0] ?? "", /6-1/);
  });
});

describe("meeting section 5 citation resolution", () => {
  it("resolves to item, timestamp, verbatim excerpt, and caption hash, not the whole file", async () => {
    const { resolveItemCitation } = await import("./meeting-story-section5.ts");
    const citation = resolveItemCitation({
      item: "2",
      timestampSeconds: 700,
      segments: [{ segmentIndex: 2, startSeconds: 600, endSeconds: 2400, excerpt: "Item 2, the airport rates and charges study.", captionSha256: "abc123" }],
      captionSha256: "abc123",
      storagePath: "C:\\data\\meet.srv3",
    });
    assert.equal(citation.item, "2");
    assert.equal(citation.timestampSeconds, 600);
    assert.equal(citation.excerpt, "Item 2, the airport rates and charges study.");
    assert.equal(citation.captionSha256, "abc123");
    assert.notEqual(citation.excerpt.length, 2_362_983);
    assert.match(citation.storagePath, /meet\.srv3/);
  });
});

describe("meeting section 5 schema", () => {
  it("adds agenda chunks, alignments, and structured votes with provenance", () => {
    assert.equal(existsSync(migrationPath), true, "migration 0071 must exist");
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /meeting_agenda_chunks/);
    assert.match(sql, /meeting_alignments/);
    assert.match(sql, /meeting_structured_votes/);
    assert.match(sql, /provenance/);
  });
});

