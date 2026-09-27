#!/usr/bin/env node
/**
 * Screenshots of the Stats screen (unit BM, redesign phase 7 lane 2), beside the
 * drawing.
 *
 * It boots the built server in this process on its own port and its own
 * in-memory PGlite (DATABASE_URL is cleared, so this never touches the shared
 * Postgres), creates the desk's first account, seeds thirty days of aggregate
 * rows so the charts have the shape the drawing has, and then photographs
 * /desk/stats three ways: 1280 in the light appearance, 1280 in the dark
 * appearance chosen through the desk's own toggle, and 390 in the light
 * appearance.
 *
 * The reader's side is REAL: before the screenshots, a second browser context
 * loads the front page and a story and leaves them open, so "Reading right now"
 * is drawn from live beacons this process received rather than from a fixture.
 * The historical rows, by contrast, are seeded straight into read_hourly --
 * thirty days of hourly aggregates cannot be produced by a browser in a
 * reasonable time, and the table they go into has no per-reader column to seed.
 *
 * Finally it writes `stats-side-by-side-light.png` and
 * `stats-side-by-side-dark.png` with PIL: the design's own capture beside this
 * build's full-page shot of the same appearance, both scaled to one width so
 * the comparison is of layout rather than of camera distance. Those two are
 * evidence, not a check -- nothing fails on them.
 *
 * The differences that remain are listed in the report, not hidden here.
 *
 *   node scripts/stats-screen-shots.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { checkedUrl, checkedOutputPath } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/** This walk's own port, above the range the e2e walks register. */
const PORT_STATS_SHOTS = 8098;

const REPO = process.cwd();
const base = checkedUrl(`http://127.0.0.1:${PORT_STATS_SHOTS}`);
const OUT = checkedOutputPath(
  resolve(REPO, "..", "townreporter-deepseek-oversight", "evidence", "BM"),
  [resolve(REPO, "..")],
  "output directory",
);
const DESIGN = resolve(REPO, "docs/design/handoff-2026-09-26", "screen-captures");

const EMAIL = "stats-shots@example.com";
const PASSWORD = "stats-shots-owner-password";

const STORY = { slug: "stats-shots-story", headline: "The council votes on the water rate" };
const SECOND = { slug: "stats-shots-second", headline: "The library board posts its budget" };

/**
 * One row per appearance: the drawing above this build's full-page shot.
 *
 * desk-25 is the DARK capture and desk-26 the LIGHT one -- the numbering is the
 * handoff's, not an ordering.
 */
const SIDE_BY_SIDE = [
  {
    row: "Stats · light · 1280",
    design: "desk-26-stats-light.png",
    built: "stats-1280-light-full.png",
  },
  {
    row: "Stats · dark · 1280",
    design: "desk-25-stats-dark.png",
    built: "stats-1280-dark-full.png",
  },
];

const shots = [];
function shot(name) {
  shots.push(name);
  console.log(`  shot  ${name}`);
}

function fail(message) {
  throw new Error(message);
}

/** Boot the built server here, in this process, on its own port and database. */
async function bootTheServer() {
  process.env.PORT = String(PORT_STATS_SHOTS);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = "";
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.BETTER_AUTH_SECRET ||= "stats-screen-shots-secret";
  await import(pathToFileURL(join(REPO, ".output", "server", "index.mjs")).href);
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  fail(`the built server never answered on ${base}`);
}

/**
 * The paper, and thirty days of aggregate history.
 *
 * Every row here is an AGGREGATE row of the kind the beacon writes: no id, no
 * address, nothing per reader. The numbers are made to have a shape the drawing
 * has -- evenings busier than mornings, weekends quieter, a few days over the
 * thousand-visit mark where the chart turns yellow -- because a screen of
 * zeros compares to a drawing of bars in no useful way.
 */
