import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { performImportFinishedStories } from "./import-stories.server.ts";
import { SECTION_REQUIRED, cardProblems, selectionFromCard } from "./import-review.ts";
import { headlineFromPaste, pasteOneStoryCard } from "./paste-one-story.ts";

/**
 * "Paste a story I already have", driven the whole way: the card the Desk
 * builds from one paste, through the same server function the import review
 * screen's Import button calls. Nothing here is a fake of the save path -- the
 * rows below are real PGlite rows written by the real code.
 *
 * A story typed as a person would type it: a headline line, paragraphs, a
 * source link, a correction, and a `**Score:**` line the reporter left in by
 * accident. That last line is the interesting one: the report reader lifts it
 * out of the text (it is part of a scanner's format), and this screen must not,
 * because a story you wrote has no format and a line removed by guesswork is a
 * paragraph published missing.
 *
 * The one line that does leave is the headline's own (step G): a paste's first
 * line becomes the headline, and it is not repeated as the body's first line.
 */
const PASTED = [
  "Council votes to bring marijuana hospitality rules back for consideration",
  "",
  "The council voted 5-2 on Tuesday to bring the hospitality rules back for a first reading.",
  "",
  "**Score:** 9/20",
  "",
  "How much any sales tax revenue would be is unknown; the budget office has not said.",
  "",
  "[council packet](https://longmont.primegov.com/packet)",
  "",
  "Correction: an earlier version said the vote was unanimous.",
].join("\n");

/**
 * The same paste with the line that becomes its headline taken off.
 *
 * Step G (from the Unit X2 walk, item 11): the first line is the headline, so
 * it is not also the body's first line. Nothing else moves.
 */
const PASTED_BODY = PASTED.split("\n").slice(2).join("\n");

async function ensureSchema() {
  const sql = await getSql();
  await sql.query(`create table if not exists leads (id serial primary key, newsroom_id integer not null,
    user_id text not null, scan_run_id integer, headline text, why text, topic text default 'council',
    status text default 'new', source_urls text default '[]', evidence text, newsworthiness integer default 0,
    created_at timestamptz default now(), investigation_id integer, notes_json text, origin text, provenance_json text)`);
  await sql.query(`create table if not exists drafts (id serial primary key, newsroom_id integer, user_id text,
    lead_id integer, headline text, dek text default '', body text not null, topic text not null,
    source_urls text default '[]', provenance_json text default '[]', disclosure_text text not null default '',
    research_json text default '{}', updated_at timestamptz default now())`);
  await sql.query(`create table if not exists articles (id serial primary key, newsroom_id integer, area text)`);
  /*
    The Opinion desk's marker row. `fileWrittenEditorial` writes one so a pasted
    editorial appears where the desk looks for editorials; the news side must
    never write one, and counting them is how "not opinion" is checked without
    asserting a column that does not exist.
  */
  await sql.query(`create table if not exists editorial_requests (id serial primary key,
    newsroom_id integer, user_id text, subject text, source_kind text, source_ref text,
    draft_id integer, finished_at timestamptz)`);
  return sql;
}

describe("headlineFromPaste: the first line, when nothing is typed", () => {
  it("takes the first line that has anything in it, without its markdown markers", () => {
    assert.equal(headlineFromPaste(PASTED), "Council votes to bring marijuana hospitality rules back for consideration");
    assert.equal(headlineFromPaste("\n\n# A heading line\n\nThe body."), "A heading line");
    assert.equal(headlineFromPaste("**Bold headline**\n\nThe body."), "Bold headline");
  });

  it("invents nothing when there is nothing to read", () => {
    assert.equal(headlineFromPaste("   \n\n  "), "");
  });
});

