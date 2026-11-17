import { describe, before, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPglite, getSql } from "../db.ts";
import { listReaderArticles } from "./reader-articles.server.ts";

/*
  Nov 17 2026: the front page's "Around the region" band reads
  `notArea: "longmont"`. A null or unknown area counts as the home town, so
  those stories must stay OUT of the band, and county/nearby/colorado stories
  must be IN it.
*/
async function applyMigrations() {
  const pg = await getPglite();
  const dir = join(process.cwd(), "migrations");
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    try {
      await pg.exec(readFileSync(join(dir, name), "utf8"));
    } catch {
      // Same rule as reader-river.test.ts: the asserts below fail loudly if
      // the tables this test needs did not apply.
    }
  }
}

describe("reader articles: notArea (region band)", () => {
  before(async () => {
    await applyMigrations();
    const sql = await getSql();
    await sql`delete from routine_notice_publications where newsroom_id = 1`;
    await sql`delete from articles`;
    await sql`
      insert into paper_settings (newsroom_id, onboarded) values (1, true)
      on conflict (newsroom_id) do update set onboarded = true
    `;
    const rows: [string, string | null][] = [
      ["home-null", null],
      ["home-longmont", "longmont"],
      ["home-unknown", "mars"],
      ["region-county", "county"],
      ["region-nearby", "nearby"],
      ["region-colorado", "colorado"],
    ];
    for (const [i, [slug, area]] of rows.entries()) {
      await sql`
        insert into articles (user_id, slug, headline, dek, body, topic, source_urls, status, published_at, area)
        values ('region-test', ${slug}, ${slug}, 'Dek', 'Body text.', 'council', '[]', 'published',
                ${`2026-01-01T12:00:${String(10 + i).padStart(2, "0")}Z`}::timestamptz, ${area})`;
    }
  });

  it("returns only stories outside the home area, newest first", async () => {
    const out = await listReaderArticles({
      notArea: "longmont",
      notTopic: "opinion",
      notRoutine: true,
      limit: 6,
      page: 1,
      oldest: false,
    });
    assert.deepEqual(
      out.stories.map((s) => s.slug),
      ["region-colorado", "region-nearby", "region-county"],
    );
  });

  it("leaves the home-area read unchanged", async () => {
    const out = await listReaderArticles({ area: "longmont", page: 1, oldest: false });
    assert.deepEqual(out.stories.map((s) => s.slug).sort(), [
      "home-longmont",
      "home-null",
      "home-unknown",
    ]);
  });
});
