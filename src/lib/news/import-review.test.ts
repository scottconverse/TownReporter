import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFinishedStories } from "./import-stories.ts";
import {
  IMPORT_KINDS,
  NO_SECTION,
  SECTION_REQUIRED,
  cardBody,
  cardDisclosure,
  cardLabel,
  cardProblems,
  cardsFromReport,
  findDuplicate,
  keptLinks,
  readSummary,
  tickedCards,
  duplicateNote,
  selectionFromCard,
  type ReviewCard,
} from "./import-review.ts";
import { pasteOneStoryCard } from "./paste-one-story.ts";

/**
 * The fixtures, on the same footing the reader puts a paste on.
 *
 * `precleanMarkdown` and `splitParagraphs` both fold CRLF to LF, so every body
 * this module hands back is LF while the file on disk may not be: with
 * `core.autocrlf=true` a Windows checkout writes `LF` blobs as CRLF (`git show
 * HEAD:…/civic-scanner-longmont-2026-09-24.md` is 0 CR / 138 LF; the working
 * tree copy is 138 CR / 138 LF). Folding here rather than comparing raw is not
 * a weaker check: the claim at "byte for byte as pasted" is about words, and a
 * body that dropped, added, re-cased or reordered one still fails it. The
 * comparison below is byte-for-byte on text whose line-ending convention is the
 * one the reader guarantees, instead of red on a Windows checkout and green on
 * Linux for the same commit.
 */
function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8").replace(
    /\r\n?/g,
    "\n",
  );
}

const FIXTURE = fixture("civic-scanner-longmont-2026-09-24.md");

const CLAUDE = fixture("civic-scanner-claude-longmont-2026-09-24.md");

function cards(): ReviewCard[] {
  return cardsFromReport(parseFinishedStories(FIXTURE));
}

function claudeCards(): ReviewCard[] {
  return cardsFromReport(parseFinishedStories(CLAUDE));
}

/** The cards that are stories, in the report's own order. */
function stories(): ReviewCard[] {
  return cards().filter((c) => c.isStory);
}

describe("cardsFromReport on the real civic-scanner report", () => {
  it("opens on the seven stories ticked and the three non-story sections off", () => {
    const built = cards();
    assert.equal(built.length, 10);
    assert.equal(built.filter((c) => c.include).length, 7);
    assert.ok(built.filter((c) => c.isStory).every((c) => c.include));
    assert.deepEqual(
      built.filter((c) => !c.isStory).map((c) => c.headline),
      ["Beat context and source access", "Signals and watch list", "Upcoming dates to monitor"],
    );
    assert.ok(built.filter((c) => !c.isStory).every((c) => !c.include));
  });

  it("keeps every story's text byte for byte as pasted", () => {
    assert.equal(stories().length, 7);
    for (const card of stories()) {
      assert.ok(card.body.trim().length > 0, `${card.headline} has a body`);
      assert.ok(FIXTURE.includes(card.body), `${card.headline}'s body is in the paste as written`);
    }
  });

  it("carries every link in a story's block as a ticked source link", () => {
    const first = stories()[0]!;
    assert.equal(first.headline, "Council votes to bring marijuana hospitality rules back for consideration");
    assert.equal(first.links.length, 3, "story 1 cites two recordings and a packet");
    assert.ok(first.links.every((l) => l.keep));
    assert.ok(first.links.some((l) => l.url.includes("youtube.com")));
    assert.ok(first.links.some((l) => l.url.includes("primegov.com")));
    // Every link the story cites is in the paste it came from.
    for (const link of first.links) assert.ok(FIXTURE.includes(link.url));
  });

  it("imports story 7 with a visible Hold flag, and offers no section on a non-story", () => {
    assert.equal(stories()[6]!.hold, true);
    assert.equal(stories()[6]!.triage, "Hold");
    assert.equal(stories()[0]!.hold, false);
    for (const card of cards().filter((c) => !c.isStory)) {
      assert.equal(card.section, NO_SECTION);
      assert.deepEqual(cardProblems(card), [SECTION_REQUIRED]);
      assert.equal(cardBody(card).trim().length > 0, true);
    }
  });

  it("defaults a detected outside-AI report to the outside-AI disclosure line", () => {
    assert.ok(cards().every((c) => c.disclosureKey === "outside-ai"));
    assert.equal(
      cardDisclosure(stories()[0]!),
      "An outside AI research tool wrote this from public records; an editor reviewed it.",
    );
  });
});

describe("the label a card wears", () => {
  /*
    The card's header sat directly above a HEADLINE field holding the same
    words, prefixed "Story: " (coordinator review of the Unit X screenshots,
    2026-09-24). For a story the label is the headline; the prefix said nothing
    the field below did not, to an editor looking at a story card.
  */
  it("is the headline itself, with no 'Story: ' in front of the same words", () => {
    const first = stories()[0]!;
    assert.equal(cardLabel(first), first.headline.trim());
    assert.equal(cardLabel(first).startsWith("Story:"), false);
  });

  it("still says so when the card is not a story, which is all it has to say", () => {
    const notAStory = cards().find((c) => !c.isStory)!;
    assert.equal(cardLabel(notAStory), `Not a story: ${notAStory.headline.trim()}`);
  });
});

