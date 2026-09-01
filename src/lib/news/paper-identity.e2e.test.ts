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
 * CITY-SETUP slice B+final proof: a paper set up as a DIFFERENT city, through
 * the first-run setup UI (not a direct DB write), overrides what the front
 * page renders -- not just what `getPaperConfig()` returns in isolation
 * (paper-settings.test.ts already proves that), but what an actual browser
 * sees, fetched once per page load and threaded down through every
 * component that used to read the hard-coded `PAPER` constant directly.
 *
 * A real built server on a real Postgres, same shape as two-editors.e2e and
 * public-surfaces.no-leak: `getPaperIdentityFn` is a `createServerFn`, which
 * throws "No Start context found" outside the framework's own request
 * runtime, so this cannot be proven by importing the module directly (see
 * search-index.test.ts for the same constraint).
 *
 * CITY-SETUP final slice added the UI walk: sign up (first account owns the
 * desk, same as every other e2e file), land on /desk/setup automatically,
 * fill the setup form and submit -- zero file edits and zero direct writes
 * to paper_settings. That is what proves the "a new city needs zero file
 * edits" claim; a db.query insert would only prove the merge logic, which
 * paper-settings.test.ts already covers.
 *
 * Release-walkthrough Blocker fix: the SAME database is also the sharpest
 * available proof of the pre-setup state -- before this file's own signup
 * step runs, this is a brand-new, unclaimed install, exactly what the
 * walkthrough described ("before anyone has claimed the desk"). The
 * pre-setup snapshot below is captured with this file's one server, one
 * browser and one database, in the moments before signup -- not a second
 * server -- both to avoid doubling this file's already-heavy resource use
 * (five files in this repo already build the app and boot a real server;
 * see src/lib/test-support/pg-admin.ts on why they are made to run one at a
 * time) and because ordering two `it`s deterministically before/after a
 * shared setup step is not guaranteed by node's test runner, while a single
 * `before()` awaiting each step in sequence is.
 */

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PSQL_ADMIN_URL = resolveAdminUrl();
// Every other integration file's PORT is 3861-3868, 3910. Not one of those.
const PORT = 3869;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const dbName = `townreporter_test_paperidentity_${process.pid}_${Date.now()}`;

const OWNER_EMAIL = "setup-owner@townreporter.test";
const PASSWORD = "city-setup-owner-pass-1";

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

// Captured in before(), in the window between the server coming up and the
// first signup -- see the file comment for why this is a snapshot rather
// than its own server+browser.
let preSetupHtml = "";
let preSetupBody = "";
let preSetupFeedXml = "";
let preSetupCorrectionsBody = "";

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

    server = spawnBuiltServer(repoRoot, dbUrl, PORT);
    await waitForServer(BASE_URL, 30_000);

    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    page = await browser.newPage();
    page.setDefaultTimeout(45_000);

    /*
      Release-walkthrough Blocker fix: before anyone signs up, this database
      has no owner and no paper_settings row at all -- the exact state the
      walkthrough described. Snapshot it now; the `it`s below just assert on
      these strings, so this ordering is a plain sequential await, not a
      test-runner scheduling assumption.
    */
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    preSetupHtml = await page.content();
    preSetupBody = (await page.textContent("body")) ?? "";
    const feedRes = await page.request.get(`${BASE_URL}/feed`);
    preSetupFeedXml = await feedRes.text();
    await page.goto(`${BASE_URL}/corrections`, { waitUntil: "domcontentloaded" });
    preSetupCorrectionsBody = (await page.textContent("body")) ?? "";

    // First account owns the fresh desk -- the normal claim path (claim.ts).
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /Create the desk/ }).waitFor();
    await page.getByLabel("Name").fill("Setup Owner");
    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create editor account" }).click();

    // The owner lands straight on the first-run setup gate (desk.index's
    // redirect, driven by firstRunSetupState()).
    await page.waitForURL(/\/desk\/setup/, { timeout: 45_000 });
    /*
      The form must arrive BLANK. The third release walkthrough found the
      City box pre-filled with the real value "Longmont" -- an operator who
      accepted the form got a paper whose database says Longmont, Colorado.
      Asserting the empty state here keeps that from coming back.
    */
    await page.getByLabel("Paper name").waitFor();
    assert.equal(await page.getByLabel("Paper name").inputValue(), "", "paper name must not be pre-filled");
    assert.equal(await page.getByLabel("City", { exact: true }).inputValue(), "", "city must not arrive pre-filled with Longmont");
    assert.equal(await page.getByLabel("State", { exact: true }).inputValue(), "", "state must not arrive pre-filled with Colorado");
    await page.getByLabel("Paper name").fill("Riverbend Record");
    await page.getByLabel("Tagline").fill("The river town's paper of record.");
    await page.getByLabel("City").fill("Riverbend");
    await page.getByLabel("State").fill("Ohio");
    /*
      CITY-SETUP timezone half: Pacific/Auckland, not America/New_York.
      Auckland sits 17-19 hours ahead of Denver (the PAPER.timezone default),
      so "today" in Auckland is a different calendar date than "today" in
      Denver for most of every day -- the sharpest possible proof that a
      screen renders the CONFIGURED zone and not the code's hard-coded one.
    */
    await page.getByLabel(/Timezone/).fill("Pacific/Auckland");
    await page.getByLabel("URL", { exact: true }).fill("https://riverbend-council.example.org/");
    await page.getByLabel("Title", { exact: true }).fill("Riverbend Council");
    await page.getByRole("button", { name: "Save and open the desk" }).click();

    // Setup redirects to /desk on success.
    await page.waitForURL(`${BASE_URL}/desk`, { timeout: 45_000 });
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

