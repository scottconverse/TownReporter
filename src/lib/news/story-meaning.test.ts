import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getPglite, getSql } from "../db.ts";
import { fillStoryMeaningOnce, pruneStoryMeaningOnce } from "./story-meaning-fill.server.ts";
import {
  clearStoryMeaningCache,
  pastStoryCoverage,
  searchPastStories,
  searchUploadedFiles,
} from "./story-meaning-search.server.ts";
import { searchEvidence, clearEvidenceVectorCache } from "./evidence-search.server.ts";
import { pastStoriesForWriter } from "./past-stories-for-writer.server.ts";
import { pastStoriesBlock } from "./past-stories-block.ts";
import { setEmbedderForTests, EVIDENCE_DIMS } from "./evidence-embed.server.ts";

/**
 * DEF-1: search by meaning over our own published stories and over the files
 * an editor uploaded. These run the REAL fill and search against the real
 * (PGlite) `articles`, `story_documents` and `story_meaning_vectors` tables
 * with a fake embedder. The model itself is never loaded here.
 *
 * The fake embedder gives a text one axis per subject word it mentions, so
 * "water rates" is close to a story about water and far from one about a
 * bridge, and a text with no subject word is far from everything.
 */

const ROOM = 861;
const OTHER_ROOM = 862;
const SUBJECTS = ["water", "bridge", "school", "budget", "zoning", "library"];

function fakeEmbed(text: string): Float32Array {
  const v = new Float32Array(EVIDENCE_DIMS);
  const lower = text.toLowerCase();
  SUBJECTS.forEach((word, i) => {
    if (lower.includes(word)) v[i] = 1;
  });
  let norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  if (norm === 0) {
    // "No subject": its own axis per text, so it is far from every subject and
    // from every other no-subject text.
    let hash = 0;
    for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) % 150;
    v[200 + hash] = 1;
    norm = 1;
  }
  return v.map((x) => x / norm);
}

let embedCalls = 0;
function useFakeEmbedder() {
  embedCalls = 0;
  setEmbedderForTests(async (texts) => {
    embedCalls += texts.length;
    return texts.map(fakeEmbed);
  });
}

let counter = 0;

async function lead(room: number, headline: string): Promise<number> {
  const sql = await getSql();
  const [row] = await sql<{ id: number }>`
    insert into leads (user_id, newsroom_id, headline, why, topic)
    values ('def1-user', ${room}, ${headline}, '', 'council') returning id
  `;
  return row!.id;
}

async function story(
  headline: string,
  options: {
    room?: number;
    dek?: string;
    body?: string;
    status?: string;
    publishedAt?: string;
    leadId?: number | null;
  } = {},
): Promise<number> {
  counter += 1;
  const sql = await getSql();
  const [row] = await sql<{ id: number }>`
    insert into articles (user_id, newsroom_id, lead_id, slug, headline, dek, body, topic, status, published_at)
    values ('def1-user', ${options.room ?? ROOM}, ${options.leadId ?? null}, ${`def1-story-${counter}`},
            ${headline}, ${options.dek ?? ""}, ${options.body ?? "Plain body text for the story."}, 'council',
            ${options.status ?? "published"}, ${options.publishedAt ?? "2026-10-03T18:00:00Z"}::timestamptz)
    returning id
  `;
  return row!.id;
}

async function file(
  filename: string,
  fullText: string | null,
  options: {
    room?: number;
    leadId?: number | null;
    sourceUrl?: string | null;
    status?: string;
    mime?: string;
  } = {},
): Promise<string> {
  counter += 1;
  const id = `def1-doc-${counter}`;
  const sql = await getSql();
  await sql`
    insert into story_documents (id, newsroom_id, user_id, lead_id, filename, mime, original, full_text, status, source_url)
    values (${id}, ${options.room ?? ROOM}, 'def1-user', ${options.leadId ?? null}, ${filename},
            ${options.mime ?? "application/pdf"}, ${new Uint8Array([1, 2, 3])}, ${fullText},
            ${options.status ?? "read"}, ${options.sourceUrl ?? null})
  `;
  return id;
}

