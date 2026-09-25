import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const FIXTURE_URL = new URL("./__fixtures__/golden-meetings/longmont-2026-09-22.json", import.meta.url);

// BEGIN DRAFT-164-VERBATIM
const DRAFT_164_RAW = `HEADLINE
Longmont council votes 4-3 to revive marijuana hospitality ordinance, retail sales licenses only

DEK
Three unidentified speakers opposed the motion directing staff to bring back a revised ordinance authorizing only retail marijuana hospitality and sales business licenses.

BODY
Longmont's City Council voted 4-3 on Sept. 22 to direct the city manager and city attorney to bring back ordinance O2025-37 on marijuana hospitality "as originally proposed with any necessary updates or conforming changes," with the added direction that the ordinance package authorize only retail marijuana hospitality and sales business licenses and make the necessary amendments to chapter 6.70 of the municipal code.

The motion was made by an unidentified speaker and seconded by Mayor Pro Tem an unidentified speaker, and it carried 4-3 with three unidentified speakers in opposition, according to the meeting transcript. The motion directs staff to return on a timeline consistent with the staff work plan; no specific date for that return is stated in the recording.

The vote came during the council's future agenda items discussion. The transcript shows the motion was taken up under that agenda item rather than as a scheduled public hearing.

A council member who supported the motion said the ordinance "really is designed to do two things" and referenced work done over the past year, saying the previous council and staff had halted that work. The transcript does not clearly capture the full explanation.

A council member who opposed the motion said they would be voting no, describing the proposal as a "marijuana revenue booster" and saying this council "deserves the opportunity" to consider targeted changes. The transcript attributes those words to a council member but does not clearly identify which member spoke them.

What the revived ordinance would permit, how many licenses it would create, and what revenue it might generate are not stated in the recording.

The transcript's tally and the named opposition are transcript-based; structured or official confirmation is still pending.

(used citations: 50)`;
// END DRAFT-164-VERBATIM

const CORRECT_STORY = {
  headline: "Longmont council carries marijuana hospitality revival 4-3, retail licenses only",
  dek: "The motion directs staff to bring back a revised ordinance authorizing only retail marijuana hospitality and sales business licenses.",
  body: [
    "Longmont's City Council voted 4-3 on Sept. 22 to direct staff to bring back a revised marijuana hospitality ordinance authorizing only retail marijuana hospitality and sales business licenses.",
    "Council Member Jake Marsing moved the motion and Council Member Alex Kalkhofer seconded it.",
    "The motion was opposed by Council Members Diane Crist, Matthew Popkin and Crystal Prieto, while Council Members Jake Marsing and Alex Kalkhofer joined Mayor Susie Hidalgo-Fahring and Mayor Pro Tem Sean McCoy in support.",
  ].join("\n\n"),
};

function verdictOf(score: { verdicts: Array<{ kind: string; subject: string; verdict: string }> }, kind: string, subject: string) {
  const hit = score.verdicts.find((v) => v.kind === kind && v.subject === subject);
  assert.ok(hit, `expected a ${kind} verdict for ${subject}`);
  return hit!.verdict;
}

describe("golden meeting facts: fixture", () => {
  it("exists and records caption evidence for every fact, using roster names", async () => {
    const { loadGoldenFixture } = await import("./golden-facts.ts");
    assert.equal(existsSync(FIXTURE_URL), true, "golden fixture must exist");
    const raw = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));
    const fixture = loadGoldenFixture(raw);
    assert.equal(fixture.meeting.id, "longmont-2026-09-22");
    assert.equal(fixture.roster.length, 7);
    assert.ok(fixture.facts.some((f) => f.kind === "seconder" && f.person === "Alex Kalkhofer"));
    for (const fact of fixture.facts) {
      assert.ok(fact.evidence.length >= 1, `${fact.kind} fact must cite evidence`);
      assert.ok(
        fact.evidence.some((e) => e.source === "recording" && e.t_ms > 0 && e.quote.length > 0),
        `${fact.kind} fact must cite a caption timestamp and quote`,
      );
      if (fact.person) {
        assert.ok(fact.nameSource === "roster", `${fact.kind} must take its spelling from the roster`);
        assert.ok(
          fixture.roster.some((m) => m.name === fact.person),
          `${fact.person} must be spelled the way the roster spells it`,
        );
      }
    }
    // Facts read off the recording carry a caption quote; the in-favor side is derived, and
    // says so, because the captions never name the four who voted with the majority.
    for (const fact of fixture.facts) {
      if (fact.factSource === "recording") {
        assert.ok(fact.evidence.some((e) => e.source === "recording" && e.quote.length > 0), `${fact.kind} must quote the recording`);
      } else {
        assert.equal(fact.factSource, "recording+roster");
        assert.match(fact.derivation, /derived/i, `${fact.kind} must say how it was derived`);
      }
    }
  });

  it("keeps caption spellings as aliases, never as official names", async () => {
    const { loadGoldenFixture } = await import("./golden-facts.ts");
    const fixture = loadGoldenFixture(JSON.parse(readFileSync(FIXTURE_URL, "utf8")));
    const allNames = fixture.roster.map((m) => m.name);
    for (const alias of ["Marcine", "Coloffer", "Christrist", "Brito"]) {
      assert.equal(allNames.includes(alias), false, `${alias} is a caption spelling, not a roster name`);
    }
    const marsing = fixture.roster.find((m) => m.name === "Jake Marsing");
    assert.ok(marsing!.captionAliases.includes("Marcine"));
  });
});