async function seedThePaper() {
  const pg = await globalThis.__pgliteInstance__;
  if (!pg) fail("the server booted without a PGlite instance to seed");

  let applied = -1;
  let quiet = 0;
  for (let i = 0; i < 240 && quiet < 3; i += 1) {
    let count = -1;
    try {
      count = Number((await pg.query("select count(*)::int as n from _migrations")).rows[0]?.n);
    } catch {
      /* the migrations table is not there yet */
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
  for (const story of [STORY, SECOND]) {
    await pg.query(
      `insert into articles (user_id, slug, headline, dek, body, topic, source_urls, status, published_at)
       values ('stats-screen-shots', $1, $2, $3, $4, 'council', '[]', 'published',
               now() - interval '1 day')`,
      [
        story.slug,
        story.headline,
        `Dek for ${story.headline}.`,
        Array.from({ length: 24 }, (_, i) => `Paragraph ${i + 1} of the story body.`).join(" "),
      ],
    );
  }

  /*
    The history: one row per (day, hour of the day, page, arrival class,
    device). `weight` is roughly how many loads that combination gets in the
    busiest hour; the hour curve, the day of the week and how long ago the day
    was (recent days are busier) all bend it.

    The hour curve has ONE peak, at 8 p.m., and no plateau: the panel names a
    single busiest hour when one hour stands alone at the top, and a fixture
    where five evening hours are level would print the tie instead -- true of
    the fixture, no use to the reader. The recirculation and quick-exit shares
    also drift a little from day to day, and so does the time a reader spends on
    a page, so the summary row's changes are changes and not a constant divided
    by itself: a per-page constant would make "avg reading time" identical in
    every window and the cell would read "same as prior 7 days" forever.

    Every hour of the day is present, and every cell lands on at least one load,
    because an hour with NO rows is not the same as an hour with a quiet one:
    the panel would call one of the empty hours "the quietest" and be naming a
    gap in the fixture rather than a habit of the town.
  */
  await pg.query("delete from read_hourly");
  await pg.query(
    `insert into read_hourly (
       newsroom_id, hour_start, path, ref_class, device,
       loads, visits, recirc, left_early, active_seconds,
       depth_25, depth_50, depth_75, depth_100)
     select 1,
            date_trunc('hour', now()) - make_interval(days => d, hours => h) - interval '1 hour',
            p.path, p.ref_class, p.device,
            loads,
            case when p.ref_class = 'internal' then 0 else loads end,
            floor(loads * p.recirc_share * (1 + (d % 3) * 0.15))::int,
            floor(loads * p.left_share * (1 + (d % 4) * 0.11))::int,
            floor(loads * p.seconds * (1 + (29 - d) * 0.012))::int,
            loads,
            floor(loads * p.d50)::int,
            floor(loads * p.d75)::int,
            floor(loads * p.d100)::int
     from generate_series(0, 29) as d
     cross join generate_series(0, 23) as hh(h)
     cross join (values
       ($1, 'search',   'computer', 11, 118, 0.31, 0.62, 0.74, 0.61, 0.47, 0.31),
       ($1, 'search',   'phone',     9,  96, 0.26, 0.58, 0.70, 0.55, 0.40, 0.25),
       ($2, 'internal', 'phone',     6, 141, 0.35, 0.31, 0.82, 0.70, 0.58, 0.44),
       ('/',            'share',      'phone',     5,  64, 0.09, 0.71, 0.66, 0.48, 0.33, 0.19),
       ('/',            'direct',     'computer',  4,  57, 0.06, 0.74, 0.61, 0.44, 0.30, 0.17),
       ('/',            'facebook',   'phone',     3,  52, 0.05, 0.80, 0.59, 0.42, 0.28, 0.15),
       ('/',            'reddit',     'computer',  2,  88, 0.12, 0.66, 0.69, 0.52, 0.36, 0.22),
       ('/',            'rss',        'computer',  2, 132, 0.04, 0.35, 0.79, 0.66, 0.51, 0.38),
       ('/',            'local',      'computer',  1,  71, 0.08, 0.60, 0.64, 0.47, 0.32, 0.18),
       ('/about',       'direct',     'tablet',    1,  44, 0.03, 0.83, 0.58, 0.39, 0.25, 0.12),
       ('/how-we-report','search',    'computer',  1, 156, 0.11, 0.40, 0.85, 0.74, 0.60, 0.45),
       ('/evidence',    'internal',   'computer',  1, 104, 0.14, 0.52, 0.76, 0.62, 0.47, 0.33)
     ) as p(path, ref_class, device, weight, seconds, recirc_share, left_share, d50, d75, d100)
     cross join lateral (
       select greatest(1, (p.weight
         * case when hh.h = 20 then 3
                when hh.h in (19, 21) then 2.6
                when hh.h in (18, 22) then 2.3
                when hh.h in (12, 13) then 2
                when hh.h between 1 and 5 then 0.3
                else 1 end
         * case when extract(dow from (now() - make_interval(days => d))) in (0, 6) then 0.55 else 1 end
         * (1 + (29 - d) * 0.02)
       )::int) as loads
     ) as l`,
    [`/articles/${STORY.slug}`, `/articles/${SECOND.slug}`],
  );

  /*
    The old counter, which is what "Page loads" reads -- derived from the rows
    just written rather than invented beside them, so a load is always more than
    a visit on the same day, the way it is in the world. Every page a reader
    arrives at is a load; only the arrivals from outside are visits.
  */
  await pg.query("delete from page_views");
  await pg.query(
    `insert into page_views (newsroom_id, target, day, count)
     select 1, 'site', d.day,
            greatest(200, (coalesce(sum(r.visits), 0) * 1.6)::int)
     from generate_series(current_date - 29, current_date, interval '1 day') as d(day)
     left join read_hourly r
       on r.newsroom_id = 1
      and r.hour_start >= d.day
      and r.hour_start < d.day + interval '1 day'
     group by d.day`,
  );

  await pg.query("delete from trust_signals_hourly");
  await pg.query(
    `insert into trust_signals_hourly (newsroom_id, hour_start, event, count)
     select 1, date_trunc('hour', now()) - make_interval(hours => g * 3), e.event, e.n
     from generate_series(0, 20) as g
     cross join (values
       ('captured-version-opened', 3), ('source-link-followed', 5),
       ('how-we-reported-reached', 2), ('correction-filed', 1),
       ('credit-copied', 2), ('rss-fetch', 7),
       ('dark-mode-chosen', 4), ('larger-text-chosen', 2)
     ) as e(event, n)`,
  );

  const rows = Number((await pg.query("select count(*)::int as n from read_hourly")).rows[0].n);
  console.log(`  ok    seeded 2 stories and ${rows} aggregate reading rows over 30 days`);
}

/**
 * The reader's own two pages, left open.
 *
 * A separate context with no desk session, so the beacons it sends are the ones
 * any reader sends. They are never closed until the walk ends: "Reading right
 * now" holds a rolling half hour, and a closed page stops counting.
 */
async function giveTheLivePanelRealReaders(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  /* The beacon's beat interval is fifteen seconds (src/components/read-beacon.tsx). */
  const BEAT_DWELL_MS = 18_000;
  const reader = await context.newPage();
  await reader.goto(`${base}/`, { waitUntil: "networkidle" });
  // The front page lists a story as a link around its headline, not as a heading
  // of its own.
  await reader.getByRole("link", { name: STORY.headline }).waitFor({ timeout: 45_000 });
  /*
    AND IT STAYS IN FRONT, on both pages. The beacon beats only while its page is
    visible, and a headless browser reports a background page as hidden -- so a
    reader left behind the desk's own window would send its load and then
    nothing, and the live panel would draw readers with an average time so far of
    0:00. It costs nothing: a screenshot does not need the desk's page focused.

    The dwell has to outlast a beat interval, because the load beacon carries no
    seconds -- the first reading time the window ever hears is the beat at
    fifteen seconds. Four seconds of reading is a measured 0:00.
  */
  await reader.bringToFront();
  await reader.waitForTimeout(BEAT_DWELL_MS);
  await reader.goto(`${base}/articles/${STORY.slug}`, { waitUntil: "networkidle" });
  await reader.getByRole("heading", { level: 1, name: STORY.headline }).waitFor({ timeout: 45_000 });
  await reader.bringToFront();
  await reader.waitForTimeout(BEAT_DWELL_MS);
  console.log("  ok    two pages are open in a reader's window, so the live panel has readers");
  return context;
}

async function signIn(page) {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: /Create the desk|Editor sign-in/ })
    .waitFor({ timeout: 45_000 });
  const fresh = (await page.getByLabel("Name", { exact: true }).count()) > 0;
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  if (fresh) {
    await page.getByLabel("Name").fill("Stats Shots Owner");
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create editor account" }).click();
  } else {
    await page.getByRole("button", { name: "Sign in with email" }).click();
  }
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });

  await page.goto(`${base}/desk/setup`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  if (await page.getByLabel("Paper name", { exact: true }).count()) {
    /*
      "TownReporter" and "Testerville": the shipped brand, so the desk chrome in
      the screenshot is the one the drawing shows, and an obviously fake town,
      so a real place name in this artifact always means a real leak.
    */
    await completeFirstRunSetup(page, base, {
      name: "TownReporter",
      city: "Testerville",
      state: "Wyoming",
    });
    console.log("  ok    the desk has a paper name and a town");
  }
}

