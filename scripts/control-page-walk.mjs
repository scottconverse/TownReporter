#!/usr/bin/env node
/**
 * The Control page, walked the way the owner will use it (0.6.65, Unit AG).
 *
 * `ops/control/control-server.mjs` replaces the terminal menu with a local page:
 * one line saying whether the paper is up, the same six buttons the menu
 * offered, and a status that refreshes itself. It is also the only thing in this
 * repository that puts a POST-to-loopback button in front of a browser, which is
 * why the security properties get their own node:test file
 * (scripts/control-page-server.test.mjs).
 *
 * This walk is about the other half: the page as a thing a person reads at
 * night. The owner's own constraints are the checks -- dark by default, nothing
 * under 16px, buttons big enough to hit, every control reachable by keyboard,
 * and a visible answer the instant a button is pressed rather than after the
 * work finishes. Those are measurements here, not inspections: the font floor
 * and the button heights come from `getComputedStyle` on every element in the
 * document, and "Working..." is timed inside the page, because the handler runs
 * synchronously and a round trip to the driver cannot time a same-frame update.
 *
 * Two checks come straight from the coordinator's review of the first version
 * (2026-09-25), and both are claims about pixels rather than about code: no card
 * may wear the healthy green over an answer it could not read, and the one
 * button that takes the paper offline may not be painted like the five that do
 * not -- in either theme.
 *
 * THE ACTION IS FAKE, DELIBERATELY. The server's `runner` seam is injected with
 * a stub, so the restart this walk presses emits two lines and flips a flag in
 * this process. Nothing is spawned, no scheduled task is touched, and the live
 * paper on this machine is not reachable from here -- which is the only way a
 * walk that presses "Restart the Reddit reader" is safe to run on the machine
 * that serves the paper. The stub still ASSERTS the argv vector it was handed:
 * that is how the walk proves the button labelled with the menu's words really
 * runs `redlib.ps1 restart` and carries no argument from the request.
 *
 *   node scripts/control-page-walk.mjs
 *
 * Port 3505, which no other integration file may bind
 * (scripts/integration-ports-are-unique.test.mjs). The page's real port is 3095;
 * a walk binding that would collide with a Control page the owner has open.
 */
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { createControlServer } from "../ops/control/control-server.mjs";

/** This walk's own listen port. */
const PORT_CONTROL_PAGE = 3505;

const base = checkedUrl(`http://127.0.0.1:${PORT_CONTROL_PAGE}`).replace(/\/$/, "");

/** The two surfaces the page paints itself, as its stylesheet paints them. */
const DARK = { hex: "#10161a", rgb: "rgb(16, 22, 26)" };
const LIGHT = { hex: "#f6f1e7", rgb: "rgb(246, 241, 231)" };

/** The owner's floor: nothing on this page may be smaller than this. */
const MIN_FONT_PX = 16;
const MIN_TARGET_PX = 44;

/** What this process hands the page instead of the real install's state. */
const world = {
  redditDown: true,
  /** Every argv vector the action table tried to run, for the assertions below. */
  spawns: [],
};

/**
 * The one action this walk presses, as the action table defines it: PowerShell,
 * then `redlib.ps1 restart`. Read here so the stub can refuse an argv that is not
 * this, rather than the walk asserting against a phrase it typed twice.
 */
const REDLIB = "redlib.ps1";

/**
 * The status the page renders, built the shape `ops/status.ps1 -Json` prints.
 *
 * The Reddit row is marked REQUIRED here on purpose, which it is not in the real
 * status: the walk needs the one thing it is about to fix to be the one thing the
 * count is about, so that "Everything is up" afterwards is evidence the page
 * re-read a status that changed. An optional row would leave the count where it
 * was and prove nothing.
 */
