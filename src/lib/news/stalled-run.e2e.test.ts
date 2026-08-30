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
 * A run record that dies without ever writing `finished_at` or `error`.
 *
 * Scan (`scan_runs`), Dark Desk (an investigation stuck at status
 * "investigating") and, less directly, Opinion (`editorial_requests`) and a
 * draft (`desk_jobs` itself) all keep a "this is still open" flag that only
 * gets cleared by the job's OWN code finishing. A process killed mid-run --
 * the machine rebooting, the app restarting, an OOM kill -- can die before
 * that write, and before this fix the screen watching that record computed
 * "still working" from exactly that open flag: `scanning = !last.finished_at
 * && !last.error`. That state is real and was reproduced on this machine
 * (see the CLAUDE-facing notes this fix shipped with): a scan_runs row
 * inserted directly, with no desk_jobs row behind it, left `/desk/scan`
 * showing "Scanning sources..." with the Run button disabled, forever --
 * because nothing was ever going to touch that row again.
 *
 * This test seeds exactly that row against a real built server and a real
 * browser, then asserts the page tells the editor plainly that the run
 * stopped and lets them start a new one -- not that some string exists in a
 * source file, but that the RENDERED page says it and the button is usable.
 *
 * Needs a real Postgres reachable at `TEST_POSTGRES_ADMIN_URL` (or the local
 * default) and a real Chromium (installed for this repo's e2e scripts).
 * Skips, with a reason, on a machine with neither.
 */

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PSQL_ADMIN_URL = resolveAdminUrl();
const PORT = 3864;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const dbName = `townreporter_test_stalledrun_${process.pid}_${Date.now()}`;

let server: ChildProcess | undefined;
let browser: Browser | undefined;
let page: Page | undefined;

const OWNER_EMAIL = "stalled-run-probe@townreporter.test";
const OWNER_PASSWORD = "stalled-run-probe-pass-1";

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
const skip = dbProbe.ok ? false : dbProbe.reason;

let userId = "";

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

    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    page = await browser.newPage();
    page.setDefaultTimeout(45_000);

    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
    await page.getByLabel("Name").fill("Stalled Run Probe");
    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
    await page.getByLabel("Confirm password").fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: "Create editor account" }).click();
    await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });

    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      /*
        Poll, don't read once. The membership row lands moments after the
        signup response, and on a loaded CI runner (six servers, six
        browsers) a single immediate read lost that race -- the user row was
        there, members=[] was not yet. Locally the write always won.
      */
      for (let i = 0; i < 30 && !userId; i++) {
        const { rows } = await db.query(
          `select newsroom_members.user_id from newsroom_members
           join "user" on "user".id = newsroom_members.user_id
           where "user".email = $1`,
          [OWNER_EMAIL],
        );
        userId = rows[0]?.user_id;
        if (!userId) await new Promise((r) => setTimeout(r, 1000));
      }
      if (!userId) {
        const users = await db.query(`select id, email from "user"`);
        const members = await db.query(`select user_id, role, newsroom_id from newsroom_members`);
        throw new Error(
          `could not resolve the newly-created owner's user id. users=${JSON.stringify(users.rows)} members=${JSON.stringify(members.rows)}`,
        );
      }
    } finally {
      await db.end();
    }
  }, 240_000);

  after(async () => {
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
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

describe("a run that died mid-work", () => {
  it("tells the editor the scan stopped, instead of spinning forever with Run disabled", { skip, timeout: 120_000 }, async () => {
    if (!page) throw new Error("no browser page");
    const dbUrl = withDatabase(PSQL_ADMIN_URL, dbName);
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      // The exact shape a crash between "insert the run row" and "enqueue
      // the desk_jobs row" leaves behind: an open scan_runs row with nothing
      // in desk_jobs that could ever reclaim it. started_at is set well in
      // the past so a reviewer reading a screenshot cannot mistake this for
      // a fresh, still-plausible run.
      await db.query(
        `insert into scan_runs (user_id, newsroom_id, started_at) values ($1, 1, now() - interval '10 minutes')`,
        [userId],
      );
    } finally {
      await db.end();
    }

    /*
      domcontentloaded, NOT networkidle: the scan desk polls its run status
      on an interval, so on a slow runner the network never goes idle and the
      goto hangs until the harness cancels the whole subtest ("test did not
      finish before its parent"). The waitFor below is the real readiness
      signal. Same lesson render-fetch.ts already carries about Municode.
    */
    await page.goto(`${BASE_URL}/desk/scan`, { waitUntil: "domcontentloaded" });

    // The dead-end this guards against: the Run button staying disabled
    // because the page believes a scan is still in flight.
    const runButton = page.getByRole("button", { name: /^Run scan$/ });
    await runButton.waitFor({ state: "visible", timeout: 15_000 });
    await assert.doesNotReject(
      async () => assert.equal(await runButton.isDisabled(), false),
      "the Run scan button is still disabled -- the page thinks a dead run is live",
    );

    // Wait for the banner rather than racing the query that discovers the
    // stalled run -- under CI load the first paint can precede that fetch.
    await page
      .getByText(/stopped without finishing/i)
      .first()
      .waitFor({ timeout: 30_000 })
      .catch(() => undefined);
    const bodyText = (await page.textContent("body")) ?? "";
    assert.ok(
      /stopped without finishing/i.test(bodyText),
      "the page never told the editor the scan stopped; it just looks like it is still running",
    );
    assert.ok(
      !/Scanning sources/i.test(bodyText),
      "the page is still showing the busy 'Scanning sources...' label for a run nothing is working on",
    );
  });
});
