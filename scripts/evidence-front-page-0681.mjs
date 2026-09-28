#!/usr/bin/env node
/**
 * Evidence for the three 0.6.81 front-page layout fixes (CL-front-page-0681):
 *
 *   1. The blank gap under the lead beside "This week" (capped to
 *      FRONT_WEEK_LIMIT rows, `src/lib/news/story-dates.server.ts`).
 *   2. Weak "This week" row titles falling back to the story's own headline
 *      when the extracted clause is a bare fragment (`src/lib/story-dates.ts`,
 *      `isBareFragment`).
 *   3. A misc-tagged grid card's headline sitting above its neighbours' (the
 *      reserved, aria-hidden tag line in `src/components/paper/story-grid.tsx`).
 *
 * This is a one-off measurement script, not part of the checked test suite --
 * it boots the built server in-process against an in-memory PGlite
 * (DATABASE_URL cleared, never the shared Postgres), seeds data built to
 * reproduce all three symptoms, and screenshots + measures before applying
 * nothing (the fixes are already in the built server; "before" is read by
 * reverting the three source files' behaviour with query params is not
 * supported, so this script's "before" evidence is the git-stashed diff run
 * separately -- see the report for the exact commands used for the pre-fix
 * numbers).
 *
 *   node scripts/evidence-front-page-0681.mjs
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const PORT = 3599;
const base = `http://127.0.0.1:${PORT}`;
const REPO = process.cwd();
const SHOTS = "C:/Users/scott/Desktop/Code/townreporter-deepseek-oversight/reports/CL-evidence";

const done = [];
function step(name, extra) {
  done.push(name);
  console.log(`  ok    ${name}${extra ? " -- " + JSON.stringify(extra) : ""}`);
}

async function bootTheServer() {
  process.env.PORT = String(PORT);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.BETTER_AUTH_SECRET ||= "evidence-front-page-0681-secret";
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
  let applied = -1;
  let quiet = 0;
  for (let i = 0; i < 240 && quiet < 3; i += 1) {
    let count = -1;
    try {
      count = Number((await pg.query("select count(*)::int as n from _migrations")).rows[0]?.n);
    } catch {
      /* migrations table not there yet */
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
  await pg.query("delete from articles");

  const insert = async ({
    slug,
    headline,
    dek,
    topic,
    minutesAgo,
    provenance = "[]",
  }) => {
    await pg.query(
      `insert into articles (user_id, slug, headline, dek, body, topic, source_urls, status, published_at, provenance_json)
       values ('evidence-0681', $1, $2, $3, $4, $5, '[]', 'published', now() - ($6 || ' minutes')::interval, $7)`,
      [
        slug,
        headline,
        dek,
        `Body text for ${slug}. A sentence or two of it, long enough to read as a story.`,
        topic,
        String(minutesAgo),
        provenance,
      ],
    );
  };

  // The lead: exactly what the drawing's lead column carries (tag, headline,
  // dek, date -- Front Daily.dc.html:36-39), so the "before" gap is the real
  // one, not an inflated dek.
  await insert({
    slug: "lead-housing",
    headline: "Longmont Board Posts Two Oct. 8, 2026 Records",
    dek: "The Housing and Human Services Advisory Board posted a funding hearing packet and a cancellation notice for its Oct. 8 meeting.",
    topic: "housing",
    minutesAgo: 5,
  });

  // Six stories with "This week" dates in their headlines, written to produce
  // the four exact fragments the owner's review named as weak (item 2). Each
  // is a bare scrap when read alone -- lower-case start or a short noun phrase
  // with no verb -- so each must now fall back to its own headline.
  const weekStories = [
    {
      slug: "week-applications",
      headline:
        "Longmont Hiring Director of Power Delivery and Operations; Applications Close Sept. 29",
      dek: "The utility is filling the post ahead of the winter maintenance season.",
    },
    {
      slug: "week-ranked",
      headline:
        "Ranked-choice campaign schedules Sept. 26 canvassing day and Oct. 3 Brighton event for 3C and 3D",
      dek: "Volunteers for both ballot questions plan a joint push ahead of the vote.",
    },
    {
      slug: "week-packet",
      headline: "Housing And Human Services Board Posts Funding Hearing Packet",
      dek: "The board has posted an Oct. 1 funding hearing packet ahead of the meeting.",
    },
    {
      slug: "week-drive",
      headline: "Growing Shade Tree Program Sets Fall Pickup",
      dek: "The Oct. 1-2 instrument collection drive returns to Clark Centennial Park.",
    },
    {
      slug: "week-hearing",
      headline: "Council Weighs Rate Study Ahead Of Public Hearing",
      dek: "The unanimous vote sends the plan to an Oct. 6 public hearing and second reading at the council.",
    },
    {
      slug: "week-meal",
      headline: "Longmont Senior Center to begin free meal pickups Oct. 2",
      dek: "Pickups begin at 3 p.m. and run through the winter.",
    },
    // Four more, plainly written, so the count inside the 7-day window clears
    // six -- otherwise FRONT_WEEK_LIMIT (6) and the old ROW_LIMIT (12) print
    // the same handful of rows and the cap this item added is invisible.
    {
      slug: "week-hazmat",
      headline: "City Announces Sept. 28 Household Hazardous Waste Event",
      dek: "Residents may drop off paint, batteries and solvents at the public works yard.",
    },
    {
      slug: "week-library",
      headline: "Library Sets Sept. 30 Author Talk",
      dek: "The visiting author's newest book is set in the county.",
    },
    {
      slug: "week-firehouse",
      headline: "Fire Department Schedules Oct. 2 Open House",
      dek: "The open house includes truck tours and a smoke-alarm giveaway.",
    },
    {
      slug: "week-budgetsession",
      headline: "Council Sets Oct. 3 Budget Work Session",
      dek: "The session previews the manager's proposed spending plan.",
    },
  ];
  /*
    Older than the lead and the six grid cells (below), so "This week" -- a
    sweep of the newest 60 published stories, independent of the front page's
    top-seven order (`readSources`, `story-dates.server.ts`) -- finds them
    without any of them displacing a grid cell. Recency inside the sweep does
    not matter to the panel; only the dates the stories name do.
  */
  let minutesAgo = 200;
  for (const s of weekStories) {
    await insert({ ...s, topic: "council", minutesAgo });
    minutesAgo += 15;
  }

  // "misc" is a stored topic, not a section anyone configures (section-types.ts),
  // but `resolve_story_section()` (migrations/0045) still checks every topic
  // against `newsroom_sections`, so the row has to exist before an article can
  // carry it -- this mirrors what the scanner's own filing path does, not a new
  // section a reader would ever see (`isMiscTopic` keeps it off every reader
  // surface regardless of this row's `visible` flag).
  await pg.query(
    `insert into newsroom_sections (newsroom_id, key, name, position, visible)
     values (1, 'misc', 'Misc', 999, true)
     on conflict (newsroom_id, key) do nothing`,
  );

  // Six grid cells: five sectioned, one "misc" (hidden tag, item 3) -- same
  // shape as the live incident (a misc card's headline sitting ~30px above its
  // row-mates' because the tag line dropped out of the layout entirely).
  const gridStories = [
    { slug: "grid-elections", topic: "elections", headline: "Elections Office Certifies Fall Ballot" },
    { slug: "grid-planning", topic: "planning", headline: "Planning Board Advances Dry Creek Annexation" },
    { slug: "grid-utilities", topic: "utilities", headline: "Utilities Reboots Recycling Push" },
    { slug: "grid-misc", topic: "misc", headline: "A Filing With No Real Section Of Its Own" },
    { slug: "grid-schools", topic: "schools", headline: "School District Sets Winter Break Calendar" },
    { slug: "grid-budget", topic: "budget", headline: "Council Reviews Mid-Year Budget Adjustments" },
  ];
  // Newer than the week stories, so these six -- not the week stories -- fill
  // the grid (`stories.slice(1, TOP_STORIES)` in `src/routes/index.tsx`, the
  // seven newest non-opinion stories after the lead).
  minutesAgo = 10;
  for (const s of gridStories) {
    await insert({ ...s, dek: `Dek for ${s.slug}.`, minutesAgo });
    minutesAgo += 5;
  }
  step(`seeded 1 lead, ${weekStories.length} "This week" stories, ${gridStories.length} grid stories`);
  const check = await pg.query(
    "select slug, topic, published_at from articles order by published_at desc, id desc",
  );
  step("published order", check.rows.map((r) => `${r.slug}(${r.topic})`));
}

