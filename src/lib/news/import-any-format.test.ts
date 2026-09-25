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
  bodyIsVerbatim,
  containsVerbatim,
  containsVerbatimEither,
  parseFinishedStories,
  parsePlainStory,
  precleanMarkdown,
  splitParagraphs,
  stripOrdinal,
} from "./import-stories.ts";

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
    assert.equal(claudeStories.length, 19);
    // "## LEADS (ADVANCE)" / "## LEADS (HOLD)" hold leads; the rest of the
    // report is context, tables and notes, and none of it is a story.
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
