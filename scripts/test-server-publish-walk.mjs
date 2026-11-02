#!/usr/bin/env node
/**
 * The release walk, as a script: one story through the whole Publish path on
 * the throwaway Test server (:3400), in minutes instead of an hour.
 *
 * Scott chose this on Nov 1 2026 ("Plan B"): the release gate keeps its
 * real Publish press, but a script does it instead of a 70-minute agent walk.
 * It covers the path the release-path skill lists:
 *   sign in -> file a lead -> write the draft -> Publish (bar and confirm
 *   button words recorded) -> "On the paper" -> public story page ->
 *   Published list -> Drafts no longer lists it -> front page lists it.
 * No AI button is pressed, so no model runs (RULES 15 stays true).
 *
 * It writes a Markdown report that ends with `PUBLISH-WALK: PASS` or
 * `PUBLISH-WALK: FAIL`, the line the release gate reads.
 *
 *   TEST_WALK_PASSWORD_FILE=C:\...\test-owner.private \
 *   TEST_WALK_REPORT=C:\Users\scott\Desktop\Goals\TownReporter-WALK-SCRIPTED-....md \
 *   node scripts/test-server-publish-walk.mjs
 *
 * Settings (all optional except the password file):
 *   TEST_WALK_BASE_URL       default http://127.0.0.1:3400
 *   TEST_WALK_EMAIL          default test-owner@townreporter.test
 *   TEST_WALK_PASSWORD_FILE  file that holds the Test login (read, never printed)
 *   TEST_WALK_APP_DIR        the Test server's code folder; its HEAD goes in the report
 *   TEST_WALK_REPORT         report path (default: ./test-server-publish-walk-report.md)
 *
 * It refuses the production port (3000) and the Dev port (3100): this walk
 * presses Publish for real, and that belongs on the Test copy only.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { confirmSectionAndWaitForPublishable } from "./confirm-section-step.mjs";

const base = checkedUrl(process.env.TEST_WALK_BASE_URL || "http://127.0.0.1:3400").replace(/\/$/, "");
const port = Number(new URL(base).port || 80);
if (port === 3000 || port === 3100) {
  console.error(`Refusing ${base}: this walk publishes for real, so it runs on the Test server only.`);
  process.exit(2);
}
const email = process.env.TEST_WALK_EMAIL || "test-owner@townreporter.test";
const passwordFile = process.env.TEST_WALK_PASSWORD_FILE;
if (!passwordFile) {
  console.error("Set TEST_WALK_PASSWORD_FILE to the file that holds the Test login.");
  process.exit(2);
}
const reportPath = process.env.TEST_WALK_REPORT || "test-server-publish-walk-report.md";
const appDir = process.env.TEST_WALK_APP_DIR || "";

const stamp = new Date();
const tag = stamp.toISOString().replace(/[-:T]/g, "").slice(0, 12);
const headline = `Scripted release walk: council posts a water plant notice ${tag}`;
const why = "The scripted release walk files this lead to prove the Publish path.";
const body =
  `Testerville City Council posted a notice about the water plant (${tag}). ` +
  "This story was written by the scripted release walk on the Test server.";

const steps = [];
const pageErrors = [];
const started = Date.now();

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const detail = (await fn()) ?? "";
    steps.push({ name, ok: true, detail: String(detail), ms: Date.now() - t0 });
  } catch (err) {
    steps.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 });
    throw err;
  }
}

function testCommit() {
  if (!appDir) return "not given (set TEST_WALK_APP_DIR)";
  try {
    return execFileSync("git", ["-C", appDir, "log", "-1", "--format=%H %s"], { encoding: "utf8" }).trim();
  } catch (err) {
    return `could not read: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function writeReport(pass) {
  const seconds = Math.round((Date.now() - started) / 1000);
  const lines = [
    `# TownReporter scripted release walk`,
    ``,
    `- When: ${stamp.toISOString()}`,
    `- Server: ${base}`,
    `- Test server code: ${testCommit()}`,
    `- Story headline: ${headline}`,
    `- Time: ${seconds} s`,
    `- Page errors seen: ${pageErrors.length}${pageErrors.length ? ` (first: ${pageErrors[0]})` : ""}`,
    ``,
    `| # | Step | Result | Detail | Time |`,
    `|---|---|---|---|---|`,
    ...steps.map((s, i) =>
      `| ${i + 1} | ${s.name} | ${s.ok ? "PASS" : "FAIL"} | ${s.detail.replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 300)} | ${(s.ms / 1000).toFixed(1)} s |`,
    ),
    ``,
    `PUBLISH-WALK: ${pass ? "PASS" : "FAIL"}`,
    ``,
  ];
  writeFileSync(reportPath, lines.join("\n"));
  return seconds;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // The walk talks to the Test server only: anything else, including the
  // production and Dev ports, is refused at the network layer too.
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    const p = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || p === 3000 || p === 3100) {
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 200)));
  let pass = false;
  let articleUrl = "";
  try {
    await step("Sign in as the Test editor", async () => {
      const password = readFileSync(passwordFile, "utf8").trim();
      await page.goto(`${base}/login`, { waitUntil: "networkidle" });
      await page.locator("input[type=email]").fill(email);
      await page.locator("input[type=password]").first().fill(password);
      const resp = page.waitForResponse(
        (r) => r.url().includes("/sign-in/email") && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: /^sign in with email$/i }).click();
      const status = (await resp).status();
      if (status !== 200) throw new Error(`sign-in returned HTTP ${status}`);
      await page.waitForURL(/\/desk/, { timeout: 60_000 });
      return `HTTP ${status}, now on ${new URL(page.url()).pathname}`;
    });

    await step("File a lead yourself", async () => {
      await page.goto(`${base}/desk/queue#file-lead`, { waitUntil: "domcontentloaded" });
      await page.getByLabel("Headline").fill(headline);
      await page.getByLabel("Why now").fill(why);
      await page.getByRole("button", { name: "File lead" }).click();
      await page.getByLabel("Story", { exact: true }).waitFor({ timeout: 30_000 });
      return `draft opened at ${new URL(page.url()).pathname}`;
    });

    await step("Write the draft and save it", async () => {
      await page.getByLabel("Headline").fill(headline);
      await page.getByLabel("Summary").fill(why);
      await page.getByLabel("Story", { exact: true }).fill(body);
      await confirmSectionAndWaitForPublishable(page);
      return "saved; Publish button is live";
    });

    let barWords = "";
    let confirmWords = "";
    await step("Press Publish and confirm", async () => {
      const publish = page.getByRole("button", { name: /^Publish in / });
      barWords = (await publish.innerText()).trim();
      await publish.click();
      // No warnings: "Yes, print it in <section>". Warnings: "Publish anyway in <section>".
      const confirm = page.getByRole("button", { name: /^(Yes, print it|Publish anyway in )/ });
      await confirm.waitFor({ timeout: 15_000 });
      confirmWords = (await confirm.innerText()).trim();
      await confirm.click();
      await page.getByText("On the paper").first().waitFor({ timeout: 30_000 });
      return `bar button "${barWords}", confirm button "${confirmWords}", desk says "On the paper"`;
    });

    await step("Open the public story page", async () => {
      await page.getByRole("link", { name: "Read it on the paper" }).click();
      await page.waitForURL(/\/articles\//, { timeout: 20_000, waitUntil: "commit" });
      articleUrl = page.url();
      await page.getByRole("heading", { level: 1, name: /water plant notice/i }).waitFor();
      await page.getByText(/Testerville City Council posted a notice about the water plant/).waitFor();
      return new URL(articleUrl).pathname;
    });

    await step("Public page works signed out", async () => {
      const anon = await browser.newContext();
      try {
        const p = await anon.newPage();
        const resp = await p.goto(articleUrl, { waitUntil: "domcontentloaded" });
        if (!resp || resp.status() !== 200) throw new Error(`HTTP ${resp?.status()}`);
        await p.getByRole("heading", { level: 1, name: /water plant notice/i }).waitFor();
        return "HTTP 200, headline shows";
      } finally {
        await anon.close();
      }
    });

    await step("Published list shows the story", async () => {
      await page.goto(`${base}/desk/published`, { waitUntil: "domcontentloaded" });
      // Inside <main> only: the site-wide search box keeps a hidden copy of
      // every headline, so a page-wide text match proves nothing.
      await page.locator("main").getByText(headline).first().waitFor({ timeout: 30_000 });
      return "listed";
    });

    await step("Drafts no longer lists the story", async () => {
      await page.goto(`${base}/desk/drafts`, { waitUntil: "domcontentloaded" });
      // The list must have loaded first, or "not listed" proves nothing.
      await page.locator("main").getByText("Drafts", { exact: true }).first().waitFor();
      await page.waitForLoadState("networkidle").catch(() => {});
      const n = await page.locator("main").getByText(headline).count();
      if (n !== 0) throw new Error(`Drafts still lists it ${n} time(s)`);
      return "not listed";
    });

    await step("Front page lists the story", async () => {
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await page.locator("main").getByText(headline).first().waitFor({ timeout: 30_000 });
      return "listed";
    });

    pass = true;
  } catch {
    pass = false;
  } finally {
    await browser.close();
  }
  const seconds = writeReport(pass);
  console.log(JSON.stringify({ ok: pass, seconds, report: reportPath, steps: steps.map((s) => `${s.ok ? "ok  " : "FAIL"} ${s.name}`) }, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
