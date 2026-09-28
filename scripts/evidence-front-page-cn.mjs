#!/usr/bin/env node
/**
 * Evidence for unit CN, item 1: the blank paper under the lead beside "This
 * week".
 *
 * A copy of CL's instrument (`scripts/evidence-front-page-0681.mjs`, the unit
 * that measured the gap at 214px with six rows) with three changes:
 *
 *   1. it writes to `reports/CN-evidence`, and the run is tagged from argv
 *      (`node scripts/evidence-front-page-cn.mjs before|after`) so a "before"
 *      build and an "after" build can be told apart in the same folder;
 *   2. it seeds three further stories ("more-water" and its two neighbours)
 *      between the six grid
 *      cells and the "This week" pile -- stories the page has not printed and
 *      that name no date this week, so the lead column's own rows (unit CN,
 *      item 1(b)) have a stable, known pool to draw from;
 *   3. it measures the lead's own rows and the panel's content bottom as well
 *      as the lead's, so the two columns can be compared at the point each one
 *      actually stops writing.
 *
 * The owner's target: the lead column and the "This week" panel end within
 * 40px of each other at 1790 and 1440. `gapUnderLeadContent` is the blank
 * paper under the lead's last content, which is what was circled in the
 * review; `columnsApart` is the same thing said the other way (how much lower
 * the panel's content ends than the lead's).
 *
 * The lead column is `.ledgerow > .leadcolumn` (unit CN, item 1(b)): the lead
 * article and the rows under it are two things, and the row's left grid item
 * is their wrapper, so a measurement of "the lead" has to say which part.
 *
 *   node scripts/evidence-front-page-cn.mjs before
 *   node scripts/evidence-front-page-cn.mjs after
 *
 * In-memory PGlite only (`DATABASE_URL=""`), never the shared Postgres, and a
 * port of its own (3598).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const PORT = 3598;
const base = `http://127.0.0.1:${PORT}`;
const REPO = process.cwd();
const SHOTS = "C:/Users/scott/Desktop/Code/townreporter-deepseek-oversight/reports/CN-evidence";
const TAG = process.argv[2] === "before" ? "before" : "after";

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
  process.env.BETTER_AUTH_SECRET ||= "evidence-front-page-cn-secret";
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

  const insert = async ({ slug, headline, dek, topic, minutesAgo, provenance = "[]" }) => {
    await pg.query(
      `insert into articles (user_id, slug, headline, dek, body, topic, source_urls, status, published_at, provenance_json)
       values ('evidence-cn', $1, $2, $3, $4, $5, '[]', 'published', now() - ($6 || ' minutes')::interval, $7)`,
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

  // The lead: the drawing's own four fields, nothing more.
  await insert({
    slug: "lead-housing",
    headline: "Longmont Board Posts Two Oct. 8, 2026 Records",
    dek: "The Housing and Human Services Advisory Board posted a funding hearing packet and a cancellation notice for its Oct. 8 meeting.",
    topic: "housing",
    minutesAgo: 5,
  });

  /*
    Ten stories that name a date in the next seven days, so the panel has more
    than the five rows it will print and the cap is visible. Carried over from
    CL's instrument unchanged: the first six are the four fragments the earlier
    review named plus two plainly written ones, and the last four are there to
    clear the cap.
  */
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
  let minutesAgo = 200;
  for (const s of weekStories) {
    await insert({ ...s, topic: "council", minutesAgo });
    minutesAgo += 15;
  }

  // "misc" is a stored topic, not a section anyone configures; the row has to
  // exist before an article can carry it (migrations/0045).
  await pg.query(
    `insert into newsroom_sections (newsroom_id, key, name, position, visible)
     values (1, 'misc', 'Misc', 999, true)
     on conflict (newsroom_id, key) do nothing`,
  );

  /*
    Six grid cells: five sectioned, one "misc" -- the shape CL's instrument
    used, so the grid stays comparable between runs.
  */
  const gridStories = [
    { slug: "grid-elections", topic: "elections", headline: "Elections Office Certifies Fall Ballot" },
    { slug: "grid-planning", topic: "planning", headline: "Planning Board Advances Dry Creek Annexation" },
    { slug: "grid-utilities", topic: "utilities", headline: "Utilities Reboots Recycling Push" },
    { slug: "grid-misc", topic: "misc", headline: "A Filing With No Real Section Of Its Own" },
    { slug: "grid-schools", topic: "schools", headline: "School District Sets Winter Break Calendar" },
    { slug: "grid-budget", topic: "budget", headline: "Council Reviews Mid-Year Budget Adjustments" },
  ];
  minutesAgo = 10;
  for (const s of gridStories) {
    await insert({ ...s, dek: `Dek for ${s.slug}.`, minutesAgo });
    minutesAgo += 5;
  }

  /*
    Three more, older than the grid and newer than the "This week" pile, naming
    no date: the pool the lead column's own rows are read from (unit CN, item
    1(b)). They are the newest stories the page has not printed, which is what
    `alsoUnderLead` takes.
  */
  const moreStories = [
    {
      slug: "more-water",
      topic: "utilities",
      headline: "Water District Flushes Its Last Lead Service Line",
      dek: "Crews finished the replacement round on the city's west side.",
    },
    {
      slug: "more-transit",
      topic: "infrastructure",
      headline: "Bus Route Riders Get A Later Last Trip Home",
      dek: "The change follows a ridership survey taken over the summer.",
    },
    {
      slug: "more-library",
      topic: "schools",
      headline: "School Libraries Reopen Their Stacks To The Public",
      dek: "The district is trying evening hours at four buildings.",
    },
  ];
  minutesAgo = 60;
  for (const s of moreStories) {
    await insert({ ...s, minutesAgo });
    minutesAgo += 15;
  }
  step(
    `seeded 1 lead, ${weekStories.length} "This week" stories, ${gridStories.length} grid stories, ${moreStories.length} further stories`,
  );
  const check = await pg.query(
    "select slug, topic, published_at from articles order by published_at desc, id desc",
  );
  step("published order", check.rows.map((r) => `${r.slug}(${r.topic})`));
}