async function vectorRows(kind: string, ownerId: string | number) {
  const sql = await getSql();
  return sql<{ part: number; source_md5: string }>`
    select part, source_md5 from story_meaning_vectors
    where kind = ${kind} and owner_id = ${String(ownerId)} order by part
  `;
}

const para = (word: string, chars: number) =>
  `${word} ` + "filler ".repeat(Math.ceil(chars / 7)).slice(0, chars - word.length - 1);

async function wipe() {
  const sql = await getSql();
  await sql`delete from story_meaning_vectors`;
  // The migrations seed a welcome article; the fill is paper-wide, so start empty.
  await sql`delete from story_documents`;
  await sql`delete from articles`;
  await sql`delete from leads where user_id = 'def1-user'`;
}

beforeEach(async () => {
  await wipe();
  clearStoryMeaningCache();
  clearEvidenceVectorCache();
  useFakeEmbedder();
});

afterEach(() => {
  setEmbedderForTests(null);
  clearStoryMeaningCache();
  clearEvidenceVectorCache();
  delete process.env.TOWNREPORTER_MEANING_SEARCH;
});

const q = (text: string) => fakeEmbed(text);

describe("A: published stories get meaning vectors", () => {
  it("embeds the headline + summary and each body part, and only for published stories", async () => {
    const body = [para("one", 600), para("two", 600), para("three", 600)].join("\n\n");
    const published = await story("Water rates go up", { dek: "A 4 percent rise.", body });
    const draft = await story("Bridge plan", { status: "draft" });

    const done = await fillStoryMeaningOnce({ articles: 10, documents: 0 });
    assert.equal(done, 1);
    const rows = await vectorRows("article", published);
    assert.deepEqual(rows.map((r) => r.part), [0, 1, 2, 3]);
    assert.equal((await vectorRows("article", draft)).length, 0);
    // Nothing left to do on the next pass.
    assert.equal(await fillStoryMeaningOnce({ articles: 10, documents: 0 }), 0);
  });

  it("stores vectors only: no headline, text or address in the table", async () => {
    await story("Secret headline about water", { body: "Secret body about water" });
    await fillStoryMeaningOnce({ articles: 5, documents: 0 });
    const sql = await getSql();
    const [row] = await sql<{ everything: string }>`
      select string_agg(v::text, ' ') as everything from story_meaning_vectors v
    `;
    assert.doesNotMatch(row!.everything, /Secret/);
    assert.doesNotMatch(row!.everything, /def1-story/);
  });

  it("does newest stories first and works through a backlog in batches", async () => {
    const old = await story("Old water story", { publishedAt: "2026-01-01T00:00:00Z" });
    const fresh = await story("Fresh water story", { publishedAt: "2026-10-20T00:00:00Z" });
    assert.equal(await fillStoryMeaningOnce({ articles: 1, documents: 0 }), 1);
    assert.equal((await vectorRows("article", fresh)).length > 0, true);
    assert.equal((await vectorRows("article", old)).length, 0);
    assert.equal(await fillStoryMeaningOnce({ articles: 1, documents: 0 }), 1);
    assert.equal((await vectorRows("article", old)).length > 0, true);
  });

  it("re-embeds a story whose text was edited, replacing the old parts", async () => {
    const id = await story("Water rates", { body: para("old", 1_800) });
    await fillStoryMeaningOnce({ articles: 5, documents: 0 });
    const before = await vectorRows("article", id);
    assert.ok(before.length >= 3);
    const sql = await getSql();
    await sql`update articles set body = 'Short corrected body about water.' where id = ${id}`;
    assert.equal(await fillStoryMeaningOnce({ articles: 5, documents: 0 }), 1);
    const after = await vectorRows("article", id);
    assert.equal(after.length, 2);
    assert.notEqual(after[0]!.source_md5, before[0]!.source_md5);
  });
});

