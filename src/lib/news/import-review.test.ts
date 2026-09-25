import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFinishedStories } from "./import-stories.ts";
import {
  NO_SECTION,
  SECTION_REQUIRED,
  cardBody,
  cardDisclosure,
  cardLabel,
  cardProblems,
  cardsFromReport,
  findDuplicate,
  keptLinks,
  tickedCards,
  duplicateNote,
  type ReviewCard,
} from "./import-review.ts";

const FIXTURE = readFileSync(
  new URL("./fixtures/civic-scanner-longmont-2026-09-24.md", import.meta.url),
  "utf8",
);

function cards(): ReviewCard[] {
  return cardsFromReport(parseFinishedStories(FIXTURE));
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
