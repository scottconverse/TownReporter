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
 * The uncredited-source publish warning, actually rendering.
 *
 * `uncreditedOutlets` (report.ts) has full unit coverage (report.test.ts):
 * given a body and a list of source URLs, it returns the outlet names the
 * body never names. What that coverage cannot see is desk.story.$leadId.tsx
 * actually wiring the function's result into the publish-confirm panel --
 * the right condition, the right text, on the right button's arm.
 *
 * This seeds a lead and a draft directly through the database (the same
 * shape leave-desk.test.ts and stalled-run.e2e.test.ts seed through, and the
 * only option here: no model provider exists in CI, so there is no drafting
 * flow to drive from the UI). The draft's source_urls carries a real
 * Longmont Times-Call URL (the same one report.test.ts uses) and a body that
 * never says "Times-Call" or "Longmont Times-Call". Arming Publish must show
 * the warning; editing the body to name the outlet must make it disappear,
 * live, without re-arming -- `uncredited` is computed from React state on
 * every render, not from the draft row on disk.
 *
 * Needs a real Postgres reachable at TEST_POSTGRES_ADMIN_URL (or the local
 * default) and a real Chromium (installed for this repo's e2e scripts).
 * Skips, with a reason, on a machine with neither.
 */

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PSQL_ADMIN_URL = resolveAdminUrl();
const PORT = 3867;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const dbName = `townreporter_test_uncreditedwarn_${process.pid}_${Date.now()}`;

let server: ChildProcess | undefined;
let browser: Browser | undefined;
let page: Page | undefined;

const OWNER_EMAIL = "uncredited-warn-probe@townreporter.test";
const OWNER_PASSWORD = "uncredited-warn-probe-pass-1";

// Same outlet + URL report.test.ts uses for "Longmont Times-Call".
const OUTLET_URL = "https://www.timescall.com/2026/08/28/front-range-rail-sales-tax-ballot/";
const OUTLET_NAME = "Longmont Times-Call";
const UNCREDITED_BODY =
  "The board acted on the sales tax Thursday, after weeks of debate over the ballot language.";
const CREDITED_BODY =
  "The Longmont Times-Call reported Thursday that the board acted on the sales tax, " +
  "after weeks of debate over the ballot language.";

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
    await page.getByLabel("Name").fill("Uncredited Warn Probe");
    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
    await page.getByLabel("Confirm password").fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: "Create editor account" }).click();
    await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });

    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      // Poll, don't read once -- see stalled-run.e2e.test.ts for why: the
      // membership row lands moments after the signup response.
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
        throw new Error("could not resolve the newly-created owner's user id");
      }
    } finally {
      await db.end();
    }
  }, 300_000);

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

describe("the uncredited-source publish warning, rendered", () => {
  it("appears when a sourced outlet is never named in the body, and clears when the body names it", { skip, timeout: 120_000 }, async () => {
    if (!page) throw new Error("no browser page");
    const dbUrl = withDatabase(PSQL_ADMIN_URL, dbName);
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    let leadId: number;
    try {
      const leadRes = await db.query(
        `insert into leads (user_id, headline, why, topic, status, source_urls, newsworthiness)
         values ($1, $2, $3, 'council', 'drafted', $4, 12)
         returning id`,
        [
          userId,
          "Board acts on sales tax after weeks of debate",
          "The ballot language changed late and voters need the context.",
          JSON.stringify([OUTLET_URL]),
        ],
      );
      leadId = leadRes.rows[0].id;
      await db.query(
        `insert into drafts (user_id, lead_id, headline, dek, body, topic, source_urls)
         values ($1, $2, $3, '', $4, 'council', $5)`,
        [
          userId,
          leadId,
          "Board acts on sales tax after weeks of debate",
          UNCREDITED_BODY,
          JSON.stringify([OUTLET_URL]),
        ],
      );
    } finally {
      await db.end();
    }

    await page.goto(`${BASE_URL}/desk/story/${leadId}`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Body").waitFor();
    assert.equal(
      await page.getByLabel("Body").inputValue(),
      UNCREDITED_BODY,
      "the seeded draft body never loaded into the workbench",
    );

    await page.getByRole("button", { name: "Publish to the paper" }).click();
    try {
      await page
        .getByText(new RegExp(`The body never names ${OUTLET_NAME}`))
        .waitFor({ timeout: 10_000 });
    } catch (e) {
      console.log("DEBUG body text:", (await page.textContent("body"))?.slice(0, 3000));
      throw e;
    }

    // Naming the outlet in the body, live, must clear the warning without
    // re-arming Publish -- `uncredited` is derived from React state on every
    // render, not re-fetched from the draft row on disk.
    await page.getByLabel("Body").fill(CREDITED_BODY);
    await page
      .getByText(new RegExp(`The body never names ${OUTLET_NAME}`))
      .waitFor({ state: "detached", timeout: 15_000 });

    const bodyText = (await page.textContent("body")) ?? "";
    assert.ok(
      !new RegExp(`The body never names ${OUTLET_NAME}`).test(bodyText),
      "the uncredited-source warning is still showing after the body was edited to name the outlet",
    );
  });
});