describe("A: past stories by meaning", () => {
  it("finds the story about the subject, not the unrelated one, with headline, date and link", async () => {
    await story("Council raises water rates", { dek: "Utility bills rise.", publishedAt: "2026-10-03T18:00:00Z" });
    await story("Main Street bridge reopens", { dek: "Traffic returns." });
    await fillStoryMeaningOnce({ articles: 10, documents: 0 });

    const found = await searchPastStories(ROOM, q("water rates"));
    assert.deepEqual(found.map((r) => r.headline), ["Council raises water rates"]);
    assert.match(found[0]!.url, /\/articles\/def1-story-\d+$/);
    assert.ok(found[0]!.publishedAt.startsWith("2026-10-03"));
    assert.ok(found[0]!.score > 0.9);
  });

  it("finds a story by a paragraph deep in the body", async () => {
    const body = [para("intro", 900), para("middle", 900), "The school board will vote on the budget."].join("\n\n");
    await story("Town meeting notes", { body });
    await fillStoryMeaningOnce({ articles: 10, documents: 0 });
    const found = await searchPastStories(ROOM, q("school budget"));
    assert.deepEqual(found.map((r) => r.headline), ["Town meeting notes"]);
  });

  it("gives nonsense nothing", async () => {
    await story("Council raises water rates");
    await fillStoryMeaningOnce({ articles: 10, documents: 0 });
    assert.deepEqual(await searchPastStories(ROOM, q("vybrunt xoxo tlk")), []);
  });

  it("an unpublished or deleted story drops out of the very next search, with no prune", async () => {
    const stay = await story("Water main repair", { dek: "water" });
    const unpublish = await story("Water rates rise", { dek: "water" });
    const remove = await story("Water plant upgrade", { dek: "water" });
    await fillStoryMeaningOnce({ articles: 10, documents: 0 });

    const first = await searchPastStories(ROOM, q("water"));
    assert.equal(first.length, 3);

    const sql = await getSql();
    await sql`update articles set status = 'draft' where id = ${unpublish}`;
    await sql`delete from articles where id = ${remove}`;
    // The vector cache still holds all three; the live row decides.
    const next = await searchPastStories(ROOM, q("water"));
    assert.deepEqual(next.map((r) => r.articleId), [stay]);
  });

  it("brings an unpublished story back when it is published again", async () => {
    const id = await story("Water rates rise", { dek: "water", status: "draft" });
    await fillStoryMeaningOnce({ articles: 10, documents: 0 });
    assert.deepEqual(await searchPastStories(ROOM, q("water")), []);
    const sql = await getSql();
    await sql`update articles set status = 'published' where id = ${id}`;
    assert.equal(await fillStoryMeaningOnce({ articles: 10, documents: 0 }), 1);
    assert.deepEqual((await searchPastStories(ROOM, q("water"))).map((r) => r.articleId), [id]);
  });

  it("never shows another paper's stories", async () => {
    await story("Water rates rise", { dek: "water", room: OTHER_ROOM });
    await fillStoryMeaningOnce({ articles: 10, documents: 0 });
    assert.deepEqual(await searchPastStories(ROOM, q("water")), []);
    assert.equal((await searchPastStories(OTHER_ROOM, q("water"))).length, 1);
  });

  it("leaves out the story being written (its own lead) and keeps the rest", async () => {
    const mine = await lead(ROOM, "Water rates story");
    await story("Water rates printed last week", { dek: "water", leadId: mine });
    await story("Water main break", { dek: "water" });
    await fillStoryMeaningOnce({ articles: 10, documents: 0 });
    const found = await searchPastStories(ROOM, q("water"), { excludeLeadId: mine });
    assert.deepEqual(found.map((r) => r.headline), ["Water main break"]);
  });

  it("returns at most the limit, closest first", async () => {
    await story("Water one", { dek: "water" });
    await story("Water and budget", { dek: "water budget" });
    for (let i = 0; i < 6; i += 1) await story(`Water story ${i}`, { dek: "water" });
    await fillStoryMeaningOnce({ articles: 25, documents: 0 });
    const found = await searchPastStories(ROOM, q("water"), { limit: 5 });
    assert.equal(found.length, 5);
    assert.ok(found.every((r) => r.headline !== "Water and budget"), "the weaker match is cut");
    for (let i = 1; i < found.length; i += 1) assert.ok(found[i - 1]!.score >= found[i]!.score);
  });

  it("counts covered and total published stories", async () => {
    await story("Water rates", { dek: "water" });
    await story("Bridge plan", { dek: "bridge" });
    await fillStoryMeaningOnce({ articles: 1, documents: 0 });
    clearStoryMeaningCache();
    assert.deepEqual(await pastStoryCoverage(ROOM), { covered: 1, total: 2 });
  });

  it("does not look at a story again once it has no usable text", async () => {
    const sql = await getSql();
    const id = await story("x", { body: "\u0001\u0002\u0003".repeat(100) });
    await sql`update articles set headline = '' where id = ${id}`;
    assert.equal(await fillStoryMeaningOnce({ articles: 5, documents: 0 }), 1);
    assert.equal(await fillStoryMeaningOnce({ articles: 5, documents: 0 }), 0);
  });
});

