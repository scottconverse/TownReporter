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
 *   SCANFIX_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/townreporter_dev \\
 *   node scripts/scan-refresh-runtime-proof.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { checkedUrl } from "./browser-guard.mjs";

const base = checkedUrl(
  process.env.SCANFIX_BASE_URL || "http://127.0.0.1:3491",
).replace(/\/$/, "");

const dbUrl = process.env.SCANFIX_DATABASE_URL;
if (!dbUrl) {
  console.error("SCANFIX_DATABASE_URL is required (dev database only).");
  process.exit(2);
}

const psqlBin = process.env.SCANFIX_PSQL || "psql";
// townreporter_dev already has an editor, so the desk shows sign-in rather
// than first-run setup. The staging account is created by ops/stage.ps1 into
// townreporter_dev only; see docs/staging.md.
const email = process.env.SCANFIX_EMAIL || "staging@townreporter.test";
const password = process.env.SCANFIX_PASSWORD || "staging-walk-2026";
const evidenceDir = resolve(process.env.SCANFIX_ARTIFACT_DIR || "../scan-refresh-evidence");
mkdirSync(evidenceDir, { recursive: true });

function sql(statement) {
  return execFileSync(psqlBin, [dbUrl, "-tAc", statement], { encoding: "utf8" }).trim();
}

// psql appends a command status line (INSERT 0 1) to -tAc output, so take the
// first line that is a bare integer -- the returned id -- not the last line.
function sqlScalar(statement) {
  const lines = sql(statement).split(/\r?\n/).map((l) => l.trim());
  return lines.find((l) => /^-?\d+$/.test(l)) || "";
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
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage();

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

  const newsroomId = sql("select newsroom_id from scan_runs order by id desc limit 1;") || "1";
  const userId = sql("select user_id from newsroom_members order by created_at limit 1;");
  if (!userId || !/^[0-9a-zA-Z-]+$/.test(userId)) throw new Error(`could not resolve a user_id, got: ${userId}`);

  // Insert an OPEN scan row: no finished_at, no error. Deliberately NOT a real
  // run -- nothing is fetched and no model is called. This reproduces the exact
  // row state the page polls on.
  const openTemplate =
    "insert into scan_runs (newsroom_id, user_id, summary, sources_selected, sources_attempted, " +
    "sources_failed, sources_analyzed, model_batches_used, model_batches_failed, leads_created, " +
    "started_at, execution_origin) values (NEWROOM, USERID, MSG, 0, 0, 0, 0, 0, 0, 0, now(), MANUAL) returning id;";
  const openId = sqlScalar(
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
  const jobId = sqlScalar(
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
  sql(`update scan_runs set finished_at = now(), leads_created = 3, summary = 'runtime proof: finished run' where id = ${openId};`);
  sql(`update desk_jobs set status = 'completed', finished_at = now(), updated_at = now() where id = ${jobId};`);
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
  sql(`delete from desk_jobs where id = ${jobId};`);
  sql(`delete from scan_runs where id = ${openId};`);
  step("removed the proof rows from the dev database");

  console.log(`\n  PASS: ${done.length} steps, 0 problems`);
  console.log(`  evidence: ${evidenceDir}`);
  await browser.close();
  process.exit(0);
} catch (err) {
  await dump(page, err);
}
