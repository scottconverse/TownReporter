#!/usr/bin/env node
/**
 * The front page "Latest stories" river, in a browser.
 *
 * The owner asked for more than five stories on the front page, loading in the
 * order they were published. The top of the page is unchanged; below it the
 * river prints every published story, newest first, and pulls the next batch in
 * when a sentinel near the bottom scrolls into view -- with a visible button
 * under the list as the fallback for a keyboard, a slow connection, or a
 * browser with no observer at all.
 *
 * This walk drives the built server in-process against its own in-memory PGlite
 * (never Postgres: DATABASE_URL is cleared below), seeds 40 published stories
 * plus one draft, and asserts on the real DOM at every step.
 *
 *   node scripts/front-page-river-e2e.mjs
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";

/**
 * This walk's own listen port, registered with
 * scripts/integration-ports-are-unique.test.mjs so no other integration file
 * can quietly bind it and answer this one's requests.
 */
const PORT_FRONT_PAGE_RIVER = 3517;

const REPO = process.cwd();
const SHOTS = "C:/Users/scott/Desktop/Code/townreporter-deepseek-oversight/scratch/T";
const base = checkedUrl(`http://127.0.0.1:${PORT_FRONT_PAGE_RIVER}`);

/** Published stories seeded, newest first: "River story 01" is the newest. */
const SEEDED = 40;
/** The front page's top section prints the first six; the river carries the rest. */
const ABOVE = 6;
const RIVER = SEEDED - ABOVE; // 34
const BATCH = 12;

let page;
const done = [];
const shot = [];

function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}

function headline(n) {
  return `River story ${String(n).padStart(2, "0")}`;
}

async function dump(err) {
  const message = err instanceof Error ? err.message : String(err);
  let url = "";
  let text = "";
  try {
    url = page?.url() ?? "";
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 1200);
  } catch {
    /* page already gone */
  }
  console.error(JSON.stringify({ ok: false, error: message, url, text, completed: done }, null, 2));
  process.exit(1);
}