function fakeStatus() {
  const checks = [
    { id: "database", label: "Database", state: "ok", ok: true, optional: false, detail: "answering on 5433", fix: null },
    { id: "paper", label: "The paper", state: "ok", ok: true, optional: false, detail: "answered on port 3000", fix: "restart-paper" },
    { id: "tunnel", label: "Tunnel", state: "ok", ok: true, optional: false, detail: "connected", fix: "restart-tunnel" },
    { id: "public-site", label: "Public site", state: "ok", ok: true, optional: false, detail: "answered 200", fix: "restart-tunnel" },
    { id: "watchdog", label: "Watchdog", state: "ok", ok: true, optional: false, detail: "last looked 2 minutes ago", fix: null },
    {
      id: "reddit-reader",
      label: "Reddit reader (Redlib)",
      state: world.redditDown ? "down" : "ok",
      ok: !world.redditDown,
      optional: false, // required in this fixture -- see the comment above
      detail: world.redditDown
        ? "down - Reddit threads read as headlines only"
        : "answering Reddit again",
      fix: "restart-reddit",
    },
  ];
  const faults = checks.filter((c) => c.state === "down");
  return {
    checkedAt: new Date().toISOString(),
    attention: faults.length,
    headline: faults.length
      ? `${faults.length} thing${faults.length === 1 ? "" : "s"} need${faults.length === 1 ? "s" : ""} attention`
      : "Everything is up",
    advice: faults.length ? "Try the Reddit reader restart." : "",
    root: "C:\\Users\\scott\\Desktop\\Code\\townreporter-web",
    checks,
    extras: [
      { id: "version", label: "Version", state: "ok", ok: true, optional: true, detail: "0.6.66", fix: null },
      { id: "backup", label: "Last backup", state: "ok", ok: true, optional: true, detail: "townreporter.sql, 3 hours ago", fix: null },
      // The copy on the other drive and the Attention card, in the states a
      // healthy machine shows them: copies verified, nothing firing. Both are
      // built the way the real probes build them, 12-hour local time and all,
      // so the wording checks below are about the page rather than the fixture.
      {
        id: "offsite",
        label: "Copy on D:",
        state: "ok",
        ok: true,
        optional: true,
        detail: "3 copies on D:\\TownReporter-backups; checked today at 2:04 AM; 4.3 TB free",
        fix: null,
      },
      // The staged copy after a reboot: everything on disk, nothing answering,
      // no start tried yet. This is the one row on the page that offers to
      // start something, and behind its button is ops\start-stage.ps1 -- so the
      // words are asserted and the button is never pressed. See theTestCopyRow.
      {
        id: "test-copy",
        label: "Test copy on 3100",
        state: "note",
        ok: false,
        optional: true,
        detail: "staged in townreporter-deepseek-2 (version 0.6.66) and nothing is answering on 127.0.0.1:3100; no start has been tried yet",
        fix: "start-test-copy",
        fixLabel: "Start the test copy",
      },
      // The model server row, in the state a working machine shows it. The
      // name in the detail is the loaded model's own (0.6.69, Unit AL item 4):
      // the rung that runs on this computer runs whatever is loaded, so the
      // card names it instead of checking for one vendor's model.
      { id: "qwen", label: "Model server (LM Studio)", state: "ok", ok: true, optional: true, detail: "halo/qwen3.6-35b-a3b is loaded", fix: null },
      // The card this walk's first new check is about: a probe that could not
      // read its answer. It is a Note, and it must never be painted green --
      // "OK: Could not read the last scan" was the bug the coordinator found.
      {
        id: "last-scan",
        label: "Last scan",
        state: "note",
        ok: false,
        optional: true,
        detail: "could not reach the database",
        fix: null,
      },
      {
        id: "alerts",
        label: "Attention",
        state: "ok",
        ok: true,
        optional: true,
        detail: "Nothing needs attention (last checked today at 3:05 PM)",
        fix: null,
      },
    ],
  };
}

/**
 * Stands in for `spawnFixed`. It records the argv vector, emits the two lines a
 * reader restart prints, and flips the flag the status is built from -- so the
 * page's own refresh is what shows the change.
 */
