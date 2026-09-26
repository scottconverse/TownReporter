/**
 * Unit tests for the mechanical style audit (unit AQ, 0.6.71).
 *
 * The fixtures are local-news sentences on purpose: an audit tuned on
 * "Lorem ipsum" tells you nothing about whether it fires on a real council
 * story. Every check has a positive case and the negative that matters most --
 * the sentence an over-eager rule would wrongly flag.
 *
 * Nothing here runs a model or touches a database; `draft-audit.ts` is pure.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  auditDraft,
  maskQuotedText,
  repeatedSixWordRuns,
  styleCheckLabel,
  type DraftAuditFinding,
  type DraftAuditResult,
} from "./draft-audit.ts";

/** Audit with the boring fields filled in, so each test shows only what it tests. */
const audit = (input: Partial<{ headline: string; dek: string; body: string; form: string }>): DraftAuditResult =>
  auditDraft({ headline: "", dek: "", body: "", form: "reported", ...input });

const withCode = (result: DraftAuditResult, code: string): DraftAuditFinding[] =>
  result.findings.filter((finding) => finding.code === code);

const codes = (result: DraftAuditResult): string[] => [...new Set(result.findings.map((f) => f.code))].sort();

// Invisible characters built from code points, never typed literally: a
// homoglyph pasted into this file would be just as hard to see as it is in a
// draft, which is the whole reason the check exists.
const nbsp = String.fromCharCode(0x00a0);
const zeroWidthSpace = String.fromCharCode(0x200b);
const cyrillicEs = String.fromCharCode(0x0441); // looks like a Latin "c"
const greekPi = String.fromCharCode(0x03c0); // looks like a Latin "n" in some fonts

describe("unnamed attribution", () => {
  it("flags a claim attributed to nobody", () => {
    const result = audit({ body: "Experts say the bridge on Main Street will reopen in March. The contractor poured the last deck section on Tuesday." });
    const [finding] = withCode(result, "unnamed-attribution");
    assert.equal(finding.severity, "fix");
    assert.equal(finding.paragraph, 1);
    assert.equal(finding.sentence, 1);
    assert.match(finding.message, /experts say/);
    assert.equal(finding.snippet, "Experts say the bridge on Main Street will reopen in March.");
  });

  it("flags each of the unnamed phrasings the desk listed", () => {
    const sentences: Array<[string, string]> = [
      ["critics argue", "Critics argue the fee is too high for small businesses."],
      ["observers note", "Observers note the turnout was higher than in 2023."],
      ["studies show", "Studies show the crossing is dangerous for children."],
      ["some believe", "Some believe the county should buy the parcel."],
      ["sources say", "Sources say the manager will resign before the election."],
    ];
    for (const [phrase, sentence] of sentences) {
      const result = audit({ body: `${sentence} The council meets again in January.` });
      const [finding] = withCode(result, "unnamed-attribution");
      assert.ok(finding, `expected a finding for "${phrase}"`);
      assert.match(finding.message, new RegExp(phrase));
    }
  });

  it("does not flag attribution inside quotation marks: those are the source's words", () => {
    const result = audit({
      body: `"Experts say the dam is safe," the county engineer told the board on Tuesday.`,
    });
    assert.deepEqual(withCode(result, "unnamed-attribution"), []);
    assert.equal(result.fixCount, 0);
  });

  it("does not flag a sentence that names the speaker, even next to an unnamed phrase", () => {
    const named = audit({ body: "The city manager said critics argue the project costs too much." });
    assert.deepEqual(withCode(named, "unnamed-attribution"), []);

    const person = audit({ body: "Dan Jones said experts were wrong about the dam." });
    assert.deepEqual(withCode(person, "unnamed-attribution"), []);
  });

  it("still flags an unnamed phrase that sits outside a quotation in the same sentence", () => {
    const result = audit({
      body: `"We are not done," said Mayor Joan Peck, but critics argue the fence is unsafe. The council votes again in October.`,
    });
    const flagged = withCode(result, "unnamed-attribution");
    assert.equal(flagged.length, 1);
    assert.match(flagged[0].message, /critics argue/);
  });

  it("leaves plain reporting alone", () => {
    const result = audit({
      body: "The council is accepting comments on the fence ordinance until Friday. The clerk said the record closes at 5 p.m.",
    });
    assert.deepEqual(codes(result), []);
  });
});

