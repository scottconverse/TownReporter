import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DRAFT_AUDIT_LIMITS, auditDraft } from "./draft-audit.ts";
import {
  DRAFT_REPAIR_LIMITS,
  buildDraftRepairPrompt,
  repairDraftStyle,
  repairFlattenedRhythm,
  repairInstructions,
  repairKeepsFacts,
  type DraftRepairCall,
  type DraftRepairRequest,
} from "./draft-audit-repair.ts";

const audit = (body: string, headline = "", dek = ""): ReturnType<typeof auditDraft> =>
  auditDraft({ headline, dek, body, form: "reported" });

const codesOf = (body: string): string[] =>
  [...new Set(audit(body).findings.map((finding) => finding.code))].sort();

/** One paragraph per line, so a fixture reads as a draft rather than a blob. */
const draft = (...paragraphs: string[]): string => paragraphs.join("\n\n");

/*
  ── Fixtures ────────────────────────────────────────────────────────────────
  Local-news sentences, the kind the desk actually drafts: a council vote, a
  water rate, a quote from a named official. The unnamed attribution in these
  is the real thing this audit exists for -- "Experts say ..." with nobody
  named is a claim with no owner.
*/

const VOTED = "The council voted 5-2 on Tuesday to raise the water fee for the coming year.";
const RENTERS = "Experts say the increase will be felt hardest by renters.";
const RATE = "The new rate starts in January and adds 40 dollars to a typical monthly bill.";
const ATTRIBUTION_DRAFT = draft(VOTED, RENTERS, RATE);

/** The same draft with the unnamed attribution taken out: what a good repair
 *  looks like. Nothing else moved, and no name was invented to fill the gap. */
const ATTRIBUTION_FIXED = draft(VOTED, "The increase will be felt hardest by renters.", RATE);

/** Eight sentences that swing between two words and thirty-six. */
const VARIED_RHYTHM = draft(
  VOTED,
  "Residents packed the meeting room, and 14 of them spoke against the increase, saying the city had not explained how the money would be spent or why the rate had to rise this year rather than next.",
  "It passed.",
  "The new rate starts in January and adds about 40 dollars to a typical monthly bill, which the city says pays for replacing the aging mains under Elm Street and a new pump at the treatment plant on Route 9.",
  "Critics argue otherwise.",
  "The city's finance director told the council the fund would run short by 2029 without the increase, and he said the alternative was delaying the Elm Street work for another year or borrowing at a higher rate.",
  "The vote was close.",
  "Two council members said they wanted to wait for the audit due in March before setting a new rate, and they asked the manager to bring back a smaller increase for the next meeting.",
);

/** The same eight facts, every sentence sixteen words long. This is what
 *  over-cleaning looks like: nothing is wrong with any one sentence, and the
 *  draft has lost the thing the editor was reading it for. Every number and
 *  every mid-sentence name of `VARIED_RHYTHM` is kept, so the only thing this
 *  fixture can fail on is the rhythm. */
const FLAT_RHYTHM = draft(
  "The council voted 5-2 on Tuesday to raise the water fee for the coming year.",
  "Residents filled the meeting room and 14 of them spoke against the increase.",
  "The increase passed anyway and the new rate starts in January for every household.",
  "It adds about 40 dollars to a typical monthly bill for water service in the city.",
  "The city says the money pays for replacing the aging mains under Elm Street.",
  "It also pays for a new pump at the treatment plant out on Route 9.",
  "The finance director told the council the fund would run short by 2029 without it.",
  "Two members wanted to wait for the audit due in March before setting a new rate.",
);

const THREE_PROBLEMS = draft(
  "Experts say the council will raise the water fee.",
  "Critics argue the increase is unfair.",
  "Some believe the rate should stay flat.",
);

type Recorded = { request: DraftRepairRequest; round: number };

/** A provider that hands back a fixed body every time, recording what it was
 *  asked to do. No model, no clock, no I/O. */