describe("prune", () => {
  it("removes the rows of an unpublished or deleted story and keeps the rest", async () => {
    const keep = await story("Water keep", { dek: "water" });
    const gone = await story("Water gone", { dek: "water" });
    const drafted = await story("Water drafted", { dek: "water" });
    const doc = await file("kept.pdf", para("zoning", 800));
    const docGone = await file("gone.pdf", para("zoning", 800));
    await fillStoryMeaningOnce({ articles: 10, documents: 5 });

    const sql = await getSql();
    await sql`delete from articles where id = ${gone}`;
    await sql`update articles set status = 'draft' where id = ${drafted}`;
    await sql`delete from story_documents where id = ${docGone}`;
    assert.ok((await pruneStoryMeaningOnce()) >= 3);
    assert.ok((await vectorRows("article", keep)).length > 0);
    assert.equal((await vectorRows("article", gone)).length, 0);
    assert.equal((await vectorRows("article", drafted)).length, 0);
    assert.ok((await vectorRows("document", doc)).length > 0);
    assert.equal((await vectorRows("document", docGone)).length, 0);
    assert.equal(await pruneStoryMeaningOnce(), 0);
  });
});

describe("B: uploaded files by meaning", () => {
  it("finds a file by its meaning and shows the matching part, filename, date and story", async () => {
    const mine = await lead(ROOM, "Zoning vote story");
    const text = [para("intro", 990), para("pages", 990), "Appendix: the zoning variance for Lot 4."].join("\n\n");
    const id = await file("variance-packet.pdf", text, { leadId: mine });
    await file("unrelated.pdf", para("library", 800));
    assert.equal(await fillStoryMeaningOnce({ articles: 0, documents: 5 }), 2);

    const found = await searchUploadedFiles(ROOM, q("zoning variance"));
    assert.equal(found.length, 1);
    assert.equal(found[0]!.documentId, id);
    assert.equal(found[0]!.filename, "variance-packet.pdf");
    assert.equal(found[0]!.leadHeadline, "Zoning vote story");
    assert.equal(found[0]!.leadId, mine);
    assert.match(found[0]!.excerptStart, /^Appendix: the zoning variance/);
    assert.ok(found[0]!.excerptStart.length <= 200);
  });

  it("only counts files an editor uploaded: not fetched web documents, link lists or unread files", async () => {
    await file("web.pdf", para("zoning", 800), { sourceUrl: "https://example.com/web.pdf" });
    await file("links", para("zoning", 800), { mime: "application/x-townreporter-source-links" });
    await file("unread.pdf", null, { status: "uploaded" });
    await file("tiny.txt", "zoning");
    const real = await file("real.pdf", para("zoning", 800));
    assert.equal(await fillStoryMeaningOnce({ articles: 0, documents: 5 }), 1);
    assert.deepEqual((await searchUploadedFiles(ROOM, q("zoning"))).map((r) => r.documentId), [real]);
  });

  it("a deleted file drops out of the next search, with no prune", async () => {
    const id = await file("a.pdf", para("zoning", 800));
    await fillStoryMeaningOnce({ articles: 0, documents: 5 });
    assert.equal((await searchUploadedFiles(ROOM, q("zoning"))).length, 1);
    const sql = await getSql();
    await sql`delete from story_documents where id = ${id}`;
    assert.deepEqual(await searchUploadedFiles(ROOM, q("zoning")), []);
  });

  it("never shows another paper's files", async () => {
    await file("theirs.pdf", para("zoning", 800), { room: OTHER_ROOM });
    await fillStoryMeaningOnce({ articles: 0, documents: 5 });
    assert.deepEqual(await searchUploadedFiles(ROOM, q("zoning")), []);
  });

  it("skips a file whose text changed until the fill catches up, then finds it again", async () => {
    const id = await file("a.pdf", para("zoning", 800));
    await fillStoryMeaningOnce({ articles: 0, documents: 5 });
    const sql = await getSql();
    await sql`update story_documents set full_text = ${para("library", 800)} where id = ${id}`;
    clearStoryMeaningCache();
    assert.deepEqual(await searchUploadedFiles(ROOM, q("zoning")), []);
    assert.equal(await fillStoryMeaningOnce({ articles: 0, documents: 5 }), 1);
    assert.deepEqual(await searchUploadedFiles(ROOM, q("zoning")), []);
    assert.equal((await searchUploadedFiles(ROOM, q("library"))).length, 1);
  });
});

