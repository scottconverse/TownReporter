/*
  N-1 proof: drive the real Meeting capture panel in the built server and show
  the stored configuration change -- and stay put when a save is refused.

  WHAT CHANGED, AND WHY.

  This script was written against a live candidate on the author's machine: it
  ran a real `pg` client against `DATABASE_URL`, took its storage root from a
  `C:/Users/...` default, and proved its refusals with `Z:/definitely/not/a/...`
  -- a path that only fails on Windows. It was run by hand once and then by
  nothing: no CI job drives the Meeting capture panel in a browser, which is
  the gap this file now fills.

  None of that could run in CI. So it reads back the way its sibling walks do
  (`scripts/sources-desk-e2e.mjs`): RELOAD the panel and read what the desk
  says the newsroom's configuration now is. That is the same claim -- the row
  was written, and the screen agrees -- made through the product instead of
  around it, on any built server, Postgres or PGlite.

  Two properties the original could not state are stated now, because the
  readback makes them cheap:

    - a REFUSED save writes NOTHING. The server validates every channel and
      the storage root before it writes a row ("Validate every channel URL up
      front so a bad one never half-writes", src/lib/news/meeting-settings.ts),
      and each refusal below is followed by a reload that has to still show the
      last good state;
    - the storage-root refusal does not depend on the machine. The unwritable
      root is a path under a REGULAR FILE (`<work>/not-a-directory/n1`), so
      `mkdir` fails with ENOTDIR on Linux, macOS and Windows alike, instead of
      relying on `Z:` not existing.

  The server boots in THIS process on in-memory PGlite, on a port of its own
  (scripts/integration-ports-are-unique.test.mjs), so nothing here needs a
  running app, a database service, or a network.
*/
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { fillPendingSetupCodeIfPresent } from "./first-run-setup-step.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** This walk's own listen port; see scripts/integration-ports-are-unique.test.mjs. */
const PORT_MEETING_SETTINGS = 3583;

const base = checkedUrl(`http://127.0.0.1:${PORT_MEETING_SETTINGS}`);
const stamp = Date.now();
const email = `n1-${stamp}@townreporter.test`;
const password = "n1-e2e-pass-12345";

/** Everything this walk creates lives here, and is removed on the way out. */
const WORK = join(tmpdir(), `townreporter-meeting-settings-${stamp}`);
/** A real folder the panel may keep -- the panel creates it on save. */
const STORAGE = join(WORK, "n1-storage");
/**
 * A path nothing can create: its PARENT is a regular file, so `mkdir` fails
 * with ENOTDIR wherever this runs. The original used `Z:/...`, which only ever
 * failed on Windows.
 */
const NOT_A_DIRECTORY = join(WORK, "not-a-directory");
const UNWRITABLE = join(NOT_A_DIRECTORY, "n1");

const GOOD_CHANNEL = "https://www.youtube.com/@CityofLongmont";
const SECOND_CHANNEL = "https://www.youtube.com/@LongmontChannelTwo";
/** Not a YouTube URL at all -- refused before anything is written. */
const BAD_CHANNEL = "https://example.com/@nope";

const out = { steps: [], problems: [] };
const step = (s) => {
  out.steps.push(s);
  console.log("STEP " + s);
};
const fail = (s) => {
  out.problems.push(s);
  console.log("PROBLEM " + s);
};

