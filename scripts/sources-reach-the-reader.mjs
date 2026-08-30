#!/usr/bin/env node
/**
 * A source attached to a lead must reach the reader.
 *
 * The front page promises "Sources shown." An audit filed a lead carrying a
 * source URL, published it, and the article showed no sources section at all
 * (UX-005): the lead stored the URL, the draft it created did not, and
 * publishLead reads the DRAFT. The promise on the front page and the code
 * disagreed, and the reader was the one who lost.
 *
 * This walks it the way the auditor did -- browser, real server, real database --
 * because the class of bug is "the data was dropped between two tables", which
 * a unit test on either table alone would have missed.
 *
 *   SOURCES_BASE_URL=http://127.0.0.1:3200 node scripts/sources-reach-the-reader.mjs
 */
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";

const base = checkedUrl(process.env.SOURCES_BASE_URL || "http://127.0.0.1:3200").replace(/\/$/, "");
const stamp = Date.now();
const SOURCE = "https://longmont.primegov.com/public/portal";
const headline = `Water board posts the Kimbark packet ${stamp}`;

const done = [];
const step = (s) => {
  done.push(s);
  console.log(`  ok    ${s}`);
};

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newContext().then((c) => c.newPage());
page.setDefaultTimeout(45_000);

try {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Name").fill("Sources Editor");
  // Shared with paste-editorial-e2e, which runs second in this job and signs
  // in as this account (the desk only ever has one editor).
  await page.getByLabel("Email").fill(process.env.E2E_DESK_EMAIL ?? `sources-${stamp}@townreporter.test`);
  await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_DESK_PASSWORD ?? "sources-e2e-pass");
  await page.getByLabel("Confirm password").fill(process.env.E2E_DESK_PASSWORD ?? "sources-e2e-pass");
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  step("owns the desk");

  await page.goto(`${base}/desk/queue`, { waitUntil: "networkidle" });
  await page.getByText("File a lead yourself").click();
  await page.getByLabel("Headline").fill(headline);
  await page.getByLabel("Why now").fill("The packet posted with a hearing date.");
  // The field is optional in the form; this whole test is about what happens
  // when it is filled in.
  const url = page.getByLabel(/source|link|url/i).first();
  await url.fill(SOURCE);
  await page.getByRole("button", { name: "File lead" }).click();
  await page.getByLabel("Body").waitFor({ timeout: 30_000 });
  step("filed a lead carrying a source URL");

  await page.getByLabel("Body").fill(
    "The water board posted the Kimbark packet on Tuesday. A hearing follows on the 14th.",
  );
  await page.getByRole("button", { name: /^Save/ }).first().click();
  await page.getByText(/Saved/i).first().waitFor({ timeout: 20_000 });
  step("wrote and saved the story by hand");

  await page.getByRole("button", { name: "Publish to the paper" }).first().click();
  // Publishing confirms before it prints; see lifecycle-e2e.mjs for why.
  await page.getByRole("button", { name: "Yes, print it" }).click();
  const readIt = page.getByRole("link", { name: /Read it on the paper/i });
  await readIt.waitFor({ timeout: 30_000 });
  step("published it");

  /*
    Follow the link, then load the destination properly.

    Clicking and waiting only for the URL to change left Playwright reading the
    DESK's markup while the address bar already said /articles/... -- so this
    check reported "no sources section" against a build whose database AND
    served HTML both carried the source. A navigation assertion that does not
    wait for the new document is a false-alarm generator.
  */
  const href = await readIt.getAttribute("href");
  if (!href) throw new Error("the post-publish confirmation has no link to the paper");
  const articleUrl = new URL(href, base).toString();
  await page.goto(articleUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20_000 });
  /*
    Scoped to the story's own sources block, not the whole page.

    The first version of this check searched the entire page text for the
    host, and PASSED against a build with the defect deliberately put back --
    the host appears elsewhere on the page. The database said `source_urls`
    was "[]" while the test said green. So the assertion now looks only inside
    the "How we reported this" section, which is the thing the front page
    means when it promises Sources shown.
  */
  const sources = page.locator('section:has(h2:text-is("How we reported this"))');
  if ((await sources.count()) === 0) {
    const text = await page.locator("body").innerText();
    throw new Error(
      `the published article at ${articleUrl} has no "How we reported this" section.` +
        `
The front page promises "Sources shown." and this story cites nothing.` +
        `
--- page text ---
${text.slice(0, 700)}`,
    );
  }
  const cited = await sources.first().innerText();
  if (!cited.includes("longmont.primegov.com")) {
    throw new Error(
      `the sources block does not cite the URL attached to the lead.` +
        `
--- sources block ---
${cited.slice(0, 500)}`,
    );
  }
  step("the reader sees the source that was attached to the lead");

  const link = sources.locator('a[href*="longmont.primegov.com"]');
  if ((await link.count()) === 0) throw new Error("the source is printed but is not a link");
  step("the source is a link the reader can follow");

  console.log(JSON.stringify({ ok: true, steps: done.length, article: articleUrl }, null, 2));
} catch (err) {
  console.error(
    JSON.stringify(
      { ok: false, error: err instanceof Error ? err.message : String(err), completed: done },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
