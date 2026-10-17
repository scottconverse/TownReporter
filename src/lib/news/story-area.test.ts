import { describe, before, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPglite, getSql } from "../db.ts";
import { listReaderArticles } from "./reader-articles.server.ts";
import {
  AREA_LABELS,
  STORY_AREAS,
  areaLabelsFor,
  cleanStoryArea,
  defaultStoryArea,
  readStoryArea,
} from "../story-area.ts";

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

/*
  Unit BX, item 6: the county pill said "County" on the live paper, whose owner
  configured "Boulder County" in Paper setup.

  `areaLabelsFor` always took the county as an argument -- the defect was that
  the reader's hook never passed the configured one, so the argument was always
  absent. The first half below is the words; the second is the wiring, read off
  the hook's own body, because the failure mode is a missing ARGUMENT and no
  assertion on `areaLabelsFor` alone can see it.
*/
describe("the county ground in the paper's own words", () => {
  const paper = { city: "Longmont", state: "Colorado" };

  it("prints the configured county, and the ground's own word when none is set", () => {
    assert.equal(areaLabelsFor(paper, "Boulder County").county, "Boulder County");
    assert.equal(areaLabelsFor(paper, "  Boulder County  ").county, "Boulder County");
    assert.equal(areaLabelsFor(paper, "").county, "Boulder County");
    assert.equal(areaLabelsFor(paper).county, "Boulder County");
  });

  it("names the shipped Longmont paper's county when none is configured (TPT-1)", () => {
    // The desk's Geography select read "County" beside "Longmont" and could not
    // say which county it meant. Longmont is in Boulder County; say so.
    assert.equal(areaLabelsFor(paper, null).county, "Boulder County");
    assert.equal(areaLabelsFor({ city: "Longmont", state: "CO" }).county, "Boulder County");
  });

  it("keeps the generic 'County' for any other paper with no county configured", () => {
    // The Riverbend leak rule: a paper that has not said its county never
    // prints another town's county.
    assert.equal(areaLabelsFor({ city: "Riverbend", state: "Ohio" }).county, "County");
    assert.equal(areaLabelsFor({ city: "Riverbend", state: "Ohio" }, null).county, "County");
  });

  it("leaves the other three grounds to the paper's identity", () => {
    const labels = areaLabelsFor(paper, "Boulder County");
    assert.equal(labels.longmont, "Longmont");
    assert.equal(labels.nearby, "Nearby");
    assert.equal(labels.colorado, "Colorado");
  });

  it("hands the configured county to areaLabelsFor from the identity", () => {
    const hook = readFileSync(new URL("../paper-context-state.ts", import.meta.url), "utf8");
    assert.match(hook, /const \{ city, state, county \} = usePaper\(\)/);
    assert.match(hook, /areaLabelsFor\(\{ city, state \}, county\)/);
  });
});

/*
  TOB-2 (Oct 16, walk boot-start-1 lead 452): the headline said Boulder and the
  body named Louisville and Boulder, never Longmont, yet the story was published
  with area `longmont` because the page always started on the home town. The
  default now follows the place the story's own words name. On the old code
  `defaultStoryArea` does not exist, so this file fails to load.
*/
describe("TOB-2: the default area follows the place the story names", () => {
  const PLACE = { city: "Longmont", state: "Colorado" };

  it("a story naming Louisville and Boulder, and not Longmont, stands on Nearby", () => {
    const story = {
      headline: "Pickleball fundraiser set for Boulder on Oct. 24",
      body: "The fundraiser, run by Mindful Works, will serve players in Louisville and Boulder.",
    };
    assert.equal(defaultStoryArea(story, PLACE), "nearby");
  });

  it("a story naming the home town stands on the home town", () => {
    const story = { headline: "Longmont council approves budget", body: "The vote was 5-2." };
    assert.equal(defaultStoryArea(story, PLACE), "longmont");
  });

  it("a story naming Boulder County stands on the county", () => {
    const story = { headline: "Boulder County commissioners adopt rules", body: "Rules apply countywide." };
    assert.equal(defaultStoryArea(story, PLACE), "county");
  });

  it("the headline decides before the body", () => {
    const story = { headline: "Lyons trustees post water rate study", body: "Longmont officials were asked." };
    assert.equal(defaultStoryArea(story, PLACE), "nearby");
  });

  it("a story naming no place returns null, so the page keeps the home town and says so", () => {
    const story = { headline: "City council approves budget", body: "The superior court ruled on it." };
    assert.equal(defaultStoryArea(story, PLACE), null);
  });
});

/*
  TOB-2 follow-up: the Nearby towns and "Boulder County" are the SHIPPED
  paper's geography. On 909a041a `defaultStoryArea` read them for every paper,
  so a Riverbend, Ohio story naming Erie filed under Nearby. The Riverbend "Erie"
  case below fails on 909a041a (it returns "nearby").
*/
describe("TOB-2 follow-up: a paper configured for another town keeps its own geography", () => {
  const RIVERBEND = { city: "Riverbend", state: "Ohio" };

  it("a Riverbend story naming Erie and Boulder County stands on no ground", () => {
    const story = {
      headline: "Erie council hears Boulder County bus plan",
      body: "The plan covers Superior and Lafayette.",
    };
    assert.equal(defaultStoryArea(story, RIVERBEND), null);
  });

  it("a Riverbend story naming only Erie stands on no ground, not Nearby", () => {
    const story = { headline: "Erie council hears bus plan", body: "The plan covers the whole route." };
    assert.equal(defaultStoryArea(story, RIVERBEND), null);
  });

  it("a Riverbend story naming Boulder County stands on no ground, even with a county set", () => {
    const story = { headline: "Boulder County commissioners adopt rules", body: "Rules apply countywide." };
    assert.equal(defaultStoryArea(story, { ...RIVERBEND, county: "Franklin" }), null);
  });

  it("a Riverbend story naming its configured county stands on the county", () => {
    const story = { headline: "Franklin County commissioners adopt rules", body: "Rules apply countywide." };
    assert.equal(defaultStoryArea(story, { ...RIVERBEND, county: "Franklin" }), "county");
  });

  it("a Riverbend story naming its own town stands on the home town", () => {
    const story = { headline: "Riverbend council approves budget", body: "The vote was 5-2." };
    assert.equal(defaultStoryArea(story, RIVERBEND), "longmont");
  });
});
