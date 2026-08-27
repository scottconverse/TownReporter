#!/usr/bin/env node
/**
 * Full paper + desk walkthrough. Agent QA — do not ask the editor to click.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const LOCAL = process.env.WALK_BASE || "http://127.0.0.1:8080";
const LIVE = process.env.WALK_LIVE || "https://townreporter-longmont.grok.me";
const OUT = "/workspace/screenshots/walkthrough";
mkdirSync(OUT, { recursive: true });

const findings = [];
function note(ok, where, detail) {
  findings.push({ ok, where, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark}  ${where}  ${detail}`);
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

async function goto(page, url, where) {
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  const status = res?.status() ?? 0;
  if (status >= 400) {
    note(false, where, `HTTP ${status} at ${url}`);
    return { status, text: "" };
  }
  await page.waitForTimeout(700);
  const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
  note(true, where, `HTTP ${status}; ${text.slice(0, 90)}`);
  return { status, text };
}

async function collectInternal(page, origin) {
  const hrefs = await page.$$eval("a[href]", (as, origin) => {
    const out = [];
    for (const a of as) {
      try {
        const u = new URL(a.getAttribute("href") || "", origin);
        if (u.origin !== origin) continue;
        if (u.pathname.startsWith("/api/")) continue;
        out.push(u.pathname + u.search);
      } catch {
        /* skip */
      }
    }
    return [...new Set(out)];
  }, origin);
  return hrefs;
}

async function walkPublic(browser, origin, tag) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const seen = new Set();
  const queue = ["/", "/about", "/how-we-report", "/corrections", "/login", "/feed", "/get-the-code"];
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    const { text } = await goto(page, origin + path, `${tag} ${path}`);
    await shot(page, `${tag}${path.replaceAll("/", "_") || "_home"}`);
    if (path === "/" && /TownReporter/i.test(text) === false) {
      note(false, `${tag} /`, "Front page missing TownReporter masthead");
    }
    if (path === "/about" && !/About this paper/i.test(text)) {
      note(false, `${tag} /about`, "About heading missing");
    }
    if (path === "/how-we-report" && !/How we report/i.test(text)) {
      note(false, `${tag} /how-we-report`, "How we report heading missing");
    }
    if (path === "/corrections" && !/Correction/i.test(text)) {
      note(false, `${tag} /corrections`, "Corrections heading missing");
    }
    if (path === "/login" && !/sign-in|Create the desk|Editor/i.test(text)) {
      note(false, `${tag} /login`, "Login copy missing");
    }
    if (path !== "/feed") {
      const more = await collectInternal(page, origin);
      for (const href of more) {
        if (!seen.has(href) && !href.startsWith("/desk/story") && !href.startsWith("/evidence")) {
          queue.push(href);
        }
      }
    }
    if (path === "/") {
      const firstStory = page.locator("a[href^='/articles/']").first();
      if (await firstStory.count()) {
        const href = await firstStory.getAttribute("href");
        if (href && !seen.has(href)) queue.push(href);
      }
    }
  }
  if (errors.length) note(false, `${tag} console`, errors.slice(0, 5).join(" | "));
  else note(true, `${tag} console`, "no page errors");
  await page.close();
  return [...seen];
}

