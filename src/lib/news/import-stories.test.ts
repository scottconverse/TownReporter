import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bodyIsVerbatim,
  containsVerbatim,
  disclosureLine,
  extractLinks,
  fallbackSingleStory,
  htmlToText,
  parseFinishedStories,
  parsePlainStory,
  splitParagraphs,
  stripOrdinal,
  verifyModelSplit,
} from "./import-stories.ts";

const FIXTURE = readFileSync(
  new URL("./fixtures/civic-scanner-longmont-2026-09-24.md", import.meta.url),
  "utf8",
);

const EXPECTED_HEADLINES = [
  "Council votes to bring marijuana hospitality rules back for consideration",
  "Four Longmont measures are set for the November ballot",
  "Council creates technology policy advisory board as city pauses fixed ALPR replacements",
  "Council authorizes purchase of the YMCA property at 950 Lashley Street",
  "21st Avenue rail crossing is scheduled for two closure periods",
  "Proposed 2027 budget includes Ride Longmont expansion and sanitation service changes",
  "St. Vrain board packet presents assessment results and bond work",
];

const report = parseFinishedStories(FIXTURE);
const stories = report.stories.filter((s) => s.isStory);
const nonStories = report.stories.filter((s) => !s.isStory);

describe("parseFinishedStories on the real civic-scanner report", () => {
  it("reads the report with no model call at all", () => {
    assert.equal(report.method, "structured");
  });

  it("finds seven stories, with the heading number stripped off each headline", () => {
    assert.equal(stories.length, 7);
    assert.deepEqual(
      stories.map((s) => s.headline),
      EXPECTED_HEADLINES,
    );
  });

  it("keeps the report's title, its scan line and the tool that wrote it", () => {
    assert.equal(report.title, "Civic Source Scanner — Longmont, Colorado daily briefing");
    assert.equal(report.detectedTool, "Civic Source Scanner");
    assert.match(report.scanDate, /September 24, 2026/);
    assert.match(report.headerNote, /The scores below are editorial triage judgments/);
    assert.match(report.headerNote, /did not independently check the video audio/);
    assert.ok(
      splitParagraphs(report.headerNote).every((p) => splitParagraphs(FIXTURE).includes(p)),
      "the report header is the report's own words",
    );
  });

  it("keeps every body paragraph byte-identical to the input", () => {
    const inputParagraphs = new Set(splitParagraphs(FIXTURE));
    for (const story of stories) {
      const paragraphs = splitParagraphs(story.body);
      assert.ok(paragraphs.length >= 2, `${story.headline} should have a body`);
      for (const paragraph of paragraphs) {
        assert.ok(
          inputParagraphs.has(paragraph),
          `body paragraph was not copied from the input: ${paragraph.slice(0, 90)}`,
        );
      }
      assert.ok(bodyIsVerbatim(FIXTURE, story), `${story.headline} body is not verbatim`);
    }
  });

  it("collects every link of each story into that story's sources", () => {
    for (const story of stories) {
      assert.ok(story.links.length >= 1, `${story.headline} has no sources`);
      for (const link of extractLinks(story.raw)) {
        assert.ok(
          story.links.some((l) => l.url === link.url),
          `${story.headline} lost the source ${link.url}`,
        );
      }
    }
    // Story 1 cites the motion, the vote and the budget packet; the brief repeats
    // two of them. Deduped by URL that is three sources, not five.
    assert.deepEqual(
      stories[0]!.links.map((l) => l.url),
      [
        "https://www.youtube.com/watch?v=jhsFsEz0P5A&t=1444s",
        "https://www.youtube.com/watch?v=jhsFsEz0P5A&t=2195s",
        "https://longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=16823&compileOutputType=1",
      ],
    );
  });

  it("reads the labelled parts: score, triage, dek, brief and next step", () => {
    const first = stories[0]!;
    assert.equal(first.score, "17/20");
    assert.equal(first.triage, "Advance");
    assert.equal(first.holds, false);
    assert.match(first.dek, /^A closely split council has revived a policy/);
    assert.match(first.plainBrief, /^Longmont’s council voted 4–3/);
    assert.match(first.reporterNextStep, /^Obtain the written motion/);
    assert.equal(first.scoreLine, first.raw.split("\n\n")[1]);
  });

  it("flags the Hold on story 7 and only story 7", () => {
    assert.equal(stories[6]!.triage, "Hold");
    assert.equal(stories[6]!.holds, true);
    assert.deepEqual(
      stories.filter((s) => s.holds).map((s) => s.headline),
      [EXPECTED_HEADLINES[6]],
    );
  });

  it("suggests a section for every story from the same chooser the write box uses", () => {
    const KNOWN = [
      "council",
      "budget",
      "housing",
      "utilities",
      "schools",
      "planning",
      "infrastructure",
      "elections",
    ];
    for (const story of stories) {
      assert.ok(
        KNOWN.includes(story.sectionSuggestion),
        `${story.headline} got the suggestion "${story.sectionSuggestion}", which is not a section`,
      );
    }
    // The unambiguous one must not be missed: a school board packet.
    assert.equal(stories[6]!.sectionSuggestion, "schools");
  });

  /*
    Coordinator review of the Unit X screenshots, 2026-09-24: the marijuana
    hospitality story was suggested "Budget". It is a council story that
    mentions what sales tax revenue might be in one paragraph, and the chooser
    this branch carries (`topicFromText`, desk-copy.ts:1156) matches
    /sales tax|mill levy|property tax/ before any council term.

    Lane 1's Unit P rewrote that same function so it reads whole words and the
    newsroom's own section names, and says "not chosen" when it is unsure. P is
    merged now (0.6.63), so this is a real test again rather than a todo, and it
    holds P's own shape: the story files under council, or comes back with the
    not-chosen marker -- never Budget.

    The import reaches that chooser through one call, `topicFromText` imported
    from desk-copy.ts (import-stories.ts:30), so this asserts P's function and
    not a copy of it. `sectionSuggestion` is "" when P says the text named no
    section (see `suggestedSectionFromText`), which is why "" is one of the two
    answers allowed here.
  */
  it("never suggests Budget for the marijuana hospitality story", () => {
    const guess = stories[0]!.sectionSuggestion;
    assert.match(stories[0]!.headline, /^Council votes to bring marijuana hospitality rules back/);
    assert.notEqual(guess, "budget");
    assert.ok(
      ["council", ""].includes(guess),
      `expected council or the not-chosen marker, got "${guess}"`,
    );
  });

  it("recognises the three non-story sections and leaves them off", () => {
    assert.deepEqual(
      nonStories.map((s) => s.headline),
      ["Beat context and source access", "Signals and watch list", "Upcoming dates to monitor"],
    );
    for (const section of nonStories) assert.equal(section.isStory, false);
  });

  it("keeps the non-story sections' own text, so nothing is silently dropped", () => {
    for (const section of nonStories) {
      const paragraphs = splitParagraphs(section.body);
      assert.ok(paragraphs.length > 0, `${section.headline} lost its text`);
      for (const paragraph of paragraphs) {
        assert.ok(
          splitParagraphs(FIXTURE).includes(paragraph),
          `${section.headline} body paragraph was not copied from the input`,
        );
      }
    }
  });

  it("defaults a detected civic-scanner report to the outside-AI disclosure line", () => {
    assert.equal(
      disclosureLine(stories[0]!.disclosureKey),
      "An outside AI research tool wrote this from public records; an editor reviewed it.",
    );
  });
});

