#!/usr/bin/env node
/**
 * The front page "Latest stories" river, in a browser.
 *
 * Unit BX (design round 1) changed what this walk measures, so the walk changed
 * with it. The front page's river is now SIX stories, newest first, and an
 * "All stories ->" link in the section head as the way to the rest -- the
 * infinite scroll, its sentinel and the "Load more stories" button are gone
 * from the front page. The claim the old machinery carried is not dropped with
 * it: the rest of the paper must still be reachable from the front page, and it
 * is reachable one hop away, on the archive, which `theArchiveCarriesTheRestOfThePaper`
 * now measures by clicking through the pagination to the oldest story.
 *
 * This walk drives the built server in-process against its own in-memory PGlite
 * (never Postgres: DATABASE_URL is cleared below), seeds 40 published stories
 * plus one draft, and asserts on the real DOM at every step.
 *
 * The second half of the unit's rule is here too: NO story is printed twice on
 * the front page. The lead, the cells of the ruled grid under it, the opinion
 * band beside "Around the region" and the river read the same paper, so every
 * card on the page is counted -- on the server-rendered HTML, where a crawler
 * or a reader with no JavaScript stops, and again on the hydrated page.
 *
 * What this walk no longer covers, and what covers it: the sentinel's scroll
 * trigger, the button's batching and the no-IntersectionObserver fallback are
 * gone from the product, so their three scenarios are gone from here rather
 * than kept green against code that no longer exists. Nothing about reach was
 * lost with them -- the archive step below asserts the same end state the
 * button used to reach (every published story printed and reachable), which is
 * the check that survives the removal.
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
 * The front page's top section prints the first nine -- the lead, the six cells
 * of the ruled grid under it, and the lead column's own two rows
 * (src/routes/index.tsx: TOP_STORIES = 1 + GRID_CELLS, GRID_CELLS = 6, and
 * ALSO_ROWS = 2).
 *
 * Nine, not the seven this walk was written against: the approved design puts
 * one lead and a six-cell grid above the band, and no "More of the story" box
 * beside the lead. `docs/design/handoff-2026-09-26/design/Front Daily.dc.html`:
 * the lead row is line 34 (`.lead`, one story), the grid is line 56 with
 * `hint-placeholder-count="6"` (line 57) over `six`, and `six` is
 * `phone ? S.slice(0, 4) : S` (line 125) with the desktop columns
 * `--sixCols: "repeat(3,minmax(0,1fr))"` (line 109) -- six cells on a desktop
 * viewport, the one this walk drives. The two rows under the lead are unit CN,
 * item 1(b): the drawing has no such list (see the report), and the owner asked
 * for them by name to fill the column the panel used to leave blank.
 */
const ABOVE = 9;
/**
 * Two opinion pieces, and the shape unit BZ item 9 gave the page.
 *
 * The newest is story 3 (`OPINION_NEWEST`): the opinion band prints it. It sits
 * INSIDE the top nine's range on purpose -- the number that used to matter is
 * the one that must not matter any more. The band used to take "the newest
 * opinion the top has NOT printed", so a piece here pushed the box down to the
 * older one; since the edition read skips opinion, the band takes the newest
 * piece the paper has, and this one is it.
 *
 * The older (`OPINION_OLDER`, story 20) is below the fold, so the river has an
 * opinion piece in it -- Latest stories still lists opinion (item 9).
 */
const OPINION_NEWEST = 3;
const OPINION_OLDER = 20;
/**
 * The nine the top of the page prints: the lead and the six cells of the ruled
 * grid, and the lead column's own two rows. NEWS ONLY -- the edition read passes
 * `notTopic: "opinion"` (`src/routes/index.tsx`), so the top nine are the nine
 * newest stories that are not opinion, which is 1..10 less the band's own piece.
 *
 * The two rows are unit CN, item 1(b) (`ALSO_ROWS` in `src/routes/index.tsx`):
 * the lead and "This week" are one grid row, and with the panel capped at the
 * drawing's five the column still ended far below the lead's button, so the
 * column prints the paper's next stories under it. They are the top's stories
 * like any other card -- the river leaves them out, and this walk counts them
 * above the river the way it counts the grid.
 */