async function fakeRunner(step, { onOutput } = {}) {
  // The full executable path is kept, not its basename: the walk's job is to
  // prove the action table handed spawn an absolute System32 path, and a
  // basename would have thrown that away before it could be checked.
  const argv = [step.exe, ...step.args].join(" ");
  world.spawns.push(argv);
  if (/redlib\.ps1/.test(argv)) {
    onOutput?.("Waiting for the Reddit reader to answer...");
    await new Promise((r) => setTimeout(r, 900));
    world.redditDown = false;
    onOutput?.("The Reddit reader answered in 1.2 seconds. Reddit threads read full again.");
    await new Promise((r) => setTimeout(r, 300));
  }
  return { code: 0, output: [] };
}

let page;
const done = [];
const facts = [];
/** Every console error and page exception, for the whole run. */
const noise = [];

function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

async function bootTheServer() {
  const server = createControlServer({
    port: PORT_CONTROL_PAGE,
    host: "127.0.0.1",
    writePidFile: false,
    pidFile: null,
    collect: async () => fakeStatus(),
    runner: fakeRunner,
    // The action table waits out real settle times for real restarts. Nothing
    // restarts here, so nothing waits -- and the walk's own stub already takes
    // 1.2 seconds, which is what makes "Working..." observable.
    settle: async () => {},
  });
  const address = await server.listen();
  return { server, port: address.port };
}

/* ─────────────────────────── the checks ─────────────────────────── */

/** One full page load, with the console watched. */
async function openThePage() {
  await page.goto(`${base}/`, { waitUntil: "load", timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const h = document.getElementById("headline");
      return !!h && h.textContent !== "Reading the status...";
    },
    undefined,
    { timeout: 15_000 },
  );
}

/** Dark is the default: no stored choice, and the page still opens dark. */
async function darkByDefault(theme) {
  must((await theme.getAttribute("data-theme")) === "dark", "the page did not open in dark");
  const stored = await page.evaluate(() => localStorage.getItem("townreporter.control.theme"));
  must(stored === null, `a fresh browser had a theme already stored: ${stored}`);
  const painted = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  must(
    painted === DARK.rgb,
    `the page says dark but painted ${painted}; the attribute is not what the operator sees`,
  );
  step(`the page opens dark, and the canvas is really ${DARK.hex}`);
}

/** The toggle, the repaint, and the choice surviving a real reload. */
async function theLightToggle() {
  await page.getByRole("button", { name: /appearance$/ }).click();
  await page.waitForFunction(
    () => document.documentElement.getAttribute("data-theme") === "light",
    undefined,
    { timeout: 10_000 },
  );
  const painted = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  must(painted === LIGHT.rgb, `the toggle said light but the canvas stayed ${painted}`);
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#headline", { timeout: 15_000 });
  const after = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  must(after === "light", `the choice did not survive the reload: the page came back ${after}`);
  const repainted = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  must(repainted === LIGHT.rgb, `after the reload the page said light but painted ${repainted}`);
  step("the light toggle repaints, and the choice survives a reload");

  // Back to dark, so every later measurement is taken on the default the owner
  // gets -- and so the walk leaves nothing behind in this context.
  await page.getByRole("button", { name: /appearance$/ }).click();
  await page.waitForFunction(
    () => document.documentElement.getAttribute("data-theme") === "dark",
    undefined,
    { timeout: 10_000 },
  );
}

/**
 * The font floor and the target size, measured on every element in the document
 * rather than on a list of selectors somebody remembered to update.
 */
