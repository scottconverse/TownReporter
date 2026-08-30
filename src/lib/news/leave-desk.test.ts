import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
 * Giving up the desk must not be reachable by a click alone.
 *
 * An audit walked this end to end: a button in the header of every desk page,
 * two positions from "Sign out", behind one inline confirm. Click, confirm,
 * and the newsroom is unclaimed -- so the next anonymous visitor to /login owns
 * the published archive, the Dark Desk investigation files, the reporting
 * notes, and the Server page that restarts services on the operator's own
 * Windows machine. No password reset exists, so the previous owner had no route
 * back from inside the product, and the desk is on the internet through the
 * tunnel.
 *
 * Three properties hold this shut:
 *
 *   1. the RPC compares a caller-supplied email to the signed-in account's own
 *      email, and REFUSES (not just logs) on a mismatch;
 *   2. the control is not rendered in the desk chrome;
 *   3. the confirmation says what is lost, not how the mechanism works.
 *
 * The first used to be checked by reading claim.ts and asserting the string
 * `typed !== mine` appeared before `await leaveAsEditor(`. It went green
 * against a build where the mismatch branch had been changed to
 * `console.warn(...)` and fell through to deleting the membership anyway --
 * because the comparison line was still THERE, just no longer connected to a
 * `return`. A source-text check cannot see control flow; it can only see
 * whether a substring exists somewhere before another substring.
 *
 * This version builds the real app, signs a real owner in through the real
 * `/login` form in a headless browser (the same technique the repo's other
 * `scripts/*-e2e.mjs` files use), and calls the ACTUAL compiled RPC function
 * the browser already loaded for the Server page -- with a mismatched email
 * the disabled "Give up the desk" button would never let a mouse click send.
 * That is deliberately the attack this guards against: "neither can a
 * request the operator did not deliberately compose" (see claim.ts). If the
 * server-side refusal is ever weakened to a warning, this calls it exactly
 * the way that weakened code path is reachable, and reads both the RPC's own
 * `ok: false` and the database row to prove the newsroom was NOT released.
 *
 * Properties 2 and 3 stay source-shape checks. Both are checked below.
 *
 * The first property needs a real Postgres reachable at
 * `TEST_POSTGRES_ADMIN_URL` (or the local default -- see
 * src/lib/test-support/pg-admin.ts). Without one it skips, with a reason,
 * rather than failing a machine that has no database at all. CI runs it for
 * real: see the `postgres-integration` job in .github/workflows/ci.yml.
 */

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PSQL_ADMIN_URL = resolveAdminUrl();
const PORT = 3862;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const dbName = `townreporter_test_leavedesk_${process.pid}_${Date.now()}`;

let server: ChildProcess | undefined;
let browser: Browser | undefined;
let page: Page | undefined;

const OWNER_EMAIL = "leave-desk-probe@townreporter.test";
const OWNER_PASSWORD = "leave-desk-probe-pass-1";

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

/**
 * Find, in the just-built client assets, the compiled RPC function for
 * `leaveEditor` -- and its export alias -- without hardcoding either the
 * chunk's content-hashed filename or the minifier's chosen local variable
 * name, both of which change on every rebuild. What does NOT change between
 * builds is the server function's id: TanStack Start derives it from the
 * source file path + export name (see createServerRpc's call site in the
 * server bundle), which is stable as long as `leaveEditor` keeps living in
 * `src/lib/news/claim.ts`.
 */
