#!/usr/bin/env node
/**
 * A legally removed story says so on in-app navigation, in a browser.
 *
 * BH4 made a removed story answer 410 Gone at its URL. That is the door a
 * reader arrives through from outside. It is not the door a reader who is
 * ALREADY INSIDE the paper arrives through: they click a link, or they press
 * Back to a story that was live when they opened it, and the route's loader runs
 * again in the browser. There is no HTTP response to re-status on that path, so
 * BH4's 410 page never arrives -- whatever React renders is the whole answer.
 *
 * Before the fix, that answer was the router's ordinary "not in this edition"
 * panel, and -- because a loader that THROWS leaves the previous match's
 * `loaderData` in place, which the route's `head` then reads -- the panel still
 * carried the removed story's own share card: `og:title`, `og:description`,
 * `article:*`, `twitter:*` and the tab title. A removal the desk confirmed was,
 * on that path, both the wrong answer and a partial republication of the thing
 * that was removed.
 *
 * This walk is the regression guard for that path, and it is the only guard that
 * can see the ROUTE'S LOADER run in a real browser: it drives the BUILT server
 * (`.output/server/index.mjs`) in-process over its own in-memory PGlite, and
 * takes the reader's path through it with Playwright.
 *
 * The path, and why each step is there:
 *
 *   1. full load of `/`                     the paper, as a reader arrives
 *   2. click the story's real `<Link>`      CLIENT-side navigation (sentinel
 *                                           must survive: no page load)
 *   3. click the breadcrumb back to `/`     another client-side navigation
 *   4. remove the story through the desk    `previewLegalRemoval` ->
 *                                           `removeLegally`, the same two
 *                                           functions the removal dialog calls
 *   5. press Back                           the reader returns to a story they
 *                                           had open when it was still live;
 *                                           the loader runs again (staleTime 0)
 *
 * Step 5 is the whole point. On a FULL load the route's own `server.handlers.GET`
 * answers 410 with the plain removal page. On a client-side navigation there is
 * no HTTP response to re-status: the loader runs in the browser and the page is
 * whatever React renders. That is the path this walk is about.
 *
 * The `window` sentinel is load-bearing, not decoration. If step 5 ever became a
 * real page load, the 410 page would arrive by itself and every "it says
 * removed" check below would pass while nothing had been fixed. So the sentinel
 * is asserted too: same JavaScript context, no reload.
 *
 * Every check runs; the failures are counted, printed and exit non-zero. The
 * server this file boots is in-process, so the explicit `process.exit` at the
 * end is also what stops it -- nothing is left listening.
 *
 *   node --experimental-strip-types scripts/legal-gone-nav-e2e.mjs
 *
 * The flag is for the one import below of the desk's own
 * `src/lib/news/legal-removal-store.ts`: step 4 has to remove the story the way
 * the desk removes it, not by deleting a row behind the desk's back.
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";

/**
 * This walk's own listen port, registered here the way
 * scripts/integration-ports-are-unique.test.mjs requires: a bare `PORT... = <n>`
 * constant no other integration file declares, so no two of them can bind the
 * same port and answer each other's requests.
 */
const PORT_LEGAL_GONE_NAV = 3523;

const REPO = process.cwd();
const base = checkedUrl(`http://127.0.0.1:${PORT_LEGAL_GONE_NAV}`);

const SLUG = "legal-gone-nav-camera-gone";
const SLUG_LIVE = "legal-gone-nav-camera-live";
const HEADLINE = "The mill on Main is sold";
const LIVE_HEADLINE = "The water tower is fixed";
const SECRET = "LEGAL_GONE_SECRET: the paragraph a court order says may not be published";
const DEK = "A dek about the mill sale";
const GENERIC_PANEL = "That story is not in this edition";

/** The words the 410 page carries; the in-app path has to say the same. */
const REMOVED_TITLE = "This story was removed.";
const REMOVED_BODY =
  "This page is gone for good. It was removed from the paper, and the record of the story is no longer published here.";

const done = [];
const step = (text) => {
  done.push(text);
  console.log(`  ok    ${text}`);
};

