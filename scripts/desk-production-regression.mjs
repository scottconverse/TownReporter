#!/usr/bin/env node
/**
 * Authenticated desk regression (directive item 5).
 *
 * Signs in, then walks the six desk surfaces -- Queue, Scan, Sources, Published,
 * Stats, Server -- and fails if any of them is unreachable, renders an error,
 * logs a console/page error, or drops a request.
 *
 * HONEST SAFETY MODEL (see the per-run artifact's `safety` block):
 *   - The SIGNED-IN WALK itself is read-only: it only navigates and reads.
 *   - When DESK_PRODREG_STATE_FILE is unset, the run performs an INTENTIONALLY
 *     MUTATING setup step first: it creates a throwaway owner and completes
 *     first-run setup. That is disclosed in the artifact, never claimed away.
 *   - No-side-effects is enforced against a DISPOSABLE DATABASE via DATABASE_URL
 *     using counts AND deterministic row hashes. If the snapshots cannot be
 *     collected, the run FAILS rather than claiming safety.
 *   - Every browser request is recorded; any mutating method fails the run.
 *
 * NEVER production credentials, never port 3000.
 *
 * Env:
 *   DESK_PRODREG_BASE_URL   required-ish; defaults to http://127.0.0.1:8080
 *   DESK_PRODREG_STATE_FILE optional Playwright storage state for an existing
 *                           test account. When set, the walk signs in via that
 *                           state and does NOT create an owner. When unset, it
 *                           creates its own throwaway owner (disclosed as a
 *                           mutating setup step) on a disposable database.
 *   DESK_PRODREG_ARTIFACT   optional path to write the per-surface JSON artifact.
 *   DATABASE_URL            REQUIRED: a disposable database. Snapshots are
 *                           taken against it before and after the walk.
 */
import { chromium } from "playwright";
import pg from "pg";
import { writeFileSync } from "node:fs";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";
import {
  assertNoMutatingRequests,
  assertNoSideEffects,
  setupStepDisclosure,
  snapshotTableSpecs,
} from "./desk-production-regression-logic.mjs";

const base = checkedUrl(
  process.env.DESK_PRODREG_BASE_URL || "http://127.0.0.1:8080",
).replace(/\/$/, "");
const stateFile = process.env.DESK_PRODREG_STATE_FILE;
const artifactPath = process.env.DESK_PRODREG_ARTIFACT || "desk-production-regression.json";
const usedSetupStep = !stateFile;

const stamp = Date.now();
const email = `prodreg-${stamp}@townreporter.test`;
const password = "prodreg-e2e-pass";

/*
  Deterministic side-effect snapshot. Counts alone cannot catch a row that was
  edited in place, so each table also gets an order-stable md5 over its full row
  set. Requires DATABASE_URL: without it there is nothing to snapshot, and this
  script refuses to claim a safety property it cannot prove.
*/
async function sideEffectSnapshot() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is required: this regression must run against a disposable database so the no-side-effects check can actually fail in CI.",
    );
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const counts = {};
    const hashes = {};
    for (const spec of snapshotTableSpecs()) {
      counts[spec.table] = Number((await client.query(spec.countSql)).rows[0].count);
      hashes[spec.table] = String((await client.query(spec.hashSql)).rows[0].hash);
    }
    return { source: "disposable-db", counts, hashes };
  } finally {
    await client.end();
  }
}

const SURFACES = [
  { name: "Queue", path: "/desk/queue", landmark: /The queue|Draft|Queue/i },
  { name: "Scan", path: "/desk/scan", landmark: /Reporter pass|Run scan/i },
  { name: "Sources", path: "/desk/sources", landmark: /Watch list|Sources/i },
  { name: "Published", path: "/desk/published", landmark: /The record|Published/i },
  { name: "Stats", path: "/desk/stats", landmark: /Site|Stories|Stats/i },
  { name: "Server", path: "/desk/ops", landmark: /Server|Health|Paper setup/i },
];

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = stateFile
  ? await browser.newContext({ storageState: stateFile })
  : await browser.newContext();
const page = await context.newPage();

const consoleErrors = [];
const requestFailures = [];
const observedRequests = [];
const routeHistory = [];

// Actual request interception: record every request method, and fail the run on
// any mutating method once the signed-in walk begins.
let walkStarted = false;
page.on("request", (r) => {
  observedRequests.push({ method: r.method(), url: r.url().slice(0, 200) });
  if (walkStarted && !["GET", "HEAD", "OPTIONS"].includes(r.method().toUpperCase())) {
    requestFailures.push({ url: r.url().slice(0, 200), error: `mutating request ${r.method()}` });
  }
});
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push({ url: page.url(), text: m.text().slice(0, 300) });
});
page.on("pageerror", (e) => {
  consoleErrors.push({ url: page.url(), text: `pageerror: ${String(e.message ?? e).slice(0, 300)}` });
});
page.on("requestfailed", (r) => {
  requestFailures.push({ url: r.url().slice(0, 200), error: r.failure()?.errorText ?? "" });
});
page.on("response", (r) => {
  if (r.status() >= 500) requestFailures.push({ url: r.url().slice(0, 200), error: `HTTP ${r.status()}` });
});