describe("sentences that only say the subject matters", () => {
  it("flags a significance claim", () => {
    const result = audit({ body: "The council's vote on Tuesday marks a turning point for the district. The fee rises in January." });
    const [finding] = withCode(result, "importance-only");
    assert.equal(finding.severity, "fix");
    assert.match(finding.message, /marks a turning point/);
    assert.equal(finding.paragraph, 1);
    assert.equal(finding.sentence, 1);
  });

  it("flags a broader-shift claim", () => {
    const result = audit({
      body: "The decision reflects a broader shift in how the county pays for roadwork. The work starts in April.",
    });
    assert.equal(withCode(result, "importance-only").length, 1);
  });

  it("does not flag a sentence that names what changes", () => {
    const result = audit({
      body: "The fee rises from $12 to $18 on January 1. The council set the rate on Tuesday.",
    });
    assert.deepEqual(withCode(result, "importance-only"), []);
  });
});

describe("participle tails", () => {
  it("flags an -ing tail that asserts importance", () => {
    const result = audit({
      body: "The district added 40 seats to the Niwot bus route, highlighting its commitment to families. The route changes on Monday.",
    });
    const [finding] = withCode(result, "participle-tail");
    assert.equal(finding.severity, "fix");
    assert.match(finding.message, /highlighting/);
  });

  it("flags the other tails on the desk's list", () => {
    for (const tail of ["underscoring", "signaling", "cementing", "reflecting"]) {
      const result = audit({
        body: `The county opened the new lot, ${tail} the growth along the corridor. Crews pave in June.`,
      });
      assert.equal(withCode(result, "participle-tail").length, 1, `expected a finding for "${tail}"`);
    }
  });

  it("does not flag a comma clause that reports a second fact", () => {
    const result = audit({
      body: "The county opened the new lot on Third Avenue, and crews will pave the entrance in June.",
    });
    assert.deepEqual(withCode(result, "participle-tail"), []);
  });

  it("does not flag a tail inside a quotation", () => {
    const result = audit({
      body: `The clerk called the delay "frustrating, underscoring the backlog," and the council agreed.`,
    });
    assert.deepEqual(withCode(result, "participle-tail"), []);
  });

  it("reports one finding for a sentence that is both a significance claim and a tail", () => {
    const result = audit({ body: "The vote marks a turning point for the district, highlighting the board's new direction." });
    assert.equal(withCode(result, "importance-only").length, 1);
    assert.deepEqual(withCode(result, "participle-tail"), []);
  });
});

describe("dressed-up verbs", () => {
  it("flags 'serves as' and suggests the plain verb", () => {
    const result = audit({
      body: "The building at Third and Kimbark serves as the city's emergency operations center. It opens in November.",
    });
    const [finding] = withCode(result, "dressed-up-verb");
    assert.equal(finding.severity, "fix");
    assert.match(finding.message, /"serves as"/);
    assert.match(finding.message, /Write "is"/);
  });

  it("flags 'stands as' and 'functions as'", () => {
    for (const phrase of ["stands as", "functions as"]) {
      const result = audit({ body: `The depot ${phrase} a landmark on First Avenue. The roof was replaced in 2019.` });
      assert.equal(withCode(result, "dressed-up-verb").length, 1, `expected a finding for "${phrase}"`);
    }
  });

  it("does not flag the plain verb", () => {
    const result = audit({ body: "The depot is a landmark on First Avenue. The roof was replaced in 2019." });
    assert.deepEqual(withCode(result, "dressed-up-verb"), []);
  });
});

