#!/usr/bin/env node
/**
 * The nightly proof: scan -> draft, with a REAL model, run automatically.
 *
 * Every other e2e walk in this repo is deliberately model-free (fake CLIs,
 * see scripts/fakes/) so CI never spends money or depends on a login. This
 * is the one script that is allowed to be neither: it drives the real
 * Claude Code / Codex CLIs the operator is actually signed in to, against a
 * disposable copy of real production data, and proves the expensive path
 * that CI structurally cannot.
 *
 * It:
 *   1. Starts its OWN dev server on port 3318, with DATABASE_URL pointed at
 *      townreporter_dev (NEVER the live database -- assertDevDatabase below
 *      is the one guard between this script and the real one).
 *   2. Signs in as the staging editor (staging@townreporter.test, created by
 *      scripts/stage-editor.mjs -- run that first so the account exists).
 *   3. Runs one Scan on Automatic, waits up to 6 minutes.
 *   4. Picks the newest draftable lead, runs Draft with AI on Automatic,
 *      waits up to 8 minutes.
 *   5. STOPS. Never publishes -- publishing on the dev copy is fine but
 *      pointless for a proof; the draft existing is the proof.
 *   6. Writes artifacts/nightly/<YYYY-MM-DD>.json and artifacts/nightly/LATEST.txt.
 *
 * The two provider details a screen does not show (which concrete model ran,
 * how long it took) are read directly from desk_jobs / scan_runs / drafts in
 * townreporter_dev after each phase completes -- the same database the app
 * itself just wrote, queried the same way scripts/stage-editor.mjs already
 * does (a plain `pg` connection, no server-only app code imported).
 *
 * Usage:
 *   node scripts/stage-editor.mjs   # once, if the staging account is missing
 *   node scripts/live-pipeline-proof.mjs
 *
 * DATABASE_URL, if set, MUST name townreporter_dev -- this script refuses
 * anything else, the same guard scripts/stage-editor.mjs uses. Unset, it
 * defaults to postgres://postgres@127.0.0.1:5433/townreporter_dev.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import pg from "pg";
import { checkedUrl } from "./browser-guard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** This walk's own listen port, registered with scripts/integration-ports-are-unique.test.mjs. */
const PORT_LIVE_PIPELINE = 3318;

const DEV_DB_NAME = "townreporter_dev";
const databaseUrl = process.env.DATABASE_URL || `postgres://postgres@127.0.0.1:5433/${DEV_DB_NAME}`;

/** Same guard scripts/stage-editor.mjs uses. Refuses anything but townreporter_dev by name. */
function assertDevDatabase(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`DATABASE_URL does not parse as a URL: ${url}`);
  }
  const dbName = parsed.pathname.replace(/^\//, "");
  if (dbName !== DEV_DB_NAME) {
    throw new Error(
      `DATABASE_URL names database '${dbName}', not '${DEV_DB_NAME}'. This proof only ever ` +
        `runs against the disposable dev copy -- refusing.`,
    );
  }
}
assertDevDatabase(databaseUrl);

const base = checkedUrl(
  process.env.LIVE_PIPELINE_BASE_URL || `http://127.0.0.1:${PORT_LIVE_PIPELINE}`,
).replace(/\/$/, "");
const selfManagedServer = !process.env.LIVE_PIPELINE_BASE_URL;

const STAGING_EMAIL = "staging@townreporter.test";
const STAGING_PASSWORD = "staging-walk-2026";

const MODEL_LABELS = {
  auto: "Automatic",
  "codex-balanced": "Codex Terra",
  "codex-frontier": "Codex Sol",
  "claude-frontier": "Claude Opus",
};
const labelFor = (choice) => MODEL_LABELS[choice] ?? choice ?? "unknown";

const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const errors = [];

function say(msg) {
  console.log(`[nightly-proof] ${msg}`);
}

// --- own dev server, started and stopped by this script ---------------------

let devProc = null;

async function waitForUp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok || res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
}