/** Go to the screen and wait for the parts the drawing has. */
async function openStats(page) {
  await page.goto(`${base}/desk/stats`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1, name: "Stats" }).waitFor({ timeout: 45_000 });
  await page.getByRole("heading", { name: "Reading right now" }).waitFor({ timeout: 45_000 });
  await page.getByRole("heading", { name: /Visits and reading time/ }).waitFor({ timeout: 45_000 });
  await page.getByRole("heading", { name: "What we never collect" }).waitFor({ timeout: 45_000 });
  await page.waitForTimeout(600);
}

/** The smallest rendered font size, and any console error -- measured, not eyeballed. */
async function measure(page, label) {
  const seen = await page.evaluate(() => {
    let smallest = null;
    for (const el of document.querySelectorAll(".desk-ltr *")) {
      const text = el.textContent?.trim() ?? "";
      if (!text) continue;
      if ([...el.children].some((c) => (c.textContent?.trim() ?? "").length > 0)) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (!Number.isFinite(px)) continue;
      if (smallest === null || px < smallest.px)
        smallest = { px, what: `${el.className || el.tagName}: ${text.slice(0, 40)}` };
    }
    return smallest;
  });
  console.log(
    `  ok    ${label}: smallest text is ${seen ? `${seen.px}px (${seen.what})` : "not found"}`,
  );
  return seen;
}