describe("filler", () => {
  it("reviews the first use and fixes the repeat", () => {
    const result = audit({
      body: "Moreover, the council tabled the fence ordinance. Members asked for the cost. Moreover, staff will bring both items back in October.",
    });
    const flagged = withCode(result, "filler");
    assert.equal(flagged.length, 2);
    assert.equal(flagged[0].severity, "review");
    assert.equal(flagged[0].sentence, 1);
    assert.equal(flagged[1].severity, "fix");
    assert.equal(flagged[1].sentence, 3);
    assert.match(flagged[1].message, /2 times/);
  });

  it("flags each term on the desk's list", () => {
    const terms: Array<[string, string]> = [
      ["moreover", "Moreover, the pool opens in June."],
      ["furthermore", "Furthermore, the pool opens in June."],
      ["it is worth noting", "It is worth noting that the pool opens in June."],
      ["in conclusion", "In conclusion, the council will meet again in January."],
      ["tapestry", "The quilt show is a tapestry of local history."],
      ["vibrant", "The downtown district is vibrant on Friday nights."],
      ["nestled", "The trailhead is nestled between two creeks."],
      ["landscape", "The decision reshapes the political landscape for the county."],
    ];
    for (const [term, sentence] of terms) {
      const result = audit({ body: sentence });
      const flagged = withCode(result, "filler");
      assert.equal(flagged.length, 1, `expected a finding for "${term}"`);
      assert.equal(flagged[0].severity, "review");
      assert.match(flagged[0].message, new RegExp(term));
    }
  });

  it("leaves literal 'landscape' alone: a landscaping crew is not a metaphor", () => {
    const result = audit({ body: "The landscape crew mowed the median on Ken Pratt Boulevard. The city pays for it." });
    assert.deepEqual(withCode(result, "filler"), []);
  });

  it("does not read a quotation as filler", () => {
    const result = audit({ body: `The clerk called the fee "a vibrant mess," and the council agreed.` });
    assert.deepEqual(withCode(result, "filler"), []);
  });
});

describe("one entity, several names", () => {
  it("reviews a paragraph that cycles two names for the same actor", () => {
    const result = audit({
      body: "City officials told the council the lot is not for sale. City Hall will publish the appraisal next week.",
    });
    const [finding] = withCode(result, "synonym-cycling");
    assert.equal(finding.severity, "review");
    assert.equal(finding.paragraph, 1);
    assert.match(finding.message, /City Hall/);
  });

  it("does not flag a short name for a name it already used", () => {
    const result = audit({
      body: "The City Council voted 5-2 on the fee. The council will revisit it in January.",
    });
    assert.deepEqual(withCode(result, "synonym-cycling"), []);
  });

  it("does not flag one name used twice", () => {
    const result = audit({
      body: "The school district hired two teachers. The school district also bought three buses.",
    });
    assert.deepEqual(withCode(result, "synonym-cycling"), []);
  });

  it("keeps the check inside one paragraph", () => {
    const result = audit({
      body: "City officials said the lot is not for sale.\n\nCity Hall published the appraisal on Thursday.",
    });
    assert.deepEqual(withCode(result, "synonym-cycling"), []);
  });
});

describe("paste artifacts", () => {
  it("flags a non-breaking space", () => {
    const result = audit({ body: `The meeting starts at 7 p.m.${nbsp}in the council chambers.` });
    const [finding] = withCode(result, "paste-artifact");
    assert.equal(finding.severity, "fix");
    assert.match(finding.message, /non-breaking space/);
    assert.match(finding.message, /U\+00A0/);
  });

  it("flags a zero-width space", () => {
    const result = audit({ body: `The Niwot${zeroWidthSpace} bakery opens Saturday.` });
    const flagged = withCode(result, "paste-artifact");
    assert.equal(flagged.length, 1);
    assert.match(flagged[0].message, /zero-width space/);
  });

  it("flags a Cyrillic letter inside a Latin word", () => {
    const result = audit({ body: `The ${cyrillicEs}ouncil voted to delay the fee. The clerk posted the minutes.` });
    const flagged = withCode(result, "paste-artifact");
    assert.equal(flagged.length, 1);
    assert.match(flagged[0].message, /Cyrillic/);
  });

  it("flags a Greek letter inside a Latin word", () => {
    const result = audit({ body: `The ${greekPi}lan fell through in August. The county will try again in March.` });
    const flagged = withCode(result, "paste-artifact");
    assert.equal(flagged.length, 1);
    assert.match(flagged[0].message, /Greek/);
  });

  it("does not flag ordinary punctuation", () => {
    const result = audit({ body: "The city's budget is 12% larger this year. The council votes in November." });
    assert.deepEqual(withCode(result, "paste-artifact"), []);
  });
});

