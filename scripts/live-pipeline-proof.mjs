#!/usr/bin/env node
/**
 * Nightly scan -> draft against the already-running Test server.
 * Configuration and read-only database discovery: nightly-proof-config.mjs.
 * No server startup, editor staging or publishing. See docs/nightly-proof.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import pg from "pg";
import { resolveProofTarget } from "./nightly-proof-config.mjs";
import { dailyScan } from "./nightly-proof-scan.mjs";
import { storyDraftButton } from "./nightly-proof-actions.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let base;
let editorEmail;
let editorPassword;

const MODEL_LABELS = {
  auto: "Automatic",
  "codex-balanced": "Codex Terra",
  "codex-frontier": "Codex Sol",
  "claude-frontier": "Claude Opus",
  "local-model": "Local model",
};
const labelFor = (choice) => MODEL_LABELS[choice] ?? choice ?? "unknown";

const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const errors = [];

function say(msg) {
  console.log(`[nightly-proof] ${msg}`);
}

// --- the walk -----------------------------------------------------------

async function signIn(page) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  const heading = page.getByRole("heading", { name: /Create the desk|Editor sign-in/ });
  // Keep the honest cold-navigation budget, even with an already-running Test server.
  await heading.waitFor({ timeout: 90_000 });
  if (/Create the desk/.test((await heading.textContent()) ?? "")) {
    throw new Error(
      "the Test desk is unclaimed -- restore its existing owner before running the proof",
    );
  }
  await page.getByLabel("Email").fill(editorEmail);
  await page.getByLabel("Password", { exact: true }).fill(editorPassword);
  await page.getByRole("button", { name: "Sign in with email" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  say("signed in as the Test editor");
}

async function runScan(page, pool) {
  try {
    const row = await dailyScan(page, pool, base);

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
        `${seconds}s, ${row.sources_attempted} attempted, ${row.sources_failed} blocked, ` +
        `${row.model_batches_used} model batch(es), provider ${labelFor(jobRows.rows[0]?.model_choice)}`,
    );
    return {
      ok: true,
      provider: labelFor(jobRows.rows[0]?.model_choice),
      seconds,
      leads: row.leads_created,
      resurfaced: resurfacedRows.rows[0]?.n ?? 0,
      scanRunId: row.id,
      attempted: row.sources_attempted,
      read: row.sources_fetched,
      blocked: row.sources_failed,
      modelBatches: row.model_batches_used,
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
    const draftButton = storyDraftButton(page);
    // Generous, same reason as the /login heading wait in signIn(): a cold
    // Vite route compile under load can run well past 30s.
    await draftButton.waitFor({ timeout: 90_000 });
    await draftButton.click();
    say(`draft started on lead ${lead.id} ("${lead.headline}"), waiting up to 8 minutes`);

    const deadline = Date.now() + 8 * 60_000;
    let landed = false;
    while (Date.now() < deadline) {
      // UI1a3: "Redrafting…" when the story already has a draft body,
      // "Drafting…" when it does not -- accept either.
      const stillDrafting = await page.getByRole("button", { name: /^(Re)?drafting…$/i }).count();
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
  const target = await resolveProofTarget();
  base = target.base;
  editorEmail = target.editorEmail;
  editorPassword = readFileSync(target.passwordFile, "utf8").trim();
  if (!editorPassword) throw new Error("The Test editor password file is empty");
  const pool = new pg.Pool({
    connectionString: target.databaseUrl,
    max: 2,
    password: "",
    options: "-c default_transaction_read_only=on",
  });
  let browser;
  try {
    say(`using the already-running Test server at ${base}`);

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
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  process.exitCode = 1;
});
