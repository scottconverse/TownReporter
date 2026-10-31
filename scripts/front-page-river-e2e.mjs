#!/usr/bin/env node
/**
 * The Bulletin front page, in a browser.
 *
 * The normal edition has fourteen story slots in a fixed order:
 *
 *   lead (1) + pair (2) + MORE TOP STORIES (4) + Latest stories (6) + Opinion (1)
 *
 * The lead, pair and numbered list are the seven newest non-opinion stories.
 * The latest grid excludes those seven and the opinion card, so every story is
 * printed once. Routine roundups belong in the events band, not these slots;
 * this walk seeds ordinary news plus opinion only, which keeps the census
 * exact and leaves the band hidden for the no-events state.
 *
 * This walk drives the built server in-process against its own in-memory
 * PGlite (never Postgres: DATABASE_URL is cleared below). It checks the
 * server-rendered HTML first, then the hydrated page, then the archive, and
 * finally a three-story edition.
 *
 *   node scripts/front-page-river-e2e.mjs
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";

/** This walk's own listen port, unique in scripts/integration-ports-are-unique.test.mjs. */
const PORT_FRONT_PAGE_RIVER = 3517;

const REPO = process.cwd();
const base = checkedUrl(`http://127.0.0.1:${PORT_FRONT_PAGE_RIVER}`);

/** Published stories seeded, newest first: "River story 01" is the newest. */
const SEEDED = 40;
/** The newest opinion piece. The top seven are news, so this is the Opinion box. */
const OPINION_NEWEST = 3;
/** The other opinion piece stays out of every front-page story slot. */
const OPINION_OLDER = 20;
/**
 * The seven news stories in the top block: lead, pair and numbered list.
 * Story 3 is opinion and therefore omitted from the edition read.
 */
const TOP = [1, 2, 4, 5, 6, 7, 8];
/** The six stories in Latest stories after excluding TOP and OPINION_NEWEST. */
const RIVER = [9, 10, 11, 12, 13, 14];
const FRONT_PAGE_STORIES = [...TOP, ...RIVER, OPINION_NEWEST];
const REST = SEEDED - FRONT_PAGE_STORIES.length;

let page;
const done = [];

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
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 1600);
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
  process.env.DATABASE_URL = "";
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
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`the built server never answered on ${base}`);
}