describe("tracking parameters in links", () => {
  it("flags utm parameters", () => {
    const result = audit({
      body: "The county posted the permit at https://bouldercounty.gov/permits?utm_source=news&utm_campaign=bridge on Tuesday.",
    });
    const [finding] = withCode(result, "tracking-parameter");
    assert.equal(finding.severity, "fix");
    assert.match(finding.message, /utm_source/);
  });

  it("flags a click id", () => {
    const result = audit({ body: "The agenda is at https://ci.longmont.co.us/agendas?fbclid=IwAR123abc for now." });
    assert.equal(withCode(result, "tracking-parameter").length, 1);
  });

  it("flags a search-engine redirect and an AMP url", () => {
    const redirect = audit({ body: "The story ran at https://www.google.com/url?q=https://ci.longmont.co.us/x last week." });
    assert.match(withCode(redirect, "tracking-parameter")[0].message, /redirect/);

    const amp = audit({ body: "The story ran at https://www.timescall.com/2026/09/26/bridge/amp/ on Friday." });
    assert.match(withCode(amp, "tracking-parameter")[0].message, /AMP/);
  });

  it("leaves a clean link alone", () => {
    const result = audit({ body: "The agenda is at https://ci.longmont.co.us/agendas/2026-09-26. The clerk posted it Friday." });
    assert.deepEqual(withCode(result, "tracking-parameter"), []);
  });
});

describe("paragraph length", () => {
  const items = [
    "the fence ordinance",
    "the sign rules",
    "the sidewalk gap on Third Avenue",
    "the water main on Collyer Street",
    "the lease at the St. Vrain Center",
    "the fee schedule for park shelters",
    "the crosswalk at Ninth and Main",
    "the alley vacation near Kimbark",
    "the tree replacement plan",
    "the snow removal contract",
    "the library roof repair",
    "the transit pass program",
  ];
  const paragraphOf = (count: number): string =>
    items
      .slice(0, count)
      .map((item) => `The council took up ${item} and asked staff for a cost estimate before the next meeting.`)
      .join(" ");

  it("reviews a paragraph over the form's cap", () => {
    const result = audit({ form: "brief", body: paragraphOf(6) });
    const [finding] = withCode(result, "paragraph-length");
    assert.equal(finding.severity, "review");
    assert.equal(finding.paragraph, 1);
    assert.match(finding.message, /brief form reads best under 95/);
  });

  it("uses the cap for the form that was recorded", () => {
    const body = paragraphOf(6);
    assert.equal(withCode(audit({ form: "brief", body }), "paragraph-length").length, 1);
    assert.equal(withCode(audit({ form: "reported", body }), "paragraph-length").length, 0);
    assert.equal(withCode(audit({ form: "explainer", body: paragraphOf(12) }), "paragraph-length").length, 1);
  });

  it("falls back to the default cap when no form is recorded", () => {
    const result = audit({ form: "", body: paragraphOf(12) });
    assert.equal(result.measurements.paragraphCap, 135);
    assert.equal(withCode(result, "paragraph-length").length, 1);
  });
});