describe("the kind a card is offered as", () => {
  /*
    Step D, 2026-09-24: "Each card gets 'Import as: Finished story / Story
    idea'." The default is the reader's, off the card's own text (see
    `defaultImportKind`), and a card the report itself dropped opens unticked --
    the demoted leads in the Claude scan are cards now, but none of them is
    ticked for the editor.
  */
  it("offers the Codex report's seven stories as finished stories, all ticked", () => {
    const built = cards();
    assert.deepEqual(
      built.filter((c) => c.isStory).map((c) => c.kind),
      Array.from({ length: 7 }, () => "story"),
    );
    for (const card of built.filter((c) => c.isStory)) {
      assert.equal(card.include, true);
      assert.equal(card.includeByDefault, true);
    }
    for (const card of built.filter((c) => !c.isStory)) assert.equal(card.include, false);
  });

  it("offers the Claude report's leads as stories or ideas, and ticks only the leads", () => {
    const built = claudeCards();
    assert.equal(built.length, 38);
    assert.equal(built.filter((c) => c.include).length, 19);
    const ticked = built.filter((c) => c.include);
    assert.equal(ticked.filter((c) => c.kind === "story").length, 10);
    assert.equal(ticked.filter((c) => c.kind === "idea").length, 9);
    for (const card of built) assert.equal(card.include, card.includeByDefault);
  });

  it("opens a demoted lead's card unticked, because the report said not to run it", () => {
    const demoted = claudeCards().filter((c) => c.triage === "Demote");
    assert.equal(demoted.length, 3);
    for (const card of demoted) {
      assert.equal(card.kind, "idea");
      assert.equal(card.include, false);
      assert.equal(card.includeByDefault, false);
      assert.equal(card.hold, true);
      assert.ok(card.body.trim().length > 0);
    }
  });

  it("says 'Story idea:' on a card that is one, and still 'Not a story:' on a section", () => {
    const idea = claudeCards().find((c) => c.kind === "idea" && c.isStory)!;
    assert.equal(cardLabel(idea), `Story idea: ${idea.headline.trim()}`);
    const notAStory = cards().find((c) => !c.isStory)!;
    assert.equal(cardLabel(notAStory), `Not a story: ${notAStory.headline.trim()}`);
    const story = cards().find((c) => c.isStory && c.kind === "story")!;
    assert.equal(cardLabel(story), story.headline.trim());
  });

  it("names the text an idea is missing in the idea's own words", () => {
    const idea = claudeCards().find((c) => c.kind === "idea" && c.isStory)!;
    assert.deepEqual(cardProblems(idea), []);
    assert.deepEqual(cardProblems({ ...idea, body: " ", plainBrief: "" }), [
      "This idea has no description.",
    ]);
    const story = cards().find((c) => c.isStory && c.kind === "story")!;
    assert.deepEqual(cardProblems({ ...story, body: " ", plainBrief: "" }), [
      "This story has no text.",
    ]);
  });

  it("sends the kind and the report's cited documents with the card", () => {
    const built = claudeCards();
    const first = built.find((c) => c.headline.startsWith("Council votes 4-3"))!;
    assert.deepEqual(first.citations, [
      "Sept 22 council recording 0:23:37 to 0:36:25 (transcript-based)",
      "Sept 22 packet p. 819 (Tier A)",
      "2027 Budget Message, Sept 1 (Tier A, CONTEXT)",
    ]);
    const payload = selectionFromCard(first);
    assert.equal(payload.kind, "story");
    assert.deepEqual(payload.citations, first.citations);
    const idea = claudeCards().find((c) => c.triage === "Demote")!;
    const ideaPayload = selectionFromCard(idea);
    assert.equal(ideaPayload.kind, "idea");
    assert.equal(ideaPayload.headline, idea.headline.trim());
  });

  it("carries a card's kind wherever a card is built, the one-story paste included", () => {
    const card = pasteOneStoryCard({
      text: "A headline\n\nA paragraph of the story as it was pasted in.",
      headline: "",
      section: "council",
    });
    assert.equal(card.kind, "story");
    assert.equal(card.includeByDefault, true);
    assert.deepEqual(card.citations, []);
  });
});

