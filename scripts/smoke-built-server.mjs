#!/usr/bin/env node
/**
 * Smoke-test a BUILT, RUNNING server the way a reader and a new editor meet it.
 *
 * CI ran typecheck, the unit suite, and a lifecycle test against `npm run dev`.
 * It never ran `npm run build`, never booted `.output`, and never opened a page
 * in a browser. So two release-blocking defects shipped past a green pipeline:
 *
 *   - `node:crypto` reached the client bundle, and the documented `npm run dev`
 *     path showed "Opening…" forever with no sign-in form. Every server
 *     response was 200. Only a browser could see it.
 *   - a build could differ from dev in ways nothing exercised.
 *
 * A 200 is not proof a page works. This loads pages in Chromium, reads the
 * console, and asserts the things a person would notice.
 *
 * Usage:  SMOKE_BASE_URL=http://127.0.0.1:3000 node scripts/smoke-built-server.mjs
 */
import { chromium } from "playwright";

const BASE = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

let failures = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg, detail) => {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
  if (detail) console.log(`        ${detail}`);
};

/** Routes a reader or a machine hits, and the status each must return. */
const ROUTES = [
  ["/", 200],
  ["/about", 200],
  ["/how-we-report", 200],
  ["/corrections", 200],
  ["/feed", 200],
  ["/sitemap.xml", 200],
  ["/robots.txt", 200],
  ["/login", 200],
  // A slug that cannot exist must 404, not render an empty article.
  ["/articles/definitely-not-a-real-slug-smoke-test", 404],
];

async function checkRoutes() {
  console.log("routes:");
  for (const [path, want] of ROUTES) {
    try {
      const res = await fetch(BASE + path, { redirect: "manual" });
      if (res.status === want) ok(`${path} -> ${res.status}`);
      else bad(`${path} -> ${res.status}, expected ${want}`);
    } catch (err) {
      bad(`${path} did not answer`, String(err?.message ?? err));
    }
  }
}

/**
 * The check that would have caught the hydration blocker.
 *
 * A page can answer 200 and still be dead in the browser: the server sends
 * HTML, the client bundle throws, and the reader sees a spinner forever.
 */
async function checkInBrowser() {
  console.log("browser:");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    // The front page must render an actual story list, not a shell.
    await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 30_000 });
    const masthead = await page.locator("body").innerText();
    if (/TownReporter/i.test(masthead)) ok("/ renders the masthead");
    else bad("/ did not render the masthead");

    // The sign-in page must reach a usable form. This is the blocker.
    await page.goto(BASE + "/login", { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(1500);
    const text = await page.locator("body").innerText();
    if (/Opening/i.test(text)) {
      bad('/login is stuck on "Opening…" — the client bundle did not hydrate');
    } else {
      ok("/login moved past its loading state");
    }
    const inputs = await page.locator("input").count();
    if (inputs >= 2) ok(`/login rendered ${inputs} form fields`);
    else bad(`/login rendered ${inputs} form fields — expected a usable form`);

    // An unauthenticated desk route must not render the desk.
    await page.goto(BASE + "/desk", { waitUntil: "networkidle", timeout: 30_000 });
    const deskText = await page.locator("body").innerText();
    if (/Create the desk|Sign in|password/i.test(deskText)) {
      ok("/desk sends an unauthenticated visitor to sign-in");
    } else if (/Command center|The desk/i.test(deskText)) {
      bad("/desk rendered the desk to an unauthenticated visitor");
    } else {
      ok("/desk did not render the desk");
    }

    if (errors.length === 0) {
      ok("no console errors on any page");
    } else {
      bad(`${errors.length} console error(s)`, errors.slice(0, 5).join(" | "));
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

/** The public front page must not call out. */
async function checkPublicPageIsSelfContained() {
  console.log("self-contained page:");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const outside = new Set();
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.origin !== new URL(BASE).origin && u.protocol.startsWith("http")) {
        outside.add(u.host);
      }
    });
    await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 30_000 });
    if (outside.size === 0) ok("front page made no outside requests");
    else bad(`front page called out to: ${[...outside].join(", ")}`);
    await context.close();
  } finally {
    await browser.close();
  }
}

console.log(`smoke: ${BASE}`);
await checkRoutes();
await checkInBrowser();
await checkPublicPageIsSelfContained();

if (failures > 0) {
  console.log(`\n${failures} smoke check(s) failed.`);
  process.exit(1);
}
console.log("\nall smoke checks passed.");
