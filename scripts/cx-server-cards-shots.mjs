#!/usr/bin/env node
/**
 * Evidence for unit CX -- the Server screen as a page of cards.
 *
 * The brief judges this screen by PICTURES, so this walk takes the pictures and
 * measures the two things a picture cannot show:
 *
 *   1. The smallest rendered font size on /desk/ops, as owner and as editor, in
 *      both appearances and at all three widths. Nothing informational may sit
 *      under 14px (design handoff, `design-system/README.md`).
 *   2. Console errors. A screen that renders and logs an error is not a screen
 *      that works.
 *
 * It also writes the two things the brief asks to be TABLED rather than looked
 * at:
 *
 *   - The card titles in document order, so "in the drawn order" is a list of
 *     strings and not an opinion about a PNG.
 *   - `cx-server-controls.json`: every distinct link and button on the page,
 *     pressed once, with what happened (navigated to X, opened the confirmation
 *     for Y, showed Z). Nothing is confirmed: every confirmation is opened and
 *     then CANCELLED, so no action runs and the desk is not given up. The two
 *     controls that would take the server down are pressed only as far as their
 *     confirmation, which is what the control itself does.
 *
 * It never calls a model and never leaves loopback.
 *
 *   CX_SHOTS_BASE_URL=http://127.0.0.1:8094 \
 *   CX_SHOTS_OUT_DIR=../townreporter-deepseek-oversight/reports/CX-evidence \
 *   node scripts/cx-server-cards-shots.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/** A port of its own, in the 8090+ range. Nothing else in the repo claims it. */
const PORT_CX_SHOTS = 8094;

const base = checkedUrl(
  process.env.CX_SHOTS_BASE_URL || `http://127.0.0.1:${PORT_CX_SHOTS}`,
).replace(/\/$/, "");
const outDir = checkedOutputPath(
  resolve(
    process.env.CX_SHOTS_OUT_DIR || "../townreporter-deepseek-oversight/reports/CX-evidence",
  ),
  [resolve("..")],
  "output directory",
);
mkdirSync(outDir, { recursive: true });

/**
 * One fixed owner, for the reason `scripts/models-screen-shots.mjs` documents:
 * the dev server's PGLite database lives in the server process, so a second run
 * against the same server must sign in to the desk the first run made rather
 * than try to create it again.
 */
const ownerEmail = "cx-server-cards@townreporter.test";
const ownerPassword = "cx-server-cards-pass";
const editorEmail = "cx-server-cards-editor@townreporter.test";
const editorPassword = "cx-server-cards-editor-pass";

const widths = [1440, 1024, 390];
const consoleErrors = [];
const measurements = [];
const cardOrder = {};
const controls = [];
const shots = [];

/** As `scripts/models-screen-shots.mjs`: every element that paints text of its own. */
const MIN_FONT_PROBE = `(() => {
  const seen = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = (node.textContent || '').trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const size = Math.round(parseFloat(style.fontSize) * 100) / 100;
    const key = size + '|' + el.tagName + '|' + el.className;
    if (seen.has(key)) continue;
    seen.set(key, {
      px: size,
      tag: el.tagName.toLowerCase(),
      className: String(el.className || '').slice(0, 80),
      sample: text.slice(0, 40),
    });
  }
  return [...seen.values()].sort((a, b) => a.px - b.px);
})()`;

/** Every card, in document order, by the first heading inside it. */
const CARD_ORDER_PROBE = `(() => {
  return [...document.querySelectorAll('div.astra-ops-card')].map((card) => {
    const h = card.querySelector('h1, h2, h3');
    return {
      id: card.id,
      title: h ? h.textContent.trim().replace(/\\s+/g, ' ') : '',
      tall: card.classList.contains('astra-ops-card-tall'),
      readOnly: Boolean(card.querySelector('[data-testid="ops-read-only"]')),
    };
  });
})()`;