describe("release-walkthrough Blocker fix: before anyone has claimed the desk or run setup", () => {
  it("the front page does not serve Longmont's identity, does not link Longmont's real council, and does not print the seeded welcome article", { skip, timeout: 60_000 }, async () => {
    assert.doesNotMatch(
      preSetupHtml,
      /longmont/i,
      "an unconfigured install must not claim to be Longmont's paper anywhere, hrefs included",
    );
    // The masthead nav's council link is entirely absent (see
    // src/components/paper-chrome.tsx: it only renders when
    // paper.councilVotesUrl is non-empty), not merely pointed elsewhere.
    assert.doesNotMatch(preSetupHtml, /City council votes/);

    // The migration-seeded article (migrations/0002_newsroom.sql, slug
    // welcome-to-townreporter) must not be publicly readable pre-setup.
    assert.doesNotMatch(preSetupBody, /A civic paper for Longmont, edited by a human/);
    assert.doesNotMatch(preSetupBody, /TownReporter is a small civic newspaper for Longmont/);

    // It also does not claim to be a real, generic town's paper -- an
    // honest "not set up" state is what the release walkthrough asked for.
    assert.match(preSetupBody, /not.{0,20}set up|awaiting setup/i);
  });

  it("the article API surfaces (feed, corrections) are empty too, not just the front page's rendering", { skip, timeout: 60_000 }, async () => {
    assert.doesNotMatch(preSetupFeedXml, /longmont/i);
    assert.doesNotMatch(preSetupFeedXml, /<item>/);
    assert.doesNotMatch(preSetupCorrectionsBody, /longmont/i);
  });
});