const results = [];
let failure = null;

async function signIn() {
  if (stateFile) {
    await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "A clear desk. A good story.", exact: true })
      .waitFor({ timeout: 30_000 });
    return;
  }
  /*
    Intentionally mutating setup step. It creates a throwaway owner on a
    disposable database and completes first-run setup. Disclosed in the artifact
    as an explicitly mutating step; the read-only claim applies to the signed-in
    walk that follows, not to this setup.
  */
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor({ timeout: 30_000 });
  const createVisible = await page.getByLabel("Confirm password").count();
  if (!createVisible) {
    throw new Error(
      "desk is already claimed (no create-account form). Point DESK_PRODREG_BASE_URL at a disposable environment with an unclaimed desk, or supply DESK_PRODREG_STATE_FILE.",
    );
  }
  await page.getByLabel("Name").fill("ProdReg Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base, { name: "ProdReg Ledger", city: "ProdRegville", state: "Wyoming" });
}

async function walkSurface(surface) {
  const entry = {
    surface: surface.name,
    path: surface.path,
    route: `${base}${surface.path}`,
    status: null,
    landmarkOk: false,
    persistenceOk: null,
    consoleErrors: [],
    requestFailures: [],
    url: null,
    text: "",
  };
  const before = consoleErrors.length;
  const rfBefore = requestFailures.length;
  const resp = await page.goto(`${base}${surface.path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  entry.status = resp?.status() ?? null;
  await page.waitForTimeout(1200);
  entry.url = page.url();
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  entry.text = text.slice(0, 400);
  entry.landmarkOk = surface.landmark.test(text);
  if (!entry.landmarkOk) throw new Error(`${surface.name}: landmark not found on ${surface.path}`);
  if (entry.status && entry.status >= 400) throw new Error(`${surface.name}: HTTP ${entry.status} on ${surface.path}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  entry.persistenceOk = surface.landmark.test(after);
  if (!entry.persistenceOk) throw new Error(`${surface.name}: surface did not persist across reload`);
  entry.consoleErrors = consoleErrors.slice(before);
  entry.requestFailures = requestFailures.slice(rfBefore);
  if (entry.consoleErrors.length) throw new Error(`${surface.name}: console/page errors: ${JSON.stringify(entry.consoleErrors)}`);
  if (entry.requestFailures.length) throw new Error(`${surface.name}: request failures: ${JSON.stringify(entry.requestFailures)}`);
  return entry;
}

let beforeSnapshot = { source: "not-taken", counts: null, hashes: null };
try {
  beforeSnapshot = await sideEffectSnapshot();
  await signIn();
  walkStarted = true;
  routeHistory.push(page.url());
  for (const surface of SURFACES) {
    results.push(await walkSurface(surface));
  }
  assertNoMutatingRequests(observedRequests.filter((r) => r.method !== "GET" && r.method !== "HEAD" && r.method !== "OPTIONS"));
  const afterSnapshot = await sideEffectSnapshot();
  const sideEffects = assertNoSideEffects(beforeSnapshot, afterSnapshot);
  const safety = {
    walkIsReadOnly: true,
    setupStep: setupStepDisclosure(usedSetupStep),
    snapshotSource: beforeSnapshot.source,
    snapshotTables: Object.keys(beforeSnapshot.counts ?? {}),
    snapshotMethod: "count(*) plus order-stable md5 over full row set",
    mutatingRequests: [],
  };
  const artifact = {
    ok: true,
    base,
    mode: stateFile ? "existing-test-account" : "throwaway-owner-with-disclosed-mutating-setup",
    safety,
    surfaces: results,
    consoleErrors,
    requestFailures,
    routeHistory,
    sideEffects,
    sideEffectSnapshots: { before: beforeSnapshot, after: afterSnapshot },
  };
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify({
    ok: true,
    mode: artifact.mode,
    safety,
    surfaces: results.map((r) => ({ surface: r.surface, status: r.status, landmarkOk: r.landmarkOk, persistenceOk: r.persistenceOk })),
    artifact: artifactPath,
  }, null, 2));
} catch (err) {
  failure = err instanceof Error ? err.message : String(err);
  const artifact = {
    ok: false,
    base,
    mode: stateFile ? "existing-test-account" : "throwaway-owner-with-disclosed-mutating-setup",
    error: failure,
    safety: {
      walkIsReadOnly: walkStarted,
      setupStep: setupStepDisclosure(usedSetupStep),
      snapshotSource: beforeSnapshot.source,
      mutatingRequests: observedRequests.filter((r) => !["GET", "HEAD", "OPTIONS"].includes(r.method.toUpperCase())),
    },
    surfaces: results,
    consoleErrors,
    requestFailures,
    routeHistory,
    sideEffectSnapshots: { before: beforeSnapshot, after: null },
    currentUrl: (() => { try { return page.url(); } catch { return ""; } })(),
  };
  try { writeFileSync(artifactPath, JSON.stringify(artifact, null, 2)); } catch { /* best effort */ }
  console.error(JSON.stringify(artifact, null, 2));
} finally {
  await browser.close();
}

if (failure) process.exit(1);