describe("C: the Find evidence panel", () => {
  it("returns past stories as a third list and files inside Close in meaning", async () => {
    await story("Council raises water rates", { dek: "Utility bills rise." });
    const id = await file("rate-study.pdf", para("water", 800));
    await fillStoryMeaningOnce({ articles: 5, documents: 5 });

    const result = await searchEvidence({ newsroomId: ROOM }, "water rates");
    assert.ok(result.ok);
    assert.deepEqual(result.pastStories.map((r) => r.headline), ["Council raises water rates"]);
    const fileRows = result.meaning.filter((row) => row.kind === "file");
    assert.deepEqual(fileRows.map((row) => row.title), ["rate-study.pdf"]);
    assert.equal(fileRows[0]!.md5, `file-${id}`);
    assert.equal(result.pastStoriesStatus.ready, true);
    assert.deepEqual(result.pastStoriesStatus.stories, { covered: 1, total: 1 });
    assert.deepEqual(result.pastStoriesStatus.files, { covered: 1, total: 1 });
  });

  it("warns and does not block: if the model cannot load, the exact-words list still works", async () => {
    const sql = await getSql();
    const [v] = await sql<{ id: number }>`
      insert into artifact_versions (user_id, url, content_hash, title, newsroom_id)
      values ('def1-user', 'https://example.com/def1-water', 'def1-hash-1', 'Water page', ${ROOM}) returning id
    `;
    await sql`
      insert into artifact_chunks (version_id, user_id, newsroom_id, chunk_index, excerpt, locator)
      values (${v!.id}, 'def1-user', ${ROOM}, 0, 'The water plant needs new pumps.', '')
    `;
    await story("Council raises water rates", { dek: "water" });
    await fillStoryMeaningOnce({ articles: 5, documents: 0 });
    setEmbedderForTests(async () => {
      throw new Error("model files are missing");
    });
    try {
      const result = await searchEvidence({ newsroomId: ROOM }, "water");
      assert.ok(result.ok);
      assert.equal(result.exact.length, 1, "exact words still found");
      assert.equal(result.meaningStatus.ready, false);
      assert.equal(result.pastStoriesStatus.ready, false);
      assert.match(result.pastStoriesStatus.reason ?? "", /model files are missing/);
      assert.deepEqual(result.pastStories, []);
    } finally {
      await sql`delete from artifact_chunks where user_id = 'def1-user'`;
      await sql`delete from artifact_versions where user_id = 'def1-user'`;
    }
  });

  it("warns and does not block when the new table is not there yet (code deployed before migration)", async () => {
    const sql = await getSql();
    await story("Council raises water rates", { dek: "water" });
    await sql`alter table story_meaning_vectors rename to story_meaning_vectors_away`;
    clearStoryMeaningCache();
    try {
      const result = await searchEvidence({ newsroomId: ROOM }, "water");
      assert.ok(result.ok);
      assert.equal(result.pastStoriesStatus.ready, false);
      assert.deepEqual(result.pastStories, []);
      assert.deepEqual(result.exact, []);
    } finally {
      await sql`alter table story_meaning_vectors_away rename to story_meaning_vectors`;
    }
  });

  it("rejects an empty query exactly as before", async () => {
    const result = await searchEvidence({ newsroomId: ROOM }, "   ");
    assert.equal(result.ok, false);
  });
});