/**
 * The design's capture beside this build's, composed with PIL.
 *
 * Written out as a small Python program run under the repo's own interpreter,
 * because the brief asks for PIL and there is no image library in JavaScript
 * here. Both sides are scaled to one width; the drawing is a page preview at
 * 1210px and this build was shot at 1280, so matching heights would compare two
 * different cameras.
 */
function composeSideBySide() {
  const script = join(OUT, "_side-by-side.py");
  writeFileSync(
    script,
    `import json, sys
from PIL import Image

WIDTH = 860
GAP = 20
rows = json.loads(sys.argv[1])
out = sys.argv[2]

def fit(path, width):
    image = Image.open(path).convert("RGB")
    height = round(image.height * width / image.width)
    return image.resize((width, height), Image.LANCZOS)

panels = []
for row in rows:
    left = fit(row["design"], WIDTH)
    right = fit(row["built"], WIDTH)
    height = max(left.height, right.height)
    panel = Image.new("RGB", (WIDTH * 2 + GAP, height), (255, 255, 255))
    panel.paste(left, (0, 0))
    panel.paste(right, (WIDTH + GAP, 0))
    panels.append(panel)

height = sum(p.height for p in panels) + GAP * (len(panels) - 1)
sheet = Image.new("RGB", (WIDTH * 2 + GAP, height), (255, 255, 255))
y = 0
for panel in panels:
    sheet.paste(panel, (0, y))
    y += panel.height + GAP
sheet.save(out)
print("wrote", out, sheet.size)
`,
  );
  const rows = SIDE_BY_SIDE.map((row) => ({
    design: join(DESIGN, row.design),
    built: join(OUT, row.built),
  }));
  for (const [i, row] of SIDE_BY_SIDE.entries()) {
    const target = join(OUT, i === 0 ? "stats-side-by-side-light.png" : "stats-side-by-side-dark.png");
    const run = spawnSync("python", [script, JSON.stringify([rows[i]]), target], {
      encoding: "utf8",
    });
    if (run.status !== 0)
      fail(`PIL side-by-side failed for ${row.row}: ${run.stderr || run.stdout}`);
    console.log(`  shot  ${target}  (design ${row.design} | built ${row.built})`);
    shots.push(target);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await bootTheServer();
  await seedThePaper();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const errors = [];
  const readers = await giveTheLivePanelRealReaders(browser);

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));

  try {
    await signIn(page);

    // --- 1280, light ------------------------------------------------------
    await openStats(page);
    await measure(page, "1280 light");
    await page.screenshot({ path: join(OUT, "stats-1280-light.png"), animations: "disabled" });
    shot(join(OUT, "stats-1280-light.png"));
    await page.screenshot({
      path: join(OUT, "stats-1280-light-full.png"),
      fullPage: true,
      animations: "disabled",
    });
    shot(join(OUT, "stats-1280-light-full.png"));

    // --- 1280, dark, through the desk's own toggle ------------------------
    await page.getByRole("button", { name: "Switch to dark appearance" }).click();
    await page.waitForFunction(
      () => document.documentElement.getAttribute("data-appearance") === "desk-dark",
      undefined,
      { timeout: 15_000 },
    );
    await measure(page, "1280 dark");
    await page.screenshot({ path: join(OUT, "stats-1280-dark.png"), animations: "disabled" });
    shot(join(OUT, "stats-1280-dark.png"));
    await page.screenshot({
      path: join(OUT, "stats-1280-dark-full.png"),
      fullPage: true,
      animations: "disabled",
    });
    shot(join(OUT, "stats-1280-dark-full.png"));

    // --- 390, light, same session -----------------------------------------
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      storageState: await context.storageState(),
    });
    const small = await phone.newPage();
    small.on("pageerror", (e) => errors.push(`phone pageerror: ${String(e).slice(0, 200)}`));
    await small.addInitScript(() => {
      window.localStorage.setItem("townreporter.desk.mode", "light");
    });
    await openStats(small);
    await measure(small, "390 light");
    await small.screenshot({
      path: join(OUT, "stats-390-light.png"),
      fullPage: true,
      animations: "disabled",
    });
    shot(join(OUT, "stats-390-light.png"));
    await phone.close();

    composeSideBySide();

    if (errors.length) fail(`the screen logged ${errors.length} error(s): ${errors.join(" | ")}`);
    console.log("  ok    no console errors on the screen in any of the three shots");
  } finally {
    await readers.close();
    await context.close();
    await browser.close();
  }

  const report = { ok: true, shots, port: PORT_STATS_SHOTS, base };
  writeFileSync(join(OUT, "stats-screen-shots.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

try {
  await main();
} catch (err) {
  console.error(
    JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2),
  );
  process.exit(1);
}