const TOP = [1, 2, 4, 5, 6, 7, 8, 9, 10];
/** The newest story in the river, and therefore what the top of the page stops at. */
const RIVER_FIRST = 11;
/** The river's rows: the paper, less the top nine, less the band's piece. */
const RIVER = SEEDED - ABOVE - 1; // 30
/**
 * How many of those the front page prints, and therefore how many are left for
 * the archive (unit BX).
 *
 * `LISTED` is `RIVER_BATCH` in `src/routes/index.tsx`: the design's front page
 * ends after six river rows and one "All stories ->" link. `REST` is what the
 * archive owes the reader -- every published story the front page did not print
 * -- and it is the number the archive step at the end of this walk counts.
 */
const LISTED = 6;
const REST = RIVER - LISTED; // 26

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
    const topic = n === OPINION_NEWEST || n === OPINION_OLDER ? "opinion" : "council";
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
    // The seven above the river, the opinion band's own card, and the six rows.
    const expected = ABOVE + 1 + LISTED;
    if (counts.cards !== expected)
      throw new Error(
        `the server-rendered page holds ${counts.cards} cards, expected ${expected} (${ABOVE} above the river, the opinion band and ${LISTED} river rows)`,
      );
    step(`the server-rendered HTML prints ${counts.stories} stories in ${counts.cards} cards, once each`);
  } finally {
    await context.close();
  }
}

/** The river rows are server-rendered: no JavaScript has run yet. */
async function theHtmlCarriesTheRiverRowsAndTheArchiveLink() {
  const html = await (await fetch(`${base}/`)).text();
  const missing = [];
  for (let n = RIVER_FIRST; n < RIVER_FIRST + LISTED; n += 1) {
    if (!html.includes(headline(n))) missing.push(headline(n));
  }
  if (missing.length) throw new Error(`the server-rendered HTML is missing ${missing.join(", ")}`);
  for (const n of TOP) {
    if (!html.includes(headline(n))) throw new Error(`the top of the page lost ${headline(n)}`);
  }
  /*
    The way to the rest of the paper, and the reason this assertion changed with
    unit BX. It used to require `?view=archive&page=2` -- the "Load more
    stories" fallback's href, which was the river's own next batch. The front
    page has no next batch now, so the link it must carry is the section head's
    "All stories ->", and it must point at the archive a reader can page
    through. Same claim (the paper does not stop at the front page), one hop
    instead of a cursor.
  */
  if (!html.includes('href="/?view=archive"'))
    throw new Error('the river head carries no "All stories" link to the archive');
  if (html.includes("Load more stories"))
    throw new Error("the front page still carries the removed Load more stories control");
  if (html.includes("A DRAFT THAT MUST NOT PRINT")) throw new Error("the draft reached the front page");
  const newest = html.indexOf(headline(RIVER_FIRST));
  const older = html.indexOf(headline(RIVER_FIRST + LISTED - 1));
  if (newest < 0 || older < 0 || newest > older)
    throw new Error("the river rows are not newest first in the HTML");
  step(
    `the ${LISTED} river stories are server-rendered, newest first, and the head links to the archive`,
  );
}

