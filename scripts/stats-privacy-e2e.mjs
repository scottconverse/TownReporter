#!/usr/bin/env node
/**
 * The Stats page's privacy rule, proved in a real browser.
 *
 * The rule (docs/design/handoff-2026-09-26/README.md:372) is "aggregate only,
 * never per person: no cookies, no storage in the browser, no IP stored, no
 * fingerprinting and no identifier that lasts past a day". Every one of those
 * is a claim about what the READER'S BROWSER does, so the unit tests cannot
 * settle it: reading.server.test.ts proves the handler never touches
 * `request.headers`, and this walk proves nothing in the page ever gave it
 * something to touch.
 *
 * What it does, in order, all of it on the built server in-process against its
 * own in-memory PGlite (never Postgres: DATABASE_URL is cleared below):
 *
 *   1. the front page, arriving from a search result;
 *   2. an article, arriving from a search result whose URL carries a private
 *      query -- the case the whole design exists for;
 *   3. a second article arrived at from the first one's path, which is what
 *      "Read another story" means;
 *   4. the reader's own Dark press, the one legitimate write to localStorage
 *      on this site, which is a reader's choice and not a count;
 *   5. the same front page at 390px, so the device class can be seen coming
 *      from the viewport width and nothing else.
 *
 * and after each of them asserts: `document.cookie` is empty, the site set no
 * cookie at all, localStorage and sessionStorage hold nothing, no request
 * carries an identifier, no URL or body carries a piece of the referrer, and
 * the classes the server stored are the eight words in src/lib/news/reading.ts
 * and not a URL. The last step reads the row the browser wrote, so the walk
 * ends on the database rather than on the browser's word for it.
 *
 * Nothing here is mocked: a real Chromium, a real server, a real database.
 *
 *   node scripts/stats-privacy-e2e.mjs
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { checkedUrl, checkedOutputPath } from "./browser-guard.mjs";

/**
 * This walk's own listen port, registered with
 * scripts/integration-ports-are-unique.test.mjs so no other integration file
 * can quietly bind it and answer this one's requests.
 */
const PORT_STATS_PRIVACY = 3524;

const REPO = process.cwd();
/** Where the walk's own JSON goes. Resolved on both sides, so Windows separators match. */
const EVIDENCE = checkedOutputPath(
  resolve(REPO, "..", "townreporter-deepseek-oversight", "evidence", "BM"),
  [resolve(REPO, "..")],
  "evidence directory",
);
const base = checkedUrl(`http://127.0.0.1:${PORT_STATS_PRIVACY}`);

/** The paper this walk seeds. Two stories, so one can be arrived at from the other. */
const STORY = { slug: "privacy-walk-story", headline: "The council votes on the water rate" };
const SECOND = { slug: "privacy-walk-second", headline: "The library board posts its budget" };
/** What the reader's search engine carried in the URL. Must never reach the server. */
const PRIVATE_QUERY = "private+query";
const SEARCH_REFERRER = `https://www.google.com/search?q=${PRIVATE_QUERY}&utm=secret`;
/** The front page's own arrival, so two different classes are exercised. */
const FRONT_REFERRER = "https://duckduckgo.com/?q=water+rate+longmont";
/** The eight words in src/lib/news/reading.ts READ_REF_CLASSES. */
const REF_CLASSES = ["search", "share", "facebook", "reddit", "direct", "local", "rss", "internal"];
/** Keys the beacon is allowed to send, per kind. Copied from read-beacon.tsx. */
const BEACON_KEYS = {
  load: ["kind", "path", "device", "refClass", "fromArticle"],
  beat: ["kind", "path", "device", "seconds"],
  read: ["kind", "path", "device", "seconds", "totalSeconds", "depth", "final"],
  trust: ["kind", "event"],
};
/**
 * Shapes that would mean the page sent something identifying: a UUID, a hex
 * digest, a JWT, or a long run of digits (an epoch stamp or a numeric id).
 * Nothing legitimate on this site's own wire looks like any of them.
 */
const ID_SHAPES = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  /\b[0-9a-f]{24,}\b/i,
  /\beyJ[A-Za-z0-9_-]{8,}/,
  /\b\d{10,}\b/,
];
/** A name that would mean a person: an IP, an agent, a cookie, a visitor id. */
const FORBIDDEN_NAME =
  /(^|[^a-z])(ip|addr|address|agent|ua|cookie|session|fingerprint|token|visitor|user|email|uid|gid|hash)([^a-z]|$)/i;
