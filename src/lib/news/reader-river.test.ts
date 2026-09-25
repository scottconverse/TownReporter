import { describe, before, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPglite, getSql } from "../db.ts";
import { listReaderArticles } from "./reader-articles.server.ts";

/**
 * Apply the real migrations, from disk.
 *
 * Under `node --test` there is no Vite glob transform, so `getSql()` brings up
 * an empty PGLite and every table comes from an `ensure*` helper. `articles`,
 * `paper_settings` and the rest are declared in `migrations/` and have none.
 * This file tests the ORDERING and the cursor against the real schema, so it
 * reads the real files rather than a copy of their DDL.
 */
async function applyMigrations() {
  const sql = await getSql();
  // `sql.query` prepares a statement; a migration file is many statements.
  // `exec` is what db.ts uses for exactly this, so use the same door.
  const pg = await getPglite();
  const dir = join(process.cwd(), "migrations");
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await pg.exec(readFileSync(join(dir, name), "utf8"));
    } catch {
      // A migration that does not apply on a bare PGLite is not this test's
      // problem. The assertion below fails loudly if the one that matters was
      // among them, so this can never quietly make the test vacuous.
    }
  }
  const cols = await sql<{ column_name: string }>`
    select column_name from information_schema.columns where table_name = 'articles'
  `;
  assert.ok(
    cols.some((c) => c.column_name === "published_at"),
    "migrations did not apply: no articles.published_at",
  );
}

/**
 * `12:00:ss.µµµµµµ` on 2026-01-01 — microsecond precision, which is what
 * Postgres `timestamptz` keeps and what a JavaScript `Date` throws away.
 */
function at(second: number, micro = 0): string {
  return `2026-01-01T12:00:${String(second).padStart(2, "0")}.${String(micro).padStart(6, "0")}Z`;
}

/**
 * The fixture, in the order it is INSERTED — so `id` ascends with the index —
 * and, except for two deliberate ties, in the order the river must return it.
 *
 *   0..10   seconds 59..49, one apart            (11 stories)
 *   11, 12  400 µs apart INSIDE one millisecond  <-- straddles the 12-batch
 *   13..25  seconds 47..35, one apart            (13 stories)
 *   26, 27  the SAME timestamp, exactly          <-- tie breaks on id
 *   28, 29  seconds 29, 28                       (2 stories)
 *
 * Position 11/12 is the point of the whole file: a cursor carried as a JS
 * `Date` rounds 12:00:48.000900 to 12:00:48.000, and the row at .000100 is then
 * NOT less than the cursor and disappears from the paper entirely.
 */
const CORPUS: string[] = [
  ...Array.from({ length: 11 }, (_, i) => at(59 - i)),
  at(48, 900),
  at(48, 100),
  ...Array.from({ length: 13 }, (_, i) => at(47 - i)),
  at(30),
  at(30),
  at(29),
  at(28),
];

/** A story that must never reach a reader. */
const HIDDEN = [
  { slug: "river-hidden-draft", status: "draft" },
  { slug: "river-hidden-held", status: "held" },
  { slug: "river-hidden-killed", status: "killed" },
];

type Seeded = { id: number; slug: string; headline: string; n: number };

async function reseed(): Promise<Seeded[]> {
  const sql = await getSql();
  /*
    Start from a corpus this file controls. The migration files themselves
    seed a welcome article dated `now()`, and every test below asserts an
    exact order and an exact count.
  */
  await sql`delete from articles`;
  await sql`
    insert into paper_settings (newsroom_id, onboarded) values (1, true)
    on conflict (newsroom_id) do update set onboarded = true
  `;
  const out: Seeded[] = [];
  for (const [n, publishedAt] of CORPUS.entries()) {
    const rows = await sql<{ id: number }>`
      insert into articles (user_id, slug, headline, dek, body, topic, source_urls, status, published_at)
      values ('river-test', ${`river-${n}`}, ${`River story ${n}`}, ${`Dek for story ${n}`},
              ${`Body text for story ${n}.`}, 'council', '[]', 'published', ${publishedAt}::timestamptz)
      returning id`;
    out.push({ id: rows[0]!.id, slug: `river-${n}`, headline: `River story ${n}`, n });
  }
  for (const h of HIDDEN) {
    await sql`
      insert into articles (user_id, slug, headline, dek, body, topic, source_urls, status, published_at)
      values ('river-test', ${h.slug}, ${`Hidden ${h.status}`}, ${"Hidden"}, ${"Hidden body."},
              'council', '[]', ${h.status}, ${at(20)}::timestamptz)`;
  }
  return out;
}

/** The order the river owes the reader: newest first, and id descending on a tie. */
function expectedOrder(seeded: Seeded[]): string[] {
  return seeded
    .slice()
    .sort((a, b) => CORPUS[b.n]!.localeCompare(CORPUS[a.n]!) || b.id - a.id)
    .map((s) => s.slug);
}