describe("what the review screen says it read", () => {
  /*
    Step D: "Each card gets 'Import as: Finished story / Story idea'." The two
    labels are the brief's own words, because the radio pair is the sentence an
    editor reads.
  */
  it("offers the two import kinds in the brief's own words", () => {
    assert.deepEqual(
      IMPORT_KINDS.map((k) => k.label),
      ["Finished story", "Story idea"],
    );
    assert.deepEqual(
      IMPORT_KINDS.map((k) => k.key),
      ["story", "idea"],
    );
  });

  /**
   * An idea list read as "8 stories" sends the editor looking for eight
   * stories that are not there.
   */
  it("counts stories and ideas apart, on every shape of paste", () => {
    assert.equal(readSummary(parseFinishedStories(FIXTURE)), "Read 7 stories out of the paste.");
    assert.equal(
      readSummary(parseFinishedStories(CLAUDE)),
      "Read 10 stories and 12 story ideas out of the paste.",
    );
    const list = [
      "# Story ideas — Longmont, week of September 21, 2026",
      "",
      "* Water Board conveyance plats at First and Main — the board takes it up Sept 21.",
      "* The budget water fund gap — the 2027 budget leaves it open.",
      "* Quiet zone work closes the 21st Avenue crossing — a week of closures.",
    ].join("\n");
    assert.equal(readSummary(parseFinishedStories(list)), "Read 3 story ideas out of the paste.");
    assert.equal(
      readSummary(parseFinishedStories("One headline\n\nThe one paragraph of a story.")),
      "Read one story, with no headings to split it.",
    );
  });
});

describe("the choices the review screen offers", () => {
  it("resolves the body choice, and never returns nothing when the brief is missing", () => {
    const card = stories()[0]!;
    assert.equal(cardBody({ ...card, bodyChoice: "main" }), card.body);
    assert.equal(cardBody({ ...card, bodyChoice: "brief" }), card.plainBrief);
    assert.equal(cardBody({ ...card, bodyChoice: "both" }), `${card.plainBrief}\n\n${card.body}`);
    const noBrief = { ...card, plainBrief: "", bodyChoice: "brief" as const };
    assert.equal(cardBody(noBrief), card.body);
  });

  it("drops an unticked source link and every blank one", () => {
    const card = stories()[0]!;
    const dropped = {
      ...card,
      links: [
        { ...card.links[0]!, keep: false },
        ...card.links.slice(1),
        { text: "half a url", url: "  ", keep: true },
      ],
    };
    assert.deepEqual(
      keptLinks(dropped).map((l) => l.url),
      card.links.slice(1).map((l) => l.url),
    );
  });

  it("blocks a card the editor has not given a section, in the desk's own words", () => {
    const card = stories()[0]!;
    assert.deepEqual(cardProblems(card), []);
    assert.deepEqual(cardProblems({ ...card, section: "" }), [SECTION_REQUIRED]);
    assert.deepEqual(cardProblems({ ...card, headline: "  " }), ["Give it a headline first."]);
    assert.deepEqual(cardProblems({ ...card, body: " ", plainBrief: "" }), [
      "This story has no text.",
    ]);
    assert.deepEqual(cardProblems({ ...card, disclosureKey: "other", disclosureOther: "" }), [
      "Write the disclosure line, or pick one of the ready-made ones.",
    ]);
  });

  it("imports only the ticked cards, in the report's own order", () => {
    const built = cards();
    const turned = built.map((c, i) => ({ ...c, include: i !== 2 }));
    assert.deepEqual(
      tickedCards(turned).map((c) => c.headline),
      built.filter((_, i) => i !== 2).map((c) => c.headline),
    );
    assert.equal(tickedCards(turned).length, 9);
  });

  it("warns about a likely duplicate and leaves the decision to the editor", () => {
    assert.match(
      duplicateNote({ headline: "Council votes on marijuana rules", slug: "council-votes" }),
      /already published as “Council votes on marijuana rules”.*you decide/s,
    );
    assert.match(duplicateNote({ headline: "Ride Longmont expansion", leadId: 12 }), /already on the desk/);
    assert.equal(duplicateNote(undefined), "");
  });

  it("finds a story already printed, and says which one, and leaves the decision to the editor", () => {
    const card = stories()[0]!;
    // The published paper carries the same story under its own headline.
    const published = [
      {
        slug: "council-marijuana-hospitality",
        headline: "Council votes to bring marijuana hospitality rules back for consideration",
        published_at: "2026-09-20T00:00:00.000Z",
      },
    ];
    assert.deepEqual(findDuplicate(card, { leads: [], published }), {
      headline: "Council votes to bring marijuana hospitality rules back for consideration",
      slug: "council-marijuana-hospitality",
    });
    // A lead on the desk, not yet published.
    assert.deepEqual(findDuplicate(card, { leads: [{ id: 12, headline: card.headline }], published: [] }), {
      headline: card.headline,
      leadId: 12,
    });
    // Printed beats on-the-desk: it is the stronger of the two facts.
    assert.equal(findDuplicate(card, { leads: [{ id: 12, headline: card.headline }], published })?.slug, published[0]!.slug);
  });

  it("does not warn about a story nothing resembles, or one with no headline yet", () => {
    const card = stories()[0]!;
    assert.equal(
      findDuplicate(card, {
        leads: [{ id: 1, headline: "Ride Longmont expansion opens Saturday" }],
        published: [{ slug: "bike-lanes", headline: "City adds bike lanes on Main Street", published_at: "2026-09-01T00:00:00.000Z" }],
      }),
      undefined,
    );
    assert.equal(findDuplicate({ ...card, headline: "   " }, { leads: [{ id: 1, headline: card.headline }], published: [] }), undefined);
  });
});