/** Boot the built server here, in this process, on its own port and database. */
async function bootTheServer() {
  process.env.PORT = String(PORT_FRONT_PAGE_RIVER);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.BETTER_AUTH_SECRET ||= "front-page-river-e2e-secret";
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

async function seedThePaper() {
  const pg = await globalThis.__pgliteInstance__;
  if (!pg) throw new Error("the server booted without a PGlite instance to seed");
  await pg.query(
    `insert into paper_settings (newsroom_id, onboarded) values (1, true)
     on conflict (newsroom_id) do update set onboarded = true`,
  );
  // A paper this walk controls: the migration seeds its own welcome story, and
  // every count below is exact.
  await pg.query("delete from articles");
  for (let n = 1; n <= SEEDED; n += 1) {
    await pg.query(
      `insert into articles (user_id, slug, headline, dek, body, topic, source_urls, status, published_at)
       values ('river-e2e', $1, $2, $3, $4, 'council', '[]', 'published',
               now() - ($5 || ' minutes')::interval)`,
      [
        `river-e2e-${n}`,
        headline(n),
        `Dek for river story ${n}, one line of it.`,
        `Body text for river story ${n}. A sentence or two of it, long enough to read as a story.`,
        String(n),
      ],
    );
  }
  await pg.query(
    `insert into articles (user_id, slug, headline, dek, body, topic, source_urls, status, published_at)
     values ('river-e2e', 'river-e2e-draft', 'A DRAFT THAT MUST NOT PRINT', 'Dek', 'Body.',
             'council', '[]', 'draft', now())`,
  );
  step(`seeded ${SEEDED} published stories and one draft`);
}

/** Every headline the page prints, in document order. */
async function printedHeadlines() {
  return page.evaluate(() =>
    [...document.querySelectorAll("h2, h3, .record-list strong")].map((el) =>
      (el.textContent || "").trim(),
    ),
  );
}

async function riverRows() {
  return page.locator(".river .newsrow").count();
}

async function waitForRows(n, note) {
  await page.waitForFunction(
    (want) => document.querySelectorAll(".river .newsrow").length === want,
    n,
    { timeout: 30_000 },
  );
  step(note);
}

function screenshot(name, width, height) {
  mkdirSync(SHOTS, { recursive: true });
  const file = join(SHOTS, name);
  return page
    .setViewportSize({ width, height })
    .then(() => page.screenshot({ path: file, fullPage: false }))
    .then(() => {
      shot.push(file);
      step(`screenshot ${name}`);
    });
}

/** The first batch is server-rendered: no JavaScript has run yet. */
async function theHtmlCarriesTheFirstBatch() {
  const html = await (await fetch(`${base}/`)).text();
  const missing = [];
  for (let n = ABOVE + 1; n <= ABOVE + BATCH; n += 1) {
    if (!html.includes(headline(n))) missing.push(headline(n));
  }
  if (missing.length) throw new Error(`the server-rendered HTML is missing ${missing.join(", ")}`);
  for (let n = 1; n <= ABOVE; n += 1) {
    if (!html.includes(headline(n))) throw new Error(`the top of the page lost ${headline(n)}`);
  }
  if (!html.includes('href="/?view=archive&amp;page=2"') && !html.includes('href="/?view=archive&page=2"'))
    throw new Error("the Load more fallback is not a real link to the archive");
  if (html.includes("A DRAFT THAT MUST NOT PRINT")) throw new Error("the draft reached the front page");
  const newest = html.indexOf(headline(ABOVE + 1));
  const older = html.indexOf(headline(ABOVE + BATCH));
  if (newest < 0 || older < 0 || newest > older)
    throw new Error("the first batch is not newest first in the HTML");
  step(`the first ${BATCH} river stories are server-rendered, newest first, as links`);
}

async function theFrontPageRendersTheTopAndTheFirstBatch() {
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1, name: /A clearer view of/ }).waitFor({ timeout: 30_000 });
  await page.getByRole("heading", { level: 2, name: "Latest stories" }).waitFor({ timeout: 30_000 });
  step("the front page renders its masthead and the Latest stories heading");

  await waitForRows(BATCH, `the river opens with one server-rendered batch of ${BATCH}`);

  const first = (await page.locator(".river .newsrow h3").first().innerText()).trim();
  if (first !== headline(ABOVE + 1))
    throw new Error(`the river starts at ${first}, not ${headline(ABOVE + 1)}`);

  // The stories above the river are not repeated inside it.
  // The lead, the record list and "The latest" list: the six the river leaves out.
  const top = await printedHeadlines();
  const above = [...new Set(top.filter((h) => /^River story 0[1-6]$/.test(h)))].sort();
  if (above.length !== ABOVE)
    throw new Error(`the top of the page printed ${above.length} of its ${ABOVE} stories`);
  const river = await page.locator(".river .newsrow h3").allInnerTexts();
  const repeated = river.filter((h) => above.includes(h.trim()));
  if (repeated.length) throw new Error(`the river repeats ${repeated.join(", ")}`);
  step("no story from the top of the page is printed again in the river");

  await page.getByRole("link", { name: "Load more stories" }).waitFor({ timeout: 10_000 });
  step("the Load more fallback link is visible under the list");
}

async function scrollingLoadsTheNextBatch() {
  await page.locator(".riversentinel").scrollIntoViewIfNeeded();
  await waitForRows(BATCH * 2, `scrolling the sentinel into view loaded a second batch of ${BATCH}`);
}

async function theButtonLoadsAnother() {
  const before = await riverRows();
  const link = page.getByRole("link", { name: "Load more stories" });
  await link.click();
  await page.waitForFunction(
    (want) => document.querySelectorAll(".river .newsrow").length > want,
    before,
    { timeout: 30_000 },
  );
  await waitForRows(RIVER, `the button loaded the rest: ${RIVER} river rows in all`);
}

async function theEndMessageAppearsAndNothingRepeats() {
  await page.getByText(/reached the first story we published/).waitFor({ timeout: 30_000 });
  step("every story shown, the page says you've reached the first story we published");

  const count = await riverRows();
  if (count !== RIVER) throw new Error(`the river ends with ${count} rows, expected ${RIVER}`);

  const headlines = (await page.locator(".river .newsrow h3").allInnerTexts()).map((h) => h.trim());
  const seen = new Set(headlines);
  if (seen.size !== headlines.length)
    throw new Error(`a headline appears twice in the river: ${headlines.length} rows, ${seen.size} titles`);

  /*
    Every river story, counted across the WHOLE page. The top of the page prints
    its own first six twice (the "Around the publication" record list overlaps
    "The latest" list -- it did before this unit, and is not this unit's to
    change), so those six are expected twice; every other story is expected
    exactly once, in the river.
  */
  const whole = await page.locator("body").innerText();
  const wrong = [];
  for (let n = 1; n <= SEEDED; n += 1) {
    const printed = whole.split(headline(n)).length - 1;
    // The six above the river are the top section's business, and it prints its
    // own middle three twice (the record list overlaps "The latest" -- measured,
    // and true before this unit). A river story prints exactly once, here.
    if (n > ABOVE && printed !== 1) wrong.push(`${headline(n)} printed ${printed}x, expected once`);
    if (n <= ABOVE && printed < 1) wrong.push(`${headline(n)} vanished from the top of the page`);
  }
  if (wrong.length) throw new Error(wrong.join("; "));
  if (whole.includes("DRAFT THAT MUST NOT PRINT")) throw new Error("the draft is on the page");
  step(
    `all ${RIVER} river stories distinct, and every one of them printed exactly once on the page`,
  );

  const last = headlines.at(-1);
  if (last !== headline(SEEDED)) throw new Error(`the oldest river story is ${last}`);
  step(`the river ends at the oldest story, ${headline(SEEDED)}, in publication order`);
}