async function measure(page, label) {
  const rows = await page.evaluate(MIN_FONT_PROBE);
  const min = rows.length ? rows[0].px : null;
  const under = rows.filter((row) => row.px < 14);
  measurements.push({
    label,
    min,
    underCount: under.length,
    under: under.slice(0, 8),
    top10: rows.slice(0, 10),
  });
  console.log(`  size  ${label}: smallest ${min}px, ${under.length} under 14px`);
  return under;
}

async function shot(page, name, fullPage = true) {
  const file = resolve(outDir, `${name}.png`);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(200);
  await page.screenshot({ path: file, fullPage, animations: "disabled" });
  shots.push(file);
  console.log(`  shot  ${file}`);
}

/** Both appearances, all three widths, for one signed-in person. */
async function sweep(page, who) {
  await page.setViewportSize({ width: widths[0], height: 1000 });
  /*
    Light first, through the desk's own stored preference: `townreporter.desk.mode`
    is what the Aa control writes, so the walk clears it rather than setting a
    class, and the page is what decides.
  */
  await page.evaluate(() => localStorage.setItem("townreporter.desk.mode", "light"));
  await page.goto(`${base}/desk/ops`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Server", exact: true }).waitFor({ timeout: 45_000 });
  /*
    The light surface is stamped `"light"`, not `"desk-light"`: the head script
    in src/lib/appearance.ts sets `dark ? (desk ? "desk-dark" : "reader-dark") :
    "light"`, and light is one surface for desk and reader alike.
  */
  await page.waitForFunction(
    () => document.documentElement.getAttribute("data-appearance") === "light",
    undefined,
    { timeout: 15_000 },
  );

  /*
    Every card must be named before the order is read. The first run of this
    walk probed one frame after `domcontentloaded` and five cards were still
    drawing their skeleton, so the order came back as element ids instead of
    the drawn titles -- an artifact of the probe, not of the page. Waiting for
    a heading in all of them is also the assertion item 1 wants: the drawing
    draws twelve named cards, so twelve named cards is what must be on screen.
  */
  await page.waitForFunction(
    () => {
      const cards = [...document.querySelectorAll("div.astra-ops-card")];
      return cards.length > 0 && cards.every((c) => c.querySelector("h1, h2, h3"));
    },
    undefined,
    { timeout: 30_000 },
  );

  const order = await page.evaluate(CARD_ORDER_PROBE);
  cardOrder[who] = order;
  console.log(`  cards ${who}: ${order.map((c) => c.title || c.id).join(" | ")}`);
  if (order.length === 0) throw new Error(`${who}: no .astra-ops-card on the page`);
  const tabs = await page.getByRole("tab").count();
  if (tabs !== 0) throw new Error(`${who}: the page still draws ${tabs} tab pills`);
  console.log(`  ok    ${who}: ${order.length} cards, 0 tab pills`);

  for (const theme of ["light", "dark"]) {
    if (theme === "dark") {
      /*
        The toggle lives in the rail's footer, and at 390 the rail is a drawer
        that is not on screen -- Playwright refuses to click an element outside
        the viewport, correctly. So the desk is widened for the switch, then
        narrowed again for the shots; the switch itself is the desk's own
        control either way.
      */
      await page.setViewportSize({ width: widths[0], height: 1000 });
      await page.waitForTimeout(300);
      const toggle = page.getByRole("button", { name: "Switch to dark appearance" });
      try {
        await toggle.click({ timeout: 10_000 });
      } catch {
        const clicked = await page.evaluate(() =>
          Boolean(
            document
              .querySelector('.astra-foot-btn[aria-label="Switch to dark appearance"]')
              ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
          ),
        );
        if (!clicked) throw new Error("the dark appearance toggle could not be pressed");
      }
      await page.waitForFunction(
        () => document.documentElement.getAttribute("data-appearance") === "desk-dark",
        undefined,
        { timeout: 15_000 },
      );
      const stored = await page.evaluate(() => localStorage.getItem("townreporter.desk.mode"));
      if (stored !== "dark") throw new Error(`the toggle did not persist dark: ${stored}`);
      console.log("  ok    dark is chosen through the desk's own toggle");
    }
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(350);
      await measure(page, `${who} ${theme} ${width}`);
      await shot(page, `cx-server-real-${who}-${width}-${theme}`);
    }
  }
  return order;
}

