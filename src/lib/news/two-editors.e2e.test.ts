import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Client } from "pg";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
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
 * Two editors, one story, at the same time (TEST-001, shipped with v0.5.4).
 *
 * The moment invites exist (v0.5.3), two real humans can collide: one
 * publishes while the other deletes; both save different bodies; both press
 * Publish. Every property here is about how the collision ENDS:
 *
 *  - the loser gets a plain message, never a crash and never silent success
 *  - the database ends consistent -- no orphan draft, no double article
 *  - last write wins on a plain double-save, and the survivor is one of the
 *    two bodies, whole (never an interleaving)
 *
 * Two Playwright CONTEXTS against one built server on a real Postgres: two
 * cookie jars, two sessions, one newsroom. The second editor's seat is
 * seeded through the invite tables directly -- the invite JOURNEY has its
 * own walk (v0.5.3); this file is about what happens after both are in.
 */

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PSQL_ADMIN_URL = resolveAdminUrl();
const PORT = 3866;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const dbName = `townreporter_test_twoeditors_${process.pid}_${Date.now()}`;

let server: ChildProcess | undefined;
let browser: Browser | undefined;
let ownerPage: Page | undefined;
let editorPage: Page | undefined;
let ownerCtx: BrowserContext | undefined;
let editorCtx: BrowserContext | undefined;
let db: Client | undefined;

const OWNER_EMAIL = "race-owner@townreporter.test";
const EDITOR_EMAIL = "race-editor@townreporter.test";
const PASSWORD = "two-editors-race-pass-1";

const dbProbe = integrationRequested()
  ? await probePostgres(PSQL_ADMIN_URL)
  : ({
      ok: false as const,
      reason:
        "set TEST_POSTGRES_ADMIN_URL to run the integration tests (they build the app and boot a server; the postgres-integration CI job runs them on every push)",
    });
const skip = dbProbe.ok ? false : dbProbe.reason;

async function signUpAndEnter(page: Page, name: string, email: string) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  const heading = await page
    .getByRole("heading", { name: /Create the desk/ })
    .count();
  if (heading > 0) {
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create editor account" }).click();
  } else {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in with email" }).click();
  }
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
}