async function measureEveryElement() {
  const measured = await page.evaluate(
    ([minFontPx, minTargetPx]) => {
      const smallest = { px: Infinity, what: "", text: "" };
      const tiny = [];
      const small = [];
      for (const el of document.querySelectorAll("body *")) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue; // the hidden dialog
        const size = parseFloat(getComputedStyle(el).fontSize);
        const label = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "");
        const text = (el.textContent || "").trim().slice(0, 40);
        if (size < smallest.px) {
          smallest.px = size;
          smallest.what = label;
          smallest.text = text;
        }
        if (size < minFontPx && text) tiny.push({ label, size, text });
        if (el.matches("button, a[href]") && box.height < minTargetPx) {
          small.push({ label, height: Math.round(box.height * 10) / 10, text });
        }
      }
      return { smallest, tiny, small, elements: document.querySelectorAll("body *").length };
    },
    [MIN_FONT_PX, MIN_TARGET_PX],
  );
  must(
    measured.tiny.length === 0,
    `${measured.tiny.length} elements carry text below ${MIN_FONT_PX}px (smallest ${measured.smallest.px}px on ` +
      `${measured.smallest.what}: "${measured.smallest.text}"): ${JSON.stringify(measured.tiny.slice(0, 5))}`,
  );
  must(
    measured.small.length === 0,
    `${measured.small.length} buttons or links are under ${MIN_TARGET_PX}px tall: ${JSON.stringify(measured.small)}`,
  );
  facts.push({ smallestFontPx: measured.smallest.px, elements: measured.elements });
  step(
    `nothing with text is under ${MIN_FONT_PX}px and every button and link is ${MIN_TARGET_PX}px tall, across ` +
      `${measured.elements} elements`,
  );
}

/** The tab key reaches the controls, in the document's order. */
async function keyboardReaches() {
  await page.evaluate(() => document.body.focus());
  const seen = [];
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press("Tab");
    const where = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        action: el.dataset ? el.dataset.action || null : null,
      };
    });
    if (where) seen.push(where);
  }
  must(
    seen.some((el) => el.id === "theme"),
    `the theme toggle is not in the tab order; the tab key reached ${JSON.stringify(seen)}`,
  );
  must(
    seen.some((el) => el.action === "restart-reddit"),
    `the action buttons are not in the tab order; the tab key reached ${JSON.stringify(seen)}`,
  );
  step(`the tab key reaches the theme toggle and the action buttons (${seen.length} stops)`);
}

/** The headline, the down row, and the one button that fixes it. */
async function theHeadline() {
  const headline = (await page.locator("#headline").textContent()) ?? "";
  must(
    headline.trim() === "1 thing needs attention",
    `the page's one big line read "${headline.trim()}", not the count of what is wrong`,
  );
  const down = page.locator(".card", { hasText: "Reddit reader (Redlib)" }).first();
  must(
    (await down.locator(".verdict.bad").count()) === 1,
    "the row that is down is not marked as down in plain words",
  );
  const fix = down.getByRole("button", { name: /^Fix this/ });
  must((await fix.count()) === 1, "the row that is down offers no button to fix it");
  facts.push({ headline: headline.trim() });
  step("one line says what needs attention, and the row that is down carries its own fix");
}

/**
 * No card may be green over an answer it could not read.
 *
 * Fix 1 of the coordinator's review was "OK: Could not read the last scan" -- a
 * soft failure wearing the healthy colour. This is measured, not inspected: the
 * green is read off the stylesheet (`--good` as the browser computes it, sampled
 * through a throwaway .verdict.ok element), and every `.card` in the document is
 * compared against it. The fixture's Last scan card is the one that says
 * "could not", and the check refuses to pass if nothing in the document does.
 */
async function noGreenOverCouldNot() {
  const measured = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.className = "verdict ok";
    probe.textContent = "OK: ";
    document.body.appendChild(probe);
    const green = getComputedStyle(probe).color;
    probe.remove();
    const cards = [];
    document.querySelectorAll(".card").forEach((card) => {
      const verdict = card.querySelector(".verdict");
      if (!verdict) return;
      cards.push({
        state: card.dataset.state || null,
        text: (card.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
        className: verdict.className,
        painted: getComputedStyle(verdict).color,
        could: /could not/i.test(card.textContent || ""),
      });
    });
    return { green, cards };
  });
  const soft = measured.cards.filter((c) => c.could);
  must(
    soft.length > 0,
    "the fixture has no card saying 'Could not', so this check proves nothing about the colour of one",
  );
  for (const card of soft) {
    must(card.state === "note", `"${card.text}" carries state ${card.state}; a soft failure is a Note`);
    must(card.className === "verdict note", `"${card.text}" is painted as ${card.className}`);
    must(
      card.painted !== measured.green,
      `"${card.text}" is painted the healthy green (${card.painted})`,
    );
  }
  facts.push({ softFailureCards: soft.length, healthyGreen: measured.green, cards: measured.cards.length });
  step(
    `no card that could not read its answer is green (${soft.length} of ${measured.cards.length} cards say so; ` +
      `the healthy green is ${measured.green})`,
  );
}