/**
 * What a control did, in one line.
 *
 * `before` is a fingerprint of the page taken just before the press: the URL,
 * the set of visible button labels, and a hash of the visible text. Comparing
 * the three afterwards distinguishes the four things a control can do here --
 * navigate, disclose something, open a confirmation, or nothing at all.
 */
async function fingerprint(page) {
  return page.evaluate(() => {
    const labels = [...document.querySelectorAll("button, a[href]")]
      .filter((el) => el.offsetParent !== null)
      .map((el) => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60));
    const text = (document.body.innerText || "").replace(/\s+/g, " ");
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
    /*
      `elements` and `fields` are here because `innerText` cannot see the two
      things these cards do most: an "Add" that draws an empty box (no text at
      all) and a "Remove" that takes one away. Without them a working control
      read as "nothing changed" -- which is the one row a reader should be able
      to trust absolutely.
    */
    const elements = document.querySelectorAll("*").length;
    const fields = [...document.querySelectorAll("input, select, textarea")].filter(
      (el) => el.offsetParent !== null,
    ).length;
    return {
      url: location.pathname + location.search + location.hash,
      labels,
      hash,
      elements,
      fields,
      scrollY: Math.round(window.scrollY),
    };
  });
}

/** Buttons that APPEARED with the press and only ever undo it. Never a "Run". */
const CANCEL_NAMES = [
  "Cancel",
  "Not now",
  "No",
  "Keep it",
  "Keep",
  "Close",
  "Dismiss",
  "Hide logs",
  "Hide actions",
  "Hide the log",
  "Done",
];

