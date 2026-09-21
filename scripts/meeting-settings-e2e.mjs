/*
  N-1 proof: drive the real Meeting capture panel in the built server and show
  the DB rows change. Requires an UNCLAIMED desk and a running built server.
    N1_BASE_URL=http://127.0.0.1:3500 node scripts/meeting-settings-e2e.mjs
*/
import { chromium } from "playwright";
import { Client } from "pg";

const base = (process.env.N1_BASE_URL || "http://127.0.0.1:3500").replace(/\/$/, "");
const dbUrl = process.env.DATABASE_URL;
const stamp = Date.now();
const email = `n1-${stamp}@townreporter.test`;
const password = "n1-e2e-pass-12345";

const pg = new Client({ connectionString: dbUrl });
await pg.connect();
const out = { steps: [], problems: [] };
const step = (s) => { out.steps.push(s); console.log("STEP " + s); };
const fail = (s) => { out.problems.push(s); console.log("PROBLEM " + s); };

async function newsroomId() {
  const r = await pg.query("select id from newsrooms order by id limit 1");
  return r.rows[0]?.id ?? 1;
}
async function channels(nid) {
  const r = await pg.query("select channel_url,position from meeting_channel_priority where newsroom_id=$1 order by position", [nid]);
  return r.rows;
}
async function settings(nid) {
  const r = await pg.query("select storage_root,retention_mode,enabled from meeting_capture_settings where newsroom_id=$1", [nid]);
  return r.rows[0] ?? null;
}

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", (e) => fail("pageerror: " + e.message));

try {
  // Own the desk.
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Name").fill("N1 Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45000 });
  step("owner created");

  const nid = await newsroomId();

  // Open Server page -> Meeting capture.
  await page.goto(`${base}/desk/ops`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Meeting capture", exact: true }).click();
  await page.getByRole("heading", { name: "Meeting capture" }).waitFor({ timeout: 20000 });
  step("Meeting capture panel renders");

  const storageDir = process.env.N1_STORAGE || "C:/Users/scott/Desktop/Code/townreporter-reliability-0651/work/n1-storage";

  // --- GOOD SAVE ---
  await page.getByLabel("Meeting capture enabled").check();
  await page.getByLabel("New meeting channel URL").fill("https://www.youtube.com/@CityofLongmont");
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByLabel("Storage root").fill(storageDir);
  await page.getByLabel("Retention mode").selectOption("audio-only");
  await page.getByRole("button", { name: "Save meeting capture settings" }).click();
  await page.getByText("Saved.", { exact: true }).waitFor({ timeout: 20000 });
  const ch1 = await channels(nid);
  const st1 = await settings(nid);
  out.goodSave = { channels: ch1, settings: st1 };
  if (!ch1.length || ch1[0].channel_url !== "https://www.youtube.com/@CityofLongmont") fail("channel row not written");
  if (!st1 || st1.retention_mode !== "audio-only" || st1.enabled !== true) fail("settings row not written");
  step("good save wrote rows: " + JSON.stringify(out.goodSave));

  const alertText = async () => {
    try { return (await page.getByRole("alert").textContent({ timeout: 3000 })) ?? ""; } catch { return ""; }
  };
  const saveAndReadAlert = async (previous) => {
    await page.getByRole("button", { name: "Save meeting capture settings" }).click();
    const deadline = Date.now() + 20000;
    let current = await alertText();
    while (Date.now() < deadline) {
      if (current && current !== previous) return current;
      await page.waitForTimeout(250);
      current = await alertText();
    }
    return current;
  };

  // --- REJECT: relative storage root ---
  await page.getByLabel("Storage root").fill("relative/root");
  const errA = await saveAndReadAlert("");
  out.rejectRelative = errA;
  step("relative root rejected: " + errA);
  if (!/absolute/i.test(errA || "")) fail("relative root error did not mention absolute");

  // --- REJECT: non-YouTube channel ---
  await page.getByLabel("Storage root").fill(storageDir);
  await page.getByLabel("New meeting channel URL").fill("https://example.com/@nope");
  await page.getByRole("button", { name: "Add" }).click();
  const errB = await saveAndReadAlert(errA);
  out.rejectChannel = errB;
  step("non-YouTube channel rejected: " + errB);
  if (!/YouTube/i.test(errB || "")) fail("channel error did not mention YouTube");
  await page.getByRole("button", { name: "Remove" }).last().click();

  // --- REJECT: unwritable root ---
  const unwritable = process.env.N1_UNWRITABLE || "Z:/definitely/not/a/real/drive/n1";
  await page.getByLabel("Storage root").fill(unwritable);
  const errC = await saveAndReadAlert(errB);
  out.rejectUnwritable = errC;
  step("unwritable root attempted (" + unwritable + "): " + errC);
  if (!/not writable|Could not create/i.test(errC || "")) fail("unwritable root error missing actual failure text");

  // --- REORDER: add a second channel and move it up, prove position changes ---
  await page.getByLabel("Storage root").fill(storageDir);
  await page.getByLabel("Retention mode").selectOption("transcript-only");
  await page.getByLabel("New meeting channel URL").fill("https://www.youtube.com/@LongmontChannelTwo");
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("button", { name: "Move up" }).last().click();
  const good2 = await saveAndReadAlert(errC);
  const chReorder = await channels(nid);
  out.reorderChannels = chReorder;
  step("reorder saved: " + JSON.stringify(chReorder) + " alert=" + good2);
  if (chReorder.length !== 2) fail("expected 2 channels after add");
  if (chReorder[0]?.channel_url !== "https://www.youtube.com/@LongmontChannelTwo") fail("reorder did not put the second channel first");

  // Confirm the good save persisted after the failed attempts.
  out.finalChannels = await channels(nid);
  out.finalSettings = await settings(nid);
} catch (e) {
  fail("driver error: " + (e instanceof Error ? e.message : String(e)));
} finally {
  await browser.close();
  await pg.end();
}

console.log("RESULT " + JSON.stringify(out, null, 2));
if (out.problems.length) process.exitCode = 1;