/**
 * The two cards the owner asked for, read off the rendered page rather than off
 * the fixture that fed it.
 *
 * "Copy on D:" has to say how many copies are there and how much room is left,
 * and "Attention" has to say in the plainest words that nothing needs attention
 * and when that was last checked. The time is asserted as a 12-hour clock: the
 * bug this page already fixed once was a backup timestamp printed as UTC on a
 * 24-hour clock, on a page read by one person sitting at that machine, and a new
 * card is exactly where that would come back.
 */
async function theNewCards() {
  const cards = await page.locator("#cards .card").evaluateAll((els) =>
    els.map((element) => ({
      label: (element.querySelector("h3")?.textContent || "").trim(),
      verdict: (element.querySelector(".verdict")?.textContent || "").trim(),
      state: element.dataset.state || null,
      text: (element.textContent || "").trim().replace(/\s+/g, " "),
    })),
  );
  const offsite = cards.find((card) => card.label === "Copy on D:");
  must(
    offsite,
    `the page draws no "Copy on D:" card; it draws ${JSON.stringify(cards.map((c) => c.label))}`,
  );
  must(offsite.verdict === "OK:", `the "Copy on D:" card reads "${offsite.verdict}"`);
  must(/\b\d+ copies? on D:/.test(offsite.text), `the "Copy on D:" card does not say how many copies: ${offsite.text}`);
  must(/TB free/.test(offsite.text), `the "Copy on D:" card does not say how much room is left: ${offsite.text}`);

  const attention = cards.find((card) => card.label === "Attention");
  must(
    attention,
    `the page draws no "Attention" card; it draws ${JSON.stringify(cards.map((c) => c.label))}`,
  );
  must(attention.verdict === "OK:", `the "Attention" card reads "${attention.verdict}"`);
  must(
    /Nothing needs attention/.test(attention.text),
    `with nothing firing the "Attention" card must say so plainly, and it reads: ${attention.text}`,
  );
  const clock = attention.text.match(/\d{1,2}:\d{2}\s?(AM|PM)/i);
  must(
    clock,
    `the "Attention" card names no 12-hour local time, so the page is printing a raw timestamp: ${attention.text}`,
  );
  facts.push({ offsite: offsite.text, attention: attention.text });
  step(`the "Copy on D:" and "Attention" cards are on the page: "${attention.text.slice(0, 60)}..."`);
}

/**
 * The row that brings the staged copy back after a reboot -- and the one button
 * this walk must not press.
 *
 * After a reboot the staged copy is gone and everything else about staging is
 * not: the database is restored, the build is on disk, and the only way back
 * used to be running the whole restore again. So the page has to say what
 * happened, in a sentence an operator can act on, and offer the button the
 * brief names. Reading the words is the check; the button is checked to be
 * there and checked to have done nothing, because behind it is
 * ops\start-stage.ps1, which on this machine would start a server on the port
 * somebody is walking. `world.spawns` is every argv the action table ran this
 * run, and this is the one id that must never appear in it.
 */