const failures = [];
function check(ok, what) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}`);
  if (!ok) failures.push(what);
}

async function dump(err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ ok: false, error: message, completed: done }, null, 2));
  process.exit(1);
}

/* --------------------------------------------------------------- the server */

async function bootTheServer() {
  process.env.PORT = String(PORT_LEGAL_GONE_NAV);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.BETTER_AUTH_SECRET ||= "legal-gone-nav-e2e-secret";
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

/** Wait for the migration pass to go quiet, then seed the room the reader serves. */
async function seedThePaper() {
  const pg = await globalThis.__pgliteInstance__;
  if (!pg) throw new Error("the server booted without a PGlite instance to seed");
  /*
    The PGlite global resolves to the instance, not to a MIGRATED instance, and
    `bootTheServer` returns as soon as `/` answers -- which an unmigrated server
    can do out of an empty state. Wait for the migration pass to go QUIET:
    `_migrations` stops growing.
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
    await new Promise((r) => setTimeout(r, 500));
  }
  await pg.query(
    `insert into paper_settings (newsroom_id, onboarded) values (1, true)
     on conflict (newsroom_id) do update set onboarded = true`,
  );
  await pg.query(
    `insert into newsroom_members (user_id, role, newsroom_id)
     values ('legal-gone-nav-owner', 'owner', 1) on conflict do nothing`,
  );
  for (const [slug, headline, dek, body] of [
    [SLUG, HEADLINE, DEK, SECRET],
    [SLUG_LIVE, LIVE_HEADLINE, "A dek about the water tower", "A story that stays up."],
  ]) {
    await pg.query(
      `insert into articles (user_id, newsroom_id, slug, headline, dek, body, topic, status, published_at)
       values ('legal-gone-nav-owner', 1, $1, $2, $3, $4, 'council', 'published', now() - interval '2 hours')`,
      [slug, headline, dek, body],
    );
  }
  step("seeded the public newsroom: one story to remove, one to leave up");
}

/** The desk's own path, exactly as the removal dialog drives it. */
async function removeLegallyThroughTheDesk() {
  const store = await import(
    pathToFileURL(join(REPO, "src/lib/news/legal-removal-store.ts")).href
  );
  const pg = await globalThis.__pgliteInstance__;
  const id = Number(
    (await pg.query("select id from articles where slug = $1", [SLUG])).rows[0]?.id,
  );
  if (!id) throw new Error("the story to remove is not in the database");
  const selection = {
    articleIds: [id],
    draftIds: [],
    memoryIds: [],
    auditIds: [],
    trashIds: [],
    reviewedLegacy: true,
    reviewedEvidence: true,
  };
  const preview = await store.previewLegalRemoval("legal-gone-nav-owner", selection);
  const { caseId } = await store.removeLegally("legal-gone-nav-owner", {
    selection,
    fingerprint: preview.fingerprint,
    policy: "retain",
    caseRef: "LEGAL-GONE-NAV-1",
  });
  const gone = await pg.query("select count(*)::int as n from articles where slug = $1", [SLUG]);
  step(
    `removed through the desk (case ${caseId}): the article row count for that slug is now ${gone.rows[0].n}`,
  );
}

/* ---------------------------------------------------------------- the reader */

const consoleErrors = [];

/**
 * Click the story link on the front page and report whether the ROUTER handled
 * it -- which it only can once React has hydrated. Before hydration an `<a>` is
 * an `<a>`, and a click is a full page load; so the click is retried from a
 * fresh front page until the sentinel survives, and the number of tries is
 * reported rather than hidden.
 */
async function clickStoryClientSide(page) {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.waitForSelector(`a[href="/articles/${SLUG}"]`);
    await page.evaluate(() => {
      window.__bh6NoReload = true;
    });
    await page.click(`a[href="/articles/${SLUG}"]`);
    await page
      .waitForFunction((slug) => location.pathname === `/articles/${slug}`, SLUG, {
        timeout: 10_000,
      })
      .catch(() => {});
    if (await page.evaluate(() => window.__bh6NoReload === true)) {
      return attempt;
    }
  }
  throw new Error("the story link was never handled by the router -- the page never hydrated");
}

/**
 * Wait until the article route has actually REPLACED the front page.
 *
 * `location.pathname` flips on popstate, before the loader has resolved, and
 * while a loader is pending the router keeps the previous page on screen. The
 * front page is the only one of the two that prints the live story's headline,
 * so its disappearance is the signal that the new route has rendered, whatever
 * it rendered.
 */
async function waitForArticleRoute(page) {
  await page.waitForFunction(
    ({ slug, live }) =>
      location.pathname === `/articles/${slug}` && !document.body.innerText.includes(live),
    { slug: SLUG, live: LIVE_HEADLINE },
    { timeout: 20_000 },
  );
}

/**
 * Wait until the removal notice itself -- body, tab title, AND the `robots`
 * meta -- has actually committed, not just the route.
 *
 * The flake this guards (main run 36354845113, 6 failed checks after the same
 * tree passed on the PR): `waitForArticleRoute` only waits for the BODY to stop
 * showing the live headline. The route's `head()` is derived from the same
 * loaderData and reaches the DOM through `<HeadContent>`, which TanStack Router
 * commits in its own effect, one tick after the body that reads loaderData
 * directly -- so occasionally the body already read "This story was removed."
 * while `document.title` and the `robots` meta still held the PREVIOUS route's
 * values for one more frame. Reading `after` at that instant is exactly the
 * kind of once-in-a-while loss a slower CI runner turns up far more often than
 * a laptop. Nothing here weakens what gets checked below -- it makes sure the
 * three signals the checks read (body, title, robots) have all landed before
 * `after` is captured, the same way `#story-body`'s arrival is used as the
 * settle signal for the earlier, live-story navigation.
 */