function fakeRepair(answer: string | ((request: DraftRepairRequest) => string)): {
  call: DraftRepairCall;
  seen: Recorded[];
} {
  const seen: Recorded[] = [];
  const call: DraftRepairCall = async (request) => {
    seen.push({ request, round: seen.length + 1 });
    return { ok: true, body: typeof answer === "string" ? answer : answer(request) };
  };
  return { call, seen };
}

const failingRepair = (error: string): DraftRepairCall => async () => ({ ok: false, error });

const run = (body: string, repair: DraftRepairCall, headline = "", dek = "") =>
  repairDraftStyle({ headline, dek, body, form: "reported", repair });

describe("repairDraftStyle: a rewrite that fixes what the audit found", () => {
  it("accepts a rewrite that removes the unnamed attribution and leaves the rest alone", async () => {
    const fake = fakeRepair(ATTRIBUTION_FIXED);
    const outcome = await run(ATTRIBUTION_DRAFT, fake.call);
    assert.equal(outcome.status, "repaired");
    assert.equal(outcome.body, ATTRIBUTION_FIXED);
    assert.equal(outcome.rounds, 1);
    assert.equal(outcome.repairCalls, 1);
    assert.deepEqual(outcome.rejections, []);
    assert.equal(outcome.before.fixCount, 1);
    assert.equal(outcome.after.fixCount, 0);
    assert.match(outcome.note, /repaired the 1 problem/);
  });

  it("hands the model the position and the message, never a snippet of the draft", async () => {
    const fake = fakeRepair(ATTRIBUTION_FIXED);
    await run(ATTRIBUTION_DRAFT, fake.call);
    const [sent] = fake.seen;
    assert.equal(sent?.request.body, ATTRIBUTION_DRAFT);
    assert.equal(sent?.request.findings.length, 1);
    assert.equal(sent?.request.findings[0]?.paragraph, 2);
    assert.equal(sent?.request.findings[0]?.sentence, 1);
    assert.match(sent?.request.findings[0]?.message ?? "", /experts say|named/i);
    assert.deepEqual(Object.keys(sent?.request.findings[0] ?? {}).sort(), ["message", "paragraph", "sentence"]);
  });

  it("does not call the model at all when nothing needs fixing", async () => {
    let called = 0;
    const outcome = await run("The council voted on the water fee.\n\nThe new rate starts in January.", async () => {
      called += 1;
      return { ok: true, body: "should never be used" };
    });
    assert.equal(called, 0);
    assert.equal(outcome.status, "clean");
    assert.equal(outcome.repairCalls, 0);
    assert.equal(outcome.body, "The council voted on the water fee.\n\nThe new rate starts in January.");
    assert.match(outcome.note, /nothing to fix/);
  });

  it("records the measurements on both sides so the change can be shown", async () => {
    const fake = fakeRepair(ATTRIBUTION_FIXED);
    const outcome = await run(ATTRIBUTION_DRAFT, fake.call);
    assert.equal(outcome.before.measurements.sentenceCount, 3);
    assert.equal(outcome.after.measurements.sentenceCount, 3);
    assert.ok(outcome.before.measurements.wordCount > outcome.after.measurements.wordCount);
  });
});