/** How TanStack addresses a server function: a fixed hash, not a reader. */
const SERVER_FN_ADDRESS = /\/_serverFn\/([0-9a-f]{64})/gi;

/**
 * Every 64-hex string that was written into the shipped bundle at build time.
 *
 * This is how "the framework's own function addresses are not identifiers" is
 * PROVED rather than assumed: an address the client sends at runtime has to be
 * in the JavaScript the client was served, and a value minted per reader could
 * not be. Read once, from the bundles only -- the vendor `_libs` directory is
 * skipped, since nothing the build generates lives there.
 */
function buildTimeIds() {
  const ids = new Set();
  const dirs = [
    join(REPO, ".output", "public"),
    join(REPO, ".output", "server", "_ssr"),
    join(REPO, ".output", "server", "_chunks"),
  ];
  const seen = new Set();
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "_libs") walk(path);
        continue;
      }
      if (!/\.(m?js|css|html)$/.test(entry.name) || seen.has(path)) continue;
      seen.add(path);
      for (const found of readFileSync(path, "utf8").matchAll(/[0-9a-f]{64}/gi)) {
        ids.add(found[0].toLowerCase());
      }
    }
  };
  for (const dir of dirs) walk(dir);
  return ids;
}

/** Read the bundles once, the first time the wire is audited -- not at import. */
let shippedIdsCache = null;
function shippedIds() {
  if (shippedIdsCache === null) shippedIdsCache = buildTimeIds();
  return shippedIdsCache;
}

let page;
const done = [];
const steps = [];
/** Every request the browser made, in order: what it sent, and to whom. */
const requests = [];
/** Every beacon body, captured at the route so the post data is readable. */
const beacons = [];
/** The status every /api/read answer carried. */
const beaconAnswers = [];

function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}

