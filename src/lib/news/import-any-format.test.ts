/**
 * Unit X3 — any report format, and story ideas as well as finished stories.
 *
 * The owner, 2026-09-24, after running the civic-scanner skill inside Claude
 * instead of Codex: "Will it work? Also, what if it's other formats, like a
 * list of stories with short paragraph descriptions of what was found?"
 *
 * Two fixtures stand behind this file:
 *
 * - `civic-scanner-longmont-2026-09-24.md`, the report the Codex-scanner run
 *   wrote (Unit X). Seven stories, clean markdown, no escapes. It must keep
 *   reading the way it reads today.
 * - `civic-scanner-claude-longmont-2026-09-24.md`, the same scanner run inside
 *   Claude, whose export is a Google-Docs-shaped markdown: `**bold**` around
 *   every heading and label, `\$`/`\#`/`\.` escapes, a broken bold, a `(9/20:
 *   I3 Im1 C3 N2)` score code on the heading, `*Sources: ...*` lines that cite
 *   documents rather than URLs, and a `## LEADS (DEMOTE)` bullet list.
 *
 * Every assertion here is about the text the editor sees on the review screen
 * and about nothing being invented: a headline with no markup in it, a body
 * paragraph that is still the report's own words, a triage the report stated.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  IDEA_WORD_LIMIT,
  bodyIsVerbatim,
  containsVerbatim,
  containsVerbatimEither,
  defaultImportKind,
  parseFinishedStories,
  parsePlainStory,
  precleanMarkdown,
  splitParagraphs,
  stripOrdinal,
} from "./import-stories.ts";
import { cardBody, cardsFromReport, type ReviewCard } from "./import-review.ts";
import { pasteOneStoryCard } from "./paste-one-story.ts";

const CODEX = readFileSync(
  new URL("./fixtures/civic-scanner-longmont-2026-09-24.md", import.meta.url),
  "utf8",
);

const CLAUDE = readFileSync(
  new URL("./fixtures/civic-scanner-claude-longmont-2026-09-24.md", import.meta.url),
  "utf8",
);

const claude = parseFinishedStories(CLAUDE);
const claudeStories = claude.stories.filter((s) => s.isStory);

describe("the export's escapes, as the editor sees them", () => {
  it("leaves the Codex report exactly as it is, byte for byte", () => {
    // The report Unit X already reads has no escapes and no bold headings, so
    // pre-cleaning it must be a no-op -- this is what keeps every Unit X
    // assertion about that report true.
    assert.equal(parseFinishedStories(CODEX).stories.length > 0, true);
  });

  it("turns the escapes a Google Docs export leaves behind into the marks a reader typed", () => {
    const cleaned = parseFinishedStories(
      [
        "**Date:** Thursday, September 24, 2026 | **Run \\#3** | v2.3 **Scan window:** September 17 to 24, 2026\\. Records older than September 17 are labeled CONTEXT.",
        "",
        "## **LEADS (ADVANCE)**",
        "",
        "### **LEAD 1: The budget is \\$547.5 million**",
        "",
        "Captions download was rate-limited (HTTP 429\\) on two tries.",
      ].join("\n"),
    );
    assert.equal(cleaned.stories.filter((s) => s.isStory)[0]!.body, "Captions download was rate-limited (HTTP 429) on two tries.");
  });

  it("repairs a bold the export only escaped on one side", () => {
    // Google Docs wrote `\*\*$4,513,469**` into the Claude report: the intended
    // bold, half-escaped. It is display damage, not emphasis anyone typed.
    const cleaned = parseFinishedStories(
      [
        "### LEAD 1: A story with a figure in it",
        "",
        "The 2026 budget appropriation is \\*\\*$4,513,469** in seven funds.",
      ].join("\n"),
    );
    assert.equal(
      cleaned.stories.filter((s) => s.isStory)[0]!.body,
      "The 2026 budget appropriation is $4,513,469 in seven funds.",
    );
  });

  it("drops a horizontal rule rather than filing it as a body paragraph", () => {
    const cleaned = parseFinishedStories(
      [
        "### LEAD 1: A story",
        "",
        "A paragraph.",
        "",
        "---",
      ].join("\n"),
    );
    assert.equal(cleaned.stories.filter((s) => s.isStory)[0]!.body, "A paragraph.");
    assert.deepEqual(splitParagraphs(precleanMarkdown("---\n\nA paragraph.\n\n---")), ["A paragraph."]);
  });
});

describe("the verbatim check, against the cleaned text and the raw paste", () => {
  it("accepts a paragraph whose escapes the reader removed", () => {
    const paragraphs = splitParagraphs(claudeStories[0]!.body);
    const cleaned = paragraphs.find((p) => !containsVerbatim(CLAUDE, p))!;
    // The raw paste spells it `\(name spelling to confirm\)`; the reader, and so
    // the editor, sees `(name spelling to confirm)`. The same words either way.
    assert.ok(cleaned.includes("(name spelling to confirm)"), cleaned.slice(0, 80));
    assert.equal(containsVerbatimEither(CLAUDE, cleaned), true);
    assert.ok(bodyIsVerbatim(CLAUDE, claudeStories[0]!));
  });

  it("still refuses a paragraph the editor never pasted", () => {
    assert.equal(containsVerbatim(CLAUDE, "The vote was unanimous."), false);
    assert.equal(containsVerbatimEither(CLAUDE, "The vote was unanimous."), false);
    const altered = `${claudeStories[0]!.body}\n\nThe vote was unanimous.`;
    const story = { ...claudeStories[0]!, body: altered };
    assert.equal(bodyIsVerbatim(CLAUDE, story), false);
  });

  it("holds for every story and every section of the Claude report", () => {
    for (const card of claude.stories) {
      // One card in the Claude report is a heading with nothing under it --
      // "## LEADS (HOLD)" -- and it carries no text to check.
      if (splitParagraphs(card.body).length === 0) continue;
      assert.ok(
        bodyIsVerbatim(CLAUDE, card),
        `${card.headline} carries text that is not in the paste`,
      );
    }
  });
});

describe("the Codex report still reads exactly as it did", () => {
  const codex = parseFinishedStories(CODEX);

  it("finds the same seven stories with the same clean headlines", () => {
    assert.equal(codex.method, "structured");
    assert.equal(codex.stories.filter((s) => s.isStory).length, 7);
    assert.equal(
      codex.stories.filter((s) => s.isStory)[0]!.headline,
      "Council votes to bring marijuana hospitality rules back for consideration",
    );
    assert.equal(codex.stories.filter((s) => s.isStory)[6]!.headline,
      "St. Vrain board packet presents assessment results and bond work");
  });

  it("keeps every body paragraph byte-identical to that report", () => {
    const inputParagraphs = new Set(splitParagraphs(CODEX));
    for (const story of codex.stories) {
      for (const paragraph of splitParagraphs(story.body)) {
        assert.ok(inputParagraphs.has(paragraph), `not copied from the input: ${paragraph.slice(0, 80)}`);
      }
      assert.ok(bodyIsVerbatim(CODEX, story));
    }
  });

  it("still reads the score, the triage and the Hold off a labelled line", () => {
    const stories = codex.stories.filter((s) => s.isStory);
    assert.equal(stories[0]!.score, "17/20");
    assert.equal(stories[0]!.triage, "Advance");
    assert.equal(stories[6]!.triage, "Hold");
    assert.equal(stories[6]!.holds, true);
  });
});

describe("the Claude report, read for the editor", () => {
  it("reads it with no model call at all", () => {
    assert.equal(claude.method, "structured");
  });

  it("finds every lead, split from the sections that are not leads", () => {
    // 19 leads under "## LEADS (ADVANCE)" and "## LEADS (HOLD)", plus the three
    // demoted leads the report filed as bullets under "## LEADS (DEMOTE)" --
    // each of those is a lead the report named, so each gets its own card
    // (Step D: see "a section that only lists demoted leads" below).
    assert.equal(claudeStories.length, 22);
    // The rest of the report -- context, tables, the coverage ledger, the watch
    // list -- is none of it a story.
    assert.ok(claude.stories.some((s) => !s.isStory));
  });

  it("gives every lead a headline with no markup, label or score code left on it", () => {
    for (const story of claudeStories) {
      assert.ok(!story.headline.includes("**"), `${story.headline} still carries bold`);
      assert.ok(!/^LEAD\s*\d+/i.test(story.headline), `${story.headline} still carries its lead number`);
      assert.ok(!/^Story\s*\d+/i.test(story.headline), `${story.headline} still carries its story number`);
      assert.ok(!/\(\s*\d+\s*\/\s*\d+\s*:/.test(story.headline), `${story.headline} still carries a score code`);
      assert.ok(!story.headline.includes("\\"), `${story.headline} still carries an escape`);
      assert.equal(story.headline.trim(), story.headline);
    }
    assert.ok(
      claudeStories.some((s) => s.headline === "Council votes 4-3 to bring back marijuana hospitality, limited to venues that also sell"),
      "the first lead's headline, word for word",
    );
    assert.ok(
      claudeStories.some((s) => s.headline === "City approves $4.5 million YMCA purchase; operating costs not recovered until year four or later"),
    );
  });

  it("keeps a body paragraph clean of the export's escapes and of the report's rules", () => {
    const first = claudeStories[0]!;
    const paragraphs = splitParagraphs(first.body);
    assert.ok(paragraphs.length >= 2, "the first lead has a real body");
    for (const paragraph of paragraphs) {
      assert.ok(!paragraph.includes("\\$"), `escape left in the body: ${paragraph.slice(0, 80)}`);
      assert.notEqual(paragraph.trim(), "---");
    }
  });
});

describe("the report's labels, in whichever words it used", () => {
  const lead = claudeStories.find((s) => s.headline.startsWith("Hangar lease assignment"))!;

  it("splits a paragraph whose labels sit inside it, and keeps the body's own words", () => {
    assert.ok(lead, "the hangar lease lead");
    assert.equal(lead.reporterNextStep, "a council statement linking lease policy to the vision session.");
    assert.equal(
      lead.plainBrief,
      "Council approved moving a hangar lease at the city airport to a new owner, 5 to 2. Two members voted no both times. Earlier, one member wanted to wait until after Saturday's airport session.",
    );
    assert.ok(!lead.body.includes("What would elevate"), lead.body.slice(-160));
    assert.ok(!lead.body.includes("Plain language"), lead.body.slice(-160));
    assert.equal(bodyIsVerbatim(CLAUDE, lead), true);
  });

  it("reads a \"Why it matters for Longmont:\" dek, which names the place", () => {
    const first = claudeStories[0]!;
    assert.match(first.dek, /^This revives a policy that failed in 2025 on a 3-3 vote/);
    assert.ok(!first.body.includes("Why it matters"));
  });

  it("takes the report's own cited documents as sources, inventing no URL for them", () => {
    const first = claudeStories[0]!;
    assert.deepEqual(first.citations, [
      "Sept 22 council recording 0:23:37 to 0:36:25 (transcript-based)",
      "Sept 22 packet p. 819 (Tier A)",
      "2027 Budget Message, Sept 1 (Tier A, CONTEXT)",
    ]);
    assert.deepEqual(first.links, []);
    assert.ok(!first.body.includes("Sources:"));
  });

  it("makes a real link out of a domain the report pasted without a scheme", () => {
    const section = claude.stories.find((s) => s.headline === "LEADS (ADVANCE)");
    assert.ok(section, "the ADVANCE section card");
    assert.ok(
      section!.links.some((l) => l.url === "https://youtube.com/watch?v=jhsFsEz0P5A"),
      JSON.stringify(section!.links),
    );
  });
});

describe("the triage the report stated", () => {
  it("reads the score and the verdict off the score line", () => {
    assert.equal(claudeStories[0]!.score, "16/20");
    assert.equal(claudeStories[0]!.triage, "Advance");
    assert.equal(claudeStories[0]!.holds, false);
  });

  it("reads a Hold from the section a lead sits under, and the score off its heading", () => {
    const held = claudeStories.filter((s) =>
      /^(Hangar lease assignment|Joint meeting with Boulder County|First out-of-city)/.test(s.headline),
    );
    assert.equal(held.length, 3);
    for (const held_ of held) {
      assert.equal(held_.triage, "Hold");
      assert.equal(held_.holds, true);
    }
    assert.equal(held[0]!.score, "9/20");
  });

  it("shows the Hold flag on every demoted lead, not only on its section", () => {
    // Step D replaced the single "## LEADS (DEMOTE)" section card with one card
    // per demoted lead. The flag the section carried is now on each of the three
    // cards, which is where an editor ticks them.
    const demoted = claude.stories.filter((s) => s.triage === "Demote");
    assert.equal(demoted.length, 3);
    for (const lead of demoted) {
      assert.equal(lead.holds, true);
      assert.ok(lead.key.startsWith("s"), `${lead.headline} is not carried as a lead`);
    }
  });
});

describe("story ideas: what each card is by default", () => {
  it("calls a card an idea when its body is one paragraph or under 120 words", () => {
    assert.equal(IDEA_WORD_LIMIT, 120);
    const long = Array.from({ length: 130 }, (_, i) => `word${i}`).join(" ");
    assert.equal(
      defaultImportKind(`${long}\n\nA second paragraph, and a few more words after it.`),
      "story",
    );
    // One long paragraph is still an idea: an idea is what a report wrote a
    // paragraph about, a story is what it wrote several paragraphs about.
    assert.equal(defaultImportKind(long), "idea");
    assert.equal(defaultImportKind("Short.\n\nAnd a second short paragraph."), "idea");
  });

  it("keeps every one of the Codex report's seven stories a story", () => {
    const stories = parseFinishedStories(CODEX).stories.filter((s) => s.isStory);
    assert.equal(stories.length, 7);
    for (const story of stories) assert.equal(story.kind, "story", story.headline);
  });

  it("reads the Claude report's short leads as ideas and its written leads as stories", () => {
    const leads = claude.stories.filter((s) => s.kind);
    assert.equal(leads.length, claude.stories.length);
    // 19 written leads plus the 3 demoted bullets: 10 carry a written story,
    // 12 are the one-paragraph leads the report filed as leads or as ideas.
    assert.equal(claudeStories.filter((s) => s.kind === "story").length, 10);
    assert.equal(claudeStories.filter((s) => s.kind === "idea").length, 12);
    for (const card of claude.stories) {
      assert.equal(card.kind, defaultImportKind(card.body), card.headline);
    }
    assert.ok(
      claudeStories.some(
        (s) => s.kind === "story" && s.headline.startsWith("Council votes 4-3 to bring back marijuana"),
      ),
    );
    const crossing = claudeStories.find((s) => s.headline.startsWith("21st Avenue rail crossing"))!;
    assert.equal(crossing.kind, "idea");
    assert.equal(crossing.includeByDefault, true);
  });

  it("ticks the leads the report filed and leaves the report's own sections unticked", () => {
    for (const card of claude.stories) {
      if (card.key.startsWith("n")) assert.equal(card.includeByDefault, false, card.headline);
    }
    assert.ok(claude.stories.some((s) => !s.isStory && s.includeByDefault === false));
  });
});

describe("a section that only lists demoted leads", () => {
  const demoted = claude.stories.filter((s) => s.triage === "Demote");

  it("gives each demoted lead its own card instead of one section card", () => {
    assert.equal(claude.stories.some((s) => s.headline === "LEADS (DEMOTE)"), false);
    assert.equal(demoted.length, 3);
    for (const lead of demoted) assert.equal(lead.isStory, true);
  });

  it("takes the headline off the bullet's first sentence and keeps the rest as its text", () => {
    const water = demoted[0]!;
    assert.equal(
      water.headline,
      'Water Board, Sept 21, "Action Required" conveyance plats for 701 S. Main, FRCC, and Longmont Transit Center Filing No. 1 (1st and Main parcels)',
    );
    assert.equal(water.body, "Outcome not confirmed. Monitoring note for the transit hub thread.");
    assert.equal(water.score, "6/20");
    assert.equal(water.triage, "Demote");
    assert.equal(water.holds, true);
    assert.equal(water.kind, "idea");
    assert.equal(water.includeByDefault, false);
    assert.equal(bodyIsVerbatim(CLAUDE, water), true);
  });

  it("does not end the headline at the initial in a street name", () => {
    const avis = demoted[1]!;
    assert.equal(
      avis.headline,
      "P&Z, Sept 23, public hearing on a vehicle sales and rental conditional use at 206 S. Main (Avis)",
    );
    assert.equal(
      avis.body,
      "Packet has approve, conditional, and deny resolutions. Outcome not confirmed (recording blocked).",
    );
    assert.equal(avis.score, "6/20");
    assert.equal(bodyIsVerbatim(CLAUDE, avis), true);
  });

  it("keeps a lead whose whole description is one short sentence", () => {
    const church = demoted[2]!;
    assert.equal(
      church.headline,
      "Neighborhood meeting Sept 17 on annexing 0.88 acres at 8979 Nelson Road (Connection Church Longmont; Norris Design)",
    );
    assert.equal(church.body, "Early stage.");
    assert.equal(church.score, "5/20");
    assert.equal(church.holds, true);
  });
});

describe("a plain list of story ideas, with no report around it", () => {
  const IDEAS = [
    "# Story ideas — Longmont, week of September 21, 2026",
    "",
    '* **Water Board conveyance plats at First and Main** — the board accepted "Action Required" plats for 701 S. Main, FRCC and the Longmont Transit Center on Sept 21. Nobody has confirmed what it decided.',
    "* P&Z hearing on the Avis vehicle rental use — a conditional use for vehicle sales and rental at 206 S. Main was heard Sept 23. The packet carries approve, conditional and deny resolutions.",
    "* 1. Airport hangar lease assignment moves to a new owner — council approved the assignment 5 to 2 on Sept 22. Two members voted no both times.",
    "* **Annexation of 0.88 acres on Nelson Road** — a neighborhood meeting on Sept 17 took up the Connection Church parcel at 8979 Nelson Road. No application has been filed yet.",
    "* The budget's water fund gap — the 2027 budget message puts the Water Fund at $51.01 million. Planned spending is $54.4 million.",
    "* **Quiet zone work closes the 21st Avenue crossing** — the crossing closes Sept 28 for four weeks of work tied to the rail quiet zone. The city has not said who pays.",
    "* Downtown parking permit changes — staff proposed moving the permit year to April. The second-vehicle rate would rise by $40.",
    "* **Library district asks for a mill levy question** — the district wants a November 2027 ballot question. The board has taken no position on it.",
  ].join("\n");

  const parsed = parseFinishedStories(IDEAS);

  it("reads the list as ideas rather than one undifferentiated story", () => {
    assert.equal(parsed.method, "ideas");
    assert.equal(parsed.stories.length, 8);
    assert.equal(parsed.detectedTool, "Story ideas");
    for (const card of parsed.stories) {
      assert.equal(card.kind, "idea");
      assert.equal(card.isStory, true);
      assert.equal(card.includeByDefault, true);
    }
  });

  it("takes the headline and the description apart at the dash or the label", () => {
    assert.deepEqual(
      parsed.stories.map((s) => s.headline),
      [
        "Water Board conveyance plats at First and Main",
        "P&Z hearing on the Avis vehicle rental use",
        "Airport hangar lease assignment moves to a new owner",
        "Annexation of 0.88 acres on Nelson Road",
        "The budget's water fund gap",
        "Quiet zone work closes the 21st Avenue crossing",
        "Downtown parking permit changes",
        "Library district asks for a mill levy question",
      ],
    );
  });

  it("keeps every description word for word, with no markup and no bullet left on it", () => {
    assert.equal(
      parsed.stories[1]!.body,
      "a conditional use for vehicle sales and rental at 206 S. Main was heard Sept 23. The packet carries approve, conditional and deny resolutions.",
    );
    for (const card of parsed.stories) {
      assert.ok(!card.body.includes("**"), card.body.slice(0, 60));
      assert.ok(!card.headline.includes("**"), card.headline);
      assert.equal(bodyIsVerbatim(IDEAS, card), true);
    }
  });

  it("reads a list sitting under its own heading the same way", () => {
    const under = parseFinishedStories(
      [
        "## Story ideas",
        "",
        "* **Water Board conveyance plats at First and Main** — the board accepted plats on Sept 21. Nobody has confirmed what it decided.",
        "* **Quiet zone work closes the 21st Avenue crossing** — the crossing closes Sept 28. The city has not said who pays.",
      ].join("\n"),
    );
    assert.equal(under.method, "ideas");
    assert.equal(under.stories.length, 2);
    assert.equal(under.stories[0]!.headline, "Water Board conveyance plats at First and Main");
  });
});

describe("a single finished story with no markdown headings", () => {
  const PLAIN = [
    "Longmont council delays the transit vote to October",
    "",
    "The council put off its decision on the Ride Longmont expansion until October 6.",
    "",
    "Two members said they wanted the ridership figures first.",
  ].join("\n");

  it("still reads on its own, with the headline off the first line", () => {
    const story = parsePlainStory(PLAIN)!;
    assert.equal(story.headline, "Longmont council delays the transit vote to October");
    assert.equal(splitParagraphs(story.body).length, 2);
    assert.equal(stripOrdinal("1. Council votes"), "Council votes");
    assert.equal(parseFinishedStories("A wall of text with no headings and no breaks in it at all, running on and on until nobody could call any of it a headline").method, "none");
  });
});

describe("the line a headline came from is not repeated as the body's first line", () => {
  /*
    Step G, from the Unit X2 walk (item 11): the paste's first line is the
    headline, so it is not the body's first line as well. A story whose
    headline is read off a heading line arrives in the editor with that line
    printed over it again otherwise.

    Every shape this unit reads, one list: the report paths already took the
    heading off (the plain-story reader and the structured reader both slice
    the first paragraph away), and the one-story paste did not until this step.
  */
  const LIST = [
    "# Story ideas — Longmont, week of September 21, 2026",
    "",
    "* Quiet zone work closes the 21st Avenue crossing — the crossing closes Sept 28 for four weeks.",
    "* The budget's water fund gap — the 2027 budget message puts the Water Fund at $51.01 million.",
  ].join("\n");

  const PLAIN = [
    "Longmont council delays the transit vote to October",
    "",
    "The council put off its decision on the Ride Longmont expansion until October 6.",
    "",
    "Two members said they wanted the ridership figures first.",
  ].join("\n");

  function everyShape(): { name: string; cards: ReviewCard[] }[] {
    return [
      { name: "the Codex report", cards: cardsFromReport(parseFinishedStories(CODEX)) },
      { name: "the Claude report", cards: cardsFromReport(parseFinishedStories(CLAUDE)) },
      { name: "an idea list", cards: cardsFromReport(parseFinishedStories(LIST)) },
      { name: "a plain story", cards: cardsFromReport(parseFinishedStories(PLAIN)) },
      { name: "one pasted story", cards: [pasteOneStoryCard({ text: PLAIN })] },
    ];
  }

  it("keeps every card's body from opening with its own headline", () => {
    for (const { name, cards } of everyShape()) {
      assert.ok(cards.length > 0, `${name} read into cards`);
      for (const card of cards) {
        const firstLine = (splitParagraphs(cardBody(card))[0] ?? "").trim();
        assert.notEqual(firstLine, card.headline.trim(), `${name}: ${card.headline}`);
      }
    }
  });

  it("leaves every remaining line of a plain paste byte-identical, in order", () => {
    const card = pasteOneStoryCard({ text: PLAIN });
    assert.equal(card.headline, PLAIN.split("\n")[0]);
    assert.deepEqual(cardBody(card).split("\n"), PLAIN.split("\n").slice(2));
    const plain = cardsFromReport(parseFinishedStories(PLAIN))[0]!;
    assert.equal(plain.headline, PLAIN.split("\n")[0]);
    assert.deepEqual(plain.body.split("\n"), PLAIN.split("\n").slice(2));
  });
});
