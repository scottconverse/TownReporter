import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { chromium, type Browser } from "playwright";
import {
  ensureBuilt,
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  run,
  spawnBuiltServer,
  waitForServer,
  withDatabase,
  type ChildProcess,
} from "../test-support/pg-admin.ts";

/**
 * Editor-only fields must never reach a reader, on ANY public page.
 *
 * `public.ts` is careful today: every public query names its columns, and
 * none of those columns is `user_id` or `source_kind`. But that carefulness
 * lives in exactly one place per query -- a select list -- and nothing stops
 * a future change from widening one (naming `user_id` alongside the columns
 * already there) or from returning a row wholesale (`select c.*` or
 * `{ ...row }`) so the field arrives without anyone naming it at all. Both
 * shapes were reproduced against this file while it was written (see the
 * commit note for the two exact edits and the resulting red run) and both are
 * guarded here so a repeat fails a real test instead of shipping.
 *
 * Fields, and why:
 *
 *   - `user_id`: who typed the story. Every `articles` and `corrections` row
 *     already carries a real one (both columns are NOT NULL) -- this is not
 *     hypothetical plumbing, it is live schema a careless `select *` would
 *     actually widen into.
 *   - `source_kind` / the literal `written-by-the-editor`: how a piece was
 *     produced -- pasted by a person versus generated -- recorded on
 *     `editorial_extras` and `editorial_requests`, tables keyed by `draft_id`
 *     and never joined from `public.ts` today. No existing public query can
 *     be widened to leak them; the only route in would be a NEW join, which
 *     is exactly the kind of "someone adds a feature later" change this
 *     guard exists for. Seeded here for real, from the same tables and the
 *     same `source_kind` value `fileWrittenEditorial` (opinion.ts) writes, so
 *     the assertion is checking an actual row, not a string this file made up.
 *
 * Every reader-facing surface is checked against a REAL running build (the
 * `createServerFn`-wrapped functions in public.ts throw "No Start context
 * found" outside the framework's own request runtime -- see
 * search-index.test.ts) and a REAL browser for the two pages that fetch their
 * data client-side after hydration rather than through a loader. A grep of
 * public.ts's text is exactly the check this repository has been burned by
 * (an import line, or a comment mentioning the bug, satisfies a grep); this
 * checks bytes that actually left the server on the wire.
 */

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PSQL_ADMIN_URL = integrationRequested() ? resolveAdminUrl() : "";
const PORT = 3910;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const dbName = `townreporter_test_leakguard_${process.pid}_${Date.now()}`;

/*
  Opt-in, because this file builds the app and boots a server.

  Five files do that. Node's test runner starts files concurrently, so on any
  machine with Postgres on the default port they all did it at once during an
  ordinary `npm test` -- and seven unrelated database tests then timed out,
  starved rather than broken. TEST_POSTGRES_ADMIN_URL is the switch; the
  postgres-integration CI job sets it and names this file, and a gate fails if
  it ever stops doing so.
*/
const dbProbe = integrationRequested()
  ? await probePostgres(PSQL_ADMIN_URL)
  : ({
      ok: false as const,
      reason:
        "set TEST_POSTGRES_ADMIN_URL to run the integration tests (they build the app and boot a server; the postgres-integration CI job runs them on every push)",
    });

let admin: Client | undefined;
let probeClient: Client | undefined;
let server: ChildProcess | undefined;
let browser: Browser | undefined;

after(async () => {
  server?.kill();
  await browser?.close();
  await probeClient?.end();
  if (dbProbe.ok) {
    admin = admin ?? new Client({ connectionString: PSQL_ADMIN_URL });
    await admin.connect().catch(() => undefined);
    await admin
      .query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      )
      .catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
});

// A distinct marker per run: it can only appear in a response if it actually
// leaked out of the database, never by coincidence with fixture prose.
const RUN = `${process.pid}_${Date.now()}`;
const USER_ID = `editor-secret-${RUN}`;
const SEARCH_MARKER = `Zqxwleakguard${RUN}`;
const HEADLINE = `Leak guard fixture story ${RUN}`;
const SLUG = `leak-guard-fixture-${RUN}`;
const TOPIC = "council";
const CORRECTION_BODY = `We corrected a date in this story. Marker ${RUN}.`;

/**
 * Strings that must never appear on the wire, anywhere in a public response:
 * the literal editor identity, the two forbidden field names as they would
 * render inside a serialized object (quoted, the shape `JSON.stringify`
 * produces), and the literal value opinion.ts writes for a person-authored
 * piece. Bare (unquoted) forms are also checked for `user_id` and
 * `source_kind` since a hand-rolled template (as `feed.ts` and
 * `sitemap.xml.ts` are) would not necessarily go through `JSON.stringify`.
 */
