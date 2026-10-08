// guards: an unknown vote count could be recorded as zero or detached from its agenda item and source
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Sql } from "../db.ts";
import { parseStructuredVotePage } from "./meeting-vote-sources.ts";
import { extractStructuredVote } from "./meeting-story-section5.ts";
import { runSection5ForArtifact } from "./meeting-story-section5-run.ts";
import { parsePrimeGovVoteRecords } from "./primegov-vote-documents.ts";

test("unknown counts stay unknown and meeting minutes establish a cited item vote", async () => {
  const block = (tally: string) => `<span class="ord-num">O-2026-51</span><p>Alex moved, seconded by Blair, to approve the plan.</p>${tally}`;
  const absent = parseStructuredVotePage(block(""))[0]!;
  const yesOnly = parseStructuredVotePage(block('<span class="tally-yes">5</span>'))[0]!;
  assert.equal(absent.tally, "");
  assert.equal(yesOnly.tally, "");
  for (const record of [absent, yesOnly]) {
    assert.equal(extractStructuredVote({
      item: "1", structuredRecord: record, minutes: null, packet: null, transcript: null,
    }).established, false);
  }

  const writes: { text: string; params: unknown[] }[] = [];
  const sql = (async () => [] as never[]) as unknown as Sql;
  sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
    writes.push({ text, params });
    if (/from sources/i.test(text)) return [{ url: "https://city.primegov.com/public/portal" }] as T[];
    if (/from meeting_transcript_artifacts/i.test(text)) return [{ id: 67, storage_path: "C:\\meetings\\whisper.json", sha256: "hash" }] as T[];
    if (/from meeting_transcript_segments/i.test(text)) return [
      { segment_index: 0, start_seconds: 10, end_seconds: 30, excerpt: "Agenda item 1, approval of the plan. The motion passed.", caption_sha256: "hash" },
    ] as T[];
    return [] as T[];
  };
  const result = await runSection5ForArtifact(sql, {
    newsroomId: 1, videoId: "video", title: "Council meeting", artifactId: 67, meetingDate: "2026-10-06",
  }, {
    primeGovOrigin: async () => "https://city.primegov.com",
    structuredVoteBaseUrl: async () => null,
    packetForTitle: async () => ({ meeting: {
      id: 1, title: "Council meeting", date: "2026-10-06", dateTime: "2026-10-06T18:00:00",
      time: "18:00", location: "Council Chambers", documentList: [],
    }, urls: [] }),
    packetItemsForMeeting: async () => [{ itemNumber: "1", title: "Approval of the plan" }],
    voteRecordsForMeeting: async () => ({
      minutes: parsePrimeGovVoteRecords(
        "1. Approval of the plan\nMotion by Alex, seconded by Blair, to approve city plan. Motion passed 5-2.",
        "minutes",
        "https://city.test/minutes.pdf",
      ),
      packet: parsePrimeGovVoteRecords(
        "1. Approval of the plan\nMotion by Alex, seconded by Blair, to approve city plan. Motion passed 4-3.",
        "packet",
        "https://city.test/packet.pdf",
      ),
    }),
  });
  assert.equal(result.votes[0]?.established, true);
  assert.equal(result.votes[0]?.item, "1");
  assert.match(result.votes[0]?.motion ?? "", /approve city plan/i);
  assert.equal(result.votes[0]?.tally, "5-2");
  assert.equal(result.votes[0]?.source, "minutes");
  assert.deepEqual(result.votes[0]?.provenance[0], { source: "minutes", locator: "https://city.test/minutes.pdf" });
  assert.match(result.votes[0]?.disagreements[0] ?? "", /PrimeGov packet says Passed 4-3/);
  const persisted = writes.find((write) => /insert into meeting_structured_votes/.test(write.text));
  assert.ok(persisted);
  assert.equal(persisted.params[2], "1");
  assert.equal(persisted.params[7], "5-2");
  assert.equal(persisted.params[9], "minutes");
});