describe("sentence rhythm", () => {
  const flat = [
    "The council met on Tuesday night to review the annual budget request.",
    "The board will meet again next week to finish the spending plan.",
    "Staff told the members the general fund is short by two million.",
    "The finance director said the shortfall comes from slower sales tax.",
    "Members asked for a list of projects that could wait until next year.",
    "The director said she would bring that list to the next meeting.",
    "The council will vote on the budget in November after a public hearing.",
    "Residents can comment at the hearing or send a note to the city clerk.",
  ];

  const long = [
    "The council voted 6-1 on Tuesday night to approve the annexation of the 42-acre parcel off Hover Street, sending the proposal to the county for a final review next month.",
    "The parcel sits between the Front Range Community College campus and a row of single-family homes that were built in the 1970s along the west side of the street.",
    "Developer Harvest Junction LLC has agreed to pay for a turn lane at Ninth Avenue and to widen the intersection before the first of the 180 homes is occupied.",
    "County planners said the annexation adds about 4 acres of parkland and a trail connection to the St. Vrain Greenway that stops short of the river today.",
  ];
  const short = ["The vote was unanimous.", "No one spoke against it.", "The fee stays at $12.", "Crews start in April."];

  it("reviews a draft where every sentence is the same length", () => {
    const result = audit({ body: flat.join(" ") });
    const flagged = withCode(result, "flat-rhythm");
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].severity, "review");
    assert.ok(result.measurements.sentenceLengthCv < 0.34, `cv was ${result.measurements.sentenceLengthCv}`);
    assert.deepEqual(withCode(result, "zigzag-rhythm"), []);
    assert.equal(result.fixCount, 0);
  });

  it("reviews a draft that alternates long and short exactly", () => {
    const paragraphs = long.map((sentence, index) => `${sentence} ${short[index]}`);
    const result = audit({ body: paragraphs.join("\n\n") });
    const flagged = withCode(result, "zigzag-rhythm");
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].severity, "review");
    assert.ok(result.measurements.zigzagShare > 0.5, `share was ${result.measurements.zigzagShare}`);
    assert.deepEqual(withCode(result, "flat-rhythm"), []);
    assert.equal(result.fixCount, 0);
  });

  it("says nothing about rhythm in a draft too short to measure", () => {
    const result = audit({ body: "The council met on Tuesday. The vote was 6-1." });
    assert.deepEqual(withCode(result, "flat-rhythm"), []);
    assert.deepEqual(withCode(result, "zigzag-rhythm"), []);
    assert.equal(result.measurements.sentenceCount, 2);
  });
});

describe("six-word repeats", () => {
  it("reviews a run of six words used twice", () => {
    const result = audit({
      body: "The county says the bridge will reopen in March.\n\nCrews finished the deck on Friday, and the bridge will reopen in March.",
    });
    const flagged = withCode(result, "six-word-repeat");
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].severity, "review");
    assert.match(flagged[0].message, /the bridge will reopen in march/);
    assert.equal(result.measurements.sixWordRepeats, 1);
  });

  it("collapses overlapping windows of one long repeat into a single finding", () => {
    const runs = repeatedSixWordRuns([
      "the bridge will reopen in march after crews finish the deck",
      "the bridge will reopen in march after crews finish the deck",
    ]);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].count, 2);
  });

  it("does not flag ordinary repeated words", () => {
    const result = audit({
      body: "The council voted on the fee on Tuesday. The council meets next month on the budget.",
    });
    assert.deepEqual(withCode(result, "six-word-repeat"), []);
  });
});

