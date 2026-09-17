#!/usr/bin/env node
/**
 * Focused regression for the authenticated /desk route.
 *
 * The reported defect: a signed-in editor selects "Editor's desk" on the
 * public home, the URL changes to /desk and the desk navigation marks the
 * desk active, but the main content still shows the public homepage. A hard
 * load of /desk showed the same public surface. This check runs the two
 * required browser cases against a running, signed-in candidate and fails
 * if /desk shows the public homepage instead of the editor desk.
 *
 * It needs an isolated candidate server and a signed-in editor storage state
 * (see scripts/dark-live-signin.mjs):

 *   DESK_ROUTE_BASE_URL=http://127.0.0.1:4400 \
 *   DESK_ROUTE_STATE_FILE=work/dark-live/state.json \
 *   node scripts/desk-route-regression.mjs
 */
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";

const base = checkedUrl(
  process.env.DESK_ROUTE_BASE_URL || "http://127.0.0.1:4400",
).replace(/\/$/, "");
const stateFile = process.env.DESK_ROUTE_STATE_FILE;
if (!stateFile) {
  console.error("DESK_ROUTE_STATE_FILE is required (signed-in editor storage state).");
  process.exit(2);
}

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: stateFile });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message ?? e).slice(0, 300)}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`);
});
page.on("requestfailed", (r) =>
  errors.push(`reqfail: ${r.url().slice(0, 160)} :: ${r.failure()?.errorText ?? ""}`),
);

const PUBLIC_HERO = "Independent. Local. Accountable.";
const DESK_HOME = "A clear desk. A good story.";

async function assertDeskRendered(label) {
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const problems = [];
  if (page.url().replace(/\/$/, "") !== `${base}/desk`) {
    problems.push(`URL is ${page.url()}, expected ${base}/desk`);
  }
  if (!text.includes(DESK_HOME)) problems.push("editor desk home landmark missing");
  if (/Independent\.\s*Local\.\s*Accountable\./.test(text)) {
    problems.push("public homepage hero rendered under /desk");
  }
  if (problems.length) {
    throw new Error(`${label}: ${problems.join("; ")}`);
  }
}

try {
  // Case 1: hard load of /desk.
  await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await assertDeskRendered("hard load of /desk");

  // Case 2: public home, then Editor's desk click.
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.getByRole("link", { name: /Editor[’']s desk/i }).first().click();
  await page.waitForTimeout(5000);
  await assertDeskRendered("Editor's desk click from public home");
} finally {
  await browser.close();
}

if (errors.length) {
  console.error(`desk route errors: ${JSON.stringify(errors.slice(0, 10), null, 1)}`);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, cases: 2 }));
