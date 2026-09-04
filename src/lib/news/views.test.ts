import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPglite, getSql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID, ensureNewsroomSchema } from "./membership.ts";
import {
  ensureViewsSchema,
  getViewStats,
  recordView,
  storyTarget,
  viewBeaconHandler,
  SITE_TARGET,
} from "./views.ts";

/**
 * `articles` is migrations-only (see schema-parity.test.ts's docstring), so
 * a plain `node --test` run -- which has no Vite migration glob -- needs the
 * real migration files applied by hand. Same approach as delete.test.ts.
 */
async function applyMigrations() {
  const pg = await getPglite();
  const dir = join(process.cwd(), "migrations");
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await pg.exec(readFileSync(join(dir, name), "utf8"));
    } catch {
      // Not every migration applies cleanly on a bare PGLite (some assume
      // Postgres-only features). What matters here -- `articles` and
      // `page_views` existing with the right columns -- is asserted below.
    }
  }
  await ensureViewsSchema();
  const sql = await getSql();
  const cols = await sql<{ table_name: string }>`
    select table_name from information_schema.columns where table_name = 'articles'
  `;
  assert.ok(cols.length > 0, "migrations did not create articles");
}

before(applyMigrations);

async function seedArticle(newsroomId: number, slug: string, headline = "A published story") {
  const sql = await getSql();
  await sql`
    insert into articles (user_id, newsroom_id, slug, headline, dek, body, topic, status)
    values (${"seed-user"}, ${newsroomId}, ${slug}, ${headline}, ${""}, ${"Body"}, ${"council"}, 'published')
  `;
}

describe("recordView", () => {
  it("increments the site bucket for today, once per call", async () => {
    const newsroomId = 9001;
    await recordView(SITE_TARGET, newsroomId);
    await recordView(SITE_TARGET, newsroomId);
    await recordView(SITE_TARGET, newsroomId);

    const sql = await getSql();
    const rows = await sql<{ count: string }>`
      select count from page_views
      where newsroom_id = ${newsroomId} and target = ${SITE_TARGET} and day = current_date
    `;
    assert.equal(rows.length, 1, "one bucket per (newsroom, target, day)");
    assert.equal(Number(rows[0]!.count), 3);
  });

  it("increments a real published story's own bucket", async () => {
    const newsroomId = 9002;
    const slug = "views-test-story-1";
    await seedArticle(newsroomId, slug);

    await recordView(storyTarget(slug), newsroomId);
    await recordView(storyTarget(slug), newsroomId);

    const sql = await getSql();
    const rows = await sql<{ count: string }>`
      select count from page_views
      where newsroom_id = ${newsroomId} and target = ${storyTarget(slug)}
    `;
    assert.equal(Number(rows[0]?.count ?? 0), 2);
  });

  it("ignores a target that is not 'site' and not a real published story, without throwing", async () => {
    const newsroomId = 9003;
    await assert.doesNotReject(() => recordView("story:does-not-exist", newsroomId));
    await assert.doesNotReject(() => recordView("nonsense", newsroomId));
    await assert.doesNotReject(() => recordView("", newsroomId));
    await assert.doesNotReject(() => recordView(null, newsroomId));
    await assert.doesNotReject(() => recordView(undefined, newsroomId));
    await assert.doesNotReject(() => recordView({ toString: () => "site" }, newsroomId));

    const sql = await getSql();
    const rows = await sql<{ target: string }>`
      select target from page_views where newsroom_id = ${newsroomId}
    `;
    assert.deepEqual(rows, [], "no bucket was created for any unrecognised target");
  });

  it("ignores a slug that belongs to an unpublished draft, not a published story", async () => {
    const newsroomId = 9004;
    const slug = "views-test-unpublished";
    const sql = await getSql();
    await sql`
      insert into articles (user_id, newsroom_id, slug, headline, dek, body, topic, status)
      values (${"seed-user"}, ${newsroomId}, ${slug}, ${"Held"}, ${""}, ${"Body"}, ${"council"}, 'held')
    `;
    await recordView(storyTarget(slug), newsroomId);
    const rows = await sql<{ target: string }>`
      select target from page_views where newsroom_id = ${newsroomId} and target = ${storyTarget(slug)}
    `;
    assert.deepEqual(rows, []);
  });

  it("is newsroom-scoped: a view recorded in one newsroom is invisible from another", async () => {
    const n1 = 9101;
    const n2 = 9102;
    await recordView(SITE_TARGET, n1);
    await recordView(SITE_TARGET, n1);
    await recordView(SITE_TARGET, n2);

    const sql = await getSql();
    const rows1 = await sql<{ count: string }>`
      select count from page_views where newsroom_id = ${n1} and target = ${SITE_TARGET}
    `;
    const rows2 = await sql<{ count: string }>`
      select count from page_views where newsroom_id = ${n2} and target = ${SITE_TARGET}
    `;
    assert.equal(Number(rows1[0]?.count ?? 0), 2);
    assert.equal(Number(rows2[0]?.count ?? 0), 1);
  });
});

