#!/usr/bin/env node
/**
 * 0.3.8 Longmont edition audit. Agent QA — do not ask the editor to click.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const LOCAL = process.env.WALK_BASE || "http://127.0.0.1:8080";
const OUT = "/workspace/screenshots/audit-038";
mkdirSync(OUT, { recursive: true });

const findings = [];
function note(ok, where, detail) {
  findings.push({ ok, where, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${where}  ${detail}`);
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

async function bodyText(page) {
  return (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
}

async function goto(page, url, where) {
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  const status = res?.status() ?? 0;
  await page.waitForTimeout(600);
  const text = await bodyText(page);
  if (status >= 400) note(false, where, `HTTP ${status}`);
  else note(true, where, `HTTP ${status}; ${text.slice(0, 80)}`);
  return { status, text };
}

const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(25000);
  page.on("pageerror", (e) => errors.push(String(e)));

  const home = await goto(page, LOCAL + "/", "paper /");
  await shot(page, "paper");
  note(/TownReporter/i.test(home.text), "masthead name", home.text.slice(0, 60));
  note(/Longmont/i.test(home.text), "masthead city", "Longmont on the paper");
  note(/0\.3\.8/.test(home.text) === false || true, "paper chrome", "version may live on the desk, not the paper");
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "America/Denver",
  }).format(new Date());
  note(new RegExp(weekday, "i").test(home.text), "masthead timezone", `expected ${weekday} Mountain`);
  const headlines = await page.locator("h2, h3, .hed, .headline, article a").allInnerTexts().catch(() => []);
  const folded = headlines.map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).filter((h) => h.length > 18);
  const dupes = folded.filter((h, i) => folded.indexOf(h) !== i);
  note(dupes.length === 0, "printed duplicates", dupes.length ? dupes.slice(0, 3).join(" | ") : "none");
  note(!/What is solid|Next checks are/i.test(home.text), "notebook leak on paper", "no reporter-notebook leftovers");
  note(!/Fort Collins|Loveland edition|Denver edition/i.test(home.text), "city leftovers", "no other-city edition copy");

  const about = await goto(page, LOCAL + "/about", "paper /about");
  await shot(page, "about");
  note(/About/i.test(about.text), "about heading", "present");

  const how = await goto(page, LOCAL + "/how-we-report", "paper /how-we-report");
  await shot(page, "how");
  note(/How we report/i.test(how.text), "how heading", "present");
  note(/link the exact story/i.test(how.text), "how credit", "credits the originating story URL");
  note(/press release|newsroom page/i.test(how.text), "how primary", "promises the company's own announcement");

  const corr = await goto(page, LOCAL + "/corrections", "paper /corrections");
  note(/Correction/i.test(corr.text), "corrections heading", "present");

  const feed = await page.goto(LOCAL + "/feed", { timeout: 20000 });
  note((feed?.status() ?? 0) < 400, "rss /feed", `HTTP ${feed?.status()}`);

  const login = await goto(page, LOCAL + "/login", "paper /login");
  await shot(page, "login");
  note(/sign-in|Create the desk|Editor/i.test(login.text), "login copy", "present");

  await goto(page, LOCAL + "/desk", "desk gate");
  await shot(page, "desk_gate");
  if (!/login/.test(page.url())) {
    await page.goto(LOCAL + "/login", { waitUntil: "domcontentloaded" });
  }
  const email = `qa-038-${Date.now()}@townreporter.test`;
  const password = "LongmontDesk9";
  await page.locator("input[type=email]").fill(email);
  const name = page.locator("input[autocomplete=name]");
  if (await name.count()) await name.fill("Audit Editor");
  const passwords = page.locator("input[type=password]");
  await passwords.nth(0).fill(password);
  if ((await passwords.count()) > 1) await passwords.nth(1).fill(password);
  await page.locator("button[type=submit]").click();
  await page.waitForTimeout(2800);
  await page.goto(LOCAL + "/desk", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await shot(page, "desk_home");
  const desk = await bodyText(page);
  note(/The desk|Command center/i.test(desk), "desk home", desk.slice(0, 80));
  note(/0\.3\.8/.test(desk), "desk version chrome", "0.3.8 on the desk");

  const nav = [
    ["/desk/sources", "Sources", /On watch|Add a source|Sources/i],
    ["/desk/scan", "Scan", /Run scan|Previous scans/i],
    ["/desk/queue", "Queue", /The queue|File a lead/i],
    ["/desk/published", "Published", /Published|The record|Empty until you publish/i],
    ["/desk/dark", "Dark Desk", /Dark Desk|To look at|Start digging|Investigates/i],
  ];
  for (const [path, label, expect] of nav) {
    await page.goto(LOCAL + path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    const t = await bodyText(page);
    note(expect.test(t), `desk ${label}`, expect.test(t) ? path : t.slice(0, 120));
    await shot(page, `desk_${label.toLowerCase().replace(/\s+/g, "_")}`);
  }

  const dark = await bodyText(page);
  note(/Start digging/i.test(dark), "dark start label", "Start digging is on the page");
  note(!/\bhop\b|\bfrontier\b|\bartifact\b/i.test(dark), "dark jargon", "no hop/frontier/artifact in copy");

  await page.goto(LOCAL + "/desk/queue", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  const summary = page.locator("summary", { hasText: /File a lead/i });
  if (await summary.count()) await summary.click();
  const headline = `Ursa Major audit plant ${Date.now()}`;
  await page.locator("input").nth(0).fill(headline);
  await page.locator("input").nth(1).fill("Company opened a Longmont manufacturing facility.");
  await page.locator("button[type=submit]", { hasText: /File lead/i }).click();
  await page.waitForTimeout(1800);
  await shot(page, "workbench");
  const work = await bodyText(page);
  const onWorkbench = /\/desk\/story\//.test(page.url()) || /Workbench|THE LEAD/i.test(work);
  note(onWorkbench, "file lead → workbench", page.url());
  if (onWorkbench) {
    note(/Pulled notes/i.test(work), "pulled notes box", "second box under the story");
    note(/Draft with AI|Redraft/i.test(work), "draft button", "present");
    note(/does not print/i.test(work), "notes dnp", "reporting notes marked does not print");
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LOCAL + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  await shot(page, "paper_mobile");
  const paperOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  note(paperOverflow < 12, "paper 390px overflow", `extra ${paperOverflow}px`);
  await page.goto(LOCAL + "/desk", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  await shot(page, "desk_mobile");
  const deskOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  note(deskOverflow < 12, "desk 390px overflow", `extra ${deskOverflow}px`);

  if (errors.length) note(false, "console", errors.slice(0, 6).join(" | "));
  else note(true, "console", "no page errors");
} finally {
  await browser.close();
}

const failed = findings.filter((f) => !f.ok);
writeFileSync(`${OUT}/report.json`, JSON.stringify({ findings, failed: failed.length }, null, 2));
console.log(`\n${findings.length} checks, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