/** The lead column's box, and the "This week" panel's box, in the ledgerow. */
async function measureLedgerow(pg) {
  return pg.evaluate(() => {
    const row = document.querySelector(".ledgerow");
    const lead = document.querySelector(".ledgerow > .lead");
    const panel = document.querySelector(".ledgerow > .datespanel");
    /*
      `.lead` and `.datespanel` are grid items in a row with the default
      `align-items: stretch`, so their OWN boxes always match the row's
      height -- comparing those two rects would always read 0. The blank
      paper the owner circled is between the lead's last real content (the
      "Read the story" button, `.leadbottom`) and the bottom of that stretched
      row, which is what `contentBottom` and `gapUnderLeadContent` measure.
    */
    const leadContent = document.querySelector(".ledgerow > .lead > .leadbottom");
    const rowRect = row?.getBoundingClientRect();
    const leadRect = lead?.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    const contentRect = leadContent?.getBoundingClientRect();
    const weekRows = document.querySelectorAll(".dateslist > li").length;
    return {
      rowBottom: rowRect ? Math.round(rowRect.bottom) : null,
      leadBottom: leadRect ? Math.round(leadRect.bottom) : null,
      panelBottom: panelRect ? Math.round(panelRect.bottom) : null,
      leadContentBottom: contentRect ? Math.round(contentRect.bottom) : null,
      gapUnderLeadContent:
        contentRect && rowRect ? Math.round(rowRect.bottom - contentRect.bottom) : null,
      weekRows,
    };
  });
}