function assertNoLeak(label: string, body: string) {
  assert.doesNotMatch(body, new RegExp(USER_ID), `${label}: the editor's user_id leaked`);
  assert.doesNotMatch(body, /user_id/, `${label}: the field name "user_id" reached the response`);
  assert.doesNotMatch(
    body,
    /source_kind/,
    `${label}: the field name "source_kind" reached the response`,
  );
  assert.doesNotMatch(
    body,
    /written-by-the-editor/,
    `${label}: the literal "written-by-the-editor" reached the response`,
  );
}

if (dbProbe.ok) {
  admin = new Client({ connectionString: PSQL_ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const dbUrl = withDatabase(PSQL_ADMIN_URL, dbName);
  process.env.DATABASE_URL = dbUrl;

  probeClient = new Client({ connectionString: dbUrl });
  await probeClient.connect();

  await run(process.execPath, [repoRoot + "scripts/migrate.mjs"], repoRoot, {
    ...process.env,
    DATABASE_URL: dbUrl,
  });

  /*
    CITY-SETUP release-walkthrough Blocker fix: nothing published is public
    until the owner has completed first-run setup (see
    src/lib/news/public-settings.ts's getPublicPaperConfig and every reader
    in public.ts / feed.ts). This fixture seeds an operating newsroom
    directly via SQL, the same way an already-running desk looks -- so it
    marks itself onboarded the same way migrations/0023 would for a real
    claimed install, or every assertion below (which predate that gate and
    have nothing to do with it) would see an empty, gated site instead of
    the fixture content they are actually testing.
  */
  await probeClient.query(
    `insert into paper_settings (newsroom_id, onboarded) values (1, true)
     on conflict (newsroom_id) do update set onboarded = true`,
  );

  // A published story and a correction on it, each carrying the real,
  // NOT NULL user_id column production writes on every insert.
  await probeClient.query(
    `insert into articles
       (user_id, slug, headline, dek, body, topic, source_urls, status, published_at)
     values ($1, $2, $3, 'A fixture for the leak guard.', $4, $5, '[]', 'published', now())`,
    [
      USER_ID,
      SLUG,
      HEADLINE,
      `The council fixture mentions ${SEARCH_MARKER} once, for the search test.`,
      TOPIC,
    ],
  );
  const articleRow = await probeClient.query<{ id: number }>(
    `select id from articles where slug = $1`,
    [SLUG],
  );
  await probeClient.query(
    `insert into corrections (user_id, article_id, body) values ($1, $2, $3)`,
    [USER_ID, articleRow.rows[0]!.id, CORRECTION_BODY],
  );

  // The real desk-only tables that hold `source_kind` and the literal
  // `written-by-the-editor`, shaped exactly as `editorial.server.ts` and
  // `opinion.ts` create and write them -- not a fixture invention. They are
  // not created by migrations (both are `create table if not exists` calls
  // made at runtime), so this test creates them itself.
  await probeClient.query(`
    create table if not exists editorial_extras (
      draft_id integer primary key,
      newsroom_id integer not null default 1,
      fact_sheet text not null default '',
      image_prompt text not null default '',
      source_kind text not null default '',
      source_ref text not null default '',
      generated_at timestamptz not null default now()
    )
  `);
  await probeClient.query(`
    create table if not exists editorial_requests (
      id serial primary key,
      user_id text not null,
      newsroom_id integer not null default 1,
      subject text not null,
      source_kind text not null default 'paste',
      source_ref text not null default '',
      asked_for text not null default '',
      pointers_json text not null default '[]',
      our_story_json text,
      draft_id integer,
      error text,
      created_at timestamptz not null default now(),
      finished_at timestamptz
    )
  `);
  const draftRow = await probeClient.query<{ id: number }>(
    `insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls, form)
     values ($1, 1, null, $2, '', 'An editorial the operator wrote by hand.', 'opinion', '[]', 'editorial')
     returning id`,
    [USER_ID, HEADLINE],
  );
  const draftId = draftRow.rows[0]!.id;
  await probeClient.query(
    `insert into editorial_extras (draft_id, newsroom_id, source_kind, source_ref)
     values ($1, 1, 'written-by-the-editor', 'pasted into the Opinion desk')`,
    [draftId],
  );
  await probeClient.query(
    `insert into editorial_requests
       (user_id, newsroom_id, subject, source_kind, source_ref, draft_id, finished_at)
     values ($1, 1, $2, 'written-by-the-editor', 'pasted into the Opinion desk', $3, now())`,
    [USER_ID, HEADLINE, draftId],
  );

  await ensureBuilt(repoRoot);
  server = spawnBuiltServer(repoRoot, dbUrl, PORT);
  await waitForServer(BASE_URL, 30_000);
  browser = await chromium.launch();
}

const skip = !dbProbe.ok ? dbProbe.reason : false;

describe("no editor-only field reaches a reader, on any public surface", () => {
  it("the front page", { skip }, async () => {
    const res = await fetch(`${BASE_URL}/`);
    const html = await res.text();
    assert.match(html, new RegExp(HEADLINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "fixture story did not render");
    assertNoLeak("front page", html);
  });

  it("the article page", { skip }, async () => {
    const res = await fetch(`${BASE_URL}/articles/${SLUG}`);
    const html = await res.text();
    assert.match(html, /A fixture for the leak guard/, "article page did not render the story");
    assertNoLeak("article page", html);
  });

  it("a topic page", { skip }, async () => {
    const res = await fetch(`${BASE_URL}/?topic=${TOPIC}`);
    const html = await res.text();
    assert.match(html, new RegExp(HEADLINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "topic page did not render the story");
    assertNoLeak("topic page", html);
  });

  it("archive search", { skip }, async () => {
    const res = await fetch(`${BASE_URL}/?q=${encodeURIComponent(SEARCH_MARKER)}`);
    const html = await res.text();
    assert.match(html, new RegExp(HEADLINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "search did not find the story");
    assertNoLeak("archive search", html);
  });

  /*
    Corrections has no SSR loader (see corrections.tsx) -- it fetches
    `listPublicCorrections` client-side, through a `_serverFn` XHR, after
    hydration. `page.content()` alone is not enough here: it is the rendered
    DOM, and React only ever paints `body`, `created_at`, `headline` and
    `slug` onto the page. The first version of this test read only
    `page.content()` and passed even with `select c.*` spread into the
    response (this file's own second reproduced leak, see the commit note) --
    the row's `user_id` was sitting in the XHR body the whole time, just
    never turned into a text node. A real browser hitting the real network is
    the only way to see the bytes that actually left the server, so this
    listens to every response the page makes and checks the raw body, not
    what ends up on screen.
  */
  it("the corrections page, after it hydrates and fetches its own data", { skip }, async () => {
    const page = await browser!.newPage();
    const responseBodies: { url: string; body: string }[] = [];
    page.on("response", (res) => {
      const type = res.request().resourceType();
      if (type !== "xhr" && type !== "fetch") return;
      responseBodies.push({
        url: res.url(),
        body: "",
      });
      const idx = responseBodies.length - 1;
      res
        .text()
        .then((body) => {
          responseBodies[idx]!.body = body;
        })
        .catch(() => undefined);
    });
    try {
      await page.goto(`${BASE_URL}/corrections`, { waitUntil: "networkidle" });
      await page.waitForSelector(`text=${CORRECTION_BODY.slice(0, 20)}`, { timeout: 15_000 });
      // networkidle already means every in-flight response settled, but give
      // the `.then` handlers above a tick to have run.
      await new Promise((r) => setTimeout(r, 50));
      assert.ok(
        responseBodies.some((r) => r.body.includes(CORRECTION_BODY.slice(0, 20))),
        "never observed the network response that actually carried the correction -- " +
          "this test is not watching the right traffic",
      );
      for (const r of responseBodies) assertNoLeak(`corrections page XHR (${r.url})`, r.body);
      const html = await page.content();
      assertNoLeak("corrections page DOM", html);
    } finally {
      await page.close();
    }
  });

  it("the RSS feed", { skip }, async () => {
    const res = await fetch(`${BASE_URL}/feed`);
    const xml = await res.text();
    assert.match(xml, new RegExp(HEADLINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "feed did not include the story");
    assertNoLeak("feed", xml);
  });

  it("the sitemap", { skip }, async () => {
    const res = await fetch(`${BASE_URL}/sitemap.xml`);
    const xml = await res.text();
    assert.match(xml, new RegExp(SLUG), "sitemap did not include the story");
    assertNoLeak("sitemap", xml);
  });

  it("robots.txt", { skip }, async () => {
    // Static and field-free by construction (see public/robots.txt), checked
    // anyway: a future dynamic robots route is exactly the kind of surface
    // this file exists to catch before it ships, not after.
    const res = await fetch(`${BASE_URL}/robots.txt`);
    const text = await res.text();
    assertNoLeak("robots.txt", text);
  });
});
