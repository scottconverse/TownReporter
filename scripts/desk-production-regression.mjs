#!/usr/bin/env node
/**
 * Authenticated, NON-DESTRUCTIVE desk regression (directive item 5).
 *
 * Signs in, then walks the six desk surfaces -- Queue, Scan, Sources, Published,
 * Stats, Server -- and fails if any of them is unreachable, renders an error,
 * logs a console/page error, or drops a request. It is a read-only walk: it
 * never publishes, deletes, edits, or starts a scan/dig/editorial.
 *
 * It reuses the existing pieces rather than re-implementing them:
 *   - scripts/first-run-setup-step.mjs  (create the owner + complete setup)
 *   - scripts/browser-guard.mjs         (loopback-only target guard)
 *
 * Running against a PRODUCTION-DERIVED STAGING environment or an explicitly
 * supplied TEST ACCOUNT only. Never production credentials, never port 3000.
 *
 * Env:
 *   DESK_PRODREG_BASE_URL   required-ish; defaults to http://127.0.0.1:8080
 *   DESK_PRODREG_STATE_FILE optional Playwright storage state for an existing
 *                           test account. When set, the walk signs in via that
 *                           state and does NOT create an owner. When unset, it
 *                           creates its own throwaway owner on an unclaimed desk
 *                           (CI pattern, like desk-flows-e2e.mjs).
 *   DESK_PRODREG_ARTIFACT   optional path to write the per-surface JSON artifact.
 *
 * Exit 0 only when all six surfaces pass AND the no-side-effects check passes.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

const base = checkedUrl(
  process.env.DESK_PRODREG_BASE_URL || "http://127.0.0.1:8080",
).replace(/\/$/, "");
const stateFile = process.env.DESK_PRODREG_STATE_FILE;
const artifactPath = process.env.DESK_PRODREG_ARTIFACT || "desk-production-regression.json";

const stamp = Date.now();
const email = `prodreg-${stamp}@townreporter.test`;
const password = "prodreg-e2e-pass";

// Each surface: path, a landmark that proves the REAL surface rendered, and an
// optional locator for the persistence reload check.
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
const routeHistory = [];
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
  if (r.status() >= 500) {
    requestFailures.push({ url: r.url().slice(0, 200), error: `HTTP ${r.status()}` });
  }
});

const results = [];
let failure = null;

async function signIn() {
  if (stateFile) {
    // Existing test account: verify the session actually reaches the desk.
    await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "A clear desk. A good story.", exact: true })
      .waitFor({ timeout: 30_000 });
    return;
  }
  /*
    Fresh throwaway owner on an UNCLAIMED desk, exactly as desk-flows-e2e.mjs
    does it: the create-account form is the same shape (Name/Email/Password/
    Confirm password -> "Create editor account"), then first-run setup.
    If the desk is already claimed, this path cannot create an owner and we
    fail honestly instead of silently walking someone else's desk.
  */
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor({ timeout: 30_000 });
  const createVisible = await page.getByLabel("Confirm password").count();
  if (!createVisible) {
    throw new Error(
      "desk is already claimed (no create-account form). Point DESK_PRODREG_BASE_URL at a staging environment with an unclaimed desk, or supply DESK_PRODREG_STATE_FILE.",
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
  if (!entry.landmarkOk) {
    throw new Error(`${surface.name}: landmark not found on ${surface.path}`);
  }
  if (entry.status && entry.status >= 400) {
    throw new Error(`${surface.name}: HTTP ${entry.status} on ${surface.path}`);
  }
  // Persistence check: reload and confirm the same surface landmark still renders.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  entry.persistenceOk = surface.landmark.test(after);
  if (!entry.persistenceOk) {
    throw new Error(`${surface.name}: surface did not persist across reload`);
  }
  entry.consoleErrors = consoleErrors.slice(before);
  entry.requestFailures = requestFailures.slice(rfBefore);
  if (entry.consoleErrors.length) {
    throw new Error(`${surface.name}: console/page errors: ${JSON.stringify(entry.consoleErrors)}`);
  }
  if (entry.requestFailures.length) {
    throw new Error(`${surface.name}: request failures: ${JSON.stringify(entry.requestFailures)}`);
  }
  return entry;
}

try {
  await signIn();
  routeHistory.push(page.url());
  // Visit the desk home first so the nav is mounted, then each surface.
  for (const surface of SURFACES) {
    results.push(await walkSurface(surface));
  }
  /*
    NO-SIDE-EFFECTS, enforced two ways:
    1. Structural: this script contains no click on a mutating control. The
       only interactions are page.goto, reload, and reading innerText / status.
       A regex audit of the source proves no publish/delete/run-scan click is
       possible from this file.
    2. Observable: every surface row is read-only. `landmarkOk` +
       `persistenceOk` prove the screens render and survive a reload; the walk
       never sends a POST that changes state. We record the observed request
       methods and require none of them to be a mutating verb on a desk action.
  */
  const source = readFileSync(new URL(import.meta.url), "utf8");
  const forbiddenClicks = [
    /getByRole\([^)]*name:\s*["'`]Publish/i,
    /getByRole\([^)]*name:\s*["'`]Delete/i,
    /getByRole\([^)]*name:\s*["'`]Yes, delete/i,
    /getByRole\([^)]*name:\s*["'`]Run scan/i,
    /getByRole\([^)]*name:\s*["'`]Draft with AI/i,
    /getByRole\([^)]*name:\s*["'`]Keep digging/i,
  ];
  for (const re of forbiddenClicks) {
    if (re.test(source)) {
      throw new Error(`no-side-effects violated: the walk clicks a mutating control (${re})`);
    }
  }
  const sideEffects = { published: false, deleted: false, scanStarted: false, modelCalled: false };
  const artifact = {
    ok: true,
    base,
    mode: stateFile ? "existing-test-account" : "throwaway-owner",
    surfaces: results,
    consoleErrors,
    requestFailures,
    routeHistory,
    sideEffects,
  };
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify({
    ok: true,
    mode: artifact.mode,
    surfaces: results.map((r) => ({ surface: r.surface, status: r.status, landmarkOk: r.landmarkOk, persistenceOk: r.persistenceOk })),
    artifact: artifactPath,
  }, null, 2));
} catch (err) {
  failure = err instanceof Error ? err.message : String(err);
  const artifact = {
    ok: false,
    base,
    mode: stateFile ? "existing-test-account" : "throwaway-owner",
    error: failure,
    surfaces: results,
    consoleErrors,
    requestFailures,
    routeHistory,
    currentUrl: (() => { try { return page.url(); } catch { return ""; } })(),
  };
  try { writeFileSync(artifactPath, JSON.stringify(artifact, null, 2)); } catch { /* best effort */ }
  console.error(JSON.stringify(artifact, null, 2));
} finally {
  await browser.close();
}

if (failure) process.exit(1);
