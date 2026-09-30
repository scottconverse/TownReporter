import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";

/**
 * Real integration test: exercises runSection5ForArtifact against a fake that
 * models the stored artifact + segments, and counts the section-5 calls. This
 * fails if the pipeline stops calling chunking, alignment, vote extraction,
 * persistence, or the unaligned path.
 *
 * `sourceUrls` is the newsroom's watch list, which is where the PrimeGov portal
 * now comes from (./primegov-source.ts). Boulder by default: a meeting's packet
 * must be looked up at the portal THIS newsroom watches.
 *
 * `councilVotesUrl` is the paper's structured vote source, out of paper
 * settings (./structured-vote-source.ts). `undefined` is a newsroom with no
 * paper_settings row at all -- the shipped install, whose council-votes site is
 * the shipped constant.
 */
function harness(
  sourceUrls: string[] = ["https://boulder.primegov.com/public/portal"],
  councilVotesUrl?: string,
) {
  const writes: { text: string; params: unknown[] }[] = [];
  const sql = (async () => [] as never[]) as unknown as Sql;
  sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
    writes.push({ text, params });
    if (/from sources/i.test(text)) {
      return sourceUrls.map((url) => ({ url })) as T[];
    }
    if (/from paper_settings/i.test(text)) {
      return (councilVotesUrl === undefined ? [] : [{ council_votes_url: councilVotesUrl }]) as T[];
    }
    if (/from meeting_transcript_artifacts/i.test(text)) {
      return [{ id: 5, storage_path: "C:\\data\\meet.srv3", sha256: "abc123" }] as T[];
    }
    if (/from meeting_transcript_segments/i.test(text)) {
      return [
        { segment_index: 0, start_seconds: 0, end_seconds: 60, excerpt: "Roll call and pledge.", caption_sha256: "abc123" },
        { segment_index: 1, start_seconds: 60, end_seconds: 120, excerpt: "agenda item 1 approval of the minutes", caption_sha256: "abc123" },
        { segment_index: 2, start_seconds: 120, end_seconds: 600, excerpt: "The clerk corrected the attendance in the May 12 minutes.", caption_sha256: "abc123" },
        { segment_index: 3, start_seconds: 600, end_seconds: 660, excerpt: "item 2 airport rates and charges study", caption_sha256: "abc123" },
        { segment_index: 4, start_seconds: 660, end_seconds: 2400, excerpt: "The consultant projected $240,000 in annual revenue from the fee change.", caption_sha256: "abc123" },
      ] as T[];
    }
    return [] as T[];
  };
  return { sql, writes };
}

/**
 * The structured vote read, replaced by a recorder. Every test injects it: a
 * test must never be able to reach a real council website, and the origin it
 * was handed is the assertion that matters here.
 */
function voteSeam() {
  const origins: string[] = [];
  const structuredVotesForDate = async (_date: string, origin: string) => {
    origins.push(origin);
    return { found: false, reason: "test: no structured record for this meeting", records: [], url: `${origin}/meetings/` };
  };
  return { origins, structuredVotesForDate };
}