async function theFrontPageRendersTheTopAndTheRiverRows() {
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

  await waitForRows(LISTED, `the river prints ${LISTED} rows, server-rendered, and no more`);

  const first = (await page.locator(".river .newsrow h3").first().innerText()).trim();
  if (first !== headline(RIVER_FIRST))
    throw new Error(`the river starts at ${first}, not ${headline(RIVER_FIRST)}`);

  /*
    The nine the river leaves out: the lead, the six cells of the ruled grid
    under it, and the lead column's own two rows. Each is printed once up there,
    and none of them appears again inside the river.

    The opinion piece at the top of the paper's range is NOT one of them -- it
    is the band's own card, and the lead and the grid are news (unit BZ item 9).
    So the check is over 1..10: every one of `TOP` printed exactly once above, and
    the newest opinion piece printed once as well, in the band's card and not in
    the top -- which the selector read just below this loop pins down.

    The region band prints nothing in this walk: the seeds carry no `area`, and a
    null area reads as the home town (`src/lib/story-area.ts`), so "Around the
    region" has no ground to print. The census names `.regionlist li` anyway, so
    a story printed there would be counted rather than quietly missed.
  */
  const top = await printedHeadlines();
  const above = [];
  for (let n = 1; n < RIVER_FIRST; n += 1) {
    const printed = top.filter((h) => h === headline(n)).length;
    /*
      A story printed above the river is either a card of the top nine or the
      band's own piece: the census reads `.opinionpanel` too, and item 9 puts
      the newest opinion there rather than in the lead or the grid.
    */
    const want = TOP.includes(n) || n === OPINION_NEWEST ? 1 : 0;
    if (printed !== want)
      throw new Error(
        `${headline(n)} is printed ${printed}x above the river; expected ${want}`,
      );
    if (want) above.push(headline(n));
  }
  /*
    ...and it is in the band, not in the top. The census cannot say WHICH card
    a story was printed in, so the selectors are read directly: the lead, the
    six cells and the lead column's rows are news, and the newest opinion piece
    is not one of them (unit BZ item 9). The band's own step reads its `<h3>`
    separately. The rows are `.storycell`s inside `.leadcolumn`, so this
    selector catches them as it catches the grid.
  */
  const topCards = (await page.locator(".lead h3, .storycell h3").allInnerTexts()).map((h) =>
    h.trim(),
  );
  if (topCards.includes(headline(OPINION_NEWEST)))
    throw new Error(
      `the lead or the grid prints ${headline(OPINION_NEWEST)}, an opinion piece; the top is news`,
    );
  const river = await page.locator(".river .newsrow h3").allInnerTexts();
  const repeated = river.filter((h) => above.includes(h.trim()));
  if (repeated.length) throw new Error(`the river repeats ${repeated.join(", ")}`);
  step(`the ${ABOVE} stories above the river are each printed once, and none of them in the river`);

  /*
    The river stops at `LISTED` once the page has hydrated. This is the check
    that the infinite scroll is really gone rather than merely unreachable: a
    page that still fetched the next batch on hydration would print more rows
    than the six, and `waitForRows` above already waits for an exact count.
    Scrolling to the bottom changes nothing, which is what the old walk's
    sentinel scenario asserted the opposite of.
  */
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
  const afterScroll = await riverRows();
  if (afterScroll !== LISTED)
    throw new Error(`scrolling the page changed the river: ${afterScroll} rows, expected ${LISTED}`);
  step(`scrolling the whole page leaves the river at ${LISTED} rows -- there is no more to fetch`);

  await page.getByRole("link", { name: "All stories" }).first().waitFor({ timeout: 10_000 });
  step('the river head carries the "All stories" link');
}

/**
 * The band takes the newest opinion piece the paper has published.
 *
 * Unit BZ, item 9 changed what this measures. The band used to take "the newest
 * opinion story the top of the page has NOT printed" -- an exclusion, so a
 * fresh editorial landing in the story grid pushed the box down to an older
 * one, and the paper's own newest editorial was not the one the box showed. The
 * front page's edition read now leaves opinion out of the lead and the grid
 * (`notTopic: "opinion"`), so the newest piece is never one the top printed and
 * the box takes it. The seeded newest opinion piece sits inside the top seven's
 * range precisely so this step fails if that ever stops being true.
 *
 * `main:src/routes/index.tsx:328` wrapped it in `<section class="opinionband">`;
 * the redesign makes it an `<aside class="opinionpanel">`
 * (`src/routes/index.tsx`), which is the shape the prototype draws -- the band's
 * own heading over one headline link and "All opinion →"
 * (`docs/design/handoff-2026-09-26/design/Front Daily.dc.html:80-82`). The `<h3>`
 * headline this step reads is the same `<h3>` in both.
 */
async function theOpinionBandTakesTheNewestOpinionPiece() {
  await page.getByRole("heading", { level: 2, name: "Opinion" }).waitFor({ timeout: 30_000 });
  const shown = (await page.locator(".opinionpanel h3").innerText()).trim();
  if (shown !== headline(OPINION_NEWEST))
    throw new Error(
      `the opinion band prints ${shown}; ${headline(OPINION_NEWEST)} is the newest opinion piece the paper has published`,
    );
  step(`the opinion band prints ${shown}, the newest opinion piece the paper has`);
}