/** Every "This week" row's printed text, in order. */
async function weekRowTexts(pg) {
  return pg.evaluate(() =>
    [...document.querySelectorAll(".dateslist > li .datewhat")].map((el) =>
      (el.textContent || "").trim(),
    ),
  );
}

/** The top of each grid cell's headline, and whether the cell has a tag line. */
async function measureGridAlignment(pg) {
  return pg.evaluate(() => {
    const cells = [...document.querySelectorAll(".storygrid .storycell")];
    return cells.map((cell) => {
      const h3 = cell.querySelector("h3");
      const tag = cell.querySelector(".storysec");
      const r = h3?.getBoundingClientRect();
      return {
        headline: (h3?.textContent || "").trim().slice(0, 40),
        headlineTop: r ? Math.round(r.top) : null,
        hasTagLine: Boolean(tag),
        tagVisibleText: (tag?.textContent || "").trim(),
      };
    });
  });
}

async function screenshotAt(context, width, dark, tag) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.locator(".ledgerow").first().waitFor({ timeout: 30_000 });
  if (dark) await page.evaluate(() => document.querySelector(".reader")?.classList.add("mode-dark"));
  await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  const ledger = await measureLedgerow(page);
  const weekTexts = await weekRowTexts(page);
  const grid = await measureGridAlignment(page);
  mkdirSync(SHOTS, { recursive: true });
  const file = join(SHOTS, `front-${tag}-${width}-${dark ? "dark" : "light"}.png`);
  await page.screenshot({ path: file, fullPage: true });
  step(`screenshot ${file}`, { width, dark, ledger, weekTexts, grid });
  await page.close();
  return { file, width, dark, ledger, weekTexts, grid };
}

async function main() {
  await bootTheServer();
  await seedThePaper();
  const browser = await chromium.launch();
  const context = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: "reduce" });
  const results = [];
  for (const width of [1790, 1440, 390]) {
    for (const dark of [false, true]) {
      results.push(await screenshotAt(context, width, dark, "after"));
    }
  }
  await browser.close();
  console.log(JSON.stringify({ ok: true, results }, null, 2));
  /*
    The built server's HTTP listener has no reason to stop on its own, so
    without this the process never exits on success -- the next run's health
    check then finds THIS port already answering and skips booting a fresh
    server (and a fresh PGlite) entirely, silently reading whatever the last
    run seeded. Caught once: a "before" run built against reverted source
    still measured the FIX's own numbers, because it was really still talking
    to the previous run's server.
  */
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