async function walkDesk(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(25000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await goto(page, LOCAL + "/desk", "local /desk (pre-auth)");
  await shot(page, "local_desk_gate");
  const url = page.url();
  if (!/login/.test(url) && !(await page.locator("text=The desk").count())) {
    // still on desk pending or already signed in
  }

  if (/login/.test(page.url()) || (await page.locator("input[type=email]").count())) {
    if (!/login/.test(page.url())) await page.goto(LOCAL + "/login", { waitUntil: "domcontentloaded" });
    const email = `qa-${Date.now()}@townreporter.test`;
    const password = "LongmontDesk9";
    await page.locator("input[type=email]").fill(email);
    const name = page.locator("input[autocomplete=name]");
    if (await name.count()) await name.fill("Walkthrough Editor");
    const passwords = page.locator("input[type=password]");
    await passwords.nth(0).fill(password);
    if ((await passwords.count()) > 1) await passwords.nth(1).fill(password);
    await page.locator("button[type=submit]").click();
    await page.waitForTimeout(2500);
    await shot(page, "local_after_signup");
    note(true, "local signup", `email ${email}; now ${page.url()}`);
  }

  await page.goto(LOCAL + "/desk", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await shot(page, "local_desk_home");
  const deskText = await page.locator("body").innerText();
  if (/The desk|Command center/i.test(deskText)) {
    note(true, "local desk home", "command center visible");
  } else if (/Sign in|Create the desk|Opening the desk/i.test(deskText)) {
    note(false, "local desk home", "still gated after signup");
    await page.close();
    return;
  } else {
    note(false, "local desk home", `unexpected copy: ${deskText.slice(0, 160)}`);
  }

  const nav = [
    ["/desk", "Desk", /The desk|Command center/i],
    ["/desk/sources", "Sources", /On watch|Proposed|Add a source|Sources/i],
    ["/desk/scan", "Scan", /Run scan|Previous scans|watch/i],
    ["/desk/queue", "Queue", /The queue|File a lead/i],
    ["/desk/published", "Published", /Published|The record|Empty until you publish/i],
    ["/desk/dark", "Dark Desk", /Dark Desk|To look at|Start from a tip|Investigates/i],
  ];
  for (const [path, label, expect] of nav) {
    const link = page.locator("nav a", { hasText: new RegExp(`^${label}$`, "i") }).first();
    if (await link.count()) {
      await link.click();
      await page.waitForTimeout(800);
    } else {
      await page.goto(LOCAL + path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);
    }
    const t = await page.locator("body").innerText();
    if (expect.test(t)) note(true, `desk nav ${label}`, path);
    else note(false, `desk nav ${label}`, `missing expected copy at ${page.url()}: ${t.slice(0, 120)}`);
    await shot(page, `desk_${label.toLowerCase().replace(" ", "_")}`);
  }

  await page.goto(LOCAL + "/desk/memory", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  if (/published/i.test(page.url())) note(true, "desk memory redirect", page.url());
  else note(false, "desk memory redirect", `stayed on ${page.url()}`);

  await page.goto(LOCAL + "/desk/queue", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  const summary = page.locator("summary", { hasText: /File a lead/i });
  if (await summary.count()) await summary.click();
  const headline = `Walkthrough water contract ${Date.now()}`;
  await page.locator("input").nth(0).fill(headline);
  await page.locator("input").nth(1).fill("Council votes Tuesday on a plant expansion.");
  await page.locator("button[type=submit]", { hasText: /File lead/i }).click();
  await page.waitForTimeout(1500);
  await shot(page, "desk_filed_lead");
  if (/\/desk\/story\//.test(page.url()) || (await page.locator("text=Workbench").count())) {
    note(true, "file lead", page.url());
    const crumb = page.locator("a", { hasText: /Queue/i }).first();
    if (await crumb.count()) {
      await crumb.click();
      await page.waitForTimeout(600);
      note(/queue/i.test(page.url()), "story crumb", page.url());
    }
  } else {
    note(false, "file lead", `did not open workbench: ${page.url()} ${await page.locator("body").innerText().then((t) => t.slice(0, 120))}`);
  }

  await page.goto(LOCAL + "/desk", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const paper = page.locator("a", { hasText: /View paper/i }).first();
  if (await paper.count()) {
    await paper.click();
    await page.waitForTimeout(800);
    note(/\/$/.test(new URL(page.url()).pathname) || /TownReporter/i.test(await page.locator("body").innerText()), "view paper", page.url());
  } else note(false, "view paper", "link missing");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LOCAL + "/desk", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  await shot(page, "desk_mobile");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  note(overflow < 8, "desk 390px overflow", `extra width ${overflow}px`);

  if (errors.length) note(false, "desk console", errors.slice(0, 6).join(" | "));
  else note(true, "desk console", "no page errors");
  await page.close();
}

const browser = await chromium.launch({ headless: true });
try {
  await walkPublic(browser, LOCAL, "local");
  await walkPublic(browser, LIVE, "live");
  await walkDesk(browser);
} finally {
  await browser.close();
}

const failed = findings.filter((f) => !f.ok);
writeFileSync(
  `${OUT}/report.json`,
  JSON.stringify({ ok: failed.length === 0, failed: failed.length, total: findings.length, findings }, null, 2),
);
console.log(`\n${failed.length} failed / ${findings.length} checks`);
process.exit(failed.length ? 1 : 0);