/** File a lead through the owner's queue UI; return its story URL. */
async function fileLead(page: Page, headline: string): Promise<string> {
  await page.goto(`${BASE_URL}/desk/queue`, { waitUntil: "domcontentloaded" });
  await page.getByText("File a lead yourself").click();
  await page.getByLabel("Headline").fill(headline);
  await page.getByLabel(/Why now/i).fill("Two editors are about to fight over it.");
  await page.getByRole("button", { name: "File lead" }).click();
  await page.waitForURL(/\/desk\/story\/\d+/, { timeout: 30_000 });
  return page.url();
}

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

    server = spawnBuiltServer(repoRoot, dbUrl, PORT);
    await waitForServer(BASE_URL, 30_000);

    db = new Client({ connectionString: dbUrl });
    await db.connect();

    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    ownerCtx = await browser.newContext();
    editorCtx = await browser.newContext();
    ownerPage = await ownerCtx.newPage();
    editorPage = await editorCtx.newPage();
    ownerPage.setDefaultTimeout(45_000);
    editorPage.setDefaultTimeout(45_000);

    // Owner claims the desk the normal way.
    await signUpAndEnter(ownerPage, "Race Owner", OWNER_EMAIL);

    // Seed a live invite for the editor (the journey is v0.5.3's walk; the
    // seat is what this file needs), then sign them up and seat them.
    const token = "e".repeat(64);
    const hash = createHash("sha256").update(token).digest("hex");
    await db.query(
      `insert into editor_invites (newsroom_id, email, token_hash, expires_at)
       values (1, $1, $2, now() + interval '1 day')`,
      [EDITOR_EMAIL, hash],
    );
    /*
      Order matters: sign up FIRST (creates the user row), seat SECOND, and
      only THEN walk onto the desk -- an authed-but-unseated visitor gets no
      Queue link, which is exactly the 45-second timeout this hook died of on
      its first run.
    */
    await editorPage.goto(`${BASE_URL}/login?invite=${token}`, { waitUntil: "domcontentloaded" });
    await editorPage.getByRole("heading", { name: /You're invited/ }).waitFor();
    await editorPage.getByLabel("Name").fill("Race Editor");
    await editorPage.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await editorPage.getByLabel("Confirm password").fill(PASSWORD);
    await editorPage.getByRole("button", { name: "Create editor account" }).click();
    await editorPage.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
    // The seat must exist before the editor's next desk request.
    const seated = await db.query(`select count(*)::int as c from newsroom_members`);
    assert.equal(seated.rows[0].c, 2, "both seats must exist before the races start");
  }, 300_000);

  after(async () => {
    await ownerPage?.close().catch(() => undefined);
    await editorPage?.close().catch(() => undefined);
    await ownerCtx?.close().catch(() => undefined);
    await editorCtx?.close().catch(() => undefined);
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

describe("two editors on one story", () => {
  it("save-after-delete loses with a message, not a crash or a silent success", { skip, timeout: 180_000 }, async () => {
    if (!ownerPage || !editorPage || !db) throw new Error("no session");
    const storyUrl = await fileLead(ownerPage, "Race story one: delete under an open editor");
    const leadId = Number(storyUrl.match(/story\/(\d+)/)![1]);

    // Owner has the workbench open and types a body.
    await ownerPage.getByLabel("Body").fill("The body the owner is still writing.");

    // The editor deletes the lead out from under them, from THEIR queue --
    // the exact two-click pattern desk-flows-e2e already proves.
    await editorPage.goto(`${BASE_URL}/desk/queue`, { waitUntil: "domcontentloaded" });
    const row = editorPage.locator(".lead-row", { hasText: "Race story one" }).first();
    await row.getByRole("button", { name: "Delete", exact: true }).click();
    await row.getByRole("button", { name: /Yes, delete/ }).click();
    await editorPage.getByText(/Deleted, and kept for 30 days/).waitFor({ timeout: 20_000 });

    // Owner saves into the void.
    const errors: string[] = [];
    ownerPage.on("pageerror", (e) => errors.push(String(e)));
    await ownerPage.getByRole("button", { name: "Save edits" }).click();
    await ownerPage.waitForTimeout(2000);

    const bodyText = (await ownerPage.textContent("body")) ?? "";
    assert.ok(
      !/Saved\.\s*$/m.test(bodyText) || /not|gone|deleted|no longer/i.test(bodyText),
      "a save against a deleted lead must not report plain success",
    );
    assert.equal(errors.length, 0, `the page must not crash: ${errors.join(" | ")}`);

    // Database: the lead is out of the live table; no article was created.
    const live = await db.query(`select count(*)::int as c from leads where id = $1`, [leadId]);
    const arts = await db.query(
      `select count(*)::int as c from articles where headline like 'Race story one%'`,
    );
    assert.equal(live.rows[0].c, 0, "the deleted lead must stay deleted");
    assert.equal(arts.rows[0].c, 0, "no article may appear for a story that never published");
  });

  it("double-save is last-write-wins with one whole body, never an interleaving", { skip, timeout: 180_000 }, async () => {
    if (!ownerPage || !editorPage || !db) throw new Error("no session");
    const storyUrl = await fileLead(ownerPage, "Race story two: both hands on the keyboard");
    const leadId = Number(storyUrl.match(/story\/(\d+)/)![1]);

    await editorPage.goto(storyUrl, { waitUntil: "domcontentloaded" });
    await editorPage.getByLabel("Body").waitFor();

    const BODY_A = "Body A: the owner's complete paragraph, written first.";
    const BODY_B = "Body B: the editor's complete paragraph, written second.";
    await ownerPage.getByLabel("Body").fill(BODY_A);
    await editorPage.getByLabel("Body").fill(BODY_B);

    // Fire both saves as close together as two real clicks get.
    await Promise.all([
      ownerPage.getByRole("button", { name: "Save edits" }).click(),
      editorPage.getByRole("button", { name: "Save edits" }).click(),
    ]);
    await ownerPage.waitForTimeout(2500);

    const rows = await db.query(
      `select body from drafts where lead_id = $1 order by updated_at desc limit 1`,
      [leadId],
    );
    const body = rows.rows[0]?.body ?? "";
    assert.ok(
      body === BODY_A || body === BODY_B,
      `the surviving body must be one editor's whole text, got: ${body.slice(0, 80)}`,
    );
  });

  it("double-publish yields exactly one article on the paper", { skip, timeout: 180_000 }, async () => {
    if (!ownerPage || !editorPage || !db) throw new Error("no session");
    const storyUrl = await fileLead(ownerPage, "Race story three: published twice at once");

    await ownerPage.getByLabel("Body").fill("A body long enough to publish, written for the race.");
    await ownerPage.getByRole("button", { name: "Save edits" }).click();
    await ownerPage.waitForTimeout(1200);

    await editorPage.goto(storyUrl, { waitUntil: "domcontentloaded" });
    await editorPage.getByLabel("Body").waitFor();

    /*
      Publish is deliberately two-step (arm, then confirm) -- one unconfirmed
      click must never print. So each editor arms first, and then the two
      CONFIRMS race. The first run of this test clicked once per editor: both
      armed, neither printed, and the assertion read 0 articles -- which was
      the product being right and the test being wrong.
    */
    await ownerPage.getByRole("button", { name: "Publish to the paper" }).click();
    await editorPage.getByRole("button", { name: "Publish to the paper" }).click();
    await ownerPage.waitForTimeout(400);
    await Promise.all([
      ownerPage.getByRole("button", { name: "Yes, print it" }).click(),
      editorPage.getByRole("button", { name: "Yes, print it" }).click(),
    ]);
    await ownerPage.waitForTimeout(3000);

    const arts = await db.query(
      `select count(*)::int as c from articles where headline like 'Race story three%'`,
    );
    assert.equal(arts.rows[0].c, 1, "two simultaneous publishes must print exactly one article");
  });
});
