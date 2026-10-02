#!/usr/bin/env node
/*
  FB1 evidence: a RUNNING SCAN drawn by the real JobCard, on the built server.

  What this walk is for, in the owner's own terms:

    - the Scan screen's card while the scan is still reading the wire, with the
      live count ("Reading sources — 7 of 20"), the chip row, the elapsed clock,
      "last activity" and Cancel;
    - the Sources screen's card and its live "N fetched" row for the same run;
    - Today's "Running now" strip and the nav's Running box, both of which draw
      a scan now -- they could not before FB1, because both readers filtered it
      out.

  HOW THE SCAN IS MADE TO LAST. Not with a slow model -- the writing pass is
  only part of the run, and the fake CLIs answer instantly -- but with sources
  that do not answer at all: `https://192.0.2.1/` is TEST-NET-1, a reserved
  documentation range that is routable-looking to the URL guard and blackholed
  by every network. Each fetch therefore sits until its own timeout, which is
  exactly the shape the owner was complaining about: a scan whose fetch pass is
  minutes long and whose screen said nothing.

  Deliberately LIGHT on the browser. A polling loop that read the DOM twice a
  second crashed the headless shell under load on this machine -- a property of
  the harness, not of the page -- so the timings here are fixed and generous.

  Usage:
    TOWNREPORTER_DATA_ROOT=... FB1_BASE_URL=http://127.0.0.1:8481 \
      node scripts/fb1/fb1-scan-shots.mjs
*/
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { completeFirstRunSetup, fillPendingSetupCodeIfPresent } from "../first-run-setup-step.mjs";

const BASE = (process.env.FB1_BASE_URL || "http://127.0.0.1:8481").replace(/\/$/, "");
const OUT = resolve(
  process.env.FB1_SHOTS_DIR || "C:/Users/scott/Desktop/Code/townreporter-coord/fb1-shots/v2",
);
const SLOW_SOURCES = Number(process.env.FB1_SLOW_SOURCES || 12);
mkdirSync(OUT, { recursive: true });

const stamp = Date.now();
const email = process.env.FB1_EMAIL || `fb1-shots-${stamp}@townreporter.test`;
const password = process.env.FB1_PASSWORD || "fb1-shots-e2e-pass";

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const problems = [];
page.on("pageerror", (e) => problems.push(String(e).slice(0, 200)));
page.on("crash", () => problems.push("PAGE CRASHED"));

const shot = async (name) => {
  await page.screenshot({ path: resolve(OUT, name) });
  console.log(`shot  ${name}  <- ${page.url()}`);
};

async function ownTheDesk() {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  if (await page.getByLabel("Name").count()) {
    await page.getByLabel("Name").fill("FB1 Shots Editor");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await fillPendingSetupCodeIfPresent(page);
    await page.getByRole("button", { name: "Create editor account" }).click();
  } else {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: /Sign in with email/ }).click();
  }
  await page.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, BASE);
}

async function addSource(url, title) {
  await page.goto(`${BASE}/desk/sources`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "+ Add a source", exact: true }).click();
  await page.getByLabel("Link", { exact: true }).fill(url);
  await page.getByLabel("Name", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Add & run first check", exact: true }).click();
  await page
    .locator("p.note")
    .filter({ hasText: /Added .+ to the watch list/ })
    .waitFor({ timeout: 45_000 });
  await page.keyboard.press("Escape");
}

