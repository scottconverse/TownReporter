import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BLACK_DESK_CONFIDENCE_CAP,
  MIN_QUERY_VARIATIONS,
  POSTURES,
  adversarialQueries,
  capSpeculativeConfidence,
  enforceSearchMinimums,
  newsworthyDecision,
  normalizePosture,
  queryVariations,
  readGates,
  readNewsworthiness,
  stageWords,
  tierForQuery,
  tierForUrl,
  verify,
  type AdversarialRecord,
} from "./dark-gates.ts";

/**
 * The operator's own doctrine, pinned.
 *
 * These are not style rules. Every assertion below quotes a line from one of
 * the two original prompts (civic-newsroom/prompts/03-black-desk.md and
 * 04-dark-signal-desk.md) or from civic-scanner's SKILL.md, and each one had
 * drifted out of this desk by 0.6.22.
 */

const PLACE = { city: "Longmont", state: "Colorado", county: "Boulder" };

/** The survey story: an incident pattern the desk is supposed to catch. */
const SURVEY_SIGNAL = {
  name: "Resident survey results promised in March never posted",
  observation:
    "The city said the housing survey results would be published in March. The results page has not changed since January.",
};

/** The 0.6.14 regression: the desk narrating its own sandbox at the editor. */
const SANDBOX_SIGNAL = {
  name: "WebFetch was refused by the sandbox policy",
  observation: "The tool call was denied and the search could not run.",
};

describe("Black Desk — stage 1 confidence cap", () => {
  /*
    "Confidence range for all signals: 0.1-0.5 (Low). By design. This is the
    feature." (03-black-desk.md:26). TownReporter had per-label ceilings up to
    1.0 on the only pass it ran.
  */
  it("caps every stage-1 signal at 0.5 however confident the model claims to be", () => {
    assert.equal(capSpeculativeConfidence(0.95), BLACK_DESK_CONFIDENCE_CAP);
    assert.equal(capSpeculativeConfidence(1), 0.5);
    assert.equal(capSpeculativeConfidence(0.4), 0.4);
  });

  it("floors at 0.1 and survives a missing or junk number", () => {
    assert.equal(capSpeculativeConfidence(0), 0.1);
    assert.equal(capSpeculativeConfidence(undefined), 0.1);
    assert.equal(capSpeculativeConfidence("banana"), 0.1);
  });
});

describe("the three postures", () => {
  /*
    "THREE DETECTION POSTURES" (03-black-desk.md:47-63). Two more had been
    added here -- "Chorus that rhymes" and "The web" -- and a whole RULE
    existed only to keep the invented Chorus posture from becoming an
    accusation.
  */
  it("is exactly the original three", () => {
    assert.deepEqual([...POSTURES], ["Dog That Didn't Bark", "Whisper", "Fiscal Fray"]);
  });

  it("maps the two invented postures back onto the three", () => {
    assert.equal(normalizePosture("Chorus that rhymes"), "Whisper");
    assert.equal(normalizePosture("The web"), "Whisper");
    assert.equal(normalizePosture("Dog that didn't bark"), "Dog That Didn't Bark");
    assert.equal(normalizePosture("missing document"), "Dog That Didn't Bark");
    assert.equal(normalizePosture("fiscal fray"), "Fiscal Fray");
    assert.equal(normalizePosture("budget anomaly"), "Fiscal Fray");
  });
});

describe("search minimums", () => {
  /*
    "Query variations: Try at least 3 distinct query variations before
    documenting 'not found'" (04-dark-signal-desk.md:100-102), and
    civic-scanner's location context (SKILL.md:180-182).
  */
  it("gives every hypothesis at least three distinct query variations", () => {
    const out = queryVariations("water main replacements deferred", PLACE);
    assert.ok(out.length >= MIN_QUERY_VARIATIONS, `only ${out.length} variations`);
    assert.equal(new Set(out).size, out.length, "the variations must be distinct");
  });

  it("scopes every query to the city, and reaches the county", () => {
    const out = queryVariations("water main replacements deferred", PLACE);
    for (const q of out) assert.match(q, /Longmont|Boulder County/);
    assert.ok(out.some((q) => q.includes("Boulder County")));
  });

  it("fills a thin planner up to the minimum without dropping its own queries", () => {
    const planned = ["council packet Longmont"];
    const out = enforceSearchMinimums(planned, ["water main replacements deferred"], PLACE);
    assert.equal(out[0], "council packet Longmont", "the planner's query keeps its place");
    assert.ok(out.length >= 1 + MIN_QUERY_VARIATIONS);
  });

  it("adds the place to an unscoped planner query rather than running it bare", () => {
    const out = enforceSearchMinimums(["franchise fee transfer"], [], PLACE);
    assert.equal(out[0], "franchise fee transfer Longmont");
  });
});

describe("domain tiers", () => {
  /*
    civic-scanner v2.1 orders them: official .gov first, then local press,
    then community (SKILL.md:100-133, 170-177).
  */
  it("records which tier answered", () => {
    assert.equal(tierForUrl("https://longmontcolorado.gov/agenda"), "official");
    assert.equal(tierForUrl("https://www.reddit.com/r/longmont/x"), "community");
    assert.equal(tierForUrl("https://longmontleader.com/story"), "local-press");
  });

  it("falls back to the tier a query was aiming at when nothing answered", () => {
    assert.equal(tierForQuery("site:longmontcolorado.gov budget"), "official");
    assert.equal(tierForQuery("water pressure reddit longmont"), "community");
    assert.equal(tierForQuery("longmont survey reported"), "local-press");
  });
});