describe("pasteOneStoryCard: one story, exactly as pasted", () => {
  it("carries the paste byte for byte, with the headline's own line taken off the top", () => {
    const card = pasteOneStoryCard({ text: PASTED });
    /*
      Step G: the first line is the headline and is not repeated as the body's
      first line. Every remaining line is byte-identical, in order, exactly
      once -- this is a split, not an edit.
    */
    assert.equal(card.body, PASTED_BODY);
    assert.deepEqual(card.body.split("\n"), PASTED.split("\n").slice(2));
    assert.equal(card.body.startsWith("The council voted 5-2"), true);
    assert.equal(card.body.includes("Council votes to bring marijuana hospitality rules back"), false);
    // The report reader would have moved this out of the text and into the
    // editor notes. Here it stays in the story and the notes stay empty.
    assert.equal(card.body.includes("**Score:** 9/20"), true);
    assert.deepEqual([card.score, card.triage, card.reporterNextStep], ["", "", ""]);
    assert.equal(card.body.includes("Correction: an earlier version"), true);
  });

  it("takes the headline's line off a paste that writes it as a heading", () => {
    const pasted = ["# Council votes on the hospitality rules", "", "The council voted 5-2 on Tuesday."].join("\n");
    const card = pasteOneStoryCard({ text: pasted });
    assert.equal(card.headline, "Council votes on the hospitality rules");
    assert.equal(card.body, "The council voted 5-2 on Tuesday.");
  });

  /**
   * The literal reading of the rule, on the paste that has nothing but a
   * headline: the line is the headline, so no body is left, and the ordinary
   * "This story has no text." refusal says so rather than filing a draft whose
   * body is the headline the field above it already shows.
   */
  it("leaves no body at all when the paste is one line, and says so", () => {
    const card = pasteOneStoryCard({ text: "Only a headline, and nothing under it" });
    assert.equal(card.headline, "Only a headline, and nothing under it");
    assert.equal(card.body, "");
    assert.deepEqual(cardProblems({ ...card, section: "council" }), ["This story has no text."]);
  });

  it("collects the links in the paste as its sources, ticked", () => {
    const card = pasteOneStoryCard({ text: PASTED });
    assert.deepEqual(card.links, [
      { text: "council packet", url: "https://longmont.primegov.com/packet", keep: true },
    ]);
  });

  it("is one ticked news story, and its section is the editor's to choose", () => {
    const card = pasteOneStoryCard({ text: PASTED });
    assert.equal(card.isStory, true);
    assert.equal(card.include, true);
    // Nothing is guessed into it. The report import screen suggests a section
    // with topicFromText; a story you wrote is not a report, and the "Budget"
    // the chooser read out of this very fixture is the mistake the brief was
    // written about.
    assert.equal(card.section, "");
    assert.equal(card.suggestedSection, "");
    assert.equal(pasteOneStoryCard({ text: PASTED, section: "schools" }).section, "schools");
  });

  /**
   * The section is asked for before the story is filed, in the same words the
   * review screen uses, and this is not a nicety: a draft with no `topic` is
   * refused by the database itself. `resolve_story_section` on `drafts`
   * (sections.server.ts:37) raises "Section not found in this newsroom: " for
   * an empty key, and every other way into the Queue -- the write box, the
   * import review screen -- picks a section first. The first version of the
   * Desk's paste panel left it unchosen and let the editor pick later; the
   * browser walk in this unit found it as a 500, which is why the rule is
   * asserted here.
   */
  it("will not be filed until the editor picks a section, in the review screen's words", () => {
    const problems = cardProblems(pasteOneStoryCard({ text: PASTED }));
    assert.deepEqual(problems, [SECTION_REQUIRED]);
    assert.equal(SECTION_REQUIRED, "Section not chosen — pick one");
    assert.deepEqual(cardProblems(pasteOneStoryCard({ text: PASTED, section: "schools" })), []);
  });

  it("takes a typed headline over the first line, and then the whole paste is the body", () => {
    const card = pasteOneStoryCard({ text: PASTED, headline: "  Hospitality rules return  " });
    assert.equal(card.headline, "Hospitality rules return");
    /*
      The other half of step G: the editor wrote the headline themselves, so
      the paste's first line is just the story's first line and nothing is
      taken off it.
    */
    assert.equal(card.body, PASTED);
    assert.equal(card.body.startsWith("Council votes to bring marijuana hospitality rules back"), true);
  });

  it("says a person wrote it, and prints the line when the editor says otherwise", () => {
    assert.equal(pasteOneStoryCard({ text: PASTED }).disclosureKey, "person");
    const ai = pasteOneStoryCard({ text: PASTED, disclosureKey: "outside-ai" });
    assert.equal(ai.disclosureKey, "outside-ai");
  });
});