try {
  await ownTheDesk();
  console.log("desk owned:", email);
  if (process.env.FB1_SKIP_SOURCES !== "1") {
    await addSource(`https://example.com/?fb1-fast=${stamp}`, "FB1 fast fixture");
    await addSource(`https://example.com/?fb1-fast2=${stamp}`, "FB1 fast fixture 2");
    for (let n = 1; n <= SLOW_SOURCES; n += 1) {
      await addSource(`https://192.0.2.1/fb1-slow-${n}`, `FB1 unreachable source ${n}`);
    }
  }
  console.log(`sources ready (2 reachable, ${SLOW_SOURCES} unreachable)`);

  await page.goto(`${BASE}/desk/scan`, { waitUntil: "networkidle" });
  /*
    A MODEL THAT ANSWERS SLOWLY, CHOSEN EXPLICITLY.

    The scan's Automatic ladder is DeepSeek, then the on-device model, then
    Codex -- none of which this fixture server has set up, so Automatic is
    refused here ("The desk cannot scan yet"). Claude Sonnet IS set up (the fake
    CLI reports a signed-in session), and FAKE_CLAUDE_DELAY_MS holds the writing
    pass open for two minutes, which is what gives this walk a scan to
    photograph.

    The picker is the SECOND select in `.scan-bar` (the first is the scan
    scope); `selectOption` needs the option's exact label, so the value is read
    out of the DOM rather than guessed.
  */
  const modelPicker = page.locator(".scan-bar select").nth(1);
  await modelPicker.waitFor({ timeout: 20_000 });
  const readOption = () =>
    modelPicker.evaluate((el) => {
      const hit = [...el.options].find((o) => /Claude Sonnet/.test(o.textContent || ""));
      return hit ? hit.value : "";
    });
  let claudeSonnet = "";
  // The options arrive with a query, after the select itself exists.
  for (let attempt = 0; attempt < 24 && !claudeSonnet; attempt += 1) {
    claudeSonnet = await readOption();
    if (!claudeSonnet) await page.waitForTimeout(500);
  }
  if (claudeSonnet) {
    await modelPicker.selectOption(claudeSonnet);
    console.log("scan pinned to Claude Sonnet (the slow fake)");
  } else {
    // Not fatal: Automatic is a real choice, and the fetch pass is what this
    // walk is photographing. Said out loud rather than swallowed.
    console.log("NOTE: the picker offered no Claude Sonnet; leaving Automatic");
  }

  /*
    PRESS UNTIL IT TAKES. The scan is refused outright when no rung of the
    editor's model is ready, which on this fixture server depends on whether a
    fake CLI is currently signed in. Three presses, then it is a failure worth
    reporting rather than a silent no-op.
  */
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.getByRole("button", { name: /Run scan/ }).first().click();
    await page.waitForTimeout(4000);
    const body = await page.locator("body").innerText();
    if (!/The desk cannot scan yet/.test(body)) {
      console.log(`pressed Run scan (attempt ${attempt})`);
      break;
    }
    console.log(`attempt ${attempt}: the desk refused the scan; retrying`);
    if (attempt === 3) throw new Error(`the desk refused every scan press: ${body.slice(-400)}`);
  }

  // The fetch pass: the two reachable pages come back, the rest sit until
  // their own timeout, and the card counts them as it goes.
  await page.waitForTimeout(9000);
  await shot("scan-jobcard-counting.png");
  await page.waitForTimeout(14000);
  await shot("scan-jobcard.png");

  /*
    FB1b, item 3, PROVED IN A BROWSER: the card the press produced is inside the
    panel the press was made in. `.astra-panel.hot` is the yellow-bordered
    "Run a scan" panel; the card used to render as its next sibling, below the
    fold. A failure here is the whole item, so it throws.
  */
  const inPanel = await page.evaluate(() => {
    const card = document.querySelector(".scan-job-card .job-card");
    const panel = document.querySelector(".astra-panel.hot");
    return Boolean(card && panel && panel.contains(card));
  });
  if (!inPanel) throw new Error("the running scan's card is not inside the Run-scan panel");
  console.log("ok    the card renders inside the Run-scan panel");
  const aboveTheFold = await page.evaluate(() => {
    const card = document.querySelector(".scan-job-card");
    return card ? card.getBoundingClientRect().top < window.innerHeight : false;
  });
  if (!aboveTheFold) throw new Error("the card is below the fold on the screen that started it");
  console.log("ok    the card is in view where the button was pressed");

  /*
    FB1b, item 1, MEASURED: one title, not wrapping, not overflowing.

    "It ellipsised instead of wrapping" is not a property of the markup, so it
    is measured: the nav's card title must be `nowrap`/`hidden`, and the box it
    sits in must not push the page sideways.
  */
  const railTitle = await page.evaluate(() => {
    const el = document.querySelector(".astra-running .job-card-title");
    if (!el) return null;
    const style = getComputedStyle(el);
    return {
      text: el.textContent || "",
      whiteSpace: style.whiteSpace,
      overflow: style.overflow,
      height: el.getBoundingClientRect().height,
      lineHeight: parseFloat(style.lineHeight) || 0,
    };
  });
  if (!railTitle) throw new Error("the nav's Running box drew no card title");
  if (railTitle.whiteSpace !== "nowrap" || railTitle.overflow !== "hidden")
    throw new Error(`the rail's title is not a single ellipsised line: ${JSON.stringify(railTitle)}`);
  if (railTitle.lineHeight && railTitle.height > railTitle.lineHeight * 1.6)
    throw new Error(`the rail's title wrapped: ${JSON.stringify(railTitle)}`);
  const railText = await page.locator(".astra-running").innerText();
  const repeats = railText.split(railTitle.text).length - 1;
  if (repeats !== 1) throw new Error(`the nav box draws "${railTitle.text}" ${repeats} times`);
  console.log("ok    the nav box draws one title, on one line");

  /*
    FB1b, item 5: LIGHT THEME, AND PHONE WIDTH.

    The same card, twice more: in light (the tokens flip, and a border or a
    muted colour that only works on dark is the classic thing to miss), and at
    390px, where the whole page must still fit -- `scrollWidth` wider than the
    viewport is the overflow the coordinator asked about.
  */
  const noOverflow = async (label) => {
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (over > 1) throw new Error(`${label}: the page overflows by ${over}px`);
    console.log(`ok    ${label}: no horizontal overflow`);
  };

  /*
    The footer controls carry aria-labels, which ARE their accessible names --
    the visible word is only the label text beside them. Dark mode is the desk
    default, so the press that switches to light is the one labelled
    "Switch to light appearance".
  */
  await page.getByLabel("Switch to light appearance").first().click();
  await page.waitForTimeout(800);
  await shot("scan-jobcard-light.png");
  await noOverflow("desktop light");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1200);
  await shot("scan-jobcard-phone.png");
  await noOverflow("phone 390");

  // The nav at phone width is the drawer, and the Running box is at the top of
  // it -- the narrowest place this card is ever drawn.
  /* UI1b-5: renamed from `{ name: "Open navigation" }` -- the phone menu is a
     labelled "Menu" button now (see desk-chrome.tsx). */
  const phoneMenu = page.getByRole("button", { name: "Menu", exact: true });
  if (await phoneMenu.count()) {
    await phoneMenu.click();
    await page.waitForTimeout(900);
    await shot("nav-running-box-phone.png");
    await noOverflow("phone 390 with the nav open");
  } else {
    console.log("NOTE: no phone nav button; the drawer was not photographed");
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByLabel("Switch to dark appearance").first().click().catch(() => undefined);
  await page.waitForTimeout(600);

  await page.goto(`${BASE}/desk/sources`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await shot("sources-jobcard-live-count.png");

  await page.goto(`${BASE}/desk`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await shot("today-running-now.png");

  await page.goto(`${BASE}/desk/scan`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const cancel = page.getByRole("button", { name: "Cancel", exact: true }).first();
  if (await cancel.count()) {
    await cancel.click();
    await page.waitForTimeout(2500);
    await shot("scan-jobcard-cancelling.png");
  } else {
    console.log("NOTE: no Cancel button was on the scan card");
  }

  console.log(JSON.stringify({ ok: true, email, pageErrors: problems }, null, 2));
} catch (error) {
  console.log("ERROR:", String(error).slice(0, 400));
  try {
    await shot("scan-jobcard-FAILURE.png");
  } catch (shotError) {
    console.log("failure screenshot also failed:", String(shotError).slice(0, 120));
  }
  console.log(JSON.stringify({ ok: false, pageErrors: problems }, null, 2));
} finally {
  await browser.close();
}