async function pressAndUndo(page, press, label, opts = {}) {
  const before = await fingerprint(page);
  const row = { label, before: before.url, action: null, after: null, opened: [], cancelled: null };
  try {
    await press();
  } catch (err) {
    row.action = `could not press: ${err instanceof Error ? err.message : String(err)}`;
    controls.push(row);
    return row;
  }
  await page.waitForTimeout(700);
  const after = await fingerprint(page);

  if (after.url !== before.url) row.action = `navigated to ${after.url}`;
  else {
    const appeared = after.labels.filter((l) => l && !before.labels.includes(l)).slice(0, 12);
    row.opened = appeared;
    const delta = after.elements - before.elements;
    if (appeared.length) row.action = `revealed: ${appeared.join(" / ")}`;
    else if (after.hash !== before.hash) row.action = "changed the page text in place";
    else if (delta !== 0 || after.fields !== before.fields)
      row.action = `changed the page in place (${delta > 0 ? "+" : ""}${delta} elements, ${after.fields} fields)`;
    else if (Math.abs(after.scrollY - before.scrollY) > 20)
      row.action = `scrolled the page to ${after.scrollY}px, nothing else`;
    else row.action = "nothing changed";
  }
  row.after = after.url;

  if (opts.keep) {
    console.log(`  press ${label}: ${row.action} (left open on purpose)`);
    controls.push(row);
    return row;
  }

  // Undo: press the first cancel-ish button that appeared, else Escape.
  const cancelName = CANCEL_NAMES.find((name) => row.opened.includes(name));
  if (cancelName) {
    try {
      await page.getByRole("button", { name: cancelName, exact: true }).first().click();
      await page.waitForTimeout(400);
      row.cancelled = `pressed "${cancelName}"`;
    } catch {
      row.cancelled = `"${cancelName}" would not press; pressed Escape instead`;
      await page.keyboard.press("Escape");
    }
  } else if (after.url !== before.url) {
    // A navigation is not undone by Escape; the `goto` below is the undo, and
    // the table says so rather than claiming a key press did it.
    row.cancelled = "went back to /desk/ops";
  } else if (row.opened.length) {
    await page.keyboard.press("Escape");
    row.cancelled = "Escape";
  }
  if (after.url !== before.url) {
    await page.goto(`${base}/desk/ops`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Server", exact: true }).waitFor({ timeout: 45_000 });
    await page.waitForTimeout(400);
  }
  console.log(`  press ${label}: ${row.action}${row.cancelled ? ` (undone: ${row.cancelled})` : ""}`);
  controls.push(row);
  return row;
}

/**
 * The desk's two appearance buttons and its two text-size buttons.
 *
 * They are pressed here rather than in the generic sweep because each one
 * SWAPS ITSELF for its opposite: the generic "what appeared?" comparison would
 * read the new label as a thing the button revealed, which is not what
 * happened. Both directions are pressed and the desk is left where it started.
 */
const APPEARANCE_TOGGLES = [
  "Switch to dark appearance",
  "Switch to light appearance",
  "Aa Large",
  "Aa Normal",
];

/**
 * The six machine actions, and what this walk is willing to do to each.
 *
 * Every one of them runs a script on this machine the moment it is pressed --
 * `src/lib/ops/actions.server.ts` holds the table, and the four that do not
 * interrupt the paper (`watchdog`, `migrate`, `refresh-fonts`, `rotate-logs`)
 * have no confirmation in front of them at all. Two are safe here and four are
 * not:
 *
 *   - `watchdog` runs `ops/watchdog.ps1`, which stops and starts the tunnel and
 *     the app. `rotate-logs` moves this machine's log files. Neither is a thing
 *     a screenshot walk should do to someone's desk.
 *   - `refresh-fonts` reaches Google and writes the webfonts into the checkout.
 *   - `restart-tunnel` and `restart-app` are the two that DO ask first, so they
 *     are pressed as far as the confirmation and then cancelled -- that is the
 *     whole of what a safe press of them can be.
 *   - `migrate` is `node scripts/migrate.mjs`, which is a no-op without a
 *     DATABASE_URL, so it is pressed for real.
 *
 * The four that are skipped are still TABLED, with the reason, because "every
 * control, and what happened" is the point of the table -- and a control that
 * was deliberately not pressed is a different row from one that did nothing.
 */
const OPS_ACTION_SKIPS = {
  "Run health check now": "would run ops/watchdog.ps1, which restarts the tunnel and the app",
  "Rotate the logs": "would move this machine's log files",
  "Re-download the fonts": "would reach Google and write webfonts into this checkout",
};

/** Pressed last, because it leaves the desk signed out and the page gone. */
const TERMINAL_BUTTONS = ["Sign out"];

async function visibleButtons(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .filter((el) => el.offsetParent !== null && !el.disabled)
      .map((el) => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60))
      .filter(Boolean),
  );
}

/**
 * The six machine actions, one row each, judged by the `h3` above the button.
 *
 * They cannot go through the generic sweep: all six buttons are labelled "Run",
 * so a sweep that de-duplicates by button text would press the first one and
 * call the other five done. Each `li` is walked by index instead, and `label`
 * comes from the `h3` in that `li` -- `src/routes/desk.ops.tsx:379`.
 */