async function theTestCopyRow() {
  const card = page.locator(".card", { hasText: "Test copy on" }).first();
  must((await card.count()) === 1, "the page draws no card for the test copy");
  const text = ((await card.textContent()) ?? "").trim().replace(/\s+/g, " ");
  must(/staged/.test(text), `the test-copy row does not say the copy is staged: ${text}`);
  must(
    /nothing is answering on 127\.0\.0\.1:\d+/.test(text),
    `the test-copy row does not say, in plain words, that nothing is answering: ${text}`,
  );
  // Unit AL2: the copy is staged from a worker checkout, not from the live one
  // this page runs in, so the row has to name the folder it would start --
  // otherwise "Start the test copy" is a button whose effect the operator
  // cannot see. The version comes with it, because that is what tells the
  // operator whether the copy is the build they expect.
  must(
    /staged in [^\s(]+ \(version \d+\.\d+\.\d+\)/.test(text),
    `the test-copy row names no checkout folder and version, so the button it offers is anonymous: ${text}`,
  );
  const button = card.getByRole("button", { name: "Start the test copy" });
  must(
    (await button.count()) === 1,
    `the staged-and-down row offers no "Start the test copy" button; the row reads: ${text}`,
  );
  const started = world.spawns.filter((argv) => /start-stage\.ps1/.test(argv));
  must(
    started.length === 0,
    `this walk started the staged copy: ${JSON.stringify(started)}. Nothing on this machine may be started.`,
  );
  facts.push({ testCopy: text });
  step(`the test copy row reads "${text.slice(0, 70)}..." and its button was not pressed`);
}

/** Contrast of two computed colours, the WCAG way. */
function contrast(first, second) {
  const luminance = (text) => {
    const [r, g, b] = (text.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number).map((value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

/** Every action button's fill and ink, as the browser paints it right now. */
function actionPaint() {
  return page.evaluate(() => {
    const rows = [];
    for (const button of document.querySelectorAll("#actions button[data-action]")) {
      const style = getComputedStyle(button);
      rows.push({
        id: button.dataset.action,
        label: (button.textContent || "").trim(),
        bg: style.backgroundColor,
        ink: style.color,
      });
    }
    return rows;
  });
}

/**
 * Stop everything must look like the one that takes the paper offline.
 *
 * Fix 5: all the buttons were one flat accent colour. This compares the painted
 * fill against every other action button in BOTH themes -- the toggle is real,
 * so this is the operator's own view, not a stylesheet read -- and checks the
 * label's contrast against its own fill, since a red nobody can read is not an
 * improvement.
 */
async function theStopButtonLooksDangerous() {
  const dark = await actionPaint();
  const stop = dark.find((row) => row.id === "stop-all");
  must(stop, `the page renders no button for stop-all; it rendered ${JSON.stringify(dark.map((r) => r.id))}`);
  const others = dark.filter((row) => row.id !== "stop-all");
  must(others.length === 7, `expected the other seven action buttons, found ${others.length}`);
  for (const other of others) {
    must(
      stop.bg !== other.bg,
      `Stop everything is painted the same ${stop.bg} as ${other.id} in the dark theme`,
    );
  }
  const darkContrast = contrast(stop.bg, stop.ink);
  must(darkContrast >= 4.5, `the stop button's label is ${darkContrast.toFixed(2)}:1 on its fill in dark, under AA`);

  await page.getByRole("button", { name: /appearance$/ }).click();
  await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light", undefined, {
    timeout: 10_000,
  });
  const light = await actionPaint();
  const stopLight = light.find((row) => row.id === "stop-all");
  must(stopLight.bg !== stop.bg, "the stop button's fill is the same in both themes, so it was never themed");
  for (const other of light.filter((row) => row.id !== "stop-all")) {
    must(
      stopLight.bg !== other.bg,
      `Stop everything is painted the same ${stopLight.bg} as ${other.id} in the light theme`,
    );
  }
  const lightContrast = contrast(stopLight.bg, stopLight.ink);
  must(lightContrast >= 4.5, `the stop button's label is ${lightContrast.toFixed(2)}:1 on its fill in light, under AA`);

  await page.getByRole("button", { name: /appearance$/ }).click();
  await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark", undefined, {
    timeout: 10_000,
  });
  facts.push({
    stopButton: {
      dark: stop.bg,
      light: stopLight.bg,
      contrastDark: Math.round(darkContrast * 100) / 100,
      contrastLight: Math.round(lightContrast * 100) / 100,
    },
  });
  step(
    `Stop everything is ${stop.bg} on ${stop.ink} (${darkContrast.toFixed(1)}:1) in dark and ${stopLight.bg} on ` +
      `${stopLight.ink} (${lightContrast.toFixed(1)}:1) in light, unlike all ${others.length} other buttons in either theme`,
  );
}

/** Every button is the menu's own wording, and the links go where the brief says. */
async function theWording(server) {
  const actions = await (await fetch(`${base}/api/actions`)).json();
  const labels = actions.actions.map((a) => a.label);
  for (const want of [
    "Check it again",
    "Restart the paper",
    "Restart the tunnel",
    "Start everything",
    "Stop everything",
    "Restart the Reddit reader",
    "Back up now",
    "Start the test copy",
  ]) {
    must(labels.includes(want), `the page offers no button labelled "${want}"`);
  }
  for (const action of actions.actions) {
    const button = page.locator(`button[data-action="${action.id}"]`);
    must((await button.count()) === 1, `the page renders no button for the action ${action.id}`);
    must(
      (await button.textContent()).trim() === action.label,
      `the button for ${action.id} is not labelled with the menu's words`,
    );
  }
  const hrefs = await page.locator("#links a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  for (const want of ["https://townreporter.org/desk", "https://townreporter.org", "http://127.0.0.1:3100"]) {
    must(hrefs.includes(want), `the page links nowhere near ${want}; it links ${JSON.stringify(hrefs)}`);
  }
  facts.push({ buttons: labels.length, links: hrefs });
  step(`all ${labels.length} buttons are on the page with the menu's own words, plus the three links`);
  must(server.token.length > 0, "no token: the page could not POST at all");
}

/** Cancel means cancel: the dialog closes and nothing at all was started. */
async function cancelChangesNothing(server) {
  const before = world.spawns.length;
  await page.locator('button[data-action="stop-all"]').click();
  await page.waitForSelector("#dialog.open", { timeout: 10_000 });
  const confirm = (await page.locator("#confirm").textContent()) ?? "";
  must(
    confirm.trim() === "Take it offline",
    `the dialog's confirm button reads "${confirm.trim()}", so it does not say what it does`,
  );
  await page.locator("#cancel").click();
  await page.waitForFunction(() => !document.getElementById("dialog").classList.contains("open"), undefined, {
    timeout: 10_000,
  });
  // Give a POST that should never have been sent time to have been sent.
  await new Promise((r) => setTimeout(r, 600));
  must(
    world.spawns.length === before && server.state.run === null,
    "Cancel started the action anyway: cancel has to mean cancel on the one action that takes the paper offline",
  );
  step("the stop-all dialog asks first, and Cancel runs nothing at all");
}

/** The press, the instant feedback, the streamed output, and the new status. */
async function pressRestartReddit(server) {
  // Timed inside the page: the handler sets "Working..." synchronously, in the
  // same task as the click, and a round trip to this driver is 10-30ms of
  // measurement error on its own. The click is the page's real listener either
  // way -- what is being timed is the page's own response to it.
  const feedback = await page.evaluate(() => {
    const button = document.querySelector('button[data-action="restart-reddit"]');
    const started = performance.now();
    button.click();
    return {
      ms: Math.round((performance.now() - started) * 10) / 10,
      text: button.textContent,
      disabled: button.disabled,
    };
  });
  must(
    feedback.text === "Working...",
    `the button said "${feedback.text}" right after the press; the operator must see the press land`,
  );
  must(feedback.disabled, "the button stayed pressable, so it can be pressed twice");
  must(
    feedback.ms < 100,
    `the page took ${feedback.ms}ms to say anything; the brief allows 100ms`,
  );

  // The output the action streams, line by line, into "What just happened".
  await page.waitForFunction(
    () => /Waiting for the Reddit reader to answer/.test(document.getElementById("output").textContent),
    undefined,
    { timeout: 15_000 },
  );
  step(`the button says "Working..." in the same frame (${feedback.ms}ms) and the output streams in`);

  // And the status the page re-reads afterwards is the new one -- the headline
  // falls to zero because the stub flipped the flag the status is built from.
  await page.waitForFunction(
    () => document.getElementById("headline").textContent.trim() === "Everything is up",
    undefined,
    { timeout: 15_000 },
  );
  const output = (await page.locator("#output").textContent()) ?? "";
  must(
    /answered in 1.2 seconds/.test(output),
    `the action's last line never arrived; the log reads: ${JSON.stringify(output.slice(0, 300))}`,
  );
  const button = page.locator('button[data-action="restart-reddit"]');
  must(
    (await button.textContent()).trim() === "Restart the Reddit reader",
    "the button did not come back to its own label when the action finished",
  );
  must(!(await button.isDisabled()), "the button stayed disabled after the action finished");
  must(
    (await page.locator(".verdict.bad").count()) === 0,
    "the page still shows a red row after the status said everything is up",
  );
  must(server.state.run?.done === true, "the server never marked the action finished");
  facts.push({ feedbackMs: feedback.ms, spawns: [...world.spawns] });
  step("the action runs, the page re-reads the status, and the new one is what it shows");
}

/** The argv the action table really ran, which is the whole safety claim. */
function theArgvWasFixed() {
  must(
    world.spawns.length === 1,
    `expected exactly one spawn, got ${JSON.stringify(world.spawns)}`,
  );
  const argv = world.spawns[0];
  must(
    argv.includes(REDLIB) && argv.endsWith(`${REDLIB} restart`),
    `the button labelled "Restart the Reddit reader" ran "${argv}", not ${REDLIB} restart`,
  );
  must(
    /System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/.test(argv),
    `the action ran "${argv}" instead of an absolute System32 PowerShell`,
  );
  step(`the button ran a fixed argv vector, not a command line: ${argv}`);
}

/** Every action is pressable but nothing is pressed: only the one above ran. */
function nothingElseRan() {
  must(
    world.spawns.every((argv) => /redlib\.ps1/.test(argv)),
    `something other than the one action the walk pressed was run: ${JSON.stringify(world.spawns)}`,
  );
  step("nothing else was started, and no scheduled task was touched");
}

/* ─────────────────────────── the run ─────────────────────────── */

let browser;
let server;
try {
  console.log(`booting the Control page on ${base} (fake runner, nothing spawned)`);
  ({ server } = await bootTheServer());
  step(`the Control page answers on ${base} with nothing spawned`);

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") noise.push({ kind: "console", text: message.text() });
  });
  page.on("pageerror", (error) => noise.push({ kind: "exception", text: String(error) }));
  page.on("requestfailed", (request) =>
    noise.push({ kind: "requestfailed", text: `${request.url()} ${request.failure()?.errorText}` }),
  );

  await openThePage();
  const theme = page.locator("html");
  await darkByDefault(theme);
  // The tab order is read on this freshly loaded page, before anything has been
  // clicked, so the walk measures the order a person arriving at the page gets
  // rather than one left over from the last check.
  await keyboardReaches();
  await theLightToggle();
  await theWording(server);
  await theNewCards();
  await theTestCopyRow();
  await theHeadline();
  await noGreenOverCouldNot();
  await theStopButtonLooksDangerous();
  await measureEveryElement();
  await cancelChangesNothing(server);
  await pressRestartReddit(server);
  theArgvWasFixed();
  nothingElseRan();
  must(
    noise.length === 0,
    `the page logged ${noise.length} error(s), which the operator would see as the page being broken: ` +
      JSON.stringify(noise.slice(0, 5)),
  );
  step("no console error, no page exception and no failed request for the whole run");

  await context.close();
  console.log(`\n${done.length} checks passed`);
  console.log(JSON.stringify({ ok: true, port: PORT_CONTROL_PAGE, checks: done, facts }, null, 2));
  await browser.close();
  await server.close();
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  let url = "";
  let text = "";
  try {
    url = page?.url() ?? "";
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 1200);
  } catch {
    /* the page is already gone */
  }
  console.error(
    JSON.stringify({ ok: false, error: message, url, text, noise, completed: done }, null, 2),
  );
  try {
    await browser?.close();
  } catch {
    /* already closed */
  }
  try {
    await server?.close();
  } catch {
    /* already closed */
  }
  process.exit(1);
}