describe("repairDraftStyle: rewrites the guard refuses", () => {
  it("keeps the previous text when the rewrite changes a number", async () => {
    const fake = fakeRepair(
      draft(VOTED, "The increase will be felt hardest by renters.", RATE.replace("40 dollars", "55 dollars")),
    );
    const outcome = await run(ATTRIBUTION_DRAFT, fake.call);
    assert.equal(outcome.status, "open");
    assert.equal(outcome.body, ATTRIBUTION_DRAFT);
    assert.equal(outcome.rejections.length, 1);
    assert.match(outcome.rejections[0]?.reason ?? "", /changed a number/);
    assert.match(outcome.note, /not used: it changed a number/);
    assert.equal(outcome.after.fixCount, 1);
    assert.equal(outcome.repairCalls, 1);
  });

  it("keeps the previous text when the rewrite drops a name", async () => {
    const named = draft(
      VOTED,
      "Rosa Delgado said the increase will be felt hardest by renters.",
      RATE,
      "Critics argue the fee is unfair.",
    );
    const fake = fakeRepair(
      draft(VOTED, "A resident said the increase will be felt hardest by renters.", RATE, "The fee is unfair."),
    );
    const outcome = await run(named, fake.call);
    assert.equal(outcome.body, named);
    assert.equal(outcome.status, "open");
    // The family name, not the first name: a word at the head of a sentence is
    // capitalised for free, so the guard reads names from the second word on.
    assert.match(outcome.rejections[0]?.reason ?? "", /dropped the name "Delgado"/);
  });

  it("keeps the previous text when the rewrite invents a name", async () => {
    const named = draft(VOTED, "The manager said the increase is needed.", RATE, "Critics argue the fee is unfair.");
    const fake = fakeRepair(
      draft(VOTED, "Manager Alvarez said the increase is needed.", RATE, "The fee is unfair."),
    );
    const outcome = await run(named, fake.call);
    assert.equal(outcome.body, named);
    assert.match(outcome.rejections[0]?.reason ?? "", /added the name/);
    assert.equal(outcome.status, "open");
  });

  it("keeps the previous text when the rewrite touches a quotation", async () => {
    const quoted = draft(
      VOTED,
      '"We cannot afford this," Delgado said at the meeting.',
      RATE,
      "Critics argue the fee is unfair.",
    );
    const fake = fakeRepair(
      draft(
        VOTED,
        '"We cannot afford that," Delgado said at the meeting.',
        RATE,
        "The fee is unfair.",
      ),
    );
    const outcome = await run(quoted, fake.call);
    assert.equal(outcome.body, quoted);
    assert.match(outcome.rejections[0]?.reason ?? "", /quoted words/);
  });

  it("keeps the previous text when the rewrite touches a link", async () => {
    const linked = draft(
      VOTED,
      "The full agenda is at https://example.com/agenda/2026.",
      RATE,
      "Critics argue the fee is unfair.",
    );
    const fake = fakeRepair(
      draft(
        VOTED,
        "The full agenda is at https://example.com/agenda/2027.",
        RATE,
        "The fee is unfair.",
      ),
    );
    const outcome = await run(linked, fake.call);
    assert.equal(outcome.body, linked);
    assert.match(outcome.rejections[0]?.reason ?? "", /changed a link/);
  });

  it("keeps the previous text when the rewrite evened out the rhythm", async () => {
    const before = audit(VARIED_RHYTHM);
    const after = audit(FLAT_RHYTHM);
    // The fixture is only meaningful if it really does lose the variation.
    assert.ok(before.measurements.sentenceLengthCv >= DRAFT_AUDIT_LIMITS.minSentenceLengthCv);
    assert.ok(after.measurements.sentenceLengthCv < DRAFT_AUDIT_LIMITS.minSentenceLengthCv);
    assert.ok(before.fixCount > 0);

    const fake = fakeRepair(FLAT_RHYTHM);
    const outcome = await run(VARIED_RHYTHM, fake.call);
    assert.equal(outcome.body, VARIED_RHYTHM);
    assert.equal(outcome.status, "open");
    assert.match(outcome.rejections[0]?.reason ?? "", /evened out the sentence lengths/);
  });

  it("keeps the previous text when the rewrite guts the draft", async () => {
    const fake = fakeRepair("The fee went up.");
    const outcome = await run(ATTRIBUTION_DRAFT, fake.call);
    assert.equal(outcome.body, ATTRIBUTION_DRAFT);
    assert.match(outcome.rejections[0]?.reason ?? "", /cut the draft down|unchanged/);
  });
});