async function seedThePaper() {
  const pg = await globalThis.__pgliteInstance__;
  if (!pg) throw new Error("the server booted without a PGlite instance to seed");

  /*
    `/` can answer while migrations are still landing. Wait for the migration
    pass to go quiet before deleting the migration's welcome story and seeding
    a paper with exact ids and dates.
  */
  let applied = -1;
  let quiet = 0;
  for (let i = 0; i < 240 && quiet < 3; i += 1) {
    let count = -1;
    try {
      count = Number((await pg.query("select count(*)::int as n from _migrations")).rows[0]?.n);
    } catch {
      /* the migrations table itself is not there yet */
    }
    if (count === applied && count >= 0) quiet += 1;
    else {
      quiet = 0;
      applied = count;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  await pg.query(
    `insert into paper_settings (newsroom_id, onboarded) values (1, true)
     on conflict (newsroom_id) do update set onboarded = true`,
  );
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
  step(`seeded ${SEEDED} published stories (two opinion) and one draft`);
}

/**
 * Every story slot on the front, once.
 *
 * A card may contain two links to the same story: the lead has both its
 * headline and its "Read the story" button. Slugs are deduped within a card,
 * then no slug may appear in two cards.
 */
async function assertEveryStoryIsPrintedOnce(target, when) {
  const cards = await target.evaluate(() => {
    const selector = ".lead, .frontpairstory, .moretop li, .frontlateststory, .frontopinion";
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
    if (card.slugs.length !== 1) {
      throw new Error(
        `${when}: a ${card.where} card links ${card.slugs.length} stories (${card.slugs.join(", ")})`,
      );
    }
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
  if (seen.size !== cards.length) {
    throw new Error(`${when}: ${cards.length} cards carry only ${seen.size} stories`);
  }
  return { cards: cards.length, stories: seen.size };
}

async function theServerRenderedHtmlPrintsEveryStoryOnce(browser) {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1280, height: 900 },
  });
  const server = await context.newPage();
  try {
    await server.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await server.getByRole("heading", { level: 2, name: "Latest stories" }).waitFor({
      timeout: 30_000,
    });
    const counts = await assertEveryStoryIsPrintedOnce(server, "server-rendered");
    if (counts.cards !== 14 || counts.stories !== 14) {
      throw new Error(
        `server-rendered front printed ${counts.cards} cards / ${counts.stories} stories, expected 14 / 14`,
      );
    }
    const topCount = await server.locator(".lead, .frontpairstory, .moretop li").count();
    const latestCount = await server.locator(".frontlateststory").count();
    const opinionCount = await server.locator(".frontopinion").count();
    if (topCount !== 7 || latestCount !== 6 || opinionCount !== 1) {
      throw new Error(
        `server-rendered slots were top ${topCount}, latest ${latestCount}, opinion ${opinionCount}; expected 7, 6, 1`,
      );
    }
    step("server-rendered HTML has 7 top, 6 latest and 1 opinion card, with no repeats");
  } finally {
    await context.close();
  }
}

async function theHtmlCarriesTheRiverRowsAndTheArchiveLink() {
  await page.locator(".frontlateststory").first().waitFor({ timeout: 30_000 });
  const rows = await page.locator(".frontlateststory").count();
  if (rows !== RIVER.length) {
    throw new Error(`${rows} latest cards, expected ${RIVER.length}`);
  }
  const allStories = page.getByRole("link", { name: "All stories", exact: true });
  if ((await allStories.count()) !== 1) {
    throw new Error(`expected one "All stories" link, found ${await allStories.count()}`);
  }
  step(`hydrated Latest stories has ${RIVER.length} cards and one "All stories" link`);
}

async function theFrontPageRendersTheTopAndTheRiverRows() {
  await page.getByRole("heading", { level: 2, name: "More top stories" }).waitFor({
    timeout: 30_000,
  });
  const numbers = (await page.locator(".moretop-number").allInnerTexts()).map((text) => text.trim());
  if (JSON.stringify(numbers) !== JSON.stringify(["1", "2", "3", "4"])) {
    throw new Error(`MORE TOP STORIES numbers are ${JSON.stringify(numbers)}`);
  }
  const top = (await page.locator(".lead h2, .frontpairstory h3, .moretop li h3").allInnerTexts()).map(
    (text) => text.trim(),
  );
  const expectedTop = TOP.map(headline);
  if (JSON.stringify(top) !== JSON.stringify(expectedTop)) {
    throw new Error(`top stories were ${JSON.stringify(top)}, expected ${JSON.stringify(expectedTop)}`);
  }
  const latest = (await page.locator(".frontlateststory h3").allInnerTexts()).map((text) =>
    text.trim(),
  );
  const expectedLatest = RIVER.map(headline);
  if (JSON.stringify(latest) !== JSON.stringify(expectedLatest)) {
    throw new Error(
      `Latest stories were ${JSON.stringify(latest)}, expected ${JSON.stringify(expectedLatest)}`,
    );
  }
  if (top.includes(headline(OPINION_NEWEST))) {
    throw new Error(`an opinion piece reached the top block`);
  }
  const duplicate = [...top, ...latest].filter(
    (value, index, all) => all.indexOf(value) !== index,
  );
  if (duplicate.length) throw new Error(`top/latest repeats ${duplicate.join(", ")}`);
  if ((await page.locator(".eventweek").count()) !== 0) {
    throw new Error("the events band rendered although the seeded week has no events");
  }
  step("the top block, four-numbered list, and six-story latest grid are exact");
}

async function theOpinionBoxTakesTheNewestOpinionPiece() {
  await page.getByRole("heading", { level: 2, name: "Opinion" }).waitFor({ timeout: 30_000 });
  const shown = (await page.locator(".frontopinion h3").innerText()).trim();
  if (shown !== headline(OPINION_NEWEST)) {
    throw new Error(
      `the opinion box prints ${shown}; ${headline(OPINION_NEWEST)} is the newest opinion piece`,
    );
  }
  step(`the opinion box prints ${shown} and keeps the older opinion out of the river`);
}

async function theArchiveCarriesTheRestOfThePaper() {
  const printedOnTheFrontPage = await page.locator("body").innerText();
  await page.getByRole("link", { name: "All stories", exact: true }).click();
  await page.locator(".listing").waitFor({ timeout: 30_000 });
  await page
    .waitForFunction(
      () => /\d+ stor(y|ies)/.test(document.querySelector(".resultcount")?.textContent ?? ""),
      undefined,
      { timeout: 30_000 },
    )
    .catch(() => {
      /* the assertion below reports what it actually said */
    });
  const count = await page.locator(".resultcount").innerText();
  if (!count.includes(String(SEEDED))) {
    throw new Error(`the archive says "${count.trim()}", expected all ${SEEDED} published stories`);
  }
  step(`the front page's "All stories" link opens an archive holding all ${SEEDED} stories`);

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
    for (const text of await page.locator(".newsrow h3").allInnerTexts()) seen.add(text.trim());

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
  for (let n = 1; n <= SEEDED; n += 1) if (!seen.has(headline(n))) missing.push(headline(n));
  if (missing.length) {
    throw new Error(`the archive never printed ${missing.length} stories: ${missing.join(", ")}`);
  }
  if ([...seen].some((text) => text.includes("DRAFT THAT MUST NOT PRINT"))) {
    throw new Error("the draft is on the archive");
  }
  step(`paging the archive reaches every one of the ${SEEDED} published stories`);

  const offFront = [];
  for (let n = 1; n <= SEEDED; n += 1) {
    if (FRONT_PAGE_STORIES.includes(n)) continue;
    if (printedOnTheFrontPage.includes(headline(n))) offFront.push(headline(n));
  }
  if (offFront.length) {
    throw new Error(`the front page printed stories outside its slots: ${offFront.join(", ")}`);
  }
  if (REST !== SEEDED - FRONT_PAGE_STORIES.length) {
    throw new Error("this walk's own front-page arithmetic is off");
  }
  step(`the front page prints none of the ${REST} stories the archive holds below it`);
}

async function aThreeStoryPaperPrintsThreeCardsAndNoEmptyBands() {
  const pg = await globalThis.__pgliteInstance__;
  await pg.query(
    `delete from articles where slug not in ('river-e2e-1','river-e2e-2','river-e2e-4')`,
  );
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 2, name: headline(1) }).waitFor({ timeout: 30_000 });
  const counts = await assertEveryStoryIsPrintedOnce(page, "three stories in");
  if (counts.cards !== 3 || counts.stories !== 3) {
    throw new Error(`the short front page prints ${counts.cards} cards, expected 3`);
  }
  if ((await page.locator(".lead").count()) !== 1) throw new Error("the lead is missing");
  if ((await page.locator(".frontpairstory").count()) !== 2) {
    throw new Error("the two stories beside the lead did not both render");
  }
  for (const selector of [".moretop", ".frontlatestband", ".frontlateststory", ".frontopinion", ".eventweek"]) {
    if (await page.locator(selector).count()) throw new Error(`${selector} rendered with no content`);
  }
  step("with three stories, the lead and pair render once each and empty bands stay out");
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
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await theHtmlCarriesTheRiverRowsAndTheArchiveLink();
    await theFrontPageRendersTheTopAndTheRiverRows();
    await theOpinionBoxTakesTheNewestOpinionPiece();
    await theArchiveCarriesTheRestOfThePaper();
    await aThreeStoryPaperPrintsThreeCardsAndNoEmptyBands();
  } catch (err) {
    await dump(err);
  } finally {
    await context.close();
    await browser.close();
  }
  console.log(JSON.stringify({ ok: true, steps: done.length }, null, 2));
  process.exit(0);
}

await main();
