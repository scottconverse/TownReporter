import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { minutesSectionFor, minutesVoteRecords, minutesVotesByItem } from "./meeting-minutes.ts";
import { extractStructuredVote } from "./meeting-story-section5.ts";

/*
  Council votes from the official minutes (Goal C unit C2, design D214).

  Longmont prints a council meeting's minutes INSIDE a later meeting's packet,
  not as a document on the meeting itself, so the text this parses is the Oct 6,
  2026 Regular Session minutes as they appear on pages 6+ of the Oct 20, 2026
  packet. The fixture is that minutes section exactly as unpdf extracted it,
  page footers glued into sentences and all.
*/

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/minutes/longmont-council-2026-10-06-minutes.txt"),
  "utf8",
);

const section = minutesSectionFor(FIXTURE, {
  bodyTitle: "City Council",
  meetingDate: "2026-10-06",
});

describe("minutes section for a meeting", () => {
  it("finds the Oct 6, 2026 City Council minutes inside a later packet's text", () => {
    assert.ok(section, "the Oct 6 minutes section must be found");
    assert.match(section!.text, /^MINUTES\nCity Council Regular Session\nOctober 6, 2026/);
    assert.match(section!.text, /17\. ADJOURN/);
    assert.match(section!.text, /to adjourn the meeting at 12:15 a\.m\./);
    assert.equal(section!.page, 1, "the section starts on the first page of the text it was given");
  });

  it("does not run on into the next document in the packet", () => {
    assert.equal(/CITY COUNCIL COMMUNICATION/.test(section!.text), false);
    assert.equal(/PLANNING AND ZONING COMMISSION/.test(section!.text), false);
  });

  it("finds nothing when no section names this body and date", () => {
    assert.equal(minutesSectionFor(FIXTURE, { bodyTitle: "City Council", meetingDate: "2026-09-22" }), null);
    assert.equal(minutesSectionFor(FIXTURE, { bodyTitle: "Water Board", meetingDate: "2026-10-06" }), null);
  });
});

describe("votes read from the minutes section", () => {
  const votes = minutesVotesByItem(section!.text);

  it("reads item 4A's minutes-approval motion", () => {
    // The item is "4A", not "4": the minutes put this motion under sub-heading
    // "A. September 22, 2026 – Regular Session", and a vote keyed to "4" would
    // claim the whole agenda item when only its first part was voted on.
    const motion = votes["4A"]?.[0];
    assert.ok(motion, "item 4A must carry the minutes-approval motion");
    assert.equal(motion!.mover, "Sean McCoy");
    assert.equal(motion!.seconder, "Diane Crist");
    assert.equal(motion!.tally, "7-0");
    assert.equal(motion!.result, "Passed");
    assert.match(motion!.motion, /approve the September 22, 2026 – Regular Session minutes as presented/);
  });

  it("reads the agenda-revision motion under item 5", () => {
    const motion = votes["5A"]?.[0];
    assert.ok(motion, "item 5A must carry the agenda-revision motion");
    assert.equal(motion!.mover, "Jake Marsing");
    assert.equal(motion!.seconder, "Susie Hidalgo-Fahring");
    assert.equal(motion!.tally, "6-1");
    assert.equal(motion!.result, "Passed");
  });

  it("never leaves a page footer inside a motion clause", () => {
    for (const [item, motions] of Object.entries(votes)) {
      for (const motion of motions) {
        assert.equal(
          /Page\s+\d+/.test(motion.motion),
          false,
          `item ${item}'s motion clause must not carry Page N text`,
        );
        assert.equal(
          /City Council Regular Session, October \d\d, 2026/.test(motion.motion),
          false,
          `item ${item}'s motion clause must not carry a glued footer`,
        );
        assert.equal(/Page\s+\d+/.test(motion.mover), false);
        assert.equal(/Page\s+\d+/.test(motion.seconder), false);
      }
    }
  });

  it("keeps motions under the sub-item that voted, and leaves the parent item unestablished", () => {
    assert.equal(votes["12"], undefined, "a top-level 12 with motions only under 12A does not establish 12");
    assert.equal(votes["12A"]?.length, 2, "12A lists both budget motions");
    assert.equal(votes["12A"]?.at(-1)?.tally, "7-0");
  });

  it("reads a failed motion as Failed", () => {
    const failed = Object.values(votes).flat().filter((motion) => motion.result === "Failed");
    assert.equal(failed.length, 1, "item 9I holds the one motion that failed");
    assert.equal(failed[0]!.tally, "2-5");
    assert.match(failed[0]!.motion, /deny O-2026-73/);
  });

  it("drops a motion that never carried or failed", () => {
    // Under item 9I the minutes record a motion that died for lack of a second
    // ("0 – 0", no Carried/Failed line). It is not a vote and must not become one.
    const denyCopperPeak = votes["9I"] ?? [];
    assert.equal(
      denyCopperPeak.some((motion) => /retain the existing planned/.test(motion.motion)),
      false,
      "a motion that died for lack of a second is not a recorded vote",
    );
    assert.equal(denyCopperPeak.length, 3, "9I carries the deny, the approve and the extension");
  });

  it("reads the adjournment as an ordinary item vote", () => {
    const adjourn = votes["17"]?.[0];
    assert.ok(adjourn, "item 17 carries the adjournment motion");
    assert.equal(adjourn!.mover, "Sean McCoy");
    assert.equal(adjourn!.tally, "7-0");
    assert.equal(adjourn!.result, "Passed");
  });
});