function findLeaveEditorClientRpc(): { file: string; exportName: string } {
  const ssrDir = join(repoRoot, ".output", "server", "_ssr");
  let functionId: string | undefined;
  for (const f of readdirSync(ssrDir)) {
    if (!f.endsWith(".mjs")) continue;
    const src = readFileSync(join(ssrDir, f), "utf8");
    const m = src.match(/id:\s*"([a-f0-9]+)",\s*name:\s*"leaveEditor"/);
    if (m) {
      functionId = m[1];
      break;
    }
  }
  if (!functionId) throw new Error("could not find leaveEditor's server function id in the build");

  const assetsDir = join(repoRoot, ".output", "public", "assets");
  for (const f of readdirSync(assetsDir)) {
    if (!f.endsWith(".js")) continue;
    const src = readFileSync(join(assetsDir, f), "utf8");
    if (!src.includes(functionId)) continue;
    const localMatch = src.match(
      new RegExp("var\\s+(\\w+)\\s*=\\s*X\\(\\{method:`POST`\\}\\)[\\s\\S]{0,150}?handler\\(W\\(`" + functionId + "`\\)\\)"),
    );
    if (!localMatch) continue;
    const local = localMatch[1];
    const exportMatch = src.match(new RegExp("[{,]" + local + "\\s+as\\s+(\\w+)[,}]"));
    if (exportMatch) return { file: f, exportName: exportMatch[1] };
  }
  throw new Error(
    `found leaveEditor's function id (${functionId}) in a client asset but could not resolve its export alias`,
  );
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

    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    page = await browser.newPage();
    page.setDefaultTimeout(45_000);

    // Create the desk's one account through the real form -- first account in
    // owns the newsroom (see membership.test.ts for that contract).
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
    await page.getByLabel("Name").fill("Leave Desk Probe");
    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
    await page.getByLabel("Confirm password").fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: "Create editor account" }).click();
    await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
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

describe("giving up the desk", () => {
  it("refuses unless the caller types the address it is signed in as", { skip }, async () => {
    if (!page) throw new Error("no browser page");
    const { file, exportName } = findLeaveEditorClientRpc();

    const result = await page.evaluate(
      async ({ file, exportName, wrongEmail }) => {
        const mod: Record<string, unknown> = await import(/* @vite-ignore */ `/assets/${file}`);
        const leaveEditor = mod[exportName] as (opts: { data: string }) => Promise<{
          ok: boolean;
          error?: string;
        }>;
        return leaveEditor({ data: wrongEmail });
      },
      { file, exportName, wrongEmail: "definitely-not-my-address@example.com" },
    );

    assert.equal(
      result.ok,
      false,
      "leaveEditor accepted a confirmation email that does not match the signed-in account -- " +
        `got: ${JSON.stringify(result)}`,
    );

    // ok:false alone is not proof the newsroom survived -- a defect that logs
    // the mismatch and deletes the membership anyway could still shape its
    // response as {ok:false}. Read the database directly. A short settle
    // delay first: a defect that fires the delete without awaiting it (so the
    // response returns before the delete's own round trip finishes) would
    // otherwise race an immediate query and pass by accident on a fast box.
    await new Promise((r) => setTimeout(r, 500));
    const dbUrl = withDatabase(PSQL_ADMIN_URL, dbName);
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      const { rows } = await db.query(
        `select role from newsroom_members join "user" on "user".id = newsroom_members.user_id where "user".email = $1`,
        [OWNER_EMAIL],
      );
      assert.equal(
        rows[0]?.role,
        "owner",
        "the owner's membership row is gone after a REFUSED leave request -- the mismatch " +
          "branch is not actually stopping the delete",
      );
    } finally {
      await db.end();
    }
  });

  /*
    Static by necessity, not by convenience: whether a component is ever
    referenced in JSX is a property of the source tree, not of any one
    request/response the running app can be asked to produce. Rendering every
    desk page and asserting a button's absence would prove the same thing far
    more expensively and would still only be checking today's page list. This
    one needs no database, so it always runs.
  */
  it("is not rendered in the chrome of every desk page", () => {
    const chrome = readFileSync(new URL("../../components/desk-chrome.tsx", import.meta.url), "utf8");
    const rendered = chrome.includes("<LeaveEditorControl");
    assert.equal(
      rendered,
      false,
      "the control is back in the persistent header, one misclick from Sign out",
    );
  });

  /*
    Also static by necessity: this is checking the copy shown to the operator,
    not a code path -- there is no request whose response is "the words in
    the confirmation dialog." Reading the source is the direct check. No
    database needed, so it always runs.
  */
  it("the confirmation names what is lost", () => {
    const copy = readFileSync(new URL("./desk-copy.ts", import.meta.url), "utf8");
    const block = copy.slice(copy.indexOf("export function createEditorCopy"));
    const text = block.slice(0, block.indexOf("}", block.indexOf("return {")));
    for (const word of ["archive", "cannot take it back", "Type your email"]) {
      assert.ok(
        text.includes(word),
        `the confirmation no longer mentions "${word}"; it describes the mechanism, not the loss`,
      );
    }
  });
});