describe("golden meeting facts: scoring real drafts", () => {
  it("fails draft 164: the seconder carries a title that belongs to another member", async () => {
    const { parseStoryText, scoreGoldenFacts, loadGoldenFixture } = await import("./golden-facts.ts");
    const fixture = loadGoldenFixture(JSON.parse(readFileSync(FIXTURE_URL, "utf8")));
    const story = parseStoryText(DRAFT_164_RAW);
    assert.match(story.body, /seconded by Mayor Pro Tem an unidentified speaker/, "the quoted draft text must be intact");
    const score = scoreGoldenFacts(story, fixture);
    assert.equal(verdictOf(score, "seconder", "Alex Kalkhofer"), "masked-wrong-role");
    assert.equal(verdictOf(score, "mover", "Jake Marsing"), "masked-correct-role");
    assert.equal(verdictOf(score, "result", "4-3"), "correct");
    assert.equal(verdictOf(score, "opposed", "Diane Crist"), "not-stated");
    assert.equal(score.pass, false);
    const seconder = score.verdicts.find((v) => v.kind === "seconder");
    assert.match(seconder!.sentence ?? "", /seconded by Mayor Pro Tem an unidentified speaker/);
  });

  it("passes a story that names the mover, the seconder, the tally and the opposition", async () => {
    const { scoreGoldenFacts, loadGoldenFixture } = await import("./golden-facts.ts");
    const fixture = loadGoldenFixture(JSON.parse(readFileSync(FIXTURE_URL, "utf8")));
    const score = scoreGoldenFacts(CORRECT_STORY, fixture);
    assert.deepEqual(score.failures, []);
    assert.equal(verdictOf(score, "mover", "Jake Marsing"), "correct");
    assert.equal(verdictOf(score, "seconder", "Alex Kalkhofer"), "correct");
    assert.equal(verdictOf(score, "result", "4-3"), "correct");
    assert.equal(verdictOf(score, "opposed", "Crystal Prieto"), "correct");
    assert.equal(verdictOf(score, "in-favor", "Sean McCoy"), "correct");
    assert.equal(score.pass, true);
  });

  it("calls an inverted opponent wrong", async () => {
    const { scoreGoldenFacts, loadGoldenFixture } = await import("./golden-facts.ts");
    const fixture = loadGoldenFixture(JSON.parse(readFileSync(FIXTURE_URL, "utf8")));
    const story = {
      ...CORRECT_STORY,
      body: CORRECT_STORY.body.replace(
        "The motion was opposed by Council Members Diane Crist, Matthew Popkin and Crystal Prieto, while",
        "The motion was opposed by Council Members Diane Crist and Matthew Popkin, while Council Member Crystal Prieto joined",
      ),
    };
    const score = scoreGoldenFacts(story, fixture);
    assert.equal(verdictOf(score, "opposed", "Diane Crist"), "correct");
    assert.equal(verdictOf(score, "opposed", "Crystal Prieto"), "wrong");
    assert.equal(score.pass, false);
    assert.ok(score.failures.some((f) => /Prieto/.test(f)));
  });

  it("treats a missing tally as not-stated and still fails a vote-led story", async () => {
    const { scoreGoldenFacts, loadGoldenFixture } = await import("./golden-facts.ts");
    const fixture = loadGoldenFixture(JSON.parse(readFileSync(FIXTURE_URL, "utf8")));
    const story = {
      headline: "Longmont council directs staff to revive marijuana hospitality ordinance",
      dek: CORRECT_STORY.dek,
      body: [
        "Longmont's City Council directed staff on Sept. 22 to bring back a revised marijuana hospitality ordinance authorizing only retail marijuana hospitality and sales business licenses.",
        "Council Member Jake Marsing moved the motion and Council Member Alex Kalkhofer seconded it.",
        CORRECT_STORY.body.split("\n\n")[2],
      ].join("\n\n"),
    };
    const score = scoreGoldenFacts(story, fixture);
    assert.equal(verdictOf(score, "result", "4-3"), "not-stated");
    assert.equal(verdictOf(score, "opposed", "Crystal Prieto"), "correct");
    assert.equal(score.pass, false);
    assert.ok(score.failures.some((f) => /4-3/.test(f)));
  });

  it("calls a caption spelling of a named mover wrong", async () => {
    const { scoreGoldenFacts, loadGoldenFixture } = await import("./golden-facts.ts");
    const fixture = loadGoldenFixture(JSON.parse(readFileSync(FIXTURE_URL, "utf8")));
    const story = {
      ...CORRECT_STORY,
      body: CORRECT_STORY.body.replace(
        "Council Member Jake Marsing moved the motion and Council Member Alex Kalkhofer seconded it.",
        "Council Member Marcine moved the motion and Council Member Coloffer seconded it.",
      ),
    };
    const score = scoreGoldenFacts(story, fixture);
    assert.equal(verdictOf(score, "mover", "Jake Marsing"), "wrong");
    assert.equal(verdictOf(score, "seconder", "Alex Kalkhofer"), "wrong");
    assert.match(score.verdicts.find((v) => v.kind === "seconder")!.reason, /caption/);
    assert.equal(score.pass, false);
  });
});