describe("what makes a vote established", () => {
  const minutesRecord = {
    item: "4A",
    motion: "approve the September 22, 2026 – Regular Session minutes as presented",
    mover: "Sean McCoy",
    seconder: "Diane Crist",
    tally: "7-0",
    result: "Passed",
    source: "minutes" as const,
    locator: "https://portal.example/Public/CompiledDocument?meetingTemplateId=16844#page=6",
    excerpt: "MOTION Sean McCoy moved, seconded by Diane Crist, to approve the September 22, 2026 – Regular Session minutes as presented",
  };

  it("establishes an item with a minutes motion, quoting the motion block", () => {
    const vote = extractStructuredVote({
      item: "4A",
      structuredRecord: null,
      minutes: minutesRecord,
      packet: null,
      transcript: { excerpt: "item 4A approval of the minutes", source: "transcript" },
    });
    assert.equal(vote.established, true);
    assert.equal(vote.source, "minutes");
    assert.equal(vote.tally, "7-0");
    assert.equal(vote.provenance[0]!.source, "minutes");
    assert.equal(vote.provenance[0]!.locator, minutesRecord.locator);
    assert.match(vote.provenance[0]!.excerpt ?? "", /Sean McCoy moved, seconded by Diane Crist/);
    assert.equal(vote.provenance[1]!.source, "transcript", "the transcript entry is kept beside the minutes entry");
  });

  it("leaves an item with no minutes motion unestablished", () => {
    const vote = extractStructuredVote({
      item: "13",
      structuredRecord: null,
      minutes: null,
      packet: null,
      transcript: { excerpt: "final call, public invited to be heard", source: "transcript" },
    });
    assert.equal(vote.established, false);
    assert.equal(vote.source, null);
  });

  it("leaves a parent item unestablished when only its sub-items voted", () => {
    const records = minutesVoteRecords(minutesVotesByItem(section!.text), "https://portal.example/#page=6");
    const vote = extractStructuredVote({
      item: "12",
      structuredRecord: null,
      minutes: records.find((record) => record.item === "12") ?? null,
      packet: null,
      transcript: null,
    });
    assert.equal(vote.established, false, "12A's motions are not 12's vote");
  });

  it("never overwrites a structured-record row", () => {
    const vote = extractStructuredVote({
      item: "4A",
      structuredRecord: {
        motion: "approve the minutes",
        mover: "Someone Else",
        seconder: "Another",
        tally: "6-1",
        result: "Passed",
        source: "structured-record",
        locator: "https://council.example/votes/4A",
      },
      minutes: minutesRecord,
      packet: null,
      transcript: null,
    });
    assert.equal(vote.source, "structured-record");
    assert.equal(vote.tally, "6-1");
    assert.match(vote.disagreements[0] ?? "", /structured vote record says Passed 6-1; official minutes says Passed 7-0/);
  });

  it("says which motion was used when an item lists several", () => {
    const records = minutesVoteRecords(minutesVotesByItem(section!.text), "https://portal.example/#page=6");
    const vote = extractStructuredVote({
      item: "12A",
      structuredRecord: null,
      minutes: records.find((record) => record.item === "12A") ?? null,
      packet: null,
      transcript: null,
    });
    assert.equal(vote.established, true);
    assert.match(vote.disagreements[0] ?? "", /minutes list 2 motions under item 12A; the last is used/);
  });
});