/**
 * The two columns, and where each one stops writing.
 *
 * `.lead` and `.datespanel` are grid items in a row with the default
 * `align-items: stretch`, so their OWN boxes always match the row's height and
 * comparing those two rects would always read 0. The blank paper the owner
 * circled is between the lead's last real content (its rows, or the "Read the
 * story" button when it has none) and the bottom of that stretched row.
 */
async function measureLedgerow(pg) {
  return pg.evaluate(() => {
    const row = document.querySelector(".ledgerow");
    const lead = document.querySelector(".ledgerow > .leadcolumn > .lead");
    const panel = document.querySelector(".ledgerow > .datespanel");
    const leadBottom = document.querySelector(".ledgerow > .leadcolumn > .lead > .leadbottom");
    const also = document.querySelector(".ledgerow > .leadcolumn > .leadalso");
    const list = document.querySelector(".ledgerow > .datespanel > .dateslist");
    const rowRect = row?.getBoundingClientRect();
    const round = (r) => (r ? Math.round(r.bottom) : null);
    const buttonBottom = round(leadBottom?.getBoundingClientRect());
    const alsoBottom = round(also?.getBoundingClientRect());
    const panelContentBottom = round(list?.getBoundingClientRect());
    /*
      Where each column really stops writing: the panel's last row, and the
      lead's own rows when it has them (`.leadalso`) or its button when it does
      not. A run against the "before" build has no rows, so the same field
      means the same thing on both sides of the change.
    */
    const leadLastBottom = alsoBottom ?? buttonBottom;
    return {
      rowBottom: round(rowRect),
      leadBottom: round(lead?.getBoundingClientRect()),
      panelBottom: round(panel?.getBoundingClientRect()),
      buttonBottom,
      alsoBottom,
      leadLastBottom,
      panelContentBottom,
      gapUnderLeadContent:
        rowRect && leadLastBottom !== null ? Math.round(rowRect.bottom - leadLastBottom) : null,
      gapUnderLeadButton:
        rowRect && buttonBottom !== null ? Math.round(rowRect.bottom - buttonBottom) : null,
      /* The owner's target, said straight: how far apart the two columns end. */
      columnsApart:
        leadLastBottom !== null && panelContentBottom !== null
          ? Math.abs(panelContentBottom - leadLastBottom)
          : null,
      leadBelowPanel:
        leadLastBottom !== null && panelContentBottom !== null
          ? leadLastBottom - panelContentBottom
          : null,
      weekRows: document.querySelectorAll(".dateslist > li").length,
      alsoRows: document.querySelectorAll(".leadalso .storycell").length,
      alsoRowHeights: [...document.querySelectorAll(".leadalso .storycell")].map((cell) =>
        Math.round(cell.getBoundingClientRect().height),
      ),
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

/** Every story the lead column prints under its button: kicker, headline, line. */
async function alsoRowTexts(pg) {
  return pg.evaluate(() =>
    [...document.querySelectorAll(".leadalso .storycell")].map((cell) => {
      const cs = getComputedStyle(cell);
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width) };
      };
      return {
        section: (cell.querySelector(".storysec")?.textContent || "").trim(),
        headline: (cell.querySelector("h3")?.textContent || "").trim(),
        meta: (cell.querySelector(".storymeta")?.textContent || "").trim(),
        headlinePx: cell.querySelector("h3")
          ? getComputedStyle(cell.querySelector("h3")).fontSize
          : null,
        kickerPx: cell.querySelector(".storysec")
          ? getComputedStyle(cell.querySelector(".storysec")).fontSize
          : null,
        metaPx: cell.querySelector(".storymeta")
          ? getComputedStyle(cell.querySelector(".storymeta")).fontSize
          : null,
        /* How the row is actually laid out -- one flex line or three stacked. */
        cell: {
          display: cs.display,
          flexDirection: cs.flexDirection,
          flexWrap: cs.flexWrap,
          padding: cs.padding,
          height: Math.round(cell.getBoundingClientRect().height),
        },
        parts: [
          box(cell.querySelector(".storysec")),
          box(cell.querySelector("h3")),
          box(cell.querySelector(".storymeta")),
        ],
      };
    }),
  );
}

/** The river's printed headlines, so a repeat can be seen rather than argued. */
async function riverHeadlines(pg) {
  return pg.evaluate(() =>
    [...document.querySelectorAll(".river .newsrow")].map((row) =>
      (row.querySelector("h3")?.textContent || "").trim(),
    ),
  );
}

async function shoot(context, width, dark) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.locator(".ledgerow").first().waitFor({ timeout: 30_000 });
  if (dark) await page.evaluate(() => document.querySelector(".reader")?.classList.add("mode-dark"));
  await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  const ledger = await measureLedgerow(page);
  const weekTexts = await weekRowTexts(page);
  const alsoTexts = await alsoRowTexts(page);
  const river = await riverHeadlines(page);
  mkdirSync(SHOTS, { recursive: true });
  const file = join(SHOTS, `cn-${TAG}-${width}-${dark ? "dark" : "light"}.png`);
  await page.screenshot({ path: file, fullPage: true });
  step(`screenshot ${file}`, { width, dark, ledger, weekTexts, alsoTexts });
  await page.close();
  return { file, width, dark, ledger, weekTexts, alsoTexts, river };
}

async function main() {
  await bootTheServer();
  await seedThePaper();
  const browser = await chromium.launch();
  const context = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: "reduce" });
  const results = [];
  for (const width of [1790, 1440, 390]) {
    for (const dark of [false, true]) {
      results.push(await shoot(context, width, dark));
    }
  }
  await browser.close();
  console.log(JSON.stringify({ ok: true, tag: TAG, results }, null, 2));
  /*
    The built server's listener has no reason to stop on its own, so without
    this the process never exits on success and the next run's health check
    finds THIS port already answering, silently reading the previous run's
    seed. (CL's instrument hit exactly that; it is why this exit is here.)
  */
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