async function waitForRemovedNoticeSettled(page) {
  await page.waitForFunction(
    ({ removedTitle }) =>
      document.body.innerText.includes(removedTitle) &&
      document.title.includes(removedTitle) &&
      [...document.querySelectorAll('meta[name="robots"]')].some((m) =>
        /noindex/i.test(m.content),
      ),
    { removedTitle: REMOVED_TITLE },
    { timeout: 20_000 },
  );
}

async function main() {
  await bootTheServer();
  step(`the built server is answering on ${base}`);
  await seedThePaper();

  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  try {
    /* 1-2: a full load of the paper, then the reader clicks the story. */
    const attempts = await clickStoryClientSide(page);
    step(`the story's own link was handled by the router (client-side, attempt ${attempts})`);

    /*
      CONTROL. For a story that is NOT removed, the same in-app path renders the
      story: so the walk can see a client-navigated article at all.

      The wait is on the ARTICLE page's own element, not on `location.pathname`.
      The pathname flips on pushState, before the loader has resolved, and while
      a loader is pending the router still shows the page it is leaving -- the
      front page, which prints this story's headline in the edition list. Reading
      `innerText` at that instant measured the front page and reported the
      story's body as missing. `#story-body` exists only on `articles.$slug`, so
      its arrival is the signal that the article route, not the page we left, is
      what the checks below read.
    */
    await page.waitForSelector("#story-body", { timeout: 20_000 });
    const liveBody = await page.evaluate(() => document.body.innerText);
    console.log(
      `  ----  control: pathname=${await page.evaluate(() => location.pathname)} #story-body=${await page.evaluate(() => !!document.querySelector("#story-body"))}`,
    );
    check(
      liveBody.includes(HEADLINE),
      "control: the in-app navigation rendered the live story's headline",
    );
    check(
      liveBody.includes(SECRET),
      "control: the in-app navigation rendered the story's body text",
    );
    check(
      (await page.evaluate(() => document.title)).includes(HEADLINE),
      "control: the in-app navigation set the document title to the story's headline",
    );

    /* 3: back to the paper, the reader's way -- the breadcrumb link. */
    await page.click(".breadcrumbs a");
    await page.waitForFunction((live) => document.body.innerText.includes(live), LIVE_HEADLINE, {
      timeout: 15_000,
    });
    check(
      await page.evaluate(() => window.__bh6NoReload === true),
      "the breadcrumb back to the paper was a client-side navigation too (no page load)",
    );

    /* 4: while the reader is on the paper, the story is removed. */
    await removeLegallyThroughTheDesk();

    /* 5: the reader presses Back, to the story they still have open in history. */
    await page.goBack().catch(() => {});
    await waitForArticleRoute(page);
    await waitForRemovedNoticeSettled(page);

    const after = await page.evaluate(() => ({
      pathname: location.pathname,
      title: document.title,
      text: document.body.innerText,
      html: document.documentElement.outerHTML,
      robots: [...document.querySelectorAll('meta[name="robots"]')].map((m) => m.content),
      metas: [...document.head.querySelectorAll("meta")].map((m) => [
        m.getAttribute("name") || m.getAttribute("property") || "?",
        (m.getAttribute("content") || "").slice(0, 60),
      ]),
      canonicals: [...document.head.querySelectorAll('link[rel="canonical"]')].map((l) => l.href),
      sentinel: window.__bh6NoReload === true,
    }));

    console.log(`  ----  after Back: pathname=${after.pathname} title=${JSON.stringify(after.title)}`);
    console.log(
      `  ----  after Back: has-removed-title=${after.text.includes(REMOVED_TITLE)} has-generic-panel=${after.text.includes(GENERIC_PANEL)} has-headline=${after.text.includes(HEADLINE)} robots=${JSON.stringify(after.robots)}`,
    );
    // What the head still claims about the story is part of "no cached copy": a
    // tab title or an og:title is the headline, wherever it is printed.
    for (const [k, v] of after.metas)
      if (k !== "?" && /title|descri|article|robots|og:url|twitter/i.test(k))
        console.log(`  ----  head meta ${k} = ${JSON.stringify(v)}`);
    console.log(`  ----  head canonical = ${JSON.stringify(after.canonicals)}`);

    /*
      The instrument itself. If this is false the rest is meaningless: a real page
      load would have fetched the 410 page and satisfied the checks below without
      the in-app path having changed at all.
    */
    check(
      after.sentinel,
      "the Back navigation was client-side -- no page load, so the 410 page did not arrive by itself",
    );
    check(after.pathname === `/articles/${SLUG}`, "the reader is on the removed story's URL");

    // The new law: the same plain words the 410 page carries.
    check(after.text.includes(REMOVED_TITLE), `the page says ${JSON.stringify(REMOVED_TITLE)}`);
    check(after.text.includes(REMOVED_BODY), "the page carries the same body sentence as the 410 page");
    // Nothing of the story: not the headline, not the dek, not a word of the body.
    for (const secret of [HEADLINE, SECRET, "LEGAL_GONE_SECRET", DEK])
      check(!after.text.includes(secret), `the page carries no story text (${secret.slice(0, 32)})`);
    check(!after.html.includes(SECRET), "the page's own HTML carries no story text either");
    // Not the story's headline in the tab either -- that is the same leak in a
    // place a reader sees and a crawler reads.
    check(!after.title.includes(HEADLINE), "the document title is not the story's headline");
    check(after.title.includes(REMOVED_TITLE), "the document title is the removal notice");
    // `noindex` on the in-app path too, so a crawler that runs scripts does not
    // index a page the URL answers 410 for.
    check(
      after.robots.some((c) => /noindex/i.test(c)),
      `the page marks itself noindex (robots meta: ${JSON.stringify(after.robots)})`,
    );
    // The panel a mistyped address gets is NOT what a removed story gets.
    check(!after.text.includes(GENERIC_PANEL), "the generic 'not in this edition' panel is gone");

    /*
      A picture of the page under test, for a human reading a failed run. It goes
      to the temp directory, not into the repository: this walk runs in CI, and a
      committed camera's screenshot is evidence, not a build artifact.
    */
    const shots = join(tmpdir(), "legal-gone-nav-e2e");
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: join(shots, "in-app-removed.png"), fullPage: true });
    step(`screenshot: ${join(shots, "in-app-removed.png")}`);

    check(
      consoleErrors.length === 0,
      `console errors: ${consoleErrors.length}${consoleErrors[0] ? ` -- ${consoleErrors[0]}` : ""}`,
    );
  } finally {
    await browser.close();
  }

  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        port: PORT_LEGAL_GONE_NAV,
        failures,
      },
      null,
      2,
    ),
  );
}

/*
  `process.exit` and not a bare return: the built server this file booted keeps
  the event loop alive, so returning would hang CI on a green run -- the exact
  failure the stop-everything-you-started rule exists to prevent.
*/
try {
  await main();
} catch (err) {
  await dump(err);
}
process.exit(failures.length ? 1 : 0);
