import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Client } from "pg";
import { chromium, type Browser, type Page } from "playwright";
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
 * CITY-SETUP slice B proof: a `paper_settings` row for a DIFFERENT city
 * overrides what the front page renders -- not just what `getPaperConfig()`
 * returns in isolation (paper-settings.test.ts already proves that), but
 * what an actual browser sees on the actual site, fetched once per page
 * load and threaded down through every component that used to read the
 * hard-coded `PAPER` constant directly.
 *
 * A real built server on a real Postgres, same shape as two-editors.e2e and
 * public-surfaces.no-leak: `getPaperIdentityFn` is a `createServerFn`, which
 * throws "No Start context found" outside the framework's own request
 * runtime, so this cannot be proven by importing the module directly (see
 * search-index.test.ts for the same constraint).
 */

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PSQL_ADMIN_URL = resolveAdminUrl();
// Every other integration file's PORT is 3861-3867, 3910. Not one of those.
const PORT = 3868;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const dbName = `townreporter_test_paperidentity_${process.pid}_${Date.now()}`;

const dbProbe = integrationRequested()
  ? await probePostgres(PSQL_ADMIN_URL)
  : ({
      ok: false as const,
      reason:
        "set TEST_POSTGRES_ADMIN_URL to run the integration tests (they build the app and boot a server; the postgres-integration CI job runs them on every push)",
    });
const skip = dbProbe.ok ? false : dbProbe.reason;

let server: ChildProcess | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
let db: Client | undefined;

if (dbProbe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: PSQL_ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();

    const dbUrl = withDatabase(PSQL_ADMIN_URL, dbName);
    await ensureBuilt(repoRoot);
    await run(process.execPath, [join(repoRoot, "scripts", "migrate.mjs")], repoRoot, {
      ...process.env,
      DATABASE_URL: dbUrl,
    });

    db = new Client({ connectionString: dbUrl });
    await db.connect();
    // A city that is not Longmont, on every identity column a UI component
    // reads. If any screen still prints Longmont's copy, this proves it.
    await db.query(
      `insert into paper_settings
        (newsroom_id, name, city, state, location, timezone, tagline, kicker, deck, trust, council_votes_url)
       values
        (1, 'Riverbend Record', 'Riverbend', 'Ohio', 'Riverbend, Ohio', 'America/New_York',
         'The river town''s paper of record.', 'Independent civic reporting  ·  Riverbend',
         'Riverbend Record follows the river town''s meetings, money and public records.',
         'Civic news for Riverbend.', 'https://riverbend-council.example.org/')`,
    );

    server = spawnBuiltServer(repoRoot, dbUrl, PORT);
    await waitForServer(BASE_URL, 30_000);

    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    page = await browser.newPage();
    page.setDefaultTimeout(45_000);
  }, 300_000);

  after(async () => {
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await db?.end().catch(() => undefined);
    server?.kill();
    const admin = new Client({ connectionString: PSQL_ADMIN_URL });
    await admin.connect();
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  }, 30_000);
}

describe("the configured paper identity, not Longmont's", () => {
  it("the front page's masthead, title and footer show the configured city", { skip, timeout: 60_000 }, async () => {
    if (!page) throw new Error("no page");
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    assert.equal(await page.title(), "Riverbend Record — Riverbend, Ohio");

    const body = (await page.textContent("body")) ?? "";
    assert.match(body, /Riverbend Record/);
    assert.match(body, /Riverbend, Ohio/);

    /*
      Scoped to the paper's chrome on purpose.

      A whole-page "no Longmont anywhere" assertion fails here, and it is
      right to: migrations/0002_newsroom.sql seeds a welcome ARTICLE written
      about Longmont, which lands on a new city's front page as content. That
      is seeded copy, not identity, and it is slice C's job -- the first-run
      setup writes the welcome piece for the city being set up. Asserting it
      here would either block this slice or tempt someone to weaken the test
      later; naming it is the honest option.
    */
    const chrome = [
      await page.textContent("header"),
      await page.textContent("footer"),
    ].join(" ");
    assert.doesNotMatch(chrome, /Longmont/);
  });

  it("a standing page (About) and the RSS feed both use the configured identity", { skip, timeout: 60_000 }, async () => {
    if (!page) throw new Error("no page");
    await page.goto(`${BASE_URL}/about`, { waitUntil: "domcontentloaded" });
    assert.equal(await page.title(), "About this paper — Riverbend Record");
    const aboutBody = (await page.textContent("body")) ?? "";
    assert.match(aboutBody, /Independent civic reporting for Riverbend/);
    assert.doesNotMatch(aboutBody, /Independent civic reporting for Longmont/);

    const feedRes = await page.request.get(`${BASE_URL}/feed`);
    const feedXml = await feedRes.text();
    assert.match(feedXml, /Riverbend Record — Riverbend, Ohio/);
    assert.doesNotMatch(feedXml, /TownReporter — Longmont/);
  });
});
