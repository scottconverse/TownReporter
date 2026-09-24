#!/usr/bin/env node
/**
 * Runtime proof for the scan-refresh hotfix (item 1 of 0.6.61).
 *
 * The unit tests prove accumulateScanPages takes the newer row. This proves the
 * consequence in a real browser, at the seam that actually broke: the Scan page
 * refetches every 2 seconds while a run looks open, merges the response, and
 * derives `scanning` from the newest row's finished_at. With the bug, the newest
 * row never changed once on screen, so the page spun forever.
 *
 * Sequence: sign in, open /desk/scan, insert an OPEN scan row directly in the
 * database (no model call, nothing outward-facing), confirm the page shows the
 * busy state, then set finished_at on that same row and confirm the page stops
 * showing the busy state within one refetch interval. Under the old code the
 * second assertion cannot pass, because the row is dropped on merge.
 *
 *   SCANFIX_BASE_URL=http://127.0.0.1:3491 \\
 *   SCANFIX_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/townreporter_scan_refresh \\
 *   node scripts/scan-refresh-runtime-proof.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

const { Client } = pg;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
function checkedLoopbackUrl(value, label, protocols = ["http:", "https:"]) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (!protocols.includes(parsed.protocol) || !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(`${label} must use an allowed protocol and loopback host; refused ${parsed.hostname || "(none)"}`);
  }
  return parsed;
}

let baseUrl;
try {
  baseUrl = checkedLoopbackUrl(
    process.env.SCANFIX_BASE_URL || "http://127.0.0.1:3491",
    "SCANFIX_BASE_URL",
  );
} catch (err) {
  console.error(`${err.message}. This proof only opens a disposable loopback server.`);
  process.exit(2);
}
const base = baseUrl.toString().replace(/\/$/, "");

const dbUrl = process.env.SCANFIX_DATABASE_URL;
if (!dbUrl) {
  console.error("SCANFIX_DATABASE_URL is required (disposable database only).");
  process.exit(2);
}
let databaseUrl;
try {
  databaseUrl = checkedLoopbackUrl(dbUrl, "SCANFIX_DATABASE_URL", ["postgres:", "postgresql:"]);
} catch (err) {
  console.error(`${err.message}. This proof must use a disposable local PostgreSQL database.`);
  process.exit(2);
}
if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
  console.error("SCANFIX_DATABASE_URL must use PostgreSQL.");
  process.exit(2);
}
if (["host", "hostaddr", "service"].some((key) => databaseUrl.searchParams.has(key))) {
  console.error("SCANFIX_DATABASE_URL may not override its loopback host through query parameters.");
  process.exit(2);
}
const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, "")).toLowerCase();
const disposableName = /(?:^|[_-])(ci|test|scratch|disposable|accept|scan[_-]?refresh)(?:$|[_-])/.test(databaseName);
const forbiddenDatabase = new Set([
  "postgres",
  "townreporter",
  "townreporter_prod",
  "townreporter_production",
  "townreporter_dev",
  "production",
]);
if (
  !databaseName ||
  forbiddenDatabase.has(databaseName) ||
  databaseName.startsWith("townreporter_dev") ||
  !disposableName
) {
  console.error(`SCANFIX_DATABASE_URL must name a disposable database; refused ${databaseName || "(none)"}.`);
  process.exit(2);
}

const email = process.env.SCANFIX_EMAIL || "staging@townreporter.test";
const password = process.env.SCANFIX_PASSWORD || "staging-walk-2026";
const evidenceDir = resolve(process.env.SCANFIX_ARTIFACT_DIR || "../scan-refresh-evidence");
mkdirSync(evidenceDir, { recursive: true });

const database = new Client({ connectionString: dbUrl });
await database.connect();

// Defense in depth: verify the connected server reports the requested scratch
// database before writing any proof rows. This catches URL/connection defaults
// and makes the target explicit in CI logs without printing credentials.
const connectedDatabase = await database.query("select current_database() as name");
if (String(connectedDatabase.rows[0]?.name || "").toLowerCase() !== databaseName) {
  await database.end();
  throw new Error(`connected to an unexpected database; expected ${databaseName}`);
}

async function sqlScalar(statement) {
  const result = await database.query(statement);
  const first = result.rows[0] ? Object.values(result.rows[0])[0] : "";
  return first == null ? "" : String(first);
}

const done = [];
function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}

async function dump(page, err) {
  const message = err instanceof Error ? err.message : String(err);
  const text = await page?.locator("body").innerText().catch(() => "");
  console.error(`\n  FAILED: ${message}`);
  console.error(`  steps reached: ${done.length ? done.join(" -> ") : "(none)"}`);
  if (text) console.error(`\n  page text (first 1200 chars):\n${text.slice(0, 1200)}`);
  await page?.screenshot({ path: join(evidenceDir, "failure.png"), fullPage: true }).catch(() => {});
}

const browser = await chromium.launch();
const page = await browser.newPage();
let openId = "";
let jobId = "";
let exitCode = 0;

try {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  if (await page.getByRole("button", { name: "Create editor account" }).count()) {
    await page.getByLabel("Name").fill("Scan Refresh Editor");
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create editor account" }).click();
  } else {
    await page.getByRole("button", { name: "Sign in with email" }).click();
  }
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  step("signed in");

  // (the Scan desk is opened below, after the open run exists)

  const newsroomId = await sqlScalar("select newsroom_id from newsroom_members order by newsroom_id limit 1;");
  if (!/^\d+$/.test(newsroomId)) throw new Error(`could not resolve a newsroom_id, got: ${newsroomId}`);
  const userId = await sqlScalar("select user_id from newsroom_members order by created_at limit 1;");
  if (!userId || !/^[0-9a-zA-Z-]+$/.test(userId)) throw new Error(`could not resolve a user_id, got: ${userId}`);

  // Insert an OPEN scan row: no finished_at, no error. Deliberately NOT a real
  // run -- nothing is fetched and no model is called. This reproduces the exact
  // row state the page polls on.
  const openTemplate =
    "insert into scan_runs (newsroom_id, user_id, summary, sources_selected, sources_attempted, " +
    "sources_failed, sources_analyzed, model_batches_used, model_batches_failed, leads_created, " +
    "started_at, execution_origin) values (NEWROOM, USERID, MSG, 0, 0, 0, 0, 0, 0, 0, now(), MANUAL) returning id;";
  openId = await sqlScalar(
    openTemplate
      .replace("NEWROOM", newsroomId)
      .replace("USERID", `'${userId}'`)
      .replace("MSG", "'runtime proof: open run'")
      .replace("MANUAL", "'manual'"),
  );
  if (!openId || !/^\d+$/.test(openId)) throw new Error(`could not insert open run, got: ${openId}`);
  step(`inserted open scan run ${openId}`);

  /*
    A run with no backing job reads as STALLED (runLooksStalled returns true
    when there is no job), and a stalled run deliberately does not show the
    busy state. A real running scan always has a live job behind it, so the
    proof creates one -- otherwise it would be asserting on a state the
    product never actually renders.
  */
  const jobTemplate =
    "insert into desk_jobs (newsroom_id, user_id, kind, subject_id, status, created_at, updated_at) " +
    "values (NEWROOM, USERID, SCANKIND, SUBJECT, RUNNING, now(), now()) returning id;";
  jobId = await sqlScalar(
    jobTemplate
      .replace("NEWROOM", newsroomId)
      .replace("USERID", `'${userId}'`)
      .replace("SCANKIND", "'scan'")
      .replace("SUBJECT", openId)
      .replace("RUNNING", "'running'"),
  );
  if (!jobId || !/^\d+$/.test(jobId)) throw new Error(`could not insert backing job, got: ${jobId}`);
  step(`created live job ${jobId} behind the open run`);

  /*
    Open the Scan desk only now, with the open run already in the database.
    The page starts its 2-second refetch only when its first load sees a run
    that is still open, which is also how it behaves in real use: you press
    Run and the page watches the run it just created.
  */
  await page.goto(`${base}/desk/scan`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1, name: "Scan", exact: true }).waitFor({ timeout: 30_000 });
  step("opened the Scan desk with an open run in place");

  // The page polls every 2s while a row looks open. Give it two intervals.
  const busy = page.locator("text=Fetching accepted sources, then one pass for leads");
  await busy.waitFor({ timeout: 20_000 });
  await page.screenshot({ path: join(evidenceDir, "1-open-run-busy.png"), fullPage: true });
  step("page shows the busy state while the run is open");

  // Now finish that same row. Same id. This is the merge the bug broke.
  await database.query("update scan_runs set finished_at = now(), leads_created = 3, summary = 'runtime proof: finished run' where id = $1", [openId]);
  await database.query("update desk_jobs set status = 'completed', finished_at = now(), updated_at = now() where id = $1", [jobId]);
  step("marked the same run finished in the database");

  // Under the old code the row is dropped on merge and the busy state never
  // clears. Assert it clears within a few refetch intervals.
  await busy.waitFor({ state: "detached", timeout: 30_000 });
  await page.screenshot({ path: join(evidenceDir, "2-finished-run-no-busy.png"), fullPage: true });
  step("page stopped showing the busy state after the run finished (the fix)");

  // And the finished row is the one on screen, with its new values.
  const bodyText = await page.locator("body").innerText();
  if (!/runtime proof: finished run/.test(bodyText)) {
    throw new Error("the finished row's new summary did not reach the screen");
  }
  step("the finished run's updated values reached the screen");

  // Leave the dev database as we found it.
  await database.query("delete from desk_jobs where id = $1", [jobId]);
  await database.query("delete from scan_runs where id = $1", [openId]);
  jobId = "";
  openId = "";
  step("removed the proof rows from the disposable database");

  console.log(`\n  PASS: ${done.length} steps, 0 problems`);
  console.log(`  evidence: ${evidenceDir}`);
} catch (err) {
  await dump(page, err);
  exitCode = 1;
} finally {
  if (jobId) await database.query("delete from desk_jobs where id = $1", [jobId]).catch(() => undefined);
  if (openId) await database.query("delete from scan_runs where id = $1", [openId]).catch(() => undefined);
  await browser.close();
  await database.end();
}

process.exit(exitCode);