async function startDevServer() {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  say(`starting the dev server on ${base} (DATABASE_URL -> ${DEV_DB_NAME})`);
  devProc = spawn(npmCmd, ["run", "dev", "--", "--port", String(PORT_LIVE_PIPELINE)], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PORT: String(PORT_LIVE_PIPELINE),
      HOST: "127.0.0.1",
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET || "nightly-proof-secret-not-for-production",
      TOWNREPORTER_TUNNEL: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    // npm ships as npm.cmd on Windows; Node cannot exec a .cmd without a
    // shell (same reason cli-spawn.server.ts hands a .mjs to node directly
    // instead of the OS -- see that file's own comment for the general
    // shape of this problem).
    shell: process.platform === "win32",
  });
  const log = [];
  devProc.stdout?.on("data", (d) => log.push(String(d)));
  devProc.stderr?.on("data", (d) => log.push(String(d)));
  const up = await waitForUp(`${base}/`, 120_000);
  if (!up) {
    throw new Error(
      `dev server did not come up on ${base} within 120s. Last output:\n${log.join("").slice(-4000)}`,
    );
  }
  say("dev server is up");
}

/** Kill the whole process tree, never by image name -- see automatic-failover-e2e's kill_tree. */
function stopDevServer() {
  if (!devProc || devProc.pid == null) return Promise.resolve();
  const pid = devProc.pid;
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        /* already gone */
      }
      resolve();
    }
  });
}

// --- the walk -----------------------------------------------------------

