import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { retrieveMeetingEvidence } from "./meeting-evidence-retrieval.ts";

function longEvidence(count = 320): string {
  return [
    "MEETING: Test council",
    "This recording has ended and the transcript below was captured successfully.",
    ...Array.from({ length: count }, (_, index) =>
      `[00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}; segment ${index}] ${index === 170 ? "Council approved the housing contract after a public hearing." : `Discussion line ${index} with enough ordinary words for batching.`}`,
    ),
    "--- VOTES, FROM THE STRUCTURED RECORD ---",
    "No vote was established from the structured record.",
  ].join("\n");
}

function meetingRows(count: number, overrides: Record<number, string>): string {
  return [
    "MEETING: Focus selection fixture",
    ...Array.from({ length: count }, (_, index) =>
      `[00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}; segment ${index}] ${overrides[index] ?? `Routine discussion line ${index}.`}`,
    ),
  ].join("\n");
}

function itemizedMeetingRows(): string {
  const base = meetingRows(140, {
    10: "Council discusses the marijuana hospitality licensing motion.",
    12: "The marijuana hospitality licensing motion carries four to three.",
    25: "Council members debate impacts on local businesses and the timeline for staff work.",
    45: "Council rejects the Dry Creek annexation traffic condition motion.",
    47: "The Dry Creek annexation motion failed three to four.",
    90: "Council moves to extend the meeting past 11 p.m.",
    92: "The meeting extension motion failed three to four.",
    130: "Council Member shares a family scheduling conflict and airport memo.",
  }).split("\n");
  const raw = base.slice(1);
  return [
    base[0]!,
    "RECORDING: https://youtube.com/watch?v=meeting",
    "This recording has ended. Auto-captions can mangle names and numbers.",
    "--- ITEM 12: MARIJUANA HOSPITALITY BUSINESS (from 00:00:00) ---",
    ...raw.slice(0, 35),
    "--- ITEM 9: CONSENT AGENDA (from 00:00:35) ---",
    ...raw.slice(35, 75),
    "--- ITEM 16: ADJOURNMENT (from 00:01:15) ---",
    ...raw.slice(75, 115),
    "--- ITEM 17: MAYOR AND COUNCIL COMMENTS (from 00:01:55) ---",
    ...raw.slice(115),
    "--- VOTES, FROM THE STRUCTURED RECORD ---",
    "- Item 12; motion: marijuana hospitality amendments; tally 4-3; result: carried; source: transcript",
    "- Item 16; motion: extend meeting; tally 3-4; result: failed; source: transcript",
  ].join("\n");
}

// The real direction from the redraft that produced drafts 161/162. It says how
// to write; it never names an item. The redraft it produced covered an electric
// budget presentation where "the council took no vote" instead of the meeting's
// recorded 4-3 decision.
const REDRAFT_DIRECTION = [
  "Lead with the main decision this meeting actually made and its recorded vote: name the motion, who moved and seconded it, the tally, and the result in the first two paragraphs.",
  "Treat the meeting as completed and write in the past tense -- no 'will consider', 'is expected to', or 'could'.",
  "Report only what the recording says: if a figure, date, or name is not stated, write 'not stated in the recording' instead of estimating it, and do not attribute any decision to a person the transcript does not name.",
].join(" ");

// Two items, one recorded decision and one presentation with no vote. The
// presentation's wording is where the old substring counter found the
// direction's instruction words: "report" in "reports" and "main" in
// "maintenance".
function directionAmbiguousMeeting(): string {
  return meetingRows(140, {
    10: "Council discusses the marijuana hospitality licensing motion.",
    12: "The marijuana hospitality licensing motion carries four to three.",
    95: "The electric director reports the maintenance backlog and the figures for this year.",
    97: "The council took no vote on the electric department update.",
  });
}

function directionFindings(): { ok: true; text: string } {
  return {
    ok: true,
    text: JSON.stringify({ findings: [
      { summary: "Council revives marijuana hospitality licensing", why: "The motion carries four to three and resumes business licensing policy", segment_indexes: [10, 12] },
      { summary: "Electric director reports the maintenance backlog", why: "The council took no vote on the electric department update", segment_indexes: [95, 97] },
    ] }),
  };
}

