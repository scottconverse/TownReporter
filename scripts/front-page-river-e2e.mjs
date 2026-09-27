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
 * The second half of the unit's rule is here too: NO story is printed twice on
 * the front page. The lead, the cells of the ruled grid under it, the opinion
 * band beside "Around the region" and the river read the same paper, so every
 * card on the page is counted -- on the server-rendered HTML, where a crawler
 * or a reader with no JavaScript stops, and again after two river batches have
 * loaded.
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
/**
 * The front page's top section prints the first seven -- the lead, and the six
 * cells of the ruled grid under it (src/routes/index.tsx: TOP_STORIES =
 * 1 + GRID_CELLS, GRID_CELLS = 6).
 *
 * Seven, not the nine this walk was written against: the approved design puts
 * one lead and a six-cell grid above the band, and no "More of the story" box
 * beside the lead. `docs/design/handoff-2026-09-26/design/Front Daily.dc.html`:
 * the lead row is line 34 (`.lead`, one story), the grid is line 56 with
 * `hint-placeholder-count="6"` (line 57) over `six`, and `six` is
 * `phone ? S.slice(0, 4) : S` (line 125) with the desktop columns
 * `--sixCols: "repeat(3,minmax(0,1fr))"` (line 109) -- six cells on a desktop
 * viewport, the one this walk drives.
 */
const ABOVE = 7;
/**
 * Two opinion pieces. The first sits inside the top seven, where the opinion
 * band would print it a second time; the second sits below, and is the newest
 * opinion piece left for the band once the top seven are excluded.
 */
const OPINION_IN_TOP = 3;
const OPINION_BAND = 20;
/** The river's rows: the paper, less the top seven, less the band's piece. */
const RIVER = SEEDED - ABOVE - 1; // 32
const BATCH = 12;