describe("the verbatim check", () => {
  it("rejects a paragraph that was altered, even by one word", () => {
    const original = splitParagraphs(FIXTURE).find((p) => p.startsWith("The budget packet explains"))!;
    assert.equal(containsVerbatim(FIXTURE, original), true);
    const altered = original.replace("$8,000", "$80,000");
    assert.notEqual(altered, original, "the fixture must actually contain the figure being altered");
    assert.equal(containsVerbatim(FIXTURE, altered), false);
  });

  it("accepts a paragraph that was only re-wrapped across lines", () => {
    const original = splitParagraphs(FIXTURE).find((p) => p.startsWith("The budget packet explains"))!;
    const rewrapped = original.replace(" ", "\n");
    assert.equal(containsVerbatim(FIXTURE, rewrapped), true);
  });

  it("does not treat an empty paragraph as contained", () => {
    assert.equal(containsVerbatim(FIXTURE, "   "), false);
  });
});

describe("the one model call, structure only", () => {
  it("accepts a split whose every paragraph is copied from the text", () => {
    const paragraphs = splitParagraphs(FIXTURE);
    const body = paragraphs.filter((p) => p.startsWith("The budget packet explains"));
    const result = verifyModelSplit(FIXTURE, {
      stories: [{ headline: "Budget packet on hospitality licences", body }],
    });
    assert.equal(result.rejected, 0);
    assert.equal(result.stories.length, 1);
    assert.equal(result.stories[0]!.body, body.join("\n\n"));
  });

  it("rejects a split that alters a sentence, and says which one", () => {
    const paragraphs = splitParagraphs(FIXTURE);
    const body = paragraphs.filter((p) => p.startsWith("The budget packet explains"));
    const result = verifyModelSplit(FIXTURE, {
      stories: [{ headline: "Budget packet", body: [...body, "The city expects $8 million a year."] }],
    });
    assert.equal(result.stories.length, 0);
    assert.equal(result.rejected, 1);
    assert.match(result.reason, /changed wording that is not in your text/);
    assert.match(result.reason, /\$8 million/);
  });

  it("rejects a story with no body rather than filing an empty one", () => {
    const result = verifyModelSplit(FIXTURE, { stories: [{ headline: "Something" }] });
    assert.equal(result.stories.length, 0);
    assert.equal(result.rejected, 1);
  });

  it("falls back to one flagged story, and keeps every word of the paste", () => {
    const messy = "A wall of text with no headings.\n\nSecond paragraph.\n\nThird.";
    const story = fallbackSingleStory(messy, { reason: "Could not split this cleanly — check it." });
    assert.equal(story.cleanSplit, false);
    assert.equal(story.warning, "Could not split this cleanly — check it.");
    assert.equal(story.body, "A wall of text with no headings.\n\nSecond paragraph.\n\nThird.");
    assert.equal(bodyIsVerbatim(messy, story), true);
  });
});