describe("meeting evidence retrieval", () => {
  it("keeps an editor-named ordinance on its recorded passage or refuses it", async () => {
    const evidence = meetingRows(180, {
      72: "Council considered ordinance 2026-57 for additional appropriations.",
      78: "The motion to adopt ordinance 2026-57 carries unanimously.",
      140: "Council considered ordinance 2026-62 about a separate matter.",
    });
    let calls = 0;
    const chat = async () => { calls += 1; return { ok: false as const, error: "should not call the model" }; };
    const selected = await retrieveMeetingEvidence(evidence, chat, { editorialAssignment: "Cover the vote on Ordinance 2026-57." });
    assert.equal(calls, 0);
    assert.match(selected.focus?.summary ?? "", /2026-57/);
    assert.match(selected.focusedEvidence, /carries unanimously/);
    assert.doesNotMatch(selected.focusedEvidence, /2026-62/);
    const absent = await retrieveMeetingEvidence(evidence, chat, { editorialAssignment: "Cover Ordinance 2026-99." });
    assert.equal(absent.focus, null);
    assert.equal(calls, 0);
  });

  it("examines every sequential batch and returns raw windows around cited findings", async () => {
    const calls: string[] = [];
    const result = await retrieveMeetingEvidence(
      longEvidence(),
      async (_system, user) => {
        calls.push(user);
        const indexes = [...user.matchAll(/^\[(\d+)\]/gm)].map((match) => Number(match[1]));
        const chosen = indexes[Math.floor(indexes.length / 2)]!;
        return { ok: true as const, text: JSON.stringify({ findings: [{ summary: `Finding in segment ${chosen}`, why_newsworthy: "local decision", segment_indexes: [chosen] }] }) };
      },
      { batchChars: 8_000 },
    );
    assert.ok(calls.length > 1, "a long record must be read in more than one pass");
    assert.equal(result.batchesExamined, calls.length);
    assert.equal(calls.flatMap((call) => [...call.matchAll(/^\[(\d+)\]/gm)].map((match) => Number(match[1]))).length, 320);
    assert.match(result.evidence, /MEETING-WIDE REPORTER INDEX/);
    assert.match(result.evidence, /RAW TRANSCRIPT WINDOWS/);
    assert.match(result.evidence, /Council approved the housing contract/);
    assert.match(result.evidence, /No vote was established/);
  });

  it("keeps distributed and signal windows when a reporter pass fails", async () => {
    const result = await retrieveMeetingEvidence(longEvidence(180), async () => ({ ok: false as const, error: "offline" }), { batchChars: 8_000 });
    assert.equal(result.findings, 0);
    assert.equal(result.batchesExamined, 0);
    assert.match(result.evidence, /0 of \d+ sequential transcript parts were read/i);
    assert.match(result.evidence, /failed and contribute only deterministic raw windows/i);
    assert.match(result.evidence, /segment 0/);
    assert.match(result.evidence, /segment 179/);
    assert.match(result.evidence, /segment 170/);
  });

  it("retries malformed reporter JSON once with a compact request and counts only usable coverage", async () => {
    const prompts: Array<{ system: string; user: string; maxTokens: number }> = [];
    const result = await retrieveMeetingEvidence(meetingRows(12, { 5: "Council approves the housing contract after public testimony." }), async (system, user, maxTokens) => {
      prompts.push({ system, user, maxTokens });
      if (prompts.length === 1) return { ok: true as const, text: '{"findings":[{"summary":"truncated' };
      return { ok: true as const, text: JSON.stringify({ findings: [
        { summary: "Council approved the housing contract", why_newsworthy: "Public service impact", segment_indexes: [5] },
      ] }) };
    });
    assert.equal(prompts.length, 2);
    assert.ok(prompts.every((prompt) => prompt.maxTokens >= 1_800));
    assert.match(prompts[0]!.system, /at most four findings/i);
    assert.match(prompts[0]!.system, /at most three segment indexes/i);
    assert.match(prompts[1]!.system, /STRICT RETRY/i);
    assert.equal(result.batchesExamined, 1);
    assert.equal(result.findings, 1);
    assert.equal(result.focus?.summary, "Council approved the housing contract");
  });

  it("marks a twice-unparseable batch as failed instead of claiming it was examined", async () => {
    let calls = 0;
    const result = await retrieveMeetingEvidence(meetingRows(12, {}), async () => {
      calls += 1;
      return { ok: true as const, text: '{"findings":[{"summary":"truncated' };
    });
    assert.equal(calls, 2);
    assert.equal(result.batchesExamined, 0);
    assert.equal(result.findings, 0);
    assert.equal(result.focus, null);
    assert.match(result.evidence, /0 of 1 sequential transcript parts were read/i);
    assert.match(result.evidence, /parts 1 failed/i);
  });

  it("keeps four-hour-style caption batches and the writer evidence below a 32K local context", async () => {
    const evidence = [
      "MEETING: Four-hour council",
      "This recording has ended and the transcript below was captured successfully.",
      ...Array.from({ length: 7_200 }, (_, index) =>
        `[${String(Math.floor(index / 3600)).padStart(2, "0")}:${String(Math.floor((index % 3600) / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}; segment ${index}] ${index % 11 === 0 ? "Council discussed a motion, contract, public hearing, budget, and vote." : `Caption fragment ${index} from the public meeting record.`}`,
      ),
      "--- VOTES, FROM THE STRUCTURED RECORD ---",
      "No vote was established from the structured record.",
    ].join("\n");
    const calls: string[] = [];
    const result = await retrieveMeetingEvidence(evidence, async (_system, user) => {
      calls.push(user);
      const indexes = [...user.matchAll(/^\[(\d+)\]/gm)].map((match) => Number(match[1]));
      const chosen = indexes[Math.floor(indexes.length / 2)]!;
      return {
        ok: true as const,
        text: JSON.stringify({ findings: [{ summary: `Decision near ${chosen}`, why_newsworthy: "public action", segment_indexes: [chosen] }] }),
      };
    });
    assert.ok(calls.length >= 5, "the long record must be split into conservative sequential reads");
    assert.ok(calls.every((call) => call.length <= 56_000), `largest batch was ${Math.max(...calls.map((call) => call.length))} characters`);
    assert.ok(result.evidence.length <= 48_000, `writer evidence was ${result.evidence.length} characters`);
    assert.match(result.evidence, /segment 0/);
    assert.match(result.evidence, /segment 7199/);
    assert.match(result.evidence, /No vote was established/);
  });

  it("locks one substantive finding and includes its local carried outcome without unrelated votes or closing material", async () => {
    const evidence = itemizedMeetingRows();
    const result = await retrieveMeetingEvidence(evidence, async () => ({
      ok: true as const,
      text: JSON.stringify({ findings: [
        { summary: "Council directs staff to revive marijuana hospitality licensing amendments", why: "The motion carries and resumes consequential business licensing policy", segment_indexes: [10] },
        { summary: "Council rejected the Dry Creek annexation traffic condition", why: "A land-use decision affects neighborhood traffic", segment_indexes: [45] },
        { summary: "Council failed to extend the meeting", why: "The session ran late", segment_indexes: [90] },
      ] }),
    }));

    assert.ok(result.focus);
    assert.equal(result.focus.summary, "Council directs staff to revive marijuana hospitality licensing amendments");
    assert.equal(result.focus.voteOutcome, "carried");
    assert.match(result.focusedEvidence, /carries four to three/);
    assert.match(result.focusedEvidence, /recording: https/i);
    assert.match(result.focusedEvidence, /debate impacts on local businesses/);
    assert.match(result.focusedEvidence, /STRUCTURED VOTES FOR ITEM 12 ONLY/);
    assert.doesNotMatch(result.focusedEvidence, /Item 16;|Dry Creek|annexation|failed three to four|family scheduling conflict|airport memo/);
    assert.match(result.evidence, /Dry Creek annexation/);
  });

  it("links a distant same-topic vote result but excludes another motion from the same agenda item", async () => {
    const rows = Array.from({ length: 620 }, (_, index) => {
      const text = index === 50
        ? "Council discusses marijuana hospitality licensing amendments and possible impacts on local businesses."
        : index === 250
          ? "Motion to revive marijuana hospitality ordinance carries four to three."
          : index === 470
            ? "Council rejects the Dry Creek annexation traffic condition, three to four."
            : `Residents and staff continue discussion of agenda item ${index}.`;
      return `[02:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}; segment ${index}] ${text}`;
    });
    const evidence = [
      "MEETING: Separated outcome fixture",
      "This recording has ended. Auto-captions may mangle names and numbers.",
      "--- ITEM 4: BUSINESS LICENSE POLICY (from 02:00:00) ---",
      ...rows,
      "--- VOTES, FROM THE STRUCTURED RECORD ---",
      "- Item 4; motion: marijuana hospitality ordinance amendments; tally 4-3; result: carried; source: transcript",
      "- Item 4; motion: Dry Creek annexation traffic condition; tally 3-4; result: failed; source: transcript",
    ].join("\n");
    const result = await retrieveMeetingEvidence(evidence, async () => ({
      ok: true as const,
      text: JSON.stringify({ findings: [
        { summary: "Council discusses marijuana hospitality licensing amendments", why_newsworthy: "Business licensing policy affects local businesses", segment_indexes: [50] },
        { summary: "Motion to revive marijuana hospitality ordinance carries four to three", why_newsworthy: "The policy motion passes", segment_indexes: [250] },
      ] }),
    }), { editorialAssignment: "marijuana hospitality licensing amendments" });

    assert.equal(result.focus?.candidateId, "F01", "the opening discussion remains the selected focus and keeps its provenance");
    assert.equal(result.focus?.segmentIndexes[0], 50);
    assert.equal(result.focus?.voteOutcome, "carried");
    assert.match(result.focusedEvidence, /RELATED SAME-ITEM FINDINGS/);
    assert.match(result.focusedEvidence, /RELATED SAME-ITEM FINDINGS[^\n]*\nMotion to revive marijuana hospitality ordinance carries four to three \[segments 250\]/);
    assert.match(result.focusedEvidence, /segment 250/);
    assert.match(result.focusedEvidence, /carries four to three/);
    assert.match(result.focusedEvidence, /motion: marijuana hospitality ordinance amendments; tally 4-3; result: carried/);
    assert.doesNotMatch(result.focusedEvidence, /Dry Creek annexation|traffic condition; tally 3-4/);
  });

  it("does not label an off-agenda motion as the preceding packet item", async () => {
    const evidence = [
      "MEETING: Council recording",
      "--- ITEM 4: APPROVAL OF MINUTES (from 00:20:00) ---",
      "[00:20:00; segment 10] Council approved the minutes.",
      "[00:21:00; segment 11] We are now on to future agenda items.",
      "[00:21:10; segment 12] I move to revive marijuana hospitality licenses.",
      "[00:21:20; segment 13] That motion carries four to three.",
    ].join("\n");
    const result = await retrieveMeetingEvidence(evidence, async () => ({
      ok: true as const,
      text: JSON.stringify({ findings: [{
        summary: "Council directs staff to revive marijuana hospitality licenses",
        why: "A consequential licensing decision",
        segment_indexes: [12, 13],
      }] }),
    }));
    assert.ok(result.focus);
    assert.equal(result.focus.agendaItem, undefined);
    assert.match(result.focusedEvidence, /TRANSCRIPT PASSAGE \(agenda-item label unverified\)/);
    assert.doesNotMatch(result.focusedEvidence, /ITEM 4: APPROVAL OF MINUTES/);
    assert.match(result.focusedEvidence, /segment 12/);
  });

  it("returns no focus when all reporter segment references are fabricated or only housekeeping is found", async () => {
    const fabricated = await retrieveMeetingEvidence(meetingRows(80, {}), async () => ({
      ok: true as const,
      text: JSON.stringify({ findings: [{ summary: "Council approved a housing contract", why: "Public impact", segment_indexes: [9999] }] }),
    }));
    assert.equal(fabricated.focus, null);
    assert.equal(fabricated.focusedEvidence, "");

    const housekeeping = await retrieveMeetingEvidence(meetingRows(80, { 10: "Council moves to extend the meeting." }), async () => ({
      ok: true as const,
      text: JSON.stringify({ findings: [{ summary: "Council failed to extend the meeting", why: "The session was late", segment_indexes: [10] }] }),
    }));
    assert.equal(housekeeping.focus, null);
    assert.equal(housekeeping.focusedEvidence, "");
  });

  it("prioritizes a matching editorial assignment over a higher-scoring unrelated candidate", async () => {
    const result = await retrieveMeetingEvidence(meetingRows(60, {}), async () => ({
      ok: true as const,
      text: JSON.stringify({ findings: [
        { summary: "Council approved a housing contract", why: "A major public investment", segment_indexes: [10] },
        { summary: "Council approved a transportation contract", why: "A public investment", segment_indexes: [40] },
      ] }),
    }), { editorialAssignment: "transportation contract" });
    assert.equal(result.focus?.summary, "Council approved a transportation contract");
  });

  it("keeps the meeting's recorded decision when the direction only says how to write", async () => {
    const result = await retrieveMeetingEvidence(directionAmbiguousMeeting(), async () => directionFindings(), { editorialAssignment: REDRAFT_DIRECTION });
    assert.equal(result.focus, null, "a direction that names no item must not lock one");
    assert.equal(result.focusScope, "meeting");
    assert.equal(result.focusedEvidence, "");
    assert.match(result.evidence, /MEETING-WIDE REPORTER INDEX/);
    assert.match(result.evidence, /carries four to three/);
    // The same material still narrows when the direction names the item.
    const named = await retrieveMeetingEvidence(directionAmbiguousMeeting(), async () => directionFindings(), { editorialAssignment: `${REDRAFT_DIRECTION} Focus on the marijuana hospitality licensing vote.` });
    assert.equal(named.focusScope, "item");
    assert.equal(named.focus?.summary, "Council revives marijuana hospitality licensing");
    assert.match(named.focusedEvidence, /carries four to three/);
    assert.doesNotMatch(named.focusedEvidence, /maintenance backlog|no vote on the electric/);
  });

  it("keeps a substantial same-item context block under the 20K cap for a long agenda section", async () => {
    const rows = Array.from({ length: 900 }, (_, index) =>
      `[01:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}; segment ${index}] ${index === 450 ? "Council approved the wastewater infrastructure contract after a lengthy public hearing." : `Residents and staff discussed the wastewater infrastructure proposal and its neighborhood effects in detail, segment ${index}.`}`,
    );
    const evidence = [
      "MEETING: Large agenda fixture",
      "This recording has ended. Auto-captions may mangle names and numbers.",
      "--- ITEM 12: WASTEWATER INFRASTRUCTURE (from 01:00:00) ---",
      ...rows,
      "--- ITEM 16: ADJOURNMENT (from 03:00:00) ---",
      "[03:00:00; segment 901] Council failed to extend the meeting.",
      "--- VOTES, FROM THE STRUCTURED RECORD ---",
      "- Item 12; motion: wastewater contract; tally 5-2; result: approved; source: record",
      "- Item 16; motion: extend meeting; tally 3-4; result: failed; source: record",
    ].join("\n");
    const result = await retrieveMeetingEvidence(evidence, async () => ({
      ok: true as const,
      text: JSON.stringify({ findings: [{ summary: "Council approved wastewater infrastructure contract", why: "The contract affects neighborhood services", segment_indexes: [450] }] }),
    }));
    assert.ok(result.focusedEvidence.length > 12_000, "focused context must preserve the debate around the selected action");
    assert.ok(result.focusedEvidence.length < 22_000, `focused context exceeded the bounded item budget: ${result.focusedEvidence.length}`);
    assert.match(result.focusedEvidence, /Residents and staff discussed/);
    assert.match(result.focusedEvidence, /STRUCTURED VOTES FOR ITEM 12 ONLY/);
    assert.doesNotMatch(result.focusedEvidence, /ITEM 16|extend the meeting|Item 16;/);
  });
});