describe("the mandatory adversarial searches", () => {
  /*
    "If adversarial search is required, execute ALL of the following"
    (04-dark-signal-desk.md:74-93), across "a minimum of 3 platforms"
    (line 96). The app runs these; the model never gets a tool.
  */
  it("emits at least four queries covering the ordinary explanation, the record, press and the opposing account", () => {
    const qs = adversarialQueries(SURVEY_SIGNAL, PLACE, ["longmontcolorado.gov"]);
    assert.ok(qs.length >= 4, `only ${qs.length} adversarial queries`);
    assert.deepEqual(
      qs.map((q) => q.kind).sort(),
      ["counter", "official", "ordinary", "press"],
    );
    assert.ok(new Set(qs.map((q) => q.tier)).size >= 3, "fewer than three kinds of source");
    for (const q of qs) assert.match(q.query, /Longmont|Boulder County/);
    assert.ok(
      qs.some((q) => /routine|scheduled|normal process|explanation/i.test(q.query)),
      "no query looks for the boring explanation",
    );
  });
});

const FULL_SEARCHES: AdversarialRecord[] = [
  { query: "a", kind: "ordinary", tier: "official", url: null, outcome: "no results found", hits: 0 },
  { query: "b", kind: "official", tier: "official", url: "u", outcome: "1 result(s)", hits: 1 },
  { query: "c", kind: "press", tier: "local-press", url: "u", outcome: "2 result(s)", hits: 2 },
  { query: "d", kind: "counter", tier: "community", url: "u", outcome: "1 result(s)", hits: 1 },
];

const FULL_GATES = {
  disproof_attempted: "Searched for the routine explanation first; the results page is on a quarterly cycle.",
  source_independence: "Both mentions trace back to the same January press release.",
  missing_context: "Nobody has asked the housing division whether the survey was rescheduled.",
  self_referential: false,
};

describe("the four gates", () => {
  /*
    "If ANY item unchecked -> Signal is INCOMPLETE. Do not publish."
    (04-dark-signal-desk.md:147)
  */
  it("finalizes only when all four gates are answered and the searches were run", () => {
    const reading = readGates(FULL_GATES);
    assert.deepEqual(reading.missing, []);
    const v = verify({ ...reading, adversarial: FULL_SEARCHES });
    assert.equal(v.status, "verified");
  });

  it("will not finalize with a gate missing, and names the one that is missing", () => {
    const reading = readGates({ ...FULL_GATES, missing_context: "" });
    const v = verify({ ...reading, adversarial: FULL_SEARCHES });
    assert.equal(v.status, "unverified");
    assert.match(v.missing.join(" "), /missing/i);
    assert.match(v.reason, /Still missing/);
  });

  it("treats a one-word shrug as a missing gate, not a filled one", () => {
    const reading = readGates({ ...FULL_GATES, disproof_attempted: "none" });
    assert.ok(reading.missing.includes("disproof_attempted"));
  });

  it("will not finalize when the adversarial searches were not all run", () => {
    const v = verify({
      ...readGates(FULL_GATES),
      adversarial: FULL_SEARCHES.slice(0, 2),
    });
    assert.equal(v.status, "unverified");
    assert.match(v.missing.join(" "), /adversarial searches/);
  });

  /*
    Gate 4. "Is this signal about AI, journalism, information integrity, or
    civic intelligence? ... These topics create cognitive blind spots"
    (04-dark-signal-desk.md:128-136). This is the gate that would have caught
    the sandbox-narration garbage of 0.6.14.
  */
  it("never finalizes a self-referential signal, even with every other gate answered", () => {
    const v = verify({
      ...readGates({ ...FULL_GATES, self_referential: true }),
      adversarial: FULL_SEARCHES,
    });
    assert.equal(v.status, "unverified");
    assert.match(v.reason, /about AI, journalism or the tool itself/);
  });

  it("catches the 0.6.14 sandbox-narration pattern even when the model says self_referential is false", () => {
    const v = verify({
      ...readGates(FULL_GATES),
      adversarial: FULL_SEARCHES,
      text: `${SANDBOX_SIGNAL.name} ${SANDBOX_SIGNAL.observation}`,
    });
    assert.equal(v.status, "unverified");
  });

  it("says which stage a signal is at, in words", () => {
    assert.match(stageWords({ stage: "black-desk" }).chip, /Black Desk/);
    assert.match(stageWords({ stage: "black-desk" }).sentence, /capped at 50%/);
    assert.match(
      stageWords({ stage: "dark-signal-desk", verification_status: "verified" }).chip,
      /Verified · four gates/,
    );
    const un = stageWords({
      stage: "dark-signal-desk",
      verification_status: "unverified",
      gates_missing: "what context is missing",
    });
    assert.match(un.chip, /Unverified/);
    assert.match(un.sentence, /what context is missing/);
  });
});

describe("the newsworthiness gate", () => {
  /*
    civic-scanner's ninth agent: "This gate can KILL or DEMOTE stories"
    (SKILL.md:560-563). Three questions; a no to all three is a watch item.
  */
  it("keeps a no / no / no signal in the file as a watch item, not a lead", () => {
    const n = readNewsworthiness({
      life_changes: false,
      is_new: false,
      has_record: false,
      note: "Routine annual posting.",
    });
    assert.equal(newsworthyDecision(n), "watch");
  });

  it("advances a signal that answers yes to any of the three", () => {
    assert.equal(
      newsworthyDecision(
        readNewsworthiness({ life_changes: false, is_new: false, has_record: true }),
      ),
      "lead",
    );
  });

  it("treats an unanswered gate as a watch item rather than assuming a story", () => {
    assert.equal(newsworthyDecision(readNewsworthiness(null)), "watch");
    assert.equal(newsworthyDecision(readNewsworthiness({})), "watch");
  });
});