/** Record a number for the report, without asserting anything about it. */
function measured(name, value) {
  steps.push({ name, value });
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
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: message,
        url,
        text,
        completed: done,
        beacons: beacons.map((b) => b.body.slice(0, 200)),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

function fail(message) {
  throw new Error(message);
}

/** Boot the built server here, in this process, on its own port and database. */
async function bootTheServer() {
  process.env.PORT = String(PORT_STATS_PRIVACY);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.BETTER_AUTH_SECRET ||= "stats-privacy-e2e-secret";
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
  fail(`the built server never answered on ${base}`);
}

/**
 * Seed the paper, once the migration pass is quiet.
 *
 * The PGlite global resolves to the instance, not to a MIGRATED instance, and
 * `/` can answer while the server is still mid-migration -- so this waits for
 * `_migrations` to stop growing rather than seeding straight away (the same
 * race scripts/front-page-river-e2e.mjs documents at length).
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
  await pg.query("delete from articles");
  for (const story of [STORY, SECOND]) {
    await pg.query(
      `insert into articles (user_id, slug, headline, dek, body, topic, source_urls, status, published_at)
       values ('stats-privacy-e2e', $1, $2, $3, $4, 'council', '[]', 'published',
               now() - interval '1 hour')`,
      [
        story.slug,
        story.headline,
        `Dek for ${story.headline}.`,
        // Long enough to scroll: the walk scrolls this page to reach a depth bucket.
        Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} of the story body.`).join(" "),
      ],
    );
  }
  step(`seeded ${[STORY, SECOND].length} published stories`);
}

/** Record every request a page makes, and the body of every beacon. */
async function watch(context) {
  await context.route("**/api/read", async (route) => {
    const req = route.request();
    beacons.push({
      url: req.url(),
      headers: req.headers(),
      body: req.postData() ?? "",
    });
    await route.continue();
  });
  context.on("response", (res) => {
    if (new URL(res.url()).pathname === "/api/read") beaconAnswers.push(res.status());
  });
}

/** The request inventory, taken from the page rather than from the route. */
function watchRequests(target) {
  target.on("request", (req) => {
    requests.push({
      method: req.method(),
      url: req.url(),
      type: req.resourceType(),
      headers: req.headers(),
      body: req.postData() ?? "",
    });
  });
}

/** Poll until `fn` is true, or fail with `what`. */
async function until(fn, what, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Every beacon body that parsed, in the order the browser sent them. */
function parsedBeacons() {
  const out = [];
  for (const beacon of beacons) {
    try {
      out.push(JSON.parse(beacon.body));
    } catch {
      /* a body that is not JSON is caught by the wire audit */
    }
  }
  return out;
}

/**
 * Wait for a beacon matching `pred`, then return the LAST one that matches.
 *
 * Waiting on the predicate rather than on a count matters on the second visit
 * to the same path: a body from an earlier step is not evidence that this step
 * sent anything.
 */
async function untilBeacon(pred, what) {
  await until(() => parsedBeacons().some(pred), what);
  return parsedBeacons().filter(pred).at(-1);
}

/**
 * The rule, checked against one page after it has settled.
 *
 * `page.evaluate`, not a header or a response: the browser's own view of what
 * it holds, which is exactly what the rule is written about.
 */
async function nothingIsRemembered(context, when) {
  const held = await page.evaluate(() => ({
    cookie: document.cookie,
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  const cookies = await context.cookies();
  if (held.cookie !== "")
    fail(`${when}: document.cookie is not empty: ${held.cookie.slice(0, 200)}`);
  if (cookies.length !== 0)
    fail(
      `${when}: the site set ${cookies.length} cookie(s): ` +
        cookies.map((c) => `${c.name}@${c.domain}`).join(", "),
    );
  if (held.local.length !== 0)
    fail(`${when}: localStorage holds ${held.local.length} key(s): ${held.local.join(", ")}`);
  if (held.session.length !== 0)
    fail(`${when}: sessionStorage holds ${held.session.length} key(s): ${held.session.join(", ")}`);
  step(`${when}: no cookie, no localStorage, no sessionStorage`);
  return held;
}

/**
 * The whole wire, checked in one place: every URL, every body, every header.
 *
 * This is the "no request carries an id" half of the brief. It runs over the
 * whole inventory rather than over the beacons alone, because an identifier
 * could leave in a query string or a header just as easily as in a body.
 */
function noRequestCarriesAnIdentifier(when) {
  const troubles = [];
  const outsideReferers = [];
  const frameworkAddresses = new Set();
  for (const req of requests) {
    let parsed;
    try {
      parsed = new URL(req.url);
    } catch {
      troubles.push(`a request to a URL that does not parse: ${req.url}`);
      continue;
    }
    if (!req.url.startsWith(base)) {
      troubles.push(`a request to another host: ${req.url}`);
      // Chromium's own internals (favicon, devtools) are not this site's wire.
      continue;
    }
    /*
      The framework addresses its own server functions as
      `/_serverFn/<64 hex>`, and those hashes are written into the shipped
      bundle at build time (the check below reads the bundle to prove it) -- the
      same address for every reader, on every machine. So the address is
      scrubbed before the id scan rather than exempted from it: a hex in that
      one position is allowed only when `buildTimeIds()` has seen it in
      .output, and everything else about the URL is still checked as strictly.
    */
    for (const found of req.url.matchAll(SERVER_FN_ADDRESS)) {
      const id = found[1].toLowerCase();
      frameworkAddresses.add(id);
      if (!shippedIds().has(id)) {
        troubles.push(`a server-function address that is not in the shipped bundle: ${id}`);
      }
    }
    for (const [where, text] of [
      ["url", req.url.replace(SERVER_FN_ADDRESS, "/_serverFn/<build-time id>")],
      ["query", parsed.search],
      ["body", req.body],
    ]) {
      for (const shape of ID_SHAPES) {
        if (shape.test(text)) troubles.push(`an id-shaped ${where}: ${text.slice(0, 160)}`);
      }
    }
    if (req.headers.cookie) troubles.push(`a request carried a cookie header: ${req.url}`);
    if (req.headers.authorization)
      troubles.push(`a request carried an authorization header: ${req.url}`);
    if (req.headers.referer && !req.headers.referer.startsWith(base)) {
      outsideReferers.push({ url: req.url, type: req.type, referer: req.headers.referer });
    }
  }
  for (const body of beacons) {
    let parsed;
    try {
      parsed = JSON.parse(body.body);
    } catch {
      troubles.push(`a beacon body that is not JSON: ${body.body.slice(0, 160)}`);
      continue;
    }
    const allowed = BEACON_KEYS[parsed.kind];
    if (!allowed) {
      troubles.push(`a beacon of an unknown kind: ${parsed.kind}`);
      continue;
    }
    for (const key of Object.keys(parsed)) {
      if (!allowed.includes(key)) troubles.push(`a beacon carrying ${key} on a ${parsed.kind}`);
      if (FORBIDDEN_NAME.test(key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)))
        troubles.push(`a beacon key naming a person: ${key}`);
    }
    for (const shape of ID_SHAPES) {
      if (shape.test(body.body)) troubles.push(`an id-shaped beacon: ${body.body.slice(0, 160)}`);
    }
    if (body.headers.cookie) troubles.push("a beacon carried a cookie header");
    if (new URL(body.url).search !== "") troubles.push(`a beacon with a query string: ${body.url}`);
    if (!body.url.startsWith(base)) troubles.push(`a beacon to another host: ${body.url}`);
  }
  /*
    The one place the outside referrer may appear is the header Chromium
    attaches to the navigation the walk itself asked for. Those navigations are
    the instrument, not the product: the point is that the SAME value never
    reaches a beacon and never reaches a URL or a body -- asserted above.
  */
  for (const outside of outsideReferers) {
    if (outside.type !== "document")
      fail(
        `${when}: a ${outside.type} request to ${outside.url} carried an outside referrer ` +
          `(${outside.referer.slice(0, 80)}) -- only a navigation may`,
      );
  }
  for (const shape of [PRIVATE_QUERY, "utm=secret", "google.com", "duckduckgo.com"]) {
    for (const req of requests) {
      if (req.url.includes(shape) || req.body.includes(shape))
        fail(`${when}: "${shape}" reached a request to ${req.url.slice(0, 120)}`);
      for (const value of Object.values(req.headers)) {
        if (value.includes(shape) && !outsideReferers.some((o) => o.referer === value))
          fail(`${when}: "${shape}" reached a header of a request to ${req.url.slice(0, 120)}`);
      }
    }
  }
  if (troubles.length) fail(`${when}: ${troubles.length} on the wire:\n  - ${troubles.join("\n  - ")}`);
  step(
    `${when}: ${requests.length} requests, ${beacons.length} beacons, none carrying an id ` +
      `(${outsideReferers.length} navigation(s) carried the referrer the walk set)`,
  );
  return outsideReferers.length;
}

/** The front page, arriving from a search result. */
async function theFrontPageFromASearchResult(context) {
  await page.goto(`${base}/`, { waitUntil: "networkidle", referer: FRONT_REFERRER });
  await page.locator(".mast .brand").waitFor({ timeout: 30_000 });
  const referrer = await page.evaluate(() => document.referrer);
  if (referrer !== FRONT_REFERRER)
    fail(`the browser did not carry the referrer this step set; it had "${referrer}"`);
  const load = await untilBeacon(
    (b) => b.kind === "load" && b.path === "/",
    "the front page's load beacon",
  );
  if (load.refClass !== "search") fail(`the front page arrival was filed as "${load.refClass}"`);
  if (load.device !== "computer") fail(`a 1280px window was filed as a "${load.device}"`);
  if (load.fromArticle !== false) fail("the front page claimed to be a story");
  step(`the front page's arrival is filed as one class word: ${JSON.stringify(load)}`);
  measured("frontPageLoadBeacon", load);
  await nothingIsRemembered(context, "the front page, from a search result");
}

/** An article, arriving from a search result whose URL carries a private query. */
async function anArticleFromAPrivateQuery(context) {
  const url = `${base}/articles/${STORY.slug}`;
  await page.goto(url, { waitUntil: "networkidle", referer: SEARCH_REFERRER });
  await page
    .getByRole("heading", { level: 1, name: STORY.headline })
    .waitFor({ timeout: 30_000 });
  const referrer = await page.evaluate(() => document.referrer);
  if (referrer !== SEARCH_REFERRER)
    fail(
      `the browser did not carry the private query into document.referrer ("${referrer}"), ` +
        `so this walk proves nothing about it`,
    );
  step(`the reader's browser really held the query: document.referrer is "${referrer.slice(0, 60)}"`);
  const load = await untilBeacon(
    (b) => b.kind === "load" && b.path === `/articles/${STORY.slug}`,
    "the article's load beacon",
  );
  if (load.refClass !== "search") fail(`the article arrival was filed as "${load.refClass}"`);
  if (!REF_CLASSES.includes(load.refClass)) fail(`"${load.refClass}" is not one of the eight words`);
  step(`the article's arrival is filed as one class word: ${JSON.stringify(load)}`);
  measured("articleLoadBeacon", load);

  // Scroll to the foot of the story: a real depth report, not a synthetic one.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const read = await untilBeacon(
    (b) => b.kind === "read" && b.path === `/articles/${STORY.slug}` && b.depth.length > 0,
    "the depth report",
  );
  if (!Array.isArray(read.depth) || read.depth.length === 0)
    fail(`the depth report carried no bucket: ${JSON.stringify(read)}`);
  for (const bucket of read.depth) {
    if (![25, 50, 75, 100].includes(bucket)) fail(`"${bucket}" is not a depth bucket`);
  }
  step(`reaching the foot of the story sent depth ${JSON.stringify(read.depth)}, in buckets`);
  measured("articleDepthBeacon", read);

  await nothingIsRemembered(context, "the article, from a search result");
}

/** A second story arrived at from the first one's path: "Read another story". */
async function aSecondStoryFromTheFirst(context) {
  await page.goto(`${base}/articles/${SECOND.slug}`, {
    waitUntil: "networkidle",
    referer: `${base}/articles/${STORY.slug}`,
  });
  await page
    .getByRole("heading", { level: 1, name: SECOND.headline })
    .waitFor({ timeout: 30_000 });
  const load = await untilBeacon(
    (b) => b.kind === "load" && b.path === `/articles/${SECOND.slug}`,
    "the second story's load beacon",
  );
  if (load.refClass !== "internal") fail(`a same-site arrival was filed as "${load.refClass}"`);
  if (load.fromArticle !== true) fail("a link from one of our stories did not read as a recirculation");
  step(`a link from another story is filed as internal + fromArticle: ${JSON.stringify(load)}`);
  measured("recirculationBeacon", load);
  await nothingIsRemembered(context, "the second story");
}

/**
 * The reader's own Dark press -- the ONE legitimate write on this site.
 *
 * src/components/reader-controls.tsx keeps the reader's Light/Dark and
 * Normal/Large choices in `localStorage` under
 * `townreporter:reader:<paper>:<city>`. That is a preference the reader set,
 * read back before paint (src/routes/__root.tsx), and it is not a count: it
 * exists whether or not this Stats unit shipped. What is asserted here is what
 * the Stats rule actually forbids -- that pressing it starts an identifier:
 * one key and no more, still no cookie, and the count that leaves is the word
 * `dark-mode-chosen` with nothing else attached.
 */
async function theReadersOwnDarkPress(context) {
  const before = beacons.length;
  // The paper's chrome and the story's own row can both carry the button; the
  // one a reader can see is the one a reader presses.
  const openers = page.getByRole("button", { name: "Reading preferences" });
  let opened = false;
  for (let i = 0; i < (await openers.count()); i += 1) {
    if (await openers.nth(i).isVisible()) {
      await openers.nth(i).click();
      opened = true;
      break;
    }
  }
  if (!opened) fail("no visible 'Reading preferences' button to press");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  const trust = await untilBeacon(
    (b) => b.kind === "trust" && b.event === "dark-mode-chosen",
    "the dark-mode trust beacon",
  );
  if (trust.event !== "dark-mode-chosen") fail(`the press was filed as "${trust.event}"`);
  if (Object.keys(trust).length !== 2)
    fail(`the trust beacon carried more than a word: ${JSON.stringify(trust)}`);
  step(`the Dark press sent ${JSON.stringify(trust)} and nothing else`);
  measured("darkPressBeacon", trust);

  const held = await page.evaluate(() => ({
    cookie: document.cookie,
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  const cookies = await context.cookies();
  if (held.cookie !== "" || cookies.length !== 0)
    fail(`the Dark press set a cookie: "${held.cookie}" / ${cookies.length}`);
  if (held.session.length !== 0)
    fail(`the Dark press wrote sessionStorage: ${held.session.join(", ")}`);
  if (held.local.length !== 1)
    fail(
      `the Dark press left ${held.local.length} localStorage keys ` +
        `(${held.local.join(", ")}); the reader's one preference blob is expected`,
    );
  if (!held.local[0].startsWith("townreporter:reader:"))
    fail(`the Dark press wrote an unexpected key: ${held.local[0]}`);
  for (const shape of ID_SHAPES) {
    if (shape.test(held.local[0])) fail(`the storage key is id-shaped: ${held.local[0]}`);
  }
  const blob = await page.evaluate((key) => localStorage.getItem(key), held.local[0]);
  if (!/^\{"dark":true[^}]*\}$/.test(blob.replace(/\s/g, "")))
    fail(`the one key does not hold the reader's choice: ${String(blob).slice(0, 160)}`);
  step(`the Dark press wrote exactly one key, ${held.local[0]}, and no cookie`);
  measured("readerPreferenceKey", { key: held.local[0], value: String(blob).slice(0, 120) });
  measured("darkPressBeacons", beacons.length - before);
}

/** The same paper at 390px: the device class is the viewport width and nothing else. */
async function aPhoneWindow(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const main = page;
  page = await context.newPage();
  await watch(context);
  watchRequests(page);
  try {
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await page.locator(".mast .brand").waitFor({ timeout: 30_000 });
    const load = await untilBeacon(
      (b) => b.kind === "load" && b.path === "/" && b.device === "phone",
      "the phone window's load beacon",
    );
    if (load.device !== "phone") fail(`a 390px window was filed as a "${load.device}"`);
    if (load.refClass !== "direct")
      fail(`a load with no referrer was filed as "${load.refClass}"`);
    step(`a 390px window is filed as a phone, a load with no referrer as direct: ${JSON.stringify(load)}`);
    measured("phoneLoadBeacon", load);
    await nothingIsRemembered(context, "the phone window");
  } finally {
    page = main;
    await context.close();
  }
}

/**
 * What the database holds, read after the browser has finished writing.
 *
 * The columns are asserted by name here as well as in reading.server.test.ts,
 * because this is the table a real browser wrote to: a per-reader column added
 * to the migration would show up in this list.
 */
async function theDatabaseHoldsClassesNotPeople() {
  const pg = await globalThis.__pgliteInstance__;
  const columns = (
    await pg.query(
      `select column_name from information_schema.columns
       where table_name = 'read_hourly' order by column_name`,
    )
  ).rows.map((r) => r.column_name);
  if (columns.length === 0) fail("read_hourly does not exist after the beacon wrote to it");
  for (const name of columns) {
    const words = name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    if (FORBIDDEN_NAME.test(words) && name !== "newsroom_id")
      fail(`read_hourly has a column naming a person: ${name}`);
  }
  step(`read_hourly has ${columns.length} columns and none of them names a reader: ${columns.join(", ")}`);
  measured("readHourlyColumns", columns);

  /*
    Unit U17b's two tables, checked the same way. `location_daily` and
    `visitor_daily` are the only Stats tables that describe a person at all --
    a place a reader was in, and how many readers the server could tell apart
    in a day -- so the column-name oracle matters most here. A latitude, a
    longitude, a region, a postal code or a timezone column would each be a
    finer fact than the rule permits and each fails this list.
  */
  for (const table of ["location_daily", "visitor_daily"]) {
    const names = (
      await pg.query(
        `select column_name from information_schema.columns
         where table_name = '${table}' order by column_name`,
      )
    ).rows.map((r) => r.column_name);
    if (names.length === 0) fail(`${table} does not exist after this walk`);
    for (const name of names) {
      const words = name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      if (FORBIDDEN_NAME.test(words) && name !== "newsroom_id")
        fail(`${table} has a column naming a person: ${name}`);
    }
    step(`${table} has ${names.length} columns and none of them names a reader: ${names.join(", ")}`);
    measured(`${table}Columns`, names);
  }
  const locationTypes = (
    await pg.query(
      `select column_name, data_type from information_schema.columns
       where table_name in ('location_daily', 'visitor_daily')`,
    )
  ).rows;
  if (locationTypes.some((row) => /timestamp/i.test(String(row.data_type))))
    fail("a stats place or visitor table has a finer grain than a day");
  measured("statsLocationTypes", locationTypes);

  const rows = (
    await pg.query(
      `select ref_class, path, sum(loads)::int as loads, sum(visits)::int as visits,
              sum(recirc)::int as recirc, sum(active_seconds)::int as seconds
       from read_hourly group by ref_class, path order by ref_class, path`,
    )
  ).rows;
  if (rows.length === 0) fail("the beacon wrote no aggregate row at all");
  for (const row of rows) {
    if (!REF_CLASSES.includes(row.ref_class))
      fail(`read_hourly holds "${row.ref_class}", which is not one of the eight words`);
    if (row.path.includes("?") || row.path.includes("google") || row.path.includes(PRIVATE_QUERY))
      fail(`read_hourly holds a URL rather than a path: ${row.path.slice(0, 160)}`);
  }
  const classes = [...new Set(rows.map((r) => r.ref_class))].sort();
  step(`read_hourly holds ${rows.length} aggregate rows across ${classes.join(", ")}`);
  measured("readHourlyRows", rows);

  const trust = (
    await pg.query(
      `select event, count(*)::int as rows, sum(count)::int as presses
       from trust_signals_hourly group by event order by event`,
    )
  ).rows;
  step(`trust_signals_hourly holds ${trust.length} counted signals: ${JSON.stringify(trust)}`);
  measured("trustRows", trust);

  /*
    The visit the browser was told to make is the one the database counted.
    Grouped by path, so the two search arrivals are two rows and each has to
    be a visit on its own -- a sum that happened to reach two would still pass
    if one arrival had been filed as a recirculation.
  */
  const search = rows.filter((r) => r.ref_class === "search");
  if (search.length !== 2 || search.some((r) => r.visits !== 1 || r.loads !== 1))
    fail(`the two search arrivals are not each counted as a visit: ${JSON.stringify(search)}`);
  const internal = rows.find((r) => r.ref_class === "internal");
  if (!internal || internal.recirc < 1 || internal.visits !== 0)
    fail(`the same-site arrival was counted wrong: ${JSON.stringify(internal)}`);
  step("both search arrivals are visits, and the same-site arrival is a recirculation, not a visit");
}

/**
 * The build has to be the whole build.
 *
 * `npx vite build` alone leaves `_libs/pglite.data` behind -- Rolldown inlines
 * PGLite's JavaScript but not its three sibling binaries -- and the server then
 * dies on the first database read with a stream of `ENOENT ... pglite.data`
 * unhandled rejections while `/` answers 500. That looks like a broken page
 * instead of a missing build step, so it is checked here by name:
 * `npm run build` runs scripts/copy-runtime-assets.mjs after the bundler.
 */
function theBuildCarriesItsRuntime() {
  const data = join(REPO, ".output", "server", "_libs", "pglite.data");
  if (!existsSync(data)) {
    fail(
      `${data} is missing, so the server cannot open its own database. Run the ` +
        `post-build steps first: node scripts/patch-ssr-exports.mjs && node scripts/copy-runtime-assets.mjs`,
    );
  }
}

async function main() {
  theBuildCarriesItsRuntime();
  await bootTheServer();
  await seedThePaper();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await watch(context);
  page = await context.newPage();
  watchRequests(page);
  try {
    await theFrontPageFromASearchResult(context);
    await anArticleFromAPrivateQuery(context);
    await aSecondStoryFromTheFirst(context);
    await theReadersOwnDarkPress(context);
    await aPhoneWindow(browser);
    /*
      One audit, at the end, over everything the walk ever put on the wire --
      the desktop window and the phone window both, since both route their
      beacons into the same inventory. Auditing twice would only prove the
      second window was not the one that broke the rule.
    */
    noRequestCarriesAnIdentifier("the whole walk");
    if (beaconAnswers.some((status) => status !== 204))
      fail(`a beacon was answered ${beaconAnswers.join("/")} rather than 204`);
    step(`all ${beaconAnswers.length} beacon answers were 204`);
    await theDatabaseHoldsClassesNotPeople();
  } catch (err) {
    await dump(err);
  }
  await browser.close();
  const report = {
    ok: true,
    steps: done.length,
    requests: requests.length,
    beacons: beacons.length,
    beaconAnswers,
    measured: Object.fromEntries(steps.map((s) => [s.name, s.value])),
  };
  mkdirSync(EVIDENCE, { recursive: true });
  const file = join(EVIDENCE, "stats-privacy-e2e.json");
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, evidence: file }, null, 2));
  process.exit(0);
}

/*
  The outer catch is the difference between a failed walk and a walk that
  appears to hang: a throw from boot or seed (before there is a page to dump)
  otherwise leaves Node holding a live PGlite and an open port, printing its
  own stack and never exiting.
*/
try {
  await main();
} catch (err) {
  await dump(err);
}
