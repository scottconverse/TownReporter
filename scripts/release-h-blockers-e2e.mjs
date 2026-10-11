#!/usr/bin/env node
/**
 * Release H blockers 1, 2 and 4, on the built desk and an in-memory PGlite.
 *
 * This is a real Chromium walk: it creates a throwaway owner, uses the drawn
 * controls, and checks the database rows written by the owner presses. It
 * makes no request to the shared Test, Live or Dev services and runs no real
 * writing model. Build first with `npm run build`, then run this script.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { completeFirstRunSetup, fillPendingSetupCodeIfPresent } from "./first-run-setup-step.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let PORT;
let BASE;
const DATA_ROOT = join(tmpdir(), `townreporter-release-h-blockers-${Date.now()}`);
const OWNER_EMAIL = `release-h-owner-${Date.now()}@townreporter.test`;
const OWNER_PASSWORD = `release-h-${randomBytes(24).toString("base64url")}`;
const FAKE_CODEX = join(DATA_ROOT, "release-h-fake-codex.mjs");
const WRITING_VOICE = (label) => `${label}\n\n${"Use clear, specific, measured civic prose. Attribute claims and opinions to their sources, distinguish what is known from what remains uncertain, and never invent facts or speak for the paper beyond the editor's instructions. ".repeat(5)}`;
const FAKE_EDITORIAL_CLI = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "login" && args[1] === "status") {
  process.stdout.write("Logged in\\n");
  process.exit(0);
}
if (args.includes("exec")) {
  let prompt = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) prompt += chunk;
  const sentence = "A public library is a shared civic resource, and its hours shape whether residents can use it. The council should hear from families, students, workers, and staff before deciding what service levels the budget can sustain.";
  process.stdout.write("Library hours deserve a careful public debate\\n\\n");
  process.stdout.write(Array.from({ length: 18 }, () => sentence).join("\\n\\n") + "\\n");
  process.exit(0);
}
process.stdout.write("ok\\n");
`;

const failures = [];
let browser;
let page;
let sql;

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve an isolated browser-test port.");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function step(name) {
  console.log(`  ok    ${name}`);
}

async function scenario(name, run) {
  try {
    await run();
    step(name);
  } catch (error) {
    failures.push({ name, error: error instanceof Error ? error.message : String(error) });
    console.error(`  FAIL  ${name}: ${failures.at(-1).error}`);
  }
}

async function waitForDesk() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return;
    } catch {
      /* the server is still binding */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The isolated app did not answer on ${BASE}.`);
}

async function waitForMigrations(pg) {
  let previous = -1;
  let quiet = 0;
  for (let i = 0; i < 240 && quiet < 3; i += 1) {
    let count = -1;
    try {
      count = Number((await pg.query("select count(*)::int as n from _migrations")).rows[0]?.n);
    } catch {
      /* bootstrap has not created the migration ledger yet */
    }
    if (count >= 0 && count === previous) quiet += 1;
    else {
      previous = count;
      quiet = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (quiet < 3) throw new Error("The isolated app migrations did not settle.");
  return { query: (text, params = []) => pg.query(text, params).then((result) => result.rows) };
}

async function signInFreshOwner() {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8_000);
  page.setDefaultNavigationTimeout(20_000);
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Create the desk/ }).waitFor();
  await page.getByLabel("Name", { exact: true }).fill("Release H Owner");
  await page.getByLabel("Email", { exact: true }).fill(OWNER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
  await page.getByLabel("Confirm password", { exact: true }).fill(OWNER_PASSWORD);
  await fillPendingSetupCodeIfPresent(page, { dataRoot: DATA_ROOT });
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.waitForURL(/\/desk\/setup/, { timeout: 30_000 });
  await completeFirstRunSetup(page, BASE, { dataRoot: DATA_ROOT });
  await page.getByRole("link", { name: /^Queue\b/ }).waitFor();
}

async function inviteCanBeCancelled() {
  await page.goto(`${BASE}/desk/ops/editors-access`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Invite an editor", exact: true }).waitFor();
  const invitee = `release-h-invite-${Date.now()}@townreporter.test`;
  await page.getByLabel("Their email", { exact: true }).fill(invitee);
  await page.getByRole("button", { name: "Make the invite link", exact: true }).click();
  const linkText = await page.locator("p.break-all").filter({ hasText: "/login?invite=" }).innerText();
  const inviteUrl = linkText.match(/https?:\/\/[^\s]+\/login\?invite=[0-9a-f]+/i)?.[0];
  assert.ok(inviteUrl, "the owner can copy the newly minted link");

  const listHeading = page.getByRole("heading", { name: "Pending invites", exact: true });
  await listHeading.waitFor();
  const row = page.locator("li").filter({ hasText: invitee });
  await row.getByRole("button", { name: "Cancel invite", exact: true }).click();
  await page.getByRole("status").filter({ hasText: /cancelled/i }).waitFor();
  await row.waitFor({ state: "detached" });

  const guest = await browser.newPage();
  await guest.goto(inviteUrl, { waitUntil: "domcontentloaded" });
  await guest.getByText(/invite link is not valid|invite was cancelled/i).waitFor();
  await guest.close();
  step("the pending invite was removed and its copied link no longer opens signup");
}

async function opinionVoiceCanBeSavedAndSkippedSafely() {
  await page.goto(`${BASE}/desk/opinion`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /New editorial/ }).click();
  await page.getByLabel(/Subject/).fill("The library hours proposal");
  const ordinaryWrite = page.getByRole("button", { name: "Write an editorial", exact: true });
  await ordinaryWrite.waitFor();
  assert.equal(await ordinaryWrite.isDisabled(), true, "the ordinary write needs the paper voice");

  const voiceLink = page.getByRole("link", { name: /Paper's editorial voice/ });
  await voiceLink.waitFor();
  await voiceLink.click();
  const voiceBox = page.getByLabel("Paper's editorial voice", { exact: true });
  await voiceBox.waitFor();
  const warning = page.getByText(/neutral house voice/i);
  await warning.waitFor();
  const writeAnyway = page.getByRole("button", { name: "Write anyway", exact: true });
  await writeAnyway.waitFor();
  assert.equal(await writeAnyway.isDisabled(), false, "the missing voice warns but does not block");
  await writeAnyway.click();

  const deadline = Date.now() + 30_000;
  let neutralRequest;
  while (Date.now() < deadline) {
    [neutralRequest] = await sql.query(
      `select voice_mode,draft_id,error,finished_at from editorial_requests where user_id=(select id from "user" where lower(email)=lower($1)) order by id desc limit 1`,
      [OWNER_EMAIL],
    );
    if (neutralRequest?.finished_at) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(neutralRequest?.finished_at, "Write anyway finishes its queued editorial request");
  assert.equal(neutralRequest.voice_mode, "neutral", "the override is carried to the queued request");
  assert.ok(neutralRequest.draft_id, neutralRequest.error ?? "the neutral house voice writes a saved draft");
  assert.equal(neutralRequest.error, null, "the neutral house voice does not block the writing run");

  await page.getByLabel(/Subject/).fill("The library hours proposal with the paper voice");
  const pasted = WRITING_VOICE("Paper voice pasted by the owner");
  await voiceBox.fill(pasted);
  await page.getByRole("button", { name: "Save paper's voice", exact: true }).click();
  await page.getByRole("status").filter({ hasText: /voice is saved/i }).waitFor();
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Write an editorial");
    return Boolean(button && !button.disabled);
  });

  const uploaded = WRITING_VOICE("Paper voice uploaded by the owner");
  await page.getByLabel("Load voice from a text file", { exact: true }).setInputFiles({
    name: "paper-voice.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(uploaded, "utf8"),
  });
  await page.waitForFunction((expected) => {
    const voiceBox = document.querySelector('textarea[aria-label="Paper\'s editorial voice"]');
    return voiceBox instanceof HTMLTextAreaElement && voiceBox.value === expected;
  }, uploaded);
  await assert.equal(await voiceBox.inputValue(), uploaded, "upload fills the same editable voice box");
  await page.getByRole("button", { name: "Save paper's voice", exact: true }).click();
  await page.getByRole("status").filter({ hasText: /voice is saved/i }).waitFor();
  assert.equal(await ordinaryWrite.isDisabled(), false, "saving the voice enables ordinary writing");
  step("the owner saved pasted and uploaded voice text, and the no-voice write used neutral voice");
}

async function largeQueueFiltersRemainClickable() {
  await page.goto(`${BASE}/desk/queue`, { waitUntil: "domcontentloaded" });
  const sectionNames = [
    "Planning and development review",
    "Public works and transportation",
    "Local government and public safety",
    "Education, libraries, and community services",
    "Housing, land use, and neighborhood affairs",
    "Parks, recreation, and environmental quality",
    "Finance, budgeting, and economic development",
  ];
  const sectionStart = Number((await sql.query("select coalesce(max(position), 0) + 1 as n from newsroom_sections where newsroom_id=1"))[0]?.n ?? 1);
  for (const [index, name] of sectionNames.entries()) {
    await sql.query(
      "insert into newsroom_sections (newsroom_id,key,name,position,visible) values (1,$1,$2,$3,true) on conflict (newsroom_id,key) do update set name=excluded.name,position=excluded.position",
      [`release-h-section-${index}`, name, sectionStart + index],
    );
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Switch to large text", exact: true }).click();
  await page.getByRole("button", { name: "Switch to normal text", exact: true }).waitFor();
  assert.equal(
    await page.locator(".desk-ltr").evaluate((desk) => desk.classList.contains("large")),
    true,
    "the browser is actually using Large text",
  );

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const filters = page.getByRole("group", { name: "Filter leads", exact: true });
    const buttons = filters.getByRole("button");
    const count = await buttons.count();
    assert.ok(count >= 4, `the ${width}px Queue keeps every pile button visible`);
    const overlap = await page.evaluate(() => {
      const tabs = document.querySelector(".queue-tabs")?.getBoundingClientRect();
      const search = document.querySelector(".queue-search")?.getBoundingClientRect();
      return Boolean(tabs && search && tabs.right > search.left && tabs.bottom > search.top && search.bottom > tabs.top);
    });
    assert.equal(overlap, false, `Search does not cover any part of the Queue pile buttons at ${width}px`);
    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index);
      await button.click();
      assert.equal(await button.getAttribute("aria-pressed"), "true", `pile ${index} accepts a real click at ${width}px`);
    }
    const search = page.getByRole("searchbox", { name: "Search leads", exact: true });
    await search.fill(`width-${width}`);
    assert.equal(await search.inputValue(), `width-${width}`);
    await page.getByLabel("Sort", { exact: true }).selectOption("newest");
    await page.getByLabel("Section", { exact: true }).selectOption("all");
  }
  step("every pile, Search, Sort and Section accepted clicks at 1440px and 390px with Large text");
}

async function main() {
  mkdirSync(DATA_ROOT, { recursive: true });
  PORT = Number(process.env.RELEASE_H_BLOCKERS_PORT || await reservePort());
  if (!Number.isInteger(PORT) || PORT < 1 || PORT === 3400) {
    throw new Error("The isolated browser test needs a valid port separate from the shared Test service.");
  }
  BASE = `http://127.0.0.1:${PORT}`;
  process.env.PORT = String(PORT);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = "";
  process.env.TOWNREPORTER_DATA_ROOT = DATA_ROOT;
  process.env.TOWNREPORTER_VOICE_FILE = "";
  process.env.TOWNREPORTER_LOCAL_DISCOVERY = "0";
  process.env.TOWNREPORTER_DEEPSEEK = "0";
  process.env.TOWNREPORTER_CODEX = "1";
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.ANTHROPIC_API_KEY = "";
  process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
  writeFileSync(FAKE_CODEX, FAKE_EDITORIAL_CLI, "utf8");
  chmodSync(FAKE_CODEX, 0o755);
  process.env.CODEX_CLI_PATH = FAKE_CODEX;
  process.env.FAKE_CODEX_SIGNED_IN = "1";
  const appLog = console.log.bind(console);
  console.log = (...args) => {
    if (String(args[0] ?? "").startsWith("[setup-code]")) return;
    appLog(...args);
  };
  try {
    await import(pathToFileURL(join(ROOT, ".output", "server", "index.mjs")).href);
    await waitForDesk();
    const pg = await globalThis.__pgliteInstance__;
    if (!pg) throw new Error("The isolated app did not use in-memory PGlite.");
    sql = await waitForMigrations(pg);
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    await signInFreshOwner();

    await scenario("FB13: owner cancels a pending invitation and the copied link stops working", inviteCanBeCancelled);
    await scenario("FB14/FC01: owner sets voice and no-voice writing warns with a neutral fallback", opinionVoiceCanBeSavedAndSkippedSafely);
    await scenario("FC17: Large-text Queue filters remain clickable at desktop and phone widths", largeQueueFiltersRemainClickable);
  } catch (error) {
    failures.push({ name: "isolated browser app setup", error: error instanceof Error ? error.message : String(error) });
    console.error(`  FAIL  isolated browser app setup: ${failures.at(-1).error}`);
  } finally {
    await browser?.close().catch(() => {});
    rmSync(DATA_ROOT, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ ok: failures.length === 0, failures }, null, 2));
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
