/*
  N-2 proof: drive "Run meetings now" twice + a forced re-capture through the
  built server UI, and show the scan_runs rows and capture records.
    N2_BASE_URL=http://127.0.0.1:3500 node scripts/meeting-manual-run-e2e.mjs
*/
import { chromium } from "playwright";
import { Client } from "pg";

const base = (process.env.N2_BASE_URL || "http://127.0.0.1:3500").replace(/\/$/, "");
const dbUrl = process.env.DATABASE_URL;
const stamp = Date.now();
const email = `n2-${stamp}@townreporter.test`;
const password = "n2-e2e-pass-12345";

const pg = new Client({ connectionString: dbUrl });
await pg.connect();
const out = { steps: [], problems: [] };
const step = (s) => { out.steps.push(s); console.log("STEP " + s); };
const fail = (s) => { out.problems.push(s); console.log("PROBLEM " + s); };

const q = async (sql, params) => (await pg.query(sql, params)).rows;
const nid = async () => (await q("select id from newsrooms order by id limit 1"))[0]?.id ?? 1;
const manualRuns = async (n) => q("select id,execution_origin,daily_reservation_id,forced_recapture,meetings_found,meetings_captured,meetings_failed,summary from scan_runs where newsroom_id=$1 and execution_origin='manual' order by id", [n]);
const captures = async (n) => q("select video_id,status,caption_sha256,coalesce(forced_recapture,false) as forced,prior_caption_sha256 from meeting_capture_records where newsroom_id=$1 order by video_id", [n]);

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", (e) => fail("pageerror: " + e.message));

try {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Name").fill("N2 Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45000 });
  step("owner created");
  const n = await nid();

  await page.goto(`${base}/desk/ops`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Meeting capture", exact: true }).click();
  await page.getByRole("heading", { name: "Meeting capture" }).waitFor({ timeout: 20000 });
  step("panel renders");

  // RUN 1
  await page.getByRole("button", { name: "Run meetings now" }).click();
  await page.getByText(/Run #\d+:/).waitFor({ timeout: 600000 });
  const r1 = await manualRuns(n);
  const c1 = await captures(n);
  out.run1 = { runs: r1, captures: c1 };
  step("run1 done: runs=" + r1.length + " captures=" + c1.length);

  // RUN 2 (same local day) -> must add a second manual row, not re-capture
  await page.getByRole("button", { name: "Run meetings now" }).click();
  await page.waitForTimeout(2000);
  // wait for a second manual row to appear
  const deadline = Date.now() + 600000;
  let r2 = await manualRuns(n);
  while (r2.length < r1.length + 1 && Date.now() < deadline) { await page.waitForTimeout(2000); r2 = await manualRuns(n); }
  const c2 = await captures(n);
  out.run2 = { runs: r2, captures: c2 };
  step("run2 done: runs=" + r2.length + " captures=" + c2.length);

  // no-recapture: capture set identical between run1 and run2
  const key = (rows) => JSON.stringify(rows.map((r) => [r.video_id, r.status, r.caption_sha256]));
  if (key(c1) !== key(c2)) fail("capture records changed between manual runs (re-capture happened)");
  else step("captures unchanged across the two manual runs");

  // provenance
  for (const row of r2) {
    if (row.execution_origin !== "manual") fail("run " + row.id + " execution_origin != manual");
    if (row.daily_reservation_id !== null) fail("run " + row.id + " has a daily_reservation_id");
  }
  // no daily reservation consumed/created
  const res = await q("select count(*)::int as n from daily_scan_reservations");
  out.dailyReservations = res[0].n;
  step("daily_scan_reservations count = " + res[0].n);

  // FORCED RE-CAPTURE of the first captured meeting
  const target = c2.find((r) => r.status === "captured");
  if (!target) fail("no captured meeting to force");
  else {
    const meta = await q("select channel_url,title,published from meeting_capture_records where newsroom_id=$1 and video_id=$2", [n, target.video_id]);
    out.forceTarget = { ...target, ...meta[0] };
    await page.getByLabel("Force video id").fill(target.video_id);
    await page.getByLabel("Force channel URL").fill(meta[0].channel_url);
    await page.getByLabel("Force meeting title").fill(meta[0].title);
    await page.getByLabel("Force meeting date").fill(meta[0].published);
    await page.getByRole("button", { name: "Force re-capture meeting" }).click();
    await page.getByText(/forced re-capture/i).waitFor({ timeout: 600000 });
    const after = await q("select video_id,caption_sha256,forced_recapture,forced_recapture_at,prior_caption_sha256 from meeting_capture_records where newsroom_id=$1 and video_id=$2", [n, target.video_id]);
    out.forceAfter = after[0];
    step("forced recapture: prior=" + target.caption_sha256 + " new=" + after[0].caption_sha256 + " forced=" + after[0].forced_recapture);
    if (after[0].forced_recapture !== true) fail("forced_recapture not recorded");
    if (after[0].prior_caption_sha256 !== target.caption_sha256) fail("prior caption hash not preserved");
  }

  out.finalManualRuns = await manualRuns(n);
} catch (e) {
  fail("driver error: " + (e instanceof Error ? e.message : String(e)));
} finally {
  await browser.close();
  await pg.end();
}

console.log("RESULT " + JSON.stringify(out, null, 2));
if (out.problems.length) process.exitCode = 1;