describe("C: the writer gets the 5 closest past stories as background", () => {
  const input = (leadId: number) => ({
    newsroomId: ROOM,
    leadId,
    headline: "Water rates vote",
    why: "Council votes Tuesday on water rates",
  });

  it("returns up to five, each with headline, date and link", async () => {
    const mine = await lead(ROOM, "Water rates vote");
    for (let i = 0; i < 7; i += 1) {
      await story(`Water story ${i}`, { dek: "water", publishedAt: "2026-10-03T18:00:00Z" });
    }
    await story("Bridge story", { dek: "bridge" });
    await fillStoryMeaningOnce({ articles: 25, documents: 0 });

    const stories = await pastStoriesForWriter(input(mine));
    assert.equal(stories.length, 5);
    for (const s of stories) {
      assert.match(s.headline, /^Water story \d$/);
      assert.equal(s.date, "Oct 3, 2026");
      assert.match(s.url, /\/articles\/def1-story-\d+$/);
    }
  });

  it("does not hand the writer the story it is rewriting", async () => {
    const mine = await lead(ROOM, "Water rates vote");
    await story("The water rates story already printed", { dek: "water", leadId: mine });
    await story("Older water story", { dek: "water" });
    await fillStoryMeaningOnce({ articles: 25, documents: 0 });
    const stories = await pastStoriesForWriter(input(mine));
    assert.deepEqual(stories.map((s) => s.headline), ["Older water story"]);
  });

  it("returns nothing, and does not wake the model, when nothing is indexed yet", async () => {
    await story("Water story", { dek: "water" });
    embedCalls = 0;
    assert.deepEqual(await pastStoriesForWriter(input(1)), []);
    assert.equal(embedCalls, 0);
  });

  it("warns and never blocks: a model that fails, hangs or is switched off gives an empty list", async () => {
    await story("Water story", { dek: "water" });
    await fillStoryMeaningOnce({ articles: 25, documents: 0 });

    setEmbedderForTests(async () => {
      throw new Error("no model");
    });
    assert.deepEqual(await pastStoriesForWriter(input(1)), []);

    setEmbedderForTests(() => new Promise(() => undefined));
    const started = Date.now();
    assert.deepEqual(await pastStoriesForWriter(input(1), { timeoutMs: 30 }), []);
    assert.ok(Date.now() - started < 2_000);

    useFakeEmbedder();
    process.env.TOWNREPORTER_MEANING_SEARCH = "off";
    assert.deepEqual(await pastStoriesForWriter(input(1)), []);
  });

  it("formats background that tells the writer to add nothing to the story", () => {
    const text = pastStoriesBlock([
      { headline: "Water rates rise", date: "Oct 3, 2026", url: "https://paper.example/articles/water" },
    ]);
    assert.match(text, /Water rates rise/);
    assert.match(text, /Oct 3, 2026/);
    assert.match(text, /https:\/\/paper\.example\/articles\/water/);
    assert.match(text, /background only/i);
    assert.match(text, /do not mention, quote, cite or link/i);
    assert.equal(pastStoriesBlock([]), "");
    assert.equal(pastStoriesBlock(undefined), "");
  });
});

describe("migration 0158", () => {
  it("can be run twice without error (safe to re-apply on a live database)", async () => {
    const pg = await getPglite();
    const sqlText = readFileSync(
      new URL("../../../migrations/0158_story_meaning_vectors.sql", import.meta.url),
      "utf8",
    );
    await pg.exec(sqlText);
    await pg.exec(sqlText);
    const sql = await getSql();
    const rows = await sql<{ n: number }>`select count(*)::int as n from story_meaning_vectors`;
    assert.equal(typeof rows[0]!.n, "number");
  });
});