describe("a pasted story, through the real import path", () => {
  it("lands in the Queue as one news draft, word for word, and publishes nothing", async () => {
    const sql = await ensureSchema();
    const card = pasteOneStoryCard({ text: PASTED, section: "council" });
    const result = await performImportFinishedStories(
      { userId: "editor", newsroomId: 71 },
      { text: PASTED, tool: "", stories: [selectionFromCard(card)] },
      { capture: async () => ({ captured: 0, failed: 0 }) },
    );
    assert.equal(result.error, "");
    assert.deepEqual(result.imported.map((i) => i.headline), [card.headline]);
    assert.equal(result.refused.length, 0);

    const leads = (await sql.query(
      "select id, headline, status, origin, topic from leads where newsroom_id=71 order by id",
    )) as { id: number; headline: string; status: string; origin: string; topic: string }[];
    assert.equal(leads.length, 1);
    assert.equal(leads[0]!.origin, "import");
    assert.equal(leads[0]!.status, "new");
    assert.equal(leads[0]!.headline, "Council votes to bring marijuana hospitality rules back for consideration");

    const drafts = (await sql.query(
      "select lead_id, headline, body, topic, source_urls, research_json from drafts where newsroom_id=71 order by id",
    )) as {
      lead_id: number;
      headline: string;
      body: string;
      topic: string;
      source_urls: string;
      research_json: string;
    }[];
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.lead_id, leads[0]!.id);
    // The text an editor gets in the story editor is the paste minus the line
    // that became the headline, byte for byte.
    assert.equal(drafts[0]!.body, PASTED_BODY);
    assert.equal(Buffer.byteLength(drafts[0]!.body, "utf8"), Buffer.byteLength(PASTED_BODY, "utf8"));
    assert.equal(PASTED.includes(drafts[0]!.body), true);
    // The section the editor chose on the Desk reaches the draft unchanged.
    // (It is not confirmed yet -- the ordinary confirm-at-publish gate still
    // asks, and the browser walk clicks that button on this story.)
    assert.equal(drafts[0]!.topic, "council");
    assert.equal(leads[0]!.topic, "council");
    assert.deepEqual(JSON.parse(drafts[0]!.source_urls), ["https://longmont.primegov.com/packet"]);
    assert.deepEqual(JSON.parse(drafts[0]!.research_json), { importedText: true });

    // Nothing published, and nothing filed as an editorial: this is a news
    // story in the Queue, not an Opinion piece.
    const [printed] = (await sql.query("select count(*)::int as n from articles")) as { n: number }[];
    const [editorials] = (await sql.query("select count(*)::int as n from editorial_requests")) as {
      n: number;
    }[];
    assert.equal(printed!.n, 0);
    assert.equal(editorials!.n, 0);
  });

  it("files under the section the editor chose", async () => {
    const sql = await ensureSchema();
    const card = pasteOneStoryCard({ text: PASTED, section: "schools" });
    const result = await performImportFinishedStories(
      { userId: "editor", newsroomId: 72 },
      { text: PASTED, tool: "", stories: [selectionFromCard(card)] },
      { capture: async () => ({ captured: 0, failed: 0 }) },
    );
    assert.equal(result.ok, true);
    const drafts = (await sql.query("select topic from drafts where newsroom_id=72 order by id")) as {
      topic: string;
    }[];
    assert.deepEqual(drafts.map((d) => d.topic), ["schools"]);
  });

  it("refuses a paste with nothing in it, and writes nothing", async () => {
    const sql = await ensureSchema();
    const [before] = (await sql.query("select count(*)::int as n from leads")) as { n: number }[];
    const card = pasteOneStoryCard({ text: "   " });
    const result = await performImportFinishedStories(
      { userId: "editor", newsroomId: 73 },
      { text: "   ", tool: "", stories: [selectionFromCard(card)] },
      { capture: async () => ({ captured: 0, failed: 0 }) },
    );
    assert.equal(result.ok, false);
    assert.match(result.error, /no text to import/i);
    const [after] = (await sql.query("select count(*)::int as n from leads")) as { n: number }[];
    assert.equal(after!.n, before!.n);
  });
});
