import { describe, before, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPglite, getSql } from "../db.ts";
import { listReaderArticles } from "./reader-articles.server.ts";
import { AREA_LABELS, STORY_AREAS, cleanStoryArea, readStoryArea } from "../story-area.ts";

/**
 * Apply the real migrations, from disk, before the first read.
 *
 * Under `node --test` there is no Vite glob transform, so `getSql()` brings up
 * an empty PGLite and `articles` comes from the migration files or from
 * nothing. This file tests a COLUMN (0098) rather than a copy of its DDL, so it
 * reads the real file -- the same door `db.ts` uses (`exec`, not `query`).
 */
async function applyMigrations() {
  await getSql();
  const pg = await getPglite();
  const dir = join(process.cwd(), "migrations");
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    try {
      await pg.exec(readFileSync(join(dir, name), "utf8"));
    } catch {
      /* a migration that does not apply on a bare PGLite is not this file's subject */
    }
  }
}

/** The three rows the pills are read against, plus one that must stay hidden. */
const ROWS = [
  { slug: "area-nearby", area: "nearby", status: "published" },
  { slug: "area-county", area: "county", status: "published" },
  { slug: "area-none", area: null, status: "published" },
  { slug: "area-hidden", area: "nearby", status: "draft" },
];

async function reseed(): Promise<void> {
  const sql = await getSql();
  await sql`delete from articles`;
  await sql`
    insert into paper_settings (newsroom_id, onboarded) values (1, true)
    on conflict (newsroom_id) do update set onboarded = true
  `;
  for (const [n, row] of ROWS.entries()) {
    await sql`
      insert into articles (user_id, slug, headline, dek, body, topic, source_urls, status, published_at, area)
      values ('area-test', ${row.slug}, ${`Area story ${n}`}, ${"A dek."}, ${"A body."},
              'council', '[]', ${row.status}, ${`2026-01-0${n + 1}T12:00:00Z`}::timestamptz, ${row.area})`;
  }
}

describe("the area tag on a printed story", () => {
  before(async () => {
    await applyMigrations();
  });
  beforeEach(async () => {
    await reseed();
  });

  it("migration 0098 adds articles.area", async () => {
    const sql = await getSql();
    const cols = await sql<{ column_name: string }>`
      select column_name from information_schema.columns
      where table_name = 'articles' and column_name = 'area'`;
    assert.equal(cols.length, 1, "articles.area did not come from the migration files");
  });

  it("a story with no area counts as the home town", async () => {
    const page = await listReaderArticles({ area: "longmont" });
    assert.deepEqual(page.stories.map((s) => s.slug), ["area-none"]);
  });

  it("a pill shows only its own ground, and never an unpublished story", async () => {
    const page = await listReaderArticles({ area: "nearby" });
    assert.deepEqual(page.stories.map((s) => s.slug), ["area-nearby"]);
  });

  it("county is its own ground, not a synonym for nearby", async () => {
    const page = await listReaderArticles({ area: "county" });
    assert.deepEqual(page.stories.map((s) => s.slug), ["area-county"]);
  });

  it("Colorado has nothing printed yet, and says so with an empty list", async () => {
    const page = await listReaderArticles({ area: "colorado" });
    assert.deepEqual(page.stories.map((s) => s.slug), []);
  });

  it("no pill changes what the unfiltered paper shows", async () => {
    const page = await listReaderArticles({});
    assert.equal(page.stories.length, 3);
  });

  it("reads an unknown or absent value as the home town, and refuses to store one", () => {
    assert.equal(readStoryArea(null), "longmont");
    assert.equal(readStoryArea(""), "longmont");
    assert.equal(readStoryArea("Boulder County"), "longmont");
    assert.equal(readStoryArea("county"), "county");
    assert.equal(cleanStoryArea(" Nearby "), "nearby");
    assert.equal(cleanStoryArea("boulder"), null);
    assert.equal(cleanStoryArea(7), null);
  });

  it("names every area it stores, in the order the paper prints them", () => {
    assert.deepEqual([...STORY_AREAS], ["longmont", "nearby", "county", "colorado"]);
    for (const key of STORY_AREAS) assert.ok(AREA_LABELS[key], `${key} has no label`);
  });
});