/** The fallback path, with no observer in the browser at all. */
async function theButtonWorksWithoutAnObserver(browser, main) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    // What a browser without the API looks like: `typeof` is "undefined".
    Object.defineProperty(window, "IntersectionObserver", { value: undefined, configurable: true });
  });
  const plain = await context.newPage();
  page = plain;
  try {
    await plain.goto(`${base}/`, { waitUntil: "networkidle" });
    await plain.locator(".river .newsrow").first().waitFor({ timeout: 30_000 });
    const count = await plain.locator(".river .newsrow").count();
    if (count !== BATCH) throw new Error(`${count} rows on a fresh page, expected ${BATCH}`);
    step("a fresh front page still shows one server-rendered batch");
    const noObserver = await plain.evaluate(() => typeof window.IntersectionObserver === "undefined");
    if (!noObserver) throw new Error("the observer was not removed, so this is not the fallback path");

    for (const want of [BATCH * 2, RIVER]) {
      await plain.getByRole("link", { name: "Load more stories" }).click();
      await plain.waitForFunction(
        (n) => document.querySelectorAll(".river .newsrow").length === n,
        want,
        { timeout: 30_000 },
      );
    }
    await plain.getByText(/reached the first story we published/).waitFor({ timeout: 30_000 });
    step("with no IntersectionObserver at all, the button alone loads every remaining batch");
  } finally {
    page = main;
    await context.close();
  }
}

async function theListIsReadableWithNoJavaScript(browser, main) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const still = await context.newPage();
  page = still;
  try {
    await still.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await still
      .getByRole("heading", { level: 2, name: "Latest stories" })
      .waitFor({ timeout: 30_000 });
    const rows = await still.locator(".river .newsrow").count();
    if (rows !== BATCH) throw new Error(`${rows} rows without JavaScript, expected ${BATCH}`);
    await still.getByRole("link", { name: "Load more stories" }).waitFor({ timeout: 10_000 });
    step("with JavaScript switched off the river still reads, and the fallback link is there");
  } finally {
    page = main;
    await context.close();
  }
}

async function theScreenshots(main) {
  for (const [width, height] of [
    [1280, 900],
    [375, 720],
  ]) {
    await main.setViewportSize({ width, height });
    // A fresh load, brought to the river: the section as a reader first meets it.
    await main.goto(`${base}/`, { waitUntil: "networkidle" });
    await main.locator(".river .newsrow").first().waitFor({ timeout: 30_000 });
    await main.locator("#latest-stories").scrollIntoViewIfNeeded();
    await screenshot(`front-page-river-${width}-light.png`, width, height);
    // The mode the reader's own switch sets, on the element the provider owns.
    await main.evaluate(() => document.querySelector(".reader")?.classList.add("mode-dark"));
    await screenshot(`front-page-river-${width}-dark.png`, width, height);
    await main.evaluate(() => document.querySelector(".reader")?.classList.remove("mode-dark"));
  }
}

async function main() {
  await bootTheServer();
  await seedThePaper();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    // The fallback is tested on its own page, later, with this removed.
    deviceScaleFactor: 1,
  });
  page = await context.newPage();
  try {
    await theHtmlCarriesTheFirstBatch();
    await theFrontPageRendersTheTopAndTheFirstBatch();
    await scrollingLoadsTheNextBatch();
    await theButtonLoadsAnother();
    await theEndMessageAppearsAndNothingRepeats();
    await theListIsReadableWithNoJavaScript(browser, page);
    await theButtonWorksWithoutAnObserver(browser, page);
    await theScreenshots(page);
  } catch (err) {
    await dump(err);
  }
  await browser.close();
  console.log(JSON.stringify({ ok: true, steps: done.length, screenshots: shot }, null, 2));
  process.exit(0);
}

await main();