let page;
const done = [];
const shot = [];
/** What each screenshot measured at the shutter: colour, background, contrast. */
const facts = [];

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
  /*
    The PGlite global resolves to the instance, not to a MIGRATED instance.
    `createPgliteSql` (src/lib/db.ts) publishes `__pgliteInstance__` and only
    then applies migrations/ on top of it, and `bootTheServer` above returns as
    soon as `/` answers -- which an unmigrated server can do out of an error or
    empty state. Awaiting the global and seeding straight away is therefore a
    race: the seed can die on `relation "paper_settings" does not exist`, or
    (worse, because it looks like a real failure) it can seed fine while the
    server is still mid-migration and then render a page with no river at all.
    Both were seen on this machine, several runs in a row.

    Wait for the migration pass to go QUIET: `_migrations` stops growing. A
    fixed table name is not enough -- `paper_settings` is created early and the
    later files are what the front page's queries need.
  */
  let applied = -1;
  let quiet = 0;
  for (let i = 0; i < 240 && quiet < 3; i += 1) {
    let count = -1;
    try {
      count = Number(
        (await pg.query("select count(*)::int as n from _migrations")).rows[0]?.n,
      );
    } catch {
      /* the migrations table itself is not there yet */
    }
    if (count === applied && count >= 0) quiet += 1;
    else {
      quiet = 0;
      applied = count;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  await pg.query(
    `insert into paper_settings (newsroom_id, onboarded) values (1, true)
     on conflict (newsroom_id) do update set onboarded = true`,
  );
  // A paper this walk controls: the migration seeds its own welcome story, and
  // every count below is exact.
  await pg.query("delete from articles");
  for (let n = 1; n <= SEEDED; n += 1) {
    const topic = n === OPINION_IN_TOP || n === OPINION_BAND ? "opinion" : "council";
    await pg.query(
      `insert into articles (user_id, slug, headline, dek, body, topic, source_urls, status, published_at)
       values ('river-e2e', $1, $2, $3, $4, $5, '[]', 'published',
               now() - ($6 || ' minutes')::interval)`,
      [
        `river-e2e-${n}`,
        headline(n),
        `Dek for river story ${n}, one line of it.`,
        `Body text for river story ${n}. A sentence or two of it, long enough to read as a story.`,
        topic,
        String(n),
      ],
    );
  }
  await pg.query(
    `insert into articles (user_id, slug, headline, dek, body, topic, source_urls, status, published_at)
     values ('river-e2e', 'river-e2e-draft', 'A DRAFT THAT MUST NOT PRINT', 'Dek', 'Body.',
             'council', '[]', 'draft', now())`,
  );
  step(`seeded ${SEEDED} published stories (two of them opinion) and one draft`);
}

/** Every headline the page prints, in document order. */
async function printedHeadlines() {
  return page.evaluate(() =>
    [...document.querySelectorAll("h2, h3")].map((el) => (el.textContent || "").trim()),
  );
}

/**
 * Every story on the page, once.
 *
 * A CARD is one printed slot -- the lead, a cell of the ruled grid, the opinion
 * band's card, a row in the river -- and a card may hold two links to the same
 * story (the lead prints a headline link and a "Read the story" button). So the
 * slugs are deduped PER CARD first, then no slug may appear in two cards.
 * Counting raw anchors would flag the lead's own button as a repeat; counting
 * headlines would miss a card that links the wrong story.
 *
 * The selector follows the redesign's markup, not the page it replaced: the
 * old top was `.record-list li` under "The latest" plus an `.opinionfeature`
 * box; the approved design puts `.storycell` cells in a `.storygrid` and the
 * band's card in `.opinionpanel` (`docs/design/handoff-2026-09-26/design/Front
 * Daily.dc.html:56`, and `src/components/paper/story-grid.tsx`).
 */
async function assertEveryStoryIsPrintedOnce(pg, when) {
  const cards = await pg.evaluate(() => {
    const selector = ".lead, .storycell, .regionlist li, .newsrow, .opinionpanel";
    return [...document.querySelectorAll(selector)].map((card) => ({
      where: (card.className || card.tagName).trim(),
      slugs: [
        ...new Set(
          [...card.querySelectorAll('a[href^="/articles/"]')].map((a) =>
            a.getAttribute("href").replace("/articles/", ""),
          ),
        ),
      ],
    }));
  });
  if (!cards.length) throw new Error(`${when}: the page printed no story cards at all`);

  const seen = new Map();
  for (const card of cards) {
    if (card.slugs.length !== 1)
      throw new Error(
        `${when}: a ${card.where} card links ${card.slugs.length} stories (${card.slugs.join(", ")})`,
      );
    const slug = card.slugs[0];
    seen.set(slug, [...(seen.get(slug) ?? []), card.where]);
  }
  const repeated = [...seen].filter(([, where]) => where.length > 1);
  if (repeated.length) {
    const detail = repeated
      .map(([slug, where]) => `${slug} in ${where.length} cards (${where.join(", ")})`)
      .join("; ");
    throw new Error(`${when}: ${repeated.length} stories printed twice: ${detail}`);
  }
  if (seen.size !== cards.length)
    throw new Error(`${when}: ${cards.length} cards carry only ${seen.size} stories`);
  return { cards: cards.length, stories: seen.size };
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

/**
 * Take one screenshot, with every animation on the page finished first.
 *
 * `.reader a h3` fades its colour over 0.16s (`src/reader-astra.css:86-90`), so
 * a shot taken the instant the mode class lands catches the headline between
 * two colours. `reducedMotion: "reduce"` on the context makes the stylesheet's
 * own rule (`src/reader-astra.css:1450-1455`) drop the transition altogether,
 * and `getAnimations().finish()` catches anything that is not CSS motion. The
 * colour is measured with `getComputedStyle` at the moment of the shutter, and
 * printed, so the picture in the report matches the picture in the file.
 */
async function screenshot(pg, name, width, height) {
  const measured = await pg.evaluate(() => {
    const running = document.getAnimations();
    /*
      Name the property AND the element it was running on, so the report can say
      whether the headline itself was caught mid-fade or whether what finished
      was the page backdrop outside `.reader`.
    */
    const names = running.map((a) => {
      const target = a.effect?.target;
      const where = target?.className ? `.${String(target.className).split(" ")[0]}` : "?";
      return `${a.transitionProperty || a.animationName || "?"} on ${where}`;
    });
    running.forEach((a) => a.finish());
    /*
      The headline the shot actually contains: the first linked `h3` whose box
      is on screen at the shutter, not merely the first in the DOM. Reporting a
      colour off-screen would describe a pixel the file does not hold.
    */
    const linked = [...document.querySelectorAll(".reader a h3")];
    const h3 =
      linked.find((el) => {
        const r = el.getBoundingClientRect();
        return r.top < innerHeight && r.bottom > 0;
      }) ??
      linked[0] ??
      document.querySelector(".river .newsrow h3");
    let background = "rgba(0, 0, 0, 0)";
    let el = h3;
    while (el && (background === "rgba(0, 0, 0, 0)" || background === "transparent")) {
      background = getComputedStyle(el).backgroundColor;
      el = el.parentElement;
    }
    return {
      headline: (h3.textContent || "").trim(),
      color: getComputedStyle(h3).color,
      background,
      finishedAnimations: names,
    };
  });
  mkdirSync(SHOTS, { recursive: true });
  const file = join(SHOTS, name);
  await pg.screenshot({ path: file, fullPage: false });
  shot.push(file);
  const contrast = contrastRatio(measured.color, measured.background);
  step(
    `screenshot ${name}: "${measured.headline}" ${measured.color} on ${measured.background}, ` +
      `${contrast.toFixed(2)}:1, animations finished: ` +
      `${measured.finishedAnimations.join(", ") || "none"}`,
  );
  return { file, width, height, contrast: Number(contrast.toFixed(2)), ...measured };
}

/** WCAG 2.1 relative luminance and contrast ratio, from two `rgb()` strings. */
function contrastRatio(fg, bg) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (css) => {
    const [r, g, b] = css.match(/[\d.]+/g).slice(0, 3).map(Number);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/**
 * The page as the server sent it, with no script run: the HTML a crawler and a
 * reader without JavaScript get. Hydration can only add a repeat, never remove
 * one, so this is where the rule has to hold first.
 */
async function theServerRenderedHtmlPrintsEveryStoryOnce(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route("**/*", (route) =>
    route.request().resourceType() === "script" ? route.abort() : route.continue(),
  );
  const server = await context.newPage();
  try {
    await server.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await server.locator("#latest-stories").waitFor({ timeout: 30_000 });
    const counts = await assertEveryStoryIsPrintedOnce(server, "server-rendered");
    // The seven above the river, the opinion band's own card, and one batch.
    const expected = ABOVE + 1 + BATCH;
    if (counts.cards !== expected)
      throw new Error(
        `the server-rendered page holds ${counts.cards} cards, expected ${expected} (${ABOVE} above the river, the opinion band and one batch)`,
      );
    step(`the server-rendered HTML prints ${counts.stories} stories in ${counts.cards} cards, once each`);
  } finally {
    await context.close();
  }
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
  /*
    The masthead's wordmark, not an `h1` tagline.

    The old front page opened with `<h1>A clearer view of {city}.</h1>`
    (`main:src/routes/index.tsx:208`), and this step waited on it. The redesign
    removed that heading: the prototype's front page carries no `h1` at all --
    its top-of-page identity is the wordmark beside the city tag
    (`docs/design/handoff-2026-09-26/design/Front Daily.dc.html:22-23`,
    `TownReporter` / `Longmont`) sitting over the dateline (`:15`) -- and the
    tagline became footer body copy in the shipped product
    (`src/components/paper-chrome.tsx`, the `<p>A clearer view of ...`). So the
    step waits on the shipped masthead hook instead, `.mast .brand`, which
    carries the paper's own name. The `Latest stories` heading is unchanged and
    still the river's own `h2#latest-stories`.
  */
  await page.locator(".mast .brand").waitFor({ timeout: 30_000 });
  await page.getByRole("heading", { level: 2, name: "Latest stories" }).waitFor({ timeout: 30_000 });
  step("the front page renders its masthead and the Latest stories heading");

  await waitForRows(BATCH, `the river opens with one server-rendered batch of ${BATCH}`);

  const first = (await page.locator(".river .newsrow h3").first().innerText()).trim();
  if (first !== headline(ABOVE + 1))
    throw new Error(`the river starts at ${first}, not ${headline(ABOVE + 1)}`);

  /*
    The seven the river leaves out: the lead and the six cells of the ruled grid
    under it. Each is printed once up there, and none of them appears again
    inside the river.

    The region band prints nothing in this walk: the seeds carry no `area`, and a
    null area reads as the home town (`src/lib/story-area.ts`), so "Around the
    region" has no ground to print. The census names `.regionlist li` anyway, so
    a story printed there would be counted rather than quietly missed.
  */
  const top = await printedHeadlines();
  const above = [];
  for (let n = 1; n <= ABOVE; n += 1) {
    const printed = top.filter((h) => h === headline(n)).length;
    if (printed !== 1) throw new Error(`${headline(n)} is printed ${printed}x above the river`);
    above.push(headline(n));
  }
  const river = await page.locator(".river .newsrow h3").allInnerTexts();
  const repeated = river.filter((h) => above.includes(h.trim()));
  if (repeated.length) throw new Error(`the river repeats ${repeated.join(", ")}`);
  step(`the ${ABOVE} stories above the river are each printed once, and none of them in the river`);

  await page.getByRole("link", { name: "Load more stories" }).waitFor({ timeout: 10_000 });
  step("the Load more fallback link is visible under the list");
}

/**
 * The band takes an opinion story the top of the page has not printed.
 *
 * `main:src/routes/index.tsx:328` wrapped it in `<section class="opinionband">`;
 * the redesign makes it an `<aside class="opinionpanel">`
 * (`src/routes/index.tsx:536`), which is the shape the prototype draws -- the
 * band's own heading over one headline link and "All opinion →"
 * (`docs/design/handoff-2026-09-26/design/Front Daily.dc.html:80-82`). The `<h3>`
 * headline this step reads is the same `<h3>` in both, so the assertion is
 * unchanged; only the hook moved.
 */
async function theOpinionBandTakesAnOpinionStoryTheTopHasNotPrinted() {
  await page.getByRole("heading", { level: 2, name: "Opinion" }).waitFor({ timeout: 30_000 });
  const shown = (await page.locator(".opinionpanel h3").innerText()).trim();
  if (shown !== headline(OPINION_BAND))
    throw new Error(
      `the opinion band prints ${shown}; ${headline(OPINION_BAND)} is the newest opinion story the top seven do not carry`,
    );
  step(`the opinion band prints ${shown}, not the opinion story the top of the page already carries`);
}

/** The same count with a second river batch loaded. */
async function noStoryIsPrintedTwiceTwoBatchesIn() {
  const counts = await assertEveryStoryIsPrintedOnce(page, "two batches in");
  const expected = ABOVE + 1 + BATCH * 2;
  if (counts.cards !== expected)
    throw new Error(`${counts.cards} cards on the page, expected ${expected}`);
  step(`with ${BATCH * 2} river rows loaded, all ${counts.stories} cards hold a different story`);
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
    Every story, counted across the WHOLE page -- the top section, the band and
    the river together. Each of the forty is owed the reader exactly one card.
  */
  const whole = await page.locator("body").innerText();
  const wrong = [];
  for (let n = 1; n <= SEEDED; n += 1) {
    const printed = whole.split(headline(n)).length - 1;
    if (printed !== 1) wrong.push(`${headline(n)} printed ${printed}x, expected once`);
  }
  if (wrong.length) throw new Error(wrong.join("; "));
  if (whole.includes("DRAFT THAT MUST NOT PRINT")) throw new Error("the draft is on the page");
  step(`all ${SEEDED} published stories are printed exactly once across the whole page`);

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

async function theScreenshots(browser, main) {
  /*
    This page's own context, with `prefers-reduced-motion: reduce`, so the
    headline is at its final colour when the shutter opens -- the bug the owner
    saw was a headline caught mid-fade, not a dark-mode colour that is wrong.
  */
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const sheet = await context.newPage();
  try {
    for (const [width, height] of [
      [1280, 900],
      [375, 720],
    ]) {
      await sheet.setViewportSize({ width, height });
      // A fresh load, brought to the river: the section as a reader first meets it.
      await sheet.goto(`${base}/`, { waitUntil: "networkidle" });
      await sheet.locator(".river .newsrow").first().waitFor({ timeout: 30_000 });
      await sheet.locator("#latest-stories").scrollIntoViewIfNeeded();
      facts.push(await screenshot(sheet, `front-page-river-${width}-light.png`, width, height));
      // The mode the reader's own switch sets, on the element the provider owns.
      await sheet.evaluate(() => document.querySelector(".reader")?.classList.add("mode-dark"));
      facts.push(await screenshot(sheet, `front-page-river-${width}-dark.png`, width, height));
      await sheet.evaluate(() => document.querySelector(".reader")?.classList.remove("mode-dark"));
    }
  } finally {
    page = main;
    await context.close();
  }
}

/**
 * A three-story paper prints three cards, and no river.
 *
 * Three stories: the lead is the first, the ruled grid carries the other two,
 * and there is no fourth story to fill a third cell. Nothing is padded out with
 * a story the page already prints, and the river is left out entirely because
 * there is nothing left for it.
 *
 * "This week" is NOT left out, and the lead does not take the whole width. The
 * approved design keeps the lead and the panel side by side in one row --
 * `docs/design/handoff-2026-09-26/design/Front Daily.dc.html:34`, with the
 * desktop columns `--leadCols: "minmax(0,1.7fr) minmax(0,1fr)"` at line 109 --
 * and the panel's empty state is first-class (`src/components/paper/dates-panel
 * .tsx:38-41`). So the claim measured here is the design's own row: the lead is
 * a share of `.ledgerow`, never the whole of it (`src/reader-astra.css:2254`);
 * the single-column collapse is under 900px (`:3211`), off this walk's 1280px.
 *
 * This runs last: it deletes the rest of the paper.
 */
async function aThreeStoryPaperPrintsThreeCardsAndNoRiver() {
  const pg = await globalThis.__pgliteInstance__;
  await pg.query(
    `delete from articles where slug not in ('river-e2e-1','river-e2e-2','river-e2e-3')`,
  );
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 2, name: headline(1) }).waitFor({ timeout: 30_000 });
  const counts = await assertEveryStoryIsPrintedOnce(page, "three stories in");
  if (counts.cards !== 3)
    throw new Error(`the short front page prints ${counts.cards} cards, expected 3`);
  if ((await page.locator(".storygrid .storycell").count()) !== 2)
    throw new Error("the grid did not stop at the two stories the lead leaves");
  if (await page.locator(".river").count())
    throw new Error("a river with nothing left in it was rendered");
  await page.locator(".ledgerow > .datespanel .datesempty").waitFor({ timeout: 10_000 });
  // `clientWidth` is the row's inside width: the 1px rules between the columns
  // are the row's own background showing through a gap, not a border, so the
  // two column widths already add up to it.
  const [row, lead] = await page.evaluate(() => [
    document.querySelector(".ledgerow")?.clientWidth ?? 0,
    document.querySelector(".lead")?.getBoundingClientRect().width ?? 0,
  ]);
  if (!(lead > 0 && lead < row - 40))
    throw new Error(
      `the lead is ${Math.round(lead)}px inside a ${Math.round(row)}px lead row: This week is not beside it`,
    );
  step("with three stories each is printed once, and the lead keeps its column beside This week");
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
    await theServerRenderedHtmlPrintsEveryStoryOnce(browser);
    await theHtmlCarriesTheFirstBatch();
    await theFrontPageRendersTheTopAndTheFirstBatch();
    await theOpinionBandTakesAnOpinionStoryTheTopHasNotPrinted();
    await scrollingLoadsTheNextBatch();
    await noStoryIsPrintedTwiceTwoBatchesIn();
    await theButtonLoadsAnother();
    await theEndMessageAppearsAndNothingRepeats();
    await theListIsReadableWithNoJavaScript(browser, page);
    await theButtonWorksWithoutAnObserver(browser, page);
    await theScreenshots(browser, page);
    await aThreeStoryPaperPrintsThreeCardsAndNoRiver();
  } catch (err) {
    await dump(err);
  }
  await browser.close();
  console.log(JSON.stringify({ ok: true, steps: done.length, screenshots: shot, measured: facts }, null, 2));
  process.exit(0);
}

await main();