describe("viewBeaconHandler", () => {
  it("always answers 204, even for a good target", async () => {
    const req = new Request("http://test.local/api/view", {
      method: "POST",
      body: JSON.stringify({ target: SITE_TARGET }),
    });
    const res = await viewBeaconHandler(req);
    assert.equal(res.status, 204);
  });

  it("swallows a malformed body and still answers 204", async () => {
    const req = new Request("http://test.local/api/view", {
      method: "POST",
      body: "not json at all {{{",
    });
    const res = await viewBeaconHandler(req);
    assert.equal(res.status, 204);
  });

  it("swallows an unknown target and still answers 204, recording nothing", async () => {
    const req = new Request("http://test.local/api/view", {
      method: "POST",
      body: JSON.stringify({ target: "story:totally-made-up-slug-xyz" }),
    });
    const res = await viewBeaconHandler(req);
    assert.equal(res.status, 204);
    const sql = await getSql();
    const rows = await sql<{ target: string }>`
      select target from page_views where target = ${"story:totally-made-up-slug-xyz"}
    `;
    assert.deepEqual(rows, []);
  });
});

describe("getViewStats", () => {
  const newsroomId = 9201;
  const userId = `views-owner-${Date.now()}`;

  before(async () => {
    await ensureNewsroomSchema();
    const sql = await getSql();
    // Seat this user as editor of a fresh newsroom id, same pattern as
    // paper-settings.test.ts: each case gets its own newsroom row so it
    // never contends with another test file's owner-seating race.
    await sql`
      insert into newsroom_members (user_id, role, newsroom_id) values (${userId}, 'owner', ${newsroomId})
    `;
  });

  it("computes site total, per-story ranking, and 7/30-day windows correctly, including a zero-view published story", async () => {
    const slugA = "views-stats-story-a";
    const slugB = "views-stats-story-b";
    const slugC = "views-stats-story-c-no-views";
    await seedArticle(newsroomId, slugA, "Story A");
    await seedArticle(newsroomId, slugB, "Story B");
    await seedArticle(newsroomId, slugC, "Story C, never viewed");

    const sql = await getSql();
    // Backdate some buckets directly, so the 7/30-day windows have
    // something real to filter out.
    await sql`
      insert into page_views (newsroom_id, target, day, count) values
        (${newsroomId}, ${SITE_TARGET}, current_date, 5),
        (${newsroomId}, ${SITE_TARGET}, current_date - interval '3 days', 4),
        (${newsroomId}, ${SITE_TARGET}, current_date - interval '10 days', 3),
        (${newsroomId}, ${SITE_TARGET}, current_date - interval '40 days', 2)
    `;
    await sql`
      insert into page_views (newsroom_id, target, day, count) values
        (${newsroomId}, ${storyTarget(slugA)}, current_date, 7),
        (${newsroomId}, ${storyTarget(slugB)}, current_date, 2)
    `;

    const stats = await getViewStats(userId);
    assert.equal(stats.siteTotal, 5 + 4 + 3 + 2);
    assert.equal(stats.site7d, 5 + 4);
    assert.equal(stats.site30d, 5 + 4 + 3);
    assert.deepEqual(
      stats.stories.map((s) => [s.slug, s.views]),
      [
        [slugA, 7],
        [slugB, 2],
        [slugC, 0],
      ],
      "ranked descending by views, with the never-viewed story last at 0 (not hidden)",
    );
  });

  it("rejects a stranger with no newsroom membership", async () => {
    // requireEditor auto-seats a brand-new stranger as owner of
    // DEFAULT_NEWSROOM_ID if that newsroom has no members at all yet -- see
    // the same guard in paper-settings.test.ts. Claim it first, on this
    // PGLite instance, so the stranger below is genuinely refused rather
    // than auto-seated.
    await ensureNewsroomSchema();
    const sql = await getSql();
    const claimed = await sql<{ c: number }>`
      select count(*)::int as c from newsroom_members where newsroom_id = ${DEFAULT_NEWSROOM_ID}
    `;
    let guardOwnerId: string | null = null;
    if ((claimed[0]?.c ?? 0) === 0) {
      guardOwnerId = `views-owner-guard-${Date.now()}`;
      await sql`
        insert into newsroom_members (user_id, role, newsroom_id)
        values (${guardOwnerId}, 'owner', ${DEFAULT_NEWSROOM_ID})
      `;
    }
    try {
      await assert.rejects(() => getViewStats(`stranger-${Date.now()}`));
    } finally {
      if (guardOwnerId) await sql`delete from newsroom_members where user_id = ${guardOwnerId}`;
    }
  });
});