async function pressOpsActions(page) {
  const open = await page.locator("#ops-actions-panel").isVisible().catch(() => false);
  if (!open) {
    controls.push({
      label: "action list",
      before: "/desk/ops",
      action: "not on the page: the actions panel was closed before the sweep reached it",
      after: "/desk/ops",
      opened: [],
      cancelled: null,
    });
    return;
  }
  const items = await page.evaluate(() =>
    [...document.querySelectorAll("#ops-actions-panel li")].map((li, index) => {
      // The `h3` holds the action's name and, after it, the "interrupts" badge
      // -- `src/routes/desk.ops.tsx:379-386`. Only the text nodes are the name;
      // reading `textContent` glues the badge on ("Restart the tunnelinterrupts").
      const heading = li.querySelector("h3");
      const label = heading
        ? [...heading.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent)
            .join("")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 60)
        : "";
      return {
        index,
        label,
        button: (li.querySelector("button")?.textContent || "").trim().slice(0, 30),
        disabled: Boolean(li.querySelector("button")?.disabled),
      };
    }),
  );
  for (const item of items) {
    const name = `action "${item.label}"`;
    // An Escape pressed to undo the row before this one can take the panel with
    // it; the button that opens it says "Restart workers" when it is closed.
    if (!(await page.locator("#ops-actions-panel").isVisible().catch(() => false))) {
      const reopen = page.getByRole("button", { name: "Restart workers", exact: true }).first();
      if ((await reopen.count()) > 0) {
        await reopen.click();
        await page.waitForTimeout(300);
      }
    }
    const skip = OPS_ACTION_SKIPS[item.label];
    if (skip) {
      controls.push({
        label: name,
        before: "/desk/ops",
        action: `not pressed — ${skip}`,
        after: "/desk/ops",
        opened: [],
        cancelled: null,
      });
      console.log(`  skip  ${name}: ${skip}`);
      continue;
    }
    if (item.disabled) {
      controls.push({
        label: name,
        before: "/desk/ops",
        action: `could not press — the desk draws it disabled (${item.button || "no button"})`,
        after: "/desk/ops",
        opened: [],
        cancelled: null,
      });
      console.log(`  n/a   ${name}: drawn disabled`);
      continue;
    }
    const press = () =>
      page.locator("#ops-actions-panel li").nth(item.index).locator("button").first().click();
    await pressAndUndo(page, press, name);
  }
}

async function pressEverything(page) {
  const seen = new Set();

  // 1. The four toggles, each pressed in both directions.
  for (const name of APPEARANCE_TOGGLES) {
    if (seen.has(name)) continue;
    seen.add(name);
    const button = page.getByRole("button", { name, exact: true }).first();
    if ((await button.count()) === 0) continue;
    await pressAndUndo(page, () => button.click(), `toggle "${name}"`, { keep: true });
  }

  // 2. Every link. Distinct (label, href) pairs only: the rail draws the same
  //    link twice, and pressing one href twice proves the same thing twice.
  const links = await page.evaluate(() =>
    [...document.querySelectorAll("a[href]")]
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
        href: el.getAttribute("href"),
      }))
      .filter((row) => row.text),
  );
  const seenLink = new Set();
  for (const { text, href } of links) {
    const key = `${text}|${href}`;
    if (seenLink.has(key)) continue;
    seenLink.add(key);
    await pressAndUndo(
      page,
      () => page.locator(`a[href="${href}"]`).filter({ hasText: text }).first().click(),
      `link "${text}" -> ${href}`,
    );
  }

  /*
    The Actions list and the log pane are behind the two disclosures the drawing
    puts in the Health card, so they are not on the page to press until those
    are open. They are opened here -- without the automatic undo -- so the sweep
    below sees everything they contain. Each is recorded as its own row.
  */
  for (const name of ["Restart workers", "View logs"]) {
    const button = page.getByRole("button", { name, exact: true }).first();
    if ((await button.count()) === 0) continue;
    await pressAndUndo(page, () => button.click(), `disclosure "${name}"`, { keep: true });
  }

  // 3. The six machine actions, each by the label above its button.
  await pressOpsActions(page);

  /*
    4. Every other button, in up to three rounds.

    The rounds are the point: a few controls here only come into existence after
    another one is pressed -- "Save daily scan" reveals "Pause daily scan", and
    pressing that reveals "Resume daily scan". A single snapshot of the page
    cannot contain buttons that the page has not drawn yet, so the sweep
    re-reads the page after each round and stops as soon as a round adds nothing
    new. Nothing is pressed twice: `seen` carries the labels across rounds.

    Three kinds are held back or left out, and each for a reason the table then
    shows:

      - the buttons inside `#ops-actions-panel`, which step 3 has just walked;
      - the two "Hide ..." disclosures, kept for the end of each round so that
        closing a panel does not take the buttons still to be pressed with it;
      - "Sign out", which ends the session, so it is pressed LAST and the
        recovery navigation is skipped around it -- after it there is no /desk/ops
        to go back to, only the sign-in page.

    Labels are the key, so two buttons that read the same are pressed once
    between them. Where that happens it is said in the report; the six "Run"
    buttons are the case that matters, and they are walked by index in step 3.
  */
  for (let round = 1; round <= 3; round++) {
    const buttons = await visibleButtons(page);
    // An array, not a Set: a Set does not survive the trip out of the page.
    const inActionsPanel = await page.evaluate(() =>
      [...document.querySelectorAll("#ops-actions-panel button")].map((el) => el.textContent.trim()),
    );
    const notTerminal = (text) => !TERMINAL_BUTTONS.includes(text);
    const order = [
      ...buttons.filter((text) => notTerminal(text) && !text.startsWith("Hide")),
      ...buttons.filter((text) => notTerminal(text) && text.startsWith("Hide")),
    ];
    let pressedThisRound = 0;
    for (const text of order) {
      const key = `button|${text}`;
      if (seen.has(key) || seen.has(text)) continue;
      if (text === "Run" || inActionsPanel.includes(text)) continue;
      const button = page.getByRole("button", { name: text, exact: true }).first();
      if ((await button.count()) === 0) continue;
      seen.add(key);
      pressedThisRound += 1;
      await pressAndUndo(page, () => button.click(), `button "${text}"`);
    }
    console.log(`  ok    button round ${round}: ${pressedThisRound} pressed`);
    if (pressedThisRound === 0) break;
  }

  // 5. "Sign out" last, and only if it is still there to press.
  for (const text of TERMINAL_BUTTONS) {
    const button = page.getByRole("button", { name: text, exact: true }).first();
    if ((await button.count()) === 0) continue;
    await pressAndUndo(page, () => button.click(), `button "${text}"`, { keep: true });
  }
}