describe("repairDraftStyle: the loop is bounded", () => {
  it("stops after two rounds and leaves the remaining problems to the editor", async () => {
    // A provider that fixes only the first problem it is given, every time.
    const fake = fakeRepair((request) => {
      const first = request.findings[0];
      if (!first) return request.body;
      const lines = request.body.split("\n\n");
      const fixed = lines.map((line, index) =>
        index + 1 === first.paragraph
          ? line.replace(/^(Experts say|Critics argue|Some believe)\s+/i, "").replace(/^./, (c) => c.toUpperCase())
          : line,
      );
      return fixed.join("\n\n");
    });
    const outcome = await run(THREE_PROBLEMS, fake.call);
    assert.equal(outcome.rounds, DRAFT_REPAIR_LIMITS.maxRounds);
    assert.equal(outcome.repairCalls, DRAFT_REPAIR_LIMITS.maxRounds);
    assert.equal(fake.seen.length, DRAFT_REPAIR_LIMITS.maxRounds);
    assert.equal(outcome.status, "open");
    assert.equal(outcome.before.fixCount, 3);
    assert.equal(outcome.after.fixCount, 1);
    assert.match(outcome.note, /1 problem to fix is still there/);
  });

  it("stops as soon as the audit comes back clean", async () => {
    const outcome = await run(THREE_PROBLEMS, fakeRepair(draft("The council will raise the water fee.", "The increase is unfair.", "The rate should stay flat.")).call);
    assert.equal(outcome.status, "repaired");
    assert.equal(outcome.rounds, 1);
    assert.equal(outcome.after.fixCount, 0);
  });

  it("stops after one round when the model hands back the draft unchanged", async () => {
    const fake = fakeRepair(THREE_PROBLEMS);
    const outcome = await run(THREE_PROBLEMS, fake.call);
    assert.equal(outcome.repairCalls, 1);
    assert.equal(outcome.body, THREE_PROBLEMS);
    assert.match(outcome.rejections[0]?.reason ?? "", /unchanged/);
    assert.equal(outcome.status, "open");
  });

  it("never asks for a rewrite it cannot use: only body findings, up to the cap", async () => {
    const result = auditDraft({
      headline: "Experts say the fee will rise",
      dek: "Critics argue otherwise.",
      body: THREE_PROBLEMS,
      form: "reported",
    });
    const instructions = repairInstructions(result);
    assert.ok(instructions.every((finding) => finding.paragraph > 0));
    assert.equal(instructions.length, 3);
    assert.deepEqual(
      repairInstructions(result, 2).map((finding) => finding.paragraph),
      [1, 2],
    );
  });
});

describe("repairDraftStyle: a provider that fails", () => {
  it("leaves the draft exactly as it was and says so plainly", async () => {
    const outcome = await run(ATTRIBUTION_DRAFT, failingRepair("The writing provider timed out."));
    assert.equal(outcome.status, "provider-failed");
    assert.equal(outcome.body, ATTRIBUTION_DRAFT);
    assert.equal(outcome.rounds, 1);
    assert.equal(outcome.repairCalls, 1);
    assert.deepEqual(outcome.after.findings, outcome.before.findings);
    assert.match(outcome.note, /did not run: The writing provider timed out\./);
    assert.match(outcome.note, /draft is unchanged/);
    // A plain message, not a stack: one sentence, and no newlines in it.
    assert.ok(!outcome.note.includes("\n"));
  });

  it("keeps the text from a first round that was accepted when the second round fails", async () => {
    let calls = 0;
    const outcome = await run(THREE_PROBLEMS, async () => {
      calls += 1;
      return calls === 1
        ? { ok: true, body: draft("The council will raise the water fee.", "Critics argue the increase is unfair.", "Some believe the rate should stay flat.") }
        : { ok: false, error: "The writing provider is unavailable." };
    });
    assert.equal(outcome.status, "provider-failed");
    assert.equal(outcome.repairCalls, 2);
    assert.equal(outcome.after.fixCount, 2);
    assert.equal(outcome.body, draft("The council will raise the water fee.", "Critics argue the increase is unfair.", "Some believe the rate should stay flat."));
  });
});