async function signIn(page) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  const heading = page.getByRole("heading", { name: /Create the desk|Editor sign-in/ });
  // A generous timeout: this is the FIRST navigation against a dev server
  // that just started, and Vite compiles each route on demand -- the /login
  // route bundle plus hydration measured well under a minute warm, but a
  // cold first hit under load can run past 45s.
  await heading.waitFor({ timeout: 90_000 });
  if (/Create the desk/.test((await heading.textContent()) ?? "")) {
    throw new Error(
      "the desk is unclaimed on this database -- run `node scripts/stage-editor.mjs` " +
        "against townreporter_dev first (it upserts the staging editor into an " +
        "already-owned desk; it cannot claim an unowned one)",
    );
  }
  await page.getByLabel("Email").fill(STAGING_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(STAGING_PASSWORD);
  await page.getByRole("button", { name: "Sign in with email" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  say("signed in as the staging editor");
}

async function runScan(page, pool) {
  try {
    await page.goto(`${base}/desk/scan`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Run scan$/ }).click();
    say("scan started, waiting up to 6 minutes");

    const deadline = Date.now() + 6 * 60_000;
    let landed = false;
    while (Date.now() < deadline) {
      if (await page.getByText("The desk cannot scan yet.").count()) {
        const detail = await page
          .locator(".notice, [class*='notice']")
          .first()
          .innerText()
          .catch(() => "refused before starting");
        throw new Error(`scan refused: ${detail.slice(0, 400)}`);
      }
      const stillRunning = await page.getByRole("button", { name: /^Scanning sources…$/ }).count();
      const idle = await page.getByRole("button", { name: /^Run scan$/ }).count();
      if (!stillRunning && idle) {
        landed = true;
        break;
      }
      await page.waitForTimeout(3_000);
    }
    if (!landed) throw new Error("scan did not finish within 6 minutes");

    const { rows } = await pool.query(
      `select id, started_at, finished_at, sources_fetched, leads_created, sources_proposed,
              summary, error
       from scan_runs order by started_at desc limit 1`,
    );
    const row = rows[0];
    if (!row) throw new Error("scan appeared to finish but no scan_runs row exists");
    if (row.error) throw new Error(`scan_runs recorded an error: ${row.error}`);

    const jobRows = await pool.query(
      `select model_choice from desk_jobs where kind = 'scan' and subject_id = $1
       order by id desc limit 1`,
      [row.id],
    );
    const resurfacedRows = await pool.query(
      `select count(*)::int as n from leads where last_resurfaced_scan_run_id = $1`,
      [row.id],
    );
    const seconds =
      row.finished_at && row.started_at
        ? Math.round((new Date(row.finished_at) - new Date(row.started_at)) / 100) / 10
        : null;

    say(
      `scan done: ${row.leads_created} lead(s), ${row.sources_fetched} source(s) fetched, ` +
        `${seconds}s, provider ${labelFor(jobRows.rows[0]?.model_choice)}`,
    );
    return {
      ok: true,
      provider: labelFor(jobRows.rows[0]?.model_choice),
      seconds,
      leads: row.leads_created,
      resurfaced: resurfacedRows.rows[0]?.n ?? 0,
      sourcesFetched: row.sources_fetched,
      summary: row.summary,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`scan: ${msg}`);
    say(`scan FAILED: ${msg}`);
    return { ok: false, provider: null, seconds: null, leads: 0, resurfaced: 0 };
  }
}

async function runDraft(page, pool) {
  try {
    const { rows: leadRows } = await pool.query(
      `select id, headline from leads where status not in ('killed', 'published')
       order by created_at desc limit 1`,
    );
    const lead = leadRows[0];
    if (!lead) throw new Error("no draftable lead exists (none new, none drafted-not-published)");

    await page.goto(`${base}/desk/story/${lead.id}`, { waitUntil: "networkidle" });
    /*
      Do NOT wait for the "Body" field here. `fileLead` (a hand-filed lead)
      inserts an empty `drafts` row up front so the edit form (Headline /
      Dek / Body / Topic) renders immediately -- but a lead that came from
      Scan has no `drafts` row at all until a draft actually lands, so the
      story page shows an EmptyState ("No draft yet...") with only the
      Draft with AI button, and no Body label exists to wait for. The
      button itself is present in both cases; that is the stable target.
    */
    const draftButton = page.getByRole("button", { name: /^Draft with AI$|^Redraft$/ });
    // Generous, same reason as the /login heading wait in signIn(): a cold
    // Vite route compile under load can run well past 30s.
    await draftButton.waitFor({ timeout: 90_000 });
    await draftButton.click();
    say(`draft started on lead ${lead.id} ("${lead.headline}"), waiting up to 8 minutes`);

    const deadline = Date.now() + 8 * 60_000;
    let landed = false;
    while (Date.now() < deadline) {
      const stillDrafting = await page.getByRole("button", { name: /^Drafting…$/ }).count();
      const done = await page.getByRole("button", { name: /^Redraft$/ }).count();
      if (!stillDrafting && done) {
        landed = true;
        break;
      }
      await page.waitForTimeout(3_000);
    }
    if (!landed) throw new Error("draft did not land within 8 minutes");

    const { rows: jobRows } = await pool.query(
      `select model_choice, started_at, finished_at, error from desk_jobs
       where kind = 'draft' and subject_id = $1 order by id desc limit 1`,
      [lead.id],
    );
    const job = jobRows[0];
    if (!job) throw new Error("draft appeared to land but no desk_jobs row exists");
    if (job.error) throw new Error(`desk_jobs recorded an error: ${job.error}`);

    const { rows: draftRows } = await pool.query(
      `select length(body) as chars from drafts where lead_id = $1 order by updated_at desc limit 1`,
      [lead.id],
    );
    const seconds =
      job.finished_at && job.started_at
        ? Math.round((new Date(job.finished_at) - new Date(job.started_at)) / 100) / 10
        : null;

    say(
      `draft done: ${draftRows[0]?.chars ?? 0} chars, ${seconds}s, provider ${labelFor(job.model_choice)}`,
    );
    return {
      ok: true,
      provider: labelFor(job.model_choice),
      seconds,
      chars: draftRows[0]?.chars ?? 0,
      leadId: lead.id,
      headline: lead.headline,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`draft: ${msg}`);
    say(`draft FAILED: ${msg}`);
    return { ok: false, provider: null, seconds: null, chars: 0 };
  }
}

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  let browser;
  try {
    if (selfManagedServer) await startDevServer();
    else say(`using an already-running server at ${base} (LIVE_PIPELINE_BASE_URL set)`);

    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage();
    page.setDefaultTimeout(90_000);

    await signIn(page);
    const scan = await runScan(page, pool);
    const draft = await runDraft(page, pool);

    const artifact = { ranAt: new Date().toISOString(), version, scan, draft, errors };

    const outDir = join(ROOT, "artifacts", "nightly");
    mkdirSync(outDir, { recursive: true });
    const dateStamp = artifact.ranAt.slice(0, 10);
    const outFile = join(outDir, `${dateStamp}.json`);
    writeFileSync(outFile, JSON.stringify(artifact, null, 2) + "\n", "utf8");
    writeFileSync(join(outDir, "LATEST.txt"), `${dateStamp}.json\n`, "utf8");
    say(`wrote ${outFile}`);

    console.log(JSON.stringify(artifact, null, 2));
    if (!scan.ok || !draft.ok) process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
    await pool.end().catch(() => {});
    if (selfManagedServer) await stopDevServer();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  process.exitCode = 1;
});