const browser = await chromium.launch();
const ownerCtx = await browser.newContext({ viewport: { width: widths[0], height: 1000 } });
const page = await ownerCtx.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(`owner console: ${msg.text().slice(0, 300)}`);
});
page.on("pageerror", (err) => consoleErrors.push(`owner pageerror: ${String(err).slice(0, 300)}`));

try {
  // --- the owner ---------------------------------------------------------
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: /Create the desk|Editor sign-in|You're invited/ })
    .waitFor({ timeout: 45_000 });
  const fresh = (await page.getByLabel("Name", { exact: true }).count()) > 0;
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Password", { exact: true }).fill(ownerPassword);
  if (fresh) {
    await page.getByLabel("Name").fill("CX Server Cards Owner");
    await page.getByLabel("Confirm password").fill(ownerPassword);
    await page.getByRole("button", { name: "Create editor account" }).click();
  } else {
    await page.getByRole("button", { name: "Sign in with email" }).click();
  }
  await page.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 45_000 });
  console.log(`  ok    ${fresh ? "the first account owns the desk" : "signed in to the desk"}`);

  await page.goto(`${base}/desk/setup`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  if (await page.getByLabel("Paper name", { exact: true }).count()) {
    await completeFirstRunSetup(page, base);
    console.log("  ok    the desk has a paper name and a town");
  }

  await sweep(page, "owner");

  // --- the editor, minted and seated through the real UI ------------------
  await page.setViewportSize({ width: widths[0], height: 1000 });
  await page.goto(`${base}/desk/ops`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Server", exact: true }).waitFor({ timeout: 45_000 });
  await page.getByLabel("Their email").fill(editorEmail);
  await page.getByRole("button", { name: "Make the invite link" }).click();
  const linkEl = page.locator("p.break-all").filter({ hasText: "/login?invite=" }).first();
  /*
    The invite is minted for a FIXED address, so on a server whose database
    already holds that editor the desk refuses it and draws an error instead of
    a link -- the address is not new. The walk then signs that editor in with
    the password it set the first time, which reaches the same read-only face by
    the same real route. A fresh server always takes the invite branch.
  */
  let inviteUrl = null;
  try {
    await linkEl.waitFor({ timeout: 20_000 });
    inviteUrl = (await linkEl.innerText()).trim();
    console.log(`  ok    the owner minted an invite: ${inviteUrl.slice(0, 60)}…`);
  } catch {
    console.log(`  note  no fresh invite for ${editorEmail} (already an editor here) -- signing in`);
  }

  const editorCtx = await browser.newContext({ viewport: { width: widths[0], height: 1000 } });
  const editorPage = await editorCtx.newPage();
  editorPage.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`editor console: ${msg.text().slice(0, 300)}`);
  });
  editorPage.on("pageerror", (err) =>
    consoleErrors.push(`editor pageerror: ${String(err).slice(0, 300)}`),
  );
  if (inviteUrl) {
    await editorPage.goto(inviteUrl, { waitUntil: "domcontentloaded" });
    await editorPage
      .getByRole("heading", { name: /You're invited to this desk/ })
      .waitFor({ timeout: 45_000 });
    await editorPage.getByLabel("Password", { exact: true }).fill(editorPassword);
    await editorPage.getByLabel("Confirm password").fill(editorPassword);
    await editorPage.getByRole("button", { name: "Create editor account" }).click();
    console.log("  ok    the invite seated a second editor");
  } else {
    await editorPage.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await editorPage
      .getByRole("heading", { name: /Editor sign-in|Create the desk/ })
      .waitFor({ timeout: 45_000 });
    await editorPage.getByLabel("Email").fill(editorEmail);
    await editorPage.getByLabel("Password", { exact: true }).fill(editorPassword);
    await editorPage.getByRole("button", { name: "Sign in with email" }).click();
    console.log("  ok    the existing editor signed in");
  }
  await editorPage.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 45_000 });

  await sweep(editorPage, "editor");

  // --- every control, pressed once ---------------------------------------
  await page.setViewportSize({ width: widths[0], height: 1000 });
  await page.goto(`${base}/desk/ops`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Server", exact: true }).waitFor({ timeout: 45_000 });
  // The sweep left the desk dark; the press pass starts from the same light
  // page the screenshots opened on, set the same way the Aa control sets it.
  await page.evaluate(() => localStorage.setItem("townreporter.desk.mode", "light"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Server", exact: true }).waitFor({ timeout: 45_000 });
  /*
    Settle before enumerating.

    The first press pass drew a table whose first row read "revealed: Light /
    Check now / Test / Sign in to Codex ..." -- those were the Writing models
    card's own controls arriving mid-sweep, not things a button had opened. The
    card is the slowest on the page (it asks each provider what it can do), so
    the pass waits for its two doors and then a beat, and the table is taken
    against a page that has stopped moving.
  */
  await page.locator('a[href="/desk/models"]').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await pressEverything(page);

  await editorCtx.close();
} catch (err) {
  const text = await page.locator("body").innerText().catch(() => "");
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        text: text.slice(0, 1500),
        consoleErrors,
      },
      null,
      2,
    ),
  );
  await browser.close();
  process.exit(1);
}

await browser.close();

const tooSmall = measurements.filter((row) => row.underCount > 0);
const result = {
  ok: consoleErrors.length === 0 && tooSmall.length === 0,
  base,
  outDir,
  cardOrder,
  controls,
  measurements,
  consoleErrorCount: consoleErrors.length,
  consoleErrors: consoleErrors.slice(0, 20),
  shotCount: shots.length,
  shots,
};
writeFileSync(resolve(outDir, "cx-server-shots.json"), JSON.stringify(result, null, 2));
writeFileSync(
  resolve(outDir, "cx-server-controls.json"),
  JSON.stringify({ base, controls, cardOrder }, null, 2),
);
console.log(
  JSON.stringify(
    {
      ok: result.ok,
      cards: { owner: cardOrder.owner?.length, editor: cardOrder.editor?.length },
      controls: controls.length,
      measures: measurements.length,
      under14: tooSmall.length,
      shots: shots.length,
      consoleErrors,
    },
    null,
    2,
  ),
);
process.exit(result.ok ? 0 : 1);