/** Boot the built server here, in this process, on its own port and database. */
async function bootTheServer() {
  process.env.PORT = String(PORT_MEETING_SETTINGS);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.BETTER_AUTH_SECRET ||= "meeting-settings-e2e-secret";
  await import(pathToFileURL(join(REPO, ".output/server/index.mjs")).href);
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the built server never answered on ${base}`);
}

let page;

/** Open the Meeting capture screen and wait for its own heading. */
async function openThePanel() {
  await page.goto(`${base}/desk/ops/meeting-capture`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Meeting capture" }).waitFor({ timeout: 30_000 });
}

/**
 * What the desk says the newsroom's configuration IS, read off the panel after
 * a reload.
 *
 * The reload is the point: the form's own React state would answer with
 * whatever was last typed, whether or not anything was stored.
 */
async function readPanel() {
  await openThePanel();
  const root = page.locator("#ops-panel-meeting-capture");
  return {
    enabled: await root.getByLabel("Meeting capture enabled").isChecked(),
    storageRoot: await root.getByLabel("Storage root").inputValue(),
    retention: await root.getByLabel("Retention mode").inputValue(),
    /*
      The URL each channel row prints. Read through the row's own Remove
      button rather than a styling class, so a restyle cannot make this
      silently read one span too few.
    */
    channels: await root.locator('button[aria-label="Remove"]').evaluateAll((buttons) =>
      buttons.map((b) => b.parentElement?.querySelector("span")?.textContent?.trim() ?? ""),
    ),
  };
}

/** The panel's own refusal sentence, or "" while it is showing none. */
async function alertText() {
  const alerts = page.locator('#ops-panel-meeting-capture [role="alert"]');
  if ((await alerts.count()) === 0) return "";
  return ((await alerts.first().innerText()) ?? "").trim();
}

/**
 * Press Save and wait for the panel to say something NEW, then return it.
 *
 * Every call site below arrives here straight after a `readPanel()`, which
 * navigates and clears any alert the panel was showing -- so a non-empty
 * alert can only be this press's answer, never a sentence left over from the
 * attempt before it.
 */
async function saveAndReadAlert() {
  await page.getByRole("button", { name: "Save meeting capture settings" }).click();
  const deadline = Date.now() + 20_000;
  let current = await alertText();
  while (Date.now() < deadline) {
    if (current) return current;
    await page.waitForTimeout(250);
    current = await alertText();
  }
  return current;
}

async function saveAndWaitForSaved() {
  await page.getByRole("button", { name: "Save meeting capture settings" }).click();
  await page.getByText("Saved.", { exact: true }).waitFor({ timeout: 20_000 });
}

/**
 * The stored configuration must be exactly this, or the walk says what it
 * found. Compared field by field, not as stringified objects -- the readback's
 * key order is whatever `readPanel` builds, and a comparison that depends on
 * it would fail on a reordering of this file that changed nothing.
 */
function expectStored(got, want, what) {
  let ok = true;
  for (const [field, value] of Object.entries(want)) {
    if (JSON.stringify(got[field]) !== JSON.stringify(value)) {
      fail(`${what}: stored ${field} is ${JSON.stringify(got[field])}, expected ${JSON.stringify(value)}`);
      ok = false;
    }
  }
  return ok;
}

const browser = await chromium.launch({ args: ["--no-sandbox"] });

try {
  mkdirSync(WORK, { recursive: true });
  // A regular file where a folder would have to be -- see UNWRITABLE above.
  writeFileSync(NOT_A_DIRECTORY, "a file, not a directory\n", "utf8");

  await bootTheServer();
  step("the built server answers on its own port, over its own PGlite");

  page = await browser.newPage();
  page.setDefaultTimeout(45_000);
  page.on("pageerror", (e) => fail("pageerror: " + e.message));

  // Own the desk.
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Name").fill("N1 Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await fillPendingSetupCodeIfPresent(page);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 45_000 });
  step("owner created");

  await openThePanel();
  step("Meeting capture panel renders");

  // --- GOOD SAVE ---
  await page.getByLabel("Meeting capture enabled").check();
  await page.getByLabel("New meeting channel URL").fill(GOOD_CHANNEL);
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByLabel("Storage root").fill(STORAGE);
  await page.getByLabel("Retention mode").selectOption("audio-only");
  await saveAndWaitForSaved();
  const good = {
    channels: [GOOD_CHANNEL],
    enabled: true,
    retention: "audio-only",
    storageRoot: STORAGE,
  };
  const st1 = await readPanel();
  out.goodSave = st1;
  expectStored(st1, good, "the good save");
  step("good save persisted, read back off the panel: " + JSON.stringify(st1));

  // --- REJECT: relative storage root ---
  await page.getByLabel("Storage root").fill("relative/root");
  const errA = await saveAndReadAlert();
  out.rejectRelative = errA;
  step("relative root rejected: " + errA);
  if (!/absolute/i.test(errA)) fail("relative root error did not mention absolute");
  const afterA = await readPanel();
  expectStored(afterA, good, "the refused relative root");
  step("the refused save wrote nothing: the panel still shows the last good state");

  // --- REJECT: non-YouTube channel ---
  await page.getByLabel("New meeting channel URL").fill(BAD_CHANNEL);
  await page.getByRole("button", { name: "Add" }).click();
  const errB = await saveAndReadAlert();
  out.rejectChannel = errB;
  step("non-YouTube channel rejected: " + errB);
  if (!/YouTube/i.test(errB)) fail("channel error did not mention YouTube");
  const afterB = await readPanel();
  expectStored(afterB, good, "the refused channel");
  step("the refused channel is not in the stored list");

  // --- REJECT: unwritable root ---
  await page.getByLabel("Storage root").fill(UNWRITABLE);
  const errC = await saveAndReadAlert();
  out.rejectUnwritable = errC;
  step("unwritable root attempted (" + UNWRITABLE + "): " + errC);
  if (!/not writable|Could not create/i.test(errC)) {
    fail("unwritable root error missing actual failure text");
  }
  const afterC = await readPanel();
  expectStored(afterC, good, "the refused unwritable root");

  // --- REORDER: add a second channel, move it up, prove the order persists ---
  await page.getByLabel("Storage root").fill(STORAGE);
  await page.getByLabel("Retention mode").selectOption("transcript-only");
  await page.getByLabel("New meeting channel URL").fill(SECOND_CHANNEL);
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("button", { name: "Move up" }).last().click();
  await saveAndWaitForSaved();
  const reorder = await readPanel();
  out.reorderChannels = reorder.channels;
  step("reorder persisted: " + JSON.stringify(reorder));
  expectStored(
    reorder,
    {
      channels: [SECOND_CHANNEL, GOOD_CHANNEL],
      enabled: true,
      retention: "transcript-only",
      storageRoot: STORAGE,
    },
    "the reorder save",
  );
} catch (e) {
  fail("driver error: " + (e instanceof Error ? e.message : String(e)));
} finally {
  await browser.close().catch(() => {});
  rmSync(WORK, { recursive: true, force: true });
}

console.log("RESULT " + JSON.stringify(out, null, 2));
/*
  Exit BY CODE, never by letting the event loop drain: the server this walk
  booted is listening in this process, so an `exitCode`-only ending leaves node
  alive with an open port and the step never finishes -- which is how the first
  run of this file sat for ten minutes after printing its result.
*/
process.exit(out.problems.length ? 1 : 0);