describe("the configured paper identity, not Longmont's", () => {
  it("the front page's masthead, title, footer and welcome article show the configured city -- Longmont appears nowhere", { skip, timeout: 60_000 }, async () => {
    if (!page) throw new Error("no page");
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    assert.equal(await page.title(), "Riverbend Record — Riverbend, Ohio");

    const body = (await page.textContent("body")) ?? "";
    assert.match(body, /Riverbend Record/);
    assert.match(body, /Riverbend, Ohio/);    /*
      The rendered HTML, not just the visible text.

      The release walkthrough found "City council votes" hard-linked to
      longmontcitycouncil.org on every configured paper. A text-only
      assertion cannot see an href, so it passed. This one would not have.
    */
    const html = await page.content();
    assert.doesNotMatch(html, /longmont/i, "Longmont must not survive setup anywhere in the page, hrefs included");

    /*
      CITY-SETUP final slice: the whole front page, including the article
      body -- not just the chrome. The seeded welcome article
      (migrations/0002_newsroom.sql, slug welcome-to-townreporter) was
      written about Longmont; completeFirstRunSetup rewrote it for
      Riverbend the moment setup was submitted above (writeWelcomeArticle in
      src/lib/news/welcome-article.ts). If that rewrite regresses, this is
      the assertion that catches it.
    */
    assert.doesNotMatch(body, /Longmont/);
  });

  it("a standing page (About), How we report, the feed and the desk queue all use the configured identity", { skip, timeout: 60_000 }, async () => {
    if (!page) throw new Error("no page");
    await page.goto(`${BASE_URL}/about`, { waitUntil: "domcontentloaded" });
    assert.equal(await page.title(), "About this paper — Riverbend Record");
    const aboutBody = (await page.textContent("body")) ?? "";
    assert.match(aboutBody, /Independent civic reporting for Riverbend/);
    assert.doesNotMatch(aboutBody, /Independent civic reporting for Longmont/);

    await page.goto(`${BASE_URL}/how-we-report`, { waitUntil: "domcontentloaded" });
    const howBody = (await page.textContent("body")) ?? "";
    assert.match(howBody, /Riverbend/);

    const feedRes = await page.request.get(`${BASE_URL}/feed`);
    const feedXml = await feedRes.text();
    assert.match(feedXml, /Riverbend Record — Riverbend, Ohio/);
    assert.doesNotMatch(feedXml, /TownReporter — Longmont/);
  });

  /*
    CITY-SETUP slice C2 proof: the masthead's "today" (Masthead in
    src/components/paper-chrome.tsx, via usePaperDateFormatters ->
    formatDate) renders in the paper's CONFIGURED timezone -- not
    PAPER.timezone (America/Denver), which is what every call site rendered
    before this slice regardless of what paper_settings said.
  */
  it("the masthead date is computed in the configured timezone, not Denver's", { skip, timeout: 60_000 }, async () => {
    if (!page) throw new Error("no page");
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    const dateOpts: Intl.DateTimeFormatOptions = {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    };
    const now = new Date();
    const expectedAuckland = now.toLocaleDateString("en-US", { ...dateOpts, timeZone: "Pacific/Auckland" });
    const wrongDenver = now.toLocaleDateString("en-US", { ...dateOpts, timeZone: "America/Denver" });

    const body = (await page.textContent("body")) ?? "";
    assert.match(body, new RegExp(expectedAuckland.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // Only meaningful when the two zones actually disagree on the date right
    // now, which is true for the large majority of every 24h period given a
    // 17-19 hour offset -- but guard the assertion so a run during the small
    // overlap window doesn't produce a false failure.
    if (wrongDenver !== expectedAuckland) {
      assert.doesNotMatch(body, new RegExp(wrongDenver.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  /*
    Regression guard: an EXISTING (already-onboarded) paper is untouched by
    this feature. The seeded Longmont welcome article is only ever rewritten
    by completeFirstRunSetup, and that RPC is owner-only and never runs on
    its own -- this newsroom's row was set up for Riverbend above, so the
    Longmont copy that ships in migrations/0002_newsroom.sql was never
    written to THIS database at all (a fresh test db), which is the
    strongest local proof available that setup does not run itself.
    paper-settings.test.ts additionally proves, at the unit level, that a
    newsroom with no paper_settings row (or onboarded=false) reads back
    exactly PAPER / COUNCIL_VOTES_URL / SEED_SOURCES unchanged.
  */
  it("the queue page (desk chrome) also reflects the configured city, proving the identity thread reaches the desk too", { skip, timeout: 60_000 }, async () => {
    if (!page) throw new Error("no page");
    await page.goto(`${BASE_URL}/desk`, { waitUntil: "domcontentloaded" });
    // The desk shows "Opening the desk / Checking this newsroom" until the
    // session resolves; reading the body before then reads the placeholder.
    await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
    const deskBody = (await page.textContent("body")) ?? "";
    assert.match(deskBody, /Riverbend Record/);
    assert.doesNotMatch(deskBody, /Longmont/);
  });
});