describe("a single finished story with no markdown headings", () => {
  const PLAIN = [
    "Longmont council delays the transit vote to October",
    "",
    "The council put off its decision on the Ride Longmont expansion until October 6.",
    "",
    "Two members said they wanted the ridership figures first.",
    "",
    "Sources: [council packet](https://longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=16823&compileOutputType=1), [recording](https://www.youtube.com/watch?v=jhsFsEz0P5A)",
  ].join("\n");

  it("is read on its own, deterministically, with the headline off the first line", () => {
    const parsed = parseFinishedStories(PLAIN);
    assert.equal(parsed.method, "plain");
    assert.equal(parsed.stories.length, 1);
    assert.equal(parsed.stories[0]!.headline, "Longmont council delays the transit vote to October");
    assert.equal(
      parsed.stories[0]!.body,
      "The council put off its decision on the Ride Longmont expansion until October 6.\n\nTwo members said they wanted the ridership figures first.",
    );
  });

  it("keeps the Sources line out of the body and in the story's sources", () => {
    const story = parsePlainStory(PLAIN)!;
    assert.equal(story.body.includes("Sources:"), false);
    assert.deepEqual(
      story.links.map((l) => l.url),
      [
        "https://longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=16823&compileOutputType=1",
        "https://www.youtube.com/watch?v=jhsFsEz0P5A",
      ],
    );
  });

  it("does not mistake a wall of text for a story", () => {
    const messy =
      "nothing here is a headline really it just runs on and on without a break in the middle of it all and there is no structure anywhere in this at all";
    assert.equal(parsePlainStory(messy), null);
    assert.equal(parseFinishedStories(messy).method, "none");
    assert.equal(parseFinishedStories(messy).stories.length, 0);
  });
});

describe("small helpers", () => {
  it("strips a heading number but keeps a heading that has none", () => {
    assert.equal(stripOrdinal("1. Council votes"), "Council votes");
    assert.equal(stripOrdinal("7) St. Vrain board"), "St. Vrain board");
    assert.equal(stripOrdinal("Council votes"), "Council votes");
  });

  it("keeps link order and drops duplicate URLs", () => {
    assert.deepEqual(
      extractLinks("[a](https://x.test/1) and [b](https://x.test/1) then [c](https://x.test/2)"),
      [
        { text: "a", url: "https://x.test/1" },
        { text: "c", url: "https://x.test/2" },
      ],
    );
  });

  it("names the outside-AI and person disclosure lines, and leaves other wording to the editor", () => {
    assert.match(disclosureLine("outside-ai"), /outside AI research tool/);
    assert.match(disclosureLine("person"), /A person wrote this/);
    assert.equal(disclosureLine("other", "  Written with a helper.  "), "Written with a helper.");
  });
});

describe("htmlToText, so a saved web page is read as text", () => {
  it("keeps the headings and paragraphs a saved page was written with", () => {
    const html = [
      "<!doctype html><html><head><title>Council report</title>",
      "<style>body{color:red}</style><script>window.x=1</script></head>",
      "<body><h1>Civic report</h1>",
      "<h3>1. Council votes on marijuana rules</h3>",
      "<p>First paragraph.</p><p>Second paragraph.</p>",
      "<h2>Beat context</h2><p>Not a story.</p></body></html>",
    ].join("");
    const text = htmlToText(html);
    assert.equal(text.includes("window.x"), false, "a script is not story text");
    assert.equal(text.includes("color:red"), false, "a style block is not story text");
    assert.equal(text.includes("<"), false, "no markup is left for the reader to read");
    assert.match(text, /^# Civic report$/m);
    assert.match(text, /^### 1\. Council votes on marijuana rules$/m);
    assert.match(text, /^## Beat context$/m);
    assert.ok(text.includes("First paragraph.") && text.includes("Second paragraph."));
    // Headings and paragraphs arrive as markdown blocks, so the reader can split them.
    assert.ok(splitParagraphs(text).includes("First paragraph."));
    assert.equal(parseFinishedStories(text).stories.filter((s) => s.isStory).length, 1);
  });

  it("turns a list and the basic entities into the words a reader would see", () => {
    const text = htmlToText(
      "<ul><li>One &amp; two</li><li>3 &lt; 4</li></ul><p>Longmont&rsquo;s plan&nbsp;stands</p><br><p>After the break</p>",
    );
    assert.ok(text.includes("One & two"));
    assert.ok(text.includes("3 < 4"));
    assert.ok(text.includes("Longmont’s plan stands"));
    assert.ok(text.split(/\n\n+/).some((p) => p.trim() === "After the break"));
    assert.equal(text.includes("&amp;"), false);
  });
});
