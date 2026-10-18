import { describe, before, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPglite, getSql } from "../db.ts";
import { getPaperConfig } from "./paper-settings.ts";
import { listNewestStories } from "./story-dates.server.ts";
import { frontWeekTitle, storyDateRows } from "../story-dates.ts";

/**
 * "This week" on the front page: the paper's newest printed stories.
 *
 * The box is the loader's `listNewestStories` plus the row mapping the panel
 * renders. The front page route body itself has no render test in this repo
 * (its loader needs the live server), so these cases read the real `articles`
 * table, under PGLite, and check the rows the panel is given.
 */

/** Apply the real migrations, from disk; see `reader-river.test.ts` for why. */
async function applyMigrations() {
  const sql = await getSql();
  const pg = await getPglite();
  const dir = join(process.cwd(), "migrations");
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await pg.exec(readFileSync(join(dir, name), "utf8"));
    } catch {
      // A migration that does not apply on a bare PGLite is not this test's problem.
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

const DAY = 24 * 60 * 60 * 1000;

/** A story published `daysAgo` days before this run, as the database stores it. */
function ago(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * DAY).toISOString();
}

/** The paper's own calendar day for an instant, as `YYYY-MM-DD`. */
function paperDay(timezone: string, iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Replace the paper's stories with exactly these, published at these times. */
async function seed(stories: { slug: string; publishedAt: string }[]) {
  const sql = await getSql();
  await sql`delete from articles`;
  await sql`
    insert into paper_settings (newsroom_id, onboarded) values (1, true)
    on conflict (newsroom_id) do update set onboarded = true
  `;
  for (const story of stories) {
    await sql`
      insert into articles (user_id, slug, headline, dek, body, topic, source_urls, status, published_at)
      values ('this-week-test', ${story.slug}, ${`Headline for ${story.slug}`}, ${`Dek for ${story.slug}`},
              ${`Body text for ${story.slug}.`}, 'council', '[]', 'published', ${story.publishedAt}::timestamptz)
    `;
  }
}

describe("this week on the front page: the newest stories", () => {
  before(async () => {
    await applyMigrations();
  });

  beforeEach(async () => {
    const sql = await getSql();
    await sql`delete from articles`;
  });

  it("lists the two newest stories after the lead, newest first, and not the older one", async () => {
    const second = ago(2);
    const third = ago(3);
    await seed([
      { slug: "week-lead", publishedAt: ago(0.04) },
      { slug: "week-second", publishedAt: second },
      { slug: "week-third", publishedAt: third },
      { slug: "week-older", publishedAt: ago(20) },
    ]);
    const { timezone } = await getPaperConfig(1);

    // The lead is the front page's top story; the box skips it.
    const { stories: items, withinWeek } = await listNewestStories("week-lead");
    const rows = storyDateRows(items);

    assert.deepEqual(
      items.map((item) => item.slug),
      ["week-second", "week-third"],
    );
    assert.deepEqual(
      items.map((item) => item.what),
      ["Headline for week-second", "Headline for week-third"],
    );
    assert.deepEqual(
      items.map((item) => item.date),
      [paperDay(timezone, second), paperDay(timezone, third)],
    );
    // Each row's day label is the day the story was published, and the row links to the story.
    assert.deepEqual(
      rows.map((row) => row.day),
      items.map((item) => String(Number(item.date.slice(-2)))),
    );
    assert.deepEqual(
      rows.map((row) => row.slug),
      ["week-second", "week-third"],
    );
    // The second story is from two days ago, inside the week, so the title stays.
    assert.equal(withinWeek, true);
    assert.equal(frontWeekTitle(withinWeek), "This week");
  });

  it("still lists the newest stories when none was published in the last seven days", async () => {
    await seed([
      { slug: "old-lead", publishedAt: ago(20) },
      { slug: "old-1", publishedAt: ago(30) },
      { slug: "old-2", publishedAt: ago(40) },
      { slug: "old-3", publishedAt: ago(50) },
      { slug: "old-4", publishedAt: ago(60) },
      { slug: "old-5", publishedAt: ago(70) },
      { slug: "old-6", publishedAt: ago(80) },
    ]);

    const { stories: items, withinWeek } = await listNewestStories("old-lead");

    // Five rows at most, the newest of what is left after the lead.
    assert.deepEqual(
      items.map((item) => item.slug),
      ["old-1", "old-2", "old-3", "old-4", "old-5"],
    );
    // Nothing was printed in the last seven days, so the fallback fired and the panel says so.
    assert.equal(withinWeek, false);
    assert.equal(frontWeekTitle(withinWeek), "Latest stories");
  });
});