/**
 * The rest of the paper is one hop away, and it is all there.
 *
 * This is where the removed infinite scroll's claim went (unit BX). The old
 * walk reached the end of the paper by loading three more river batches and
 * asserting the river ended at `headline(SEEDED)`; the front page's river is
 * six rows and a link now, so the same end state is asserted where the reader
 * actually gets it -- the archive, reached by clicking the front page's own
 * "All stories ->" link and then the pagination it prints. Every published
 * story the front page did not print has to be printed here, the draft has to
 * be absent, and the order has to be newest first.
 */
async function theArchiveCarriesTheRestOfThePaper() {
  const printedOnTheFrontPage = await page.locator("body").innerText();
  await page.getByRole("link", { name: "All stories" }).first().click();
  await page.locator(".listing").waitFor({ timeout: 30_000 });
  const count = await page.getByRole("status").innerText();
  if (!count.includes(String(SEEDED)))
    throw new Error(`the archive says "${count.trim()}", expected all ${SEEDED} published stories`);
  step(`the front page's "All stories" link opens the archive, and it holds all ${SEEDED} stories`);

  /*
    Page through to the oldest story. `PAGE_SIZE` is 12 (`src/lib/news/reader-
    articles.ts:13`), so forty stories are four pages and the last one is where
    the oldest four are. Each step waits for the expected page label and row
    boundary before sampling; paging is bounded by the seeded paper's count.
  */
  const seen = new Set();
  const pageSize = 12;
  const totalPages = Math.ceil(SEEDED / pageSize);
  for (let expectedPage = 1; expectedPage <= totalPages; expectedPage += 1) {
    const firstStory = (expectedPage - 1) * pageSize + 1;
    const lastStory = Math.min(expectedPage * pageSize, SEEDED);
    await page.waitForFunction(
      ({ expectedPage, totalPages, firstStory, lastStory }) => {
        const pageLabel = document.querySelector(".pagination span")?.textContent?.trim();
        const headings = Array.from(document.querySelectorAll(".newsrow h3"), (heading) =>
          heading.textContent?.trim(),
        );
        return (
          pageLabel === `Page ${expectedPage} of ${totalPages}` &&
          headings.length === lastStory - firstStory + 1 &&
          headings[0] === `River story ${String(firstStory).padStart(2, "0")}` &&
          headings.at(-1) === `River story ${String(lastStory).padStart(2, "0")}`
        );
      },
      { expectedPage, totalPages, firstStory, lastStory },
      { timeout: 30_000 },
    );
    for (const h of await page.locator(".newsrow h3").allInnerTexts()) seen.add(h.trim());

    const next = page.getByRole("button", { name: /Next/ });
    if (expectedPage === totalPages) {
      if (await next.isEnabled()) throw new Error(`the Next button is enabled on page ${totalPages}`);
      break;
    }

    await page.waitForFunction(
      () => {
        const button = Array.from(document.querySelectorAll(".pagination button")).find((item) =>
          item.textContent?.includes("Next"),
        );
        return button && !button.disabled;
      },
      undefined,
      { timeout: 30_000 },
    );
    await next.click();
  }
  const missing = [];
  for (let n = RIVER_FIRST; n <= SEEDED; n += 1) {
    if (!seen.has(headline(n))) missing.push(headline(n));
  }
  if (missing.length)
    throw new Error(`the archive never printed ${missing.length} of the paper's stories: ${missing.join(", ")}`);
  if ([...seen].some((h) => h.includes("DRAFT THAT MUST NOT PRINT")))
    throw new Error("the draft is on the archive");
  step(`paging the archive reaches every one of the ${SEEDED - RIVER_FIRST + 1} stories below the front page`);

  /*
    And the front page itself did not carry them: the six rows plus the top.
    This is the "exactly once" claim the old river made across the whole page,
    kept for the page it is still true on.
  */
  const onFront = [];
  const frontPage = new Set(TOP);
  frontPage.add(OPINION_NEWEST);
  for (let n = RIVER_FIRST; n < RIVER_FIRST + LISTED; n += 1) frontPage.add(n);
  for (let n = 1; n <= SEEDED; n += 1) {
    if (frontPage.has(n)) continue;
    if (printedOnTheFrontPage.includes(headline(n))) onFront.push(headline(n));
  }
  if (onFront.length)
    throw new Error(`the front page printed ${onFront.length} stories it no longer lists: ${onFront.join(", ")}`);
  if (REST !== SEEDED - frontPage.size)
    throw new Error(
      `this walk's own arithmetic is off: REST is ${REST} but ${SEEDED - frontPage.size} stories are off the front page`,
    );
  step(`the front page prints none of the ${REST} stories the archive holds for it`);
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
    if (rows !== LISTED) throw new Error(`${rows} rows without JavaScript, expected ${LISTED}`);
    await still.getByRole("link", { name: "All stories" }).first().waitFor({ timeout: 10_000 });
    step("with JavaScript switched off the river still reads, and the archive link is there");
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
 * A three-story paper prints three cards, no river -- and an empty half leaves
 * the other half the whole width.
 *
 * Three stories: the lead is the first, the ruled grid carries the other two,
 * and there is no fourth story to fill a third cell. Nothing is padded out with
 * a story the page already prints, and the river is left out entirely because
 * there is nothing left for it.
 *
 * Unit BX inverted the second half of this. The walk used to require the
 * "This week" panel to be PRESENT with its empty state, and the lead to keep
 * its column beside it, on the grounds that the approved design draws the lead
 * and the panel side by side (`docs/design/handoff-2026-09-26/design/Front
 * Daily.dc.html:34`, `--leadCols` at line 109). The brief's rule is now the
 * opposite for a panel with nothing to say: no dated items means no panel and
 * no explanatory sentence, and the lead runs the full width
 * (`src/routes/index.tsx:396`, the `solo` class; `src/reader-astra.css`, the
 * `min-width: 901px` block). The two halves of the band follow the same rule.
 *
 * So the claims measured here are: the panel is ABSENT, the whole region band
 * is ABSENT (this paper's three stories are all home-ground and none of them is
 * an opinion piece), and the lead fills the row it sits in.
 *
 * The three kept stories are 1, 2 and 4 -- NOT 1, 2 and 3: story 3 is the
 * opinion piece (unit BZ item 9), and keeping it would put a card in the
 * Opinion band and leave only one story for the grid. The paper this step
 * describes is the one the walk was written against, three news stories with
 * nothing left over.
 *
 * `clientWidth` is the row's inside width: the 1px rules between the columns
 * are the row's own background showing through a gap, not a border, so a lead
 * that fills the row measures the row.
 *
 * This runs last: it deletes the rest of the paper.
 */
async function aThreeStoryPaperPrintsThreeCardsAndNoRiver() {
  const pg = await globalThis.__pgliteInstance__;
  await pg.query(
    `delete from articles where slug not in ('river-e2e-1','river-e2e-2','river-e2e-4')`,
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
  if (await page.locator(".ledgerow > .datespanel").count())
    throw new Error("This week printed a panel although no published story names a date this week");
  if ((await page.locator(".datesempty").count()))
    throw new Error("an empty panel's explanatory sentence was printed");
  if (await page.locator(".regionband").count())
    throw new Error("the region band was rendered with neither half to print");
  if ((await page.locator(".regionband.solo").count()))
    throw new Error("a one-column region band was rendered with neither column to print");
  const [row, lead] = await page.evaluate(() => [
    document.querySelector(".ledgerow")?.clientWidth ?? 0,
    /*
      The row's left grid item, which since unit CN item 1(b) is the column
      (`.leadcolumn`) and not the lead article: the article's own box stops at
      the column's inline padding, so measuring `.lead` here would read the
      padding rather than whether the column took the width.
    */
    document.querySelector(".ledgerow > .leadcolumn")?.getBoundingClientRect().width ?? 0,
  ]);
  if (!(lead > 0 && lead >= row - 2))
    throw new Error(
      `the lead is ${Math.round(lead)}px inside a ${Math.round(row)}px lead row: it did not take the full width when This week was absent`,
    );
  step(
    "with three stories each is printed once, no empty This week or region band is rendered, and the lead runs the full width",
  );
}

async function main() {
  await bootTheServer();
  await seedThePaper();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  page = await context.newPage();
  try {
    await theServerRenderedHtmlPrintsEveryStoryOnce(browser);
    await theHtmlCarriesTheRiverRowsAndTheArchiveLink();
    await theFrontPageRendersTheTopAndTheRiverRows();
    await theOpinionBandTakesTheNewestOpinionPiece();
    await theArchiveCarriesTheRestOfThePaper();
    await theListIsReadableWithNoJavaScript(browser, page);
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