type Page = Awaited<ReturnType<typeof listReaderArticles>>;

/** Batch through the paper the way the front page does, until it says stop. */
async function walk(opts: { limit?: number; exclude?: number[] } = {}): Promise<Page[]> {
  const batches: Page[] = [];
  let cursor: Page["nextCursor"] = null;
  for (let guard = 0; guard < 12; guard += 1) {
    const page = await listReaderArticles({
      ...(opts.limit === undefined ? {} : { limit: opts.limit }),
      ...(opts.exclude === undefined ? {} : { exclude: opts.exclude }),
      ...(cursor ? { cursor } : {}),
    });
    batches.push(page);
    if (!page.hasMore) return batches;
    assert.ok(page.nextCursor, "hasMore with no cursor would loop forever");
    cursor = page.nextCursor;
  }
  throw new Error("the walk never reached the first story we published");
}

before(async () => {
  await applyMigrations();
});

describe("the latest-stories river", () => {
  let seeded: Seeded[];
  let expected: string[];
  beforeEach(async () => {
    seeded = await reseed();
    expected = expectedOrder(seeded);
  });

  it("returns the newest story first, and the fixture is what it claims to be", async () => {
    // The fixture's own two ties, asserted separately from the code under test.
    assert.equal(CORPUS[26], CORPUS[27], "positions 26 and 27 must share a timestamp");
    assert.ok(CORPUS[11]!.startsWith("2026-01-01T12:00:48"), "position 11 is 12:00:48");
    assert.equal(CORPUS[12]!.slice(0, 22), CORPUS[11]!.slice(0, 22), "11 and 12 share a millisecond");
    assert.ok(seeded[27]!.id > seeded[26]!.id, "the tied pair ascends by id");

    const page = await listReaderArticles({ limit: 12 });
    assert.deepEqual(
      page.stories.map((s) => s.slug),
      expected.slice(0, 12),
    );
    assert.equal(page.total, CORPUS.length);
    assert.equal(page.hasMore, true);
  });

  it("walks the whole paper: no gaps, no repeats, and both ties survive the cursor", async () => {
    const batches = await walk({ limit: 12 });
    const seen = batches.flatMap((b) => b.stories.map((s) => s.slug));

    assert.deepEqual(seen, expected);
    assert.equal(new Set(seen).size, CORPUS.length, "a story was returned twice");
    assert.equal(seen.length, CORPUS.length, "a story was skipped");
    // The two cases a page-offset or a Date cursor gets wrong, named explicitly.
    assert.equal(seen[11], "river-11");
    assert.equal(seen[12], "river-12");
    assert.equal(seen[26], "river-27");
    assert.equal(seen[27], "river-26");
    assert.equal(batches.at(-1)!.hasMore, false);
    assert.equal(batches.at(-1)!.nextCursor, null);
  });

  it("never repeats a story when another is published mid-scroll", async () => {
    const sql = await getSql();
    const first = await listReaderArticles({ limit: 12 });
    await sql`
      insert into articles (user_id, slug, headline, dek, body, topic, source_urls, status, published_at)
      values ('river-test', 'river-filed-mid-scroll', 'Filed mid scroll', 'Dek', 'Body.',
              'council', '[]', 'published', now())`;

    const batches: Page[] = [first];
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await listReaderArticles({ limit: 12, cursor });
      batches.push(page);
      cursor = page.nextCursor;
    }
    const seen = batches.flatMap((b) => b.stories.map((s) => s.slug));
    assert.deepEqual(seen, expected, "the mid-scroll story shifted the cursor");
    assert.equal(seen.some((s) => s === "river-filed-mid-scroll"), false);
  });

  it("bounds one batch server-side, however large a caller asks for", async () => {
    const page = await listReaderArticles({ limit: 100 });
    assert.equal(page.stories.length, 24);
    assert.equal(page.hasMore, true);
  });

  it("never returns, or counts, a story that is not published", async () => {
    const batches = await walk({ limit: 12 });
    const seen = batches.flatMap((b) => b.stories.map((s) => s.slug));
    for (const h of HIDDEN) assert.equal(seen.includes(h.slug), false, `${h.slug} reached a reader`);
    assert.equal(seen.length, CORPUS.length);
    assert.equal(batches[0]!.total, CORPUS.length, "unpublished rows were counted");
  });

  it("leaves out the stories already shown further up the page", async () => {
    const shown = [seeded[0]!.id, seeded[1]!.id];
    const batches = await walk({ limit: 12, exclude: shown });
    const seen = batches.flatMap((b) => b.stories.map((s) => s.slug));
    assert.deepEqual(seen, expected.slice(2));
    assert.equal(batches[0]!.total, CORPUS.length - 2);
  });
});