describe("the audit as a whole", () => {
  it("finds nothing to fix in a clean local-news draft", () => {
    const result = audit({
      headline: "Longmont approves 42-acre annexation off Hover Street",
      dek: "The council voted 6-1 on Tuesday; the county reviews the plan next month.",
      form: "reported",
      body: [
        "The Longmont City Council voted 6-1 on Tuesday to annex 42 acres off Hover Street, the first step in a plan that could add 180 homes near the airport.",
        "Councilmember Diane Sikes said the project would add students to Rocky Mountain Elementary and traffic to Ninth Avenue.",
        "The developer, Niwot-based Harvest Junction LLC, has agreed to pay for a turn lane at Ninth Avenue and to widen the intersection before the first home is occupied.",
        "The county commissioners take up the annexation on October 14. If they approve it, construction could start in the spring.",
      ].join("\n\n"),
    });
    assert.deepEqual(result.findings.filter((finding) => finding.severity === "fix"), []);
    assert.equal(result.fixCount, 0);
    assert.equal(result.measurements.paragraphCount, 4);
    assert.equal(result.measurements.sentenceCount, 5);
  });

  it("measures the draft and reports the counts alongside the findings", () => {
    const result = audit({
      headline: "Council weighs the fee",
      dek: "A vote comes in November.",
      form: "brief",
      body: "One short line.\n\nA second paragraph with six words here.",
    });
    assert.equal(result.version, 1);
    assert.equal(result.measurements.paragraphCount, 2);
    assert.equal(result.measurements.sentenceCount, 2);
    assert.equal(result.measurements.wordCount, 10);
    assert.equal(result.measurements.maxParagraphWords, 7);
    assert.equal(result.measurements.paragraphCap, 95);
    assert.equal(result.measurements.meanSentenceWords, 5);
    assert.equal(result.fixCount + result.reviewCount, result.findings.length);
  });

  it("returns an empty result for an empty draft", () => {
    const result = audit({});
    assert.deepEqual(result.findings, []);
    assert.equal(result.fixCount, 0);
    assert.equal(result.reviewCount, 0);
    assert.equal(result.measurements.paragraphCount, 0);
    assert.equal(result.measurements.sentenceCount, 0);
    assert.equal(result.measurements.sentenceLengthCv, 0);
    assert.equal(result.measurements.paragraphCap, 135);
  });

  it("audits the headline and the dek as paragraph 0", () => {
    const result = audit({ headline: "Experts say the fee will rise", dek: "The council votes in November." });
    const flagged = withCode(result, "unnamed-attribution");
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].paragraph, 0);
    assert.equal(flagged[0].sentence, 1);
    assert.equal(flagged[0].snippet, "Experts say the fee will rise");
  });

  it("gives every finding a severity, a code, a position and a readable message", () => {
    const result = audit({
      headline: "Experts say the fee marks a turning point",
      form: "brief",
      body: `Moreover, the depot serves as the hub, highlighting its role. City officials said so. City Hall agreed. The record${nbsp}stays open.`,
    });
    assert.ok(result.findings.length >= 4, `expected several findings, got ${result.findings.length}`);
    for (const finding of result.findings) {
      assert.ok(finding.severity === "fix" || finding.severity === "review", `bad severity: ${finding.severity}`);
      assert.ok(finding.code.length > 0);
      assert.ok(Number.isInteger(finding.paragraph) && finding.paragraph >= 0);
      assert.ok(Number.isInteger(finding.sentence) && finding.sentence >= 0);
      assert.ok(finding.message.length > 10, `message too short: ${finding.message}`);
      // A finding that points at a sentence shows it; a whole-paragraph or
      // whole-draft finding has nothing to point at and says so with an empty
      // snippet rather than a wrong one.
      if (finding.sentence > 0) assert.ok(finding.snippet.length > 0, `missing snippet for ${finding.code}`);
    }
    assert.equal(codes(result).includes("paste-artifact"), true);
  });

  it("labels the list the way the story page prints it", () => {
    assert.equal(styleCheckLabel(0), "No style findings");
    assert.equal(styleCheckLabel(1), "1 thing to fix");
    assert.equal(styleCheckLabel(3), "3 things to fix");
  });
});

describe("quote masking", () => {
  it("keeps the length of the text so positions still line up", () => {
    const text = `He said "experts say" on Tuesday.`;
    const masked = maskQuotedText(text);
    assert.equal(masked.length, text.length);
    assert.equal(masked.includes("experts"), false);
    assert.equal(masked.includes("He said"), true);
  });

  it("treats an apostrophe as an apostrophe, not an opening quote", () => {
    const text = "The city's budget grew by 12% this year.";
    assert.equal(maskQuotedText(text), text);
  });

  it("masks curly quotes and leaves the rest of the draft readable", () => {
    const text = `The clerk said “we are not done” and sat down.`;
    const masked = maskQuotedText(text);
    assert.equal(masked.includes("not done"), false);
    assert.equal(masked.includes("and sat down"), true);
  });
});