describe("meeting section 5 real pipeline integration", () => {
  it("runs chunking, alignment, vote extraction, persistence, and citation resolution from the stored artifact", async () => {
    const { runSection5ForArtifact } = await import("./meeting-story-section5-run.ts");
    const { sql, writes } = harness();
    const votes = voteSeam();
    const lookedUpIn: string[] = [];
    const packetItemsIn: string[] = [];
    const result = await runSection5ForArtifact(
      sql,
      { newsroomId: 1, videoId: "L1AnMLsLwtk", title: "City Council Regular Session", artifactId: 5 },
      {
        structuredVotesForDate: votes.structuredVotesForDate,
        // Both seams record the origin they were handed: the portal is this
        // newsroom's, read out of its watch list, and reaches the packet
        // download as well as the lookup.
        packetForTitle: async (_title, origin) => {
          lookedUpIn.push(origin);
          return {
            meeting: {
              id: 1, title: "City Council Regular Session", date: "2026-07-28", dateTime: "2026-07-28T18:00:00",
              time: "18:00", location: "Council Chambers",
              documentList: [
                { id: 1, templateId: 1, compileOutputType: 1, templateName: "Agenda", link: null },
              ],
            },
            urls: [],
          };
        },
        packetItemsForMeeting: async (_meeting, origin) => {
          packetItemsIn.push(origin);
          return [
            { itemNumber: "1", title: "Approval of the Minutes" },
            { itemNumber: "2", title: "Airport Rates and Charges Study" },
          ];
        },
      },
    );
    assert.deepEqual(lookedUpIn, ["https://boulder.primegov.com"]);
    assert.deepEqual(packetItemsIn, ["https://boulder.primegov.com"]);
    assert.ok(writes.some((w) => /from sources/i.test(w.text) && w.params[0] === 1), "the portal comes from this newsroom's watch list");
    assert.deepEqual(
      votes.origins,
      ["https://longmontcitycouncil.org"],
      "a newsroom with no paper_settings row reads the shipped install's configured council-votes site",
    );
    assert.equal(result.aligned, true);
    assert.ok(result.chunkCount >= 1, "chunks were produced");
    assert.ok(writes.some((w) => /meeting_agenda_chunks/.test(w.text)), "chunks persisted");
    assert.ok(writes.some((w) => /meeting_alignments/.test(w.text)), "alignment persisted");
    assert.ok(writes.some((w) => /meeting_structured_votes/.test(w.text)), "votes persisted");
    assert.ok(result.citations.length >= 1, "citations resolved from stored segments");
    assert.equal(result.citations[0]?.captionSha256, "abc123");
    assert.ok(result.citations[0]!.excerpt.length < 1000, "citation excerpt is bounded, not the whole file");
    assert.ok(result.citations.some((citation) => citation.segmentIndex === 4), "later substantive transcript segments remain citeable");
    assert.match(result.items.find((item) => item.item === "2")?.excerpt ?? "", /\$240,000/, "the writer receives the full bounded item span, not just its transition line");
    assert.match(result.items.find((item) => item.item === "2")?.excerpt ?? "", /\[00:11:00; segment 4\]/, "every later segment carries its own timestamp and stable segment index");
  });

  it("takes the honest unaligned path when packet items do not align", async () => {
    const { runSection5ForArtifact } = await import("./meeting-story-section5-run.ts");
    const { sql, writes } = harness();
    const result = await runSection5ForArtifact(
      sql,
      { newsroomId: 1, videoId: "L1AnMLsLwtk", title: "City Council Regular Session", artifactId: 5 },
      { packetForTitle: async () => null, structuredVotesForDate: voteSeam().structuredVotesForDate },
    );
    assert.equal(result.aligned, false);
    assert.ok(result.unalignedLead, "unaligned lead produced");
    assert.equal(result.unalignedLead!.itemLevelDraft, false);
    assert.equal(result.unalignedLead!.untimed, true);
    assert.match(result.unalignedLead!.leadWhy, /align/i);
    assert.ok(writes.some((w) => /meeting_alignments/.test(w.text)), "failed alignment still persisted");
  });

  it("skips the packet lookup entirely when the newsroom watches no portal", async () => {
    const { runSection5ForArtifact } = await import("./meeting-story-section5-run.ts");
    // A watch list with no PrimeGov source: the desk's shipped example city
    // must not be queried in its place.
    const { sql, writes } = harness(["https://example.test/council", "https://example.test/agendas"]);
    const lookedUpIn: string[] = [];
    let itemsAsked = 0;
    const votes = voteSeam();
    const result = await runSection5ForArtifact(
      sql,
      { newsroomId: 1, videoId: "L1AnMLsLwtk", title: "City Council Regular Session", artifactId: 5 },
      {
        structuredVotesForDate: votes.structuredVotesForDate,
        packetForTitle: async (_title, origin) => {
          lookedUpIn.push(origin);
          return null;
        },
        packetItemsForMeeting: async () => {
          itemsAsked += 1;
          return [];
        },
      },
    );
    assert.deepEqual(lookedUpIn, [], "no portal configured means no lookup");
    assert.equal(itemsAsked, 0, "and no agenda download");
    assert.equal(result.aligned, false);
    assert.ok(writes.some((w) => /from sources/i.test(w.text)), "the watch list was read");
  });

  it("reads the structured vote record at the source THIS paper configured", async () => {
    const { runSection5ForArtifact } = await import("./meeting-story-section5-run.ts");
    // A paper set up for another city, with its own council-votes site. The
    // shipped paper's site must never be asked in its place.
    const { sql } = harness(["https://boulder.primegov.com/public/portal"], "https://council.example.test/");
    const votes = voteSeam();
    const result = await runSection5ForArtifact(
      sql,
      { newsroomId: 1, videoId: "L1AnMLsLwtk", title: "City Council Regular Session", artifactId: 5, meetingDate: "2026-07-28" },
      { packetForTitle: async () => null, structuredVotesForDate: votes.structuredVotesForDate },
    );
    assert.deepEqual(votes.origins, ["https://council.example.test"]);
    assert.equal(
      JSON.stringify({ origins: votes.origins, reason: result.structuredVoteReason }).toLowerCase().includes("longmont"),
      false,
      "another city's paper must not have its votes read from, or reported against, the shipped paper's site",
    );
  });

  it("runs no structured vote lookup and says why when the paper configured none", async () => {
    const { runSection5ForArtifact } = await import("./meeting-story-section5-run.ts");
    // An empty council-votes setting is a real answer ("this paper has no
    // structured vote record"), not a gap to fill with the shipped paper's.
    const { sql } = harness(["https://boulder.primegov.com/public/portal"], "");
    const votes = voteSeam();
    const result = await runSection5ForArtifact(
      sql,
      { newsroomId: 1, videoId: "L1AnMLsLwtk", title: "City Council Regular Session", artifactId: 5, meetingDate: "2026-07-28" },
      { packetForTitle: async () => null, structuredVotesForDate: votes.structuredVotesForDate },
    );
    assert.deepEqual(votes.origins, [], "no source configured means no lookup at all");
    assert.match(result.structuredVoteReason, /no structured vote source configured/i);
    assert.equal(result.votes.every((vote) => !vote.established), true, "and no vote is invented to fill the gap");
  });
});