describe("repairKeepsFacts", () => {
  const before = [
    "The council voted 5-2 on Tuesday.",
    '"We cannot afford this," Delgado said.',
    "The agenda is at https://example.com/agenda/2026.",
    "The manager said the fee covers 40 miles of main.",
  ].join(" ");

  it("allows a rewrite that keeps every fact", () => {
    const after = before.replace("The manager said the fee covers", "The fee covers");
    assert.equal(repairKeepsFacts(before, after), null);
  });

  it("allows a quotation to move, as long as its words do not change", () => {
    const after = [
      '"We cannot afford this," Delgado said.',
      "The council voted 5-2 on Tuesday.",
      "The agenda is at https://example.com/agenda/2026.",
      "The manager said the fee covers 40 miles of main.",
    ].join(" ");
    assert.equal(repairKeepsFacts(before, after), null);
  });

  it("refuses an empty rewrite", () => {
    assert.match(repairKeepsFacts(before, "   "), /returned nothing/);
  });

  it("refuses a rewrite that changes a number", () => {
    assert.match(repairKeepsFacts(before, before.replace("40 miles", "45 miles")), /changed a number/);
  });

  it("refuses a rewrite that drops a name", () => {
    assert.match(repairKeepsFacts(before, before.replace("Delgado said", "an official said")), /dropped the name "Delgado"/);
  });

  it("refuses a rewrite that invents a name", () => {
    assert.match(
      repairKeepsFacts(before, before.replace("Delgado said", "Delgado and Alvarez said")),
      /added the name "Alvarez"/,
    );
  });

  it("refuses a rewrite that rewrites a quotation", () => {
    assert.match(repairKeepsFacts(before, before.replace("cannot afford this", "cannot afford that")), /quoted words/);
  });

  it("refuses a rewrite that changes a link", () => {
    assert.match(repairKeepsFacts(before, before.replace("/agenda/2026", "/agenda/2027")), /changed a link/);
  });

  it("refuses a rewrite that loses most of the draft", () => {
    assert.match(repairKeepsFacts(before, "The fee went up."), /cut the draft down/);
  });
});

describe("repairFlattenedRhythm", () => {
  it("says nothing when the draft had no rhythm to lose", () => {
    const flat = audit(FLAT_RHYTHM);
    assert.equal(repairFlattenedRhythm(flat, flat), null);
  });

  it("says nothing about drafts too short for the measurement to mean anything", () => {
    const short = audit(draft(VOTED, "It passed.", RATE));
    assert.ok(short.measurements.sentenceCount < DRAFT_AUDIT_LIMITS.minSentencesForRhythm);
    assert.equal(repairFlattenedRhythm(short, audit(FLAT_RHYTHM)), null);
  });

  it("names the problem when a varied draft comes back even", () => {
    assert.match(
      repairFlattenedRhythm(audit(VARIED_RHYTHM), audit(FLAT_RHYTHM)) ?? "",
      /evened out the sentence lengths/,
    );
  });

  it("allows a rewrite that keeps the variation", () => {
    assert.equal(repairFlattenedRhythm(audit(VARIED_RHYTHM), audit(VARIED_RHYTHM)), null);
  });
});

describe("buildDraftRepairPrompt", () => {
  it("gives the model the problems, the draft, and the rules that protect it", () => {
    const request: DraftRepairRequest = {
      findings: [{ paragraph: 2, sentence: 1, message: "Nobody is named for this claim." }],
      body: ATTRIBUTION_DRAFT,
    };
    const prompt = buildDraftRepairPrompt(request);
    assert.match(prompt.user, /Paragraph 2, sentence 1: Nobody is named for this claim\./);
    assert.match(prompt.user, /The draft:/);
    assert.ok(prompt.user.includes(ATTRIBUTION_DRAFT));
    assert.match(prompt.system, /quotation marks belong to the person who said them/i);
    assert.match(prompt.system, /Never add a fact/);
    assert.match(prompt.system, /corrected draft alone/);
  });
});

describe("the fixture itself", () => {
  it("reads as the local-news sentences the audit was written for", () => {
    assert.deepEqual(codesOf(ATTRIBUTION_DRAFT), ["unnamed-attribution"]);
    assert.deepEqual(codesOf(ATTRIBUTION_FIXED), []);
    assert.deepEqual(codesOf(THREE_PROBLEMS), ["unnamed-attribution"]);
  });
});
