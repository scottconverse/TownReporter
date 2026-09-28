#!/usr/bin/env node
/**
 * Captures for unit CU -- retiring the manual follow-up workflow (0.6.81).
 *
 * Three screens, because those are the three the manual workflow touched:
 * Today (`/desk`, whose right rail drew the asks), Follow-ups
 * (`/desk/follow-ups`, which split into an agents section and a "Manual asks"
 * section) and a story page (`/desk/story/$leadId`, whose Reporting inspector
 * held "People who still need to respond").
 *
 * It is run twice against the same seed: once from a tree at HEAD (the BEFORE
 * captures) and once from the unit's own tree (AFTER). The seed writes four
 * manual rows and three agent rows, so the pair of runs answers the only
 * question the images exist to answer -- does a live manual row still reach a
 * screen? -- with the same rows on both sides.
 *
 *   CU_SHOTS_BASE_URL=http://127.0.0.1:8090 \
 *   CU_SHOTS_OUT_DIR=../townreporter-deepseek-oversight/reports/CU-evidence \
 *   CU_SHOTS_PREFIX=after \
 *   node scripts/cu-followups-shots.mjs
 *
 * The server is started and stopped by whoever runs this, on 8090 (the port
 * PROJECT-BRIEF.md reserves for this work). This file only visits, and it
 * names its own port only as the default base URL -- it never binds one.
 *
 * The dev-only seed route is scripts/dev-seed-route.ts, copied to
 * src/routes/api/dev-seed.ts for the run and deleted afterwards (it refuses to
 * work under `import.meta.env.PROD`); src/routeTree.gen.ts is restored with it.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/** The reserved shots port. This file is `-shots.mjs`, so the 3xxx-port
 * uniqueness scan (scripts/integration-ports-are-unique.test.mjs, which reads
 * `-e2e.mjs` / `-walk.mjs`) does not collect it. */
const PORT_CU_SHOTS = 8090;

const base = checkedUrl(
  process.env.CU_SHOTS_BASE_URL || `http://127.0.0.1:${PORT_CU_SHOTS}`,
).replace(/\/$/, "");
const outDir = checkedOutputPath(
  resolve(
    process.env.CU_SHOTS_OUT_DIR ||
      "../townreporter-deepseek-oversight/reports/CU-evidence",
  ),
  [resolve("..")],
  "output directory",
);
const prefix = (process.env.CU_SHOTS_PREFIX || "after").replace(/[^a-z0-9-]/gi, "");
mkdirSync(outDir, { recursive: true });

const SEED_PATH = "/api/dev-seed";

/*
  The story page is reached the way an editor reaches it -- the first story
  link on Today -- rather than by a hardcoded lead id, because the id is a
  serial and differs between the BEFORE and AFTER servers. The Reporting
  inspector tab has to be opened too: "People who still need to respond" lived
  in that panel, and it is `hidden` until the tab is selected, so a capture
  without the click would show neither the section nor its absence.
*/
const screens = [
  { slug: "today", path: "/desk", name: "Today" },
  { slug: "followups", path: "/desk/follow-ups", name: "Follow-ups" },
  { slug: "story", path: null, name: "Story", firstStoryLink: true, openReporting: true },
];

const shapes = [
  { tag: "1280-light", width: 1280, height: 900, dark: false, appearance: "light" },
  { tag: "1280-dark", width: 1280, height: 900, dark: true, appearance: "desk-dark" },
  { tag: "390-light", width: 390, height: 844, dark: false, appearance: "light" },
];

/*
  A fixed address, like the other shots harness: the server is a dev one with
  PGlite in memory, so an owner may already exist on a re-run and the script
  has to sign in rather than try to create the first account twice.
*/
const email = process.env.CU_SHOTS_EMAIL || "cu-followups-shots@townreporter.test";
const password = process.env.CU_SHOTS_PASSWORD || "cu-followups-shots-pass";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

/** Sticky/fixed chrome paints across the middle of a full-page capture. */
const PINNED_CHROME_HIDDEN = ".astra-topbar,.astra-skip{visibility:hidden !important}";

const report = { base, outDir, prefix, shots: [] };

async function shot(screen, shape) {
  const name = `${prefix}-${screen.slug}-${shape.tag}`;
  await page.setViewportSize({ width: shape.width, height: shape.height });
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(300);
  /*
    The mode is a storage key the pre-paint script stamps on <html>. Asserting
    the attribute is what makes the file name true instead of hopeful.
  */
  const appearance = await page.evaluate(
    () => document.documentElement.dataset.appearance ?? "",
  );
  if (appearance !== shape.appearance) {
    throw new Error(
      `${name}: asked for data-appearance="${shape.appearance}", page says "${appearance}"`,
    );
  }
  const style = await page.addStyleTag({ content: PINNED_CHROME_HIDDEN });
  const file = resolve(outDir, `${name}.png`);
  const full = await page.evaluate(() => document.documentElement.scrollHeight);
  if (full <= shape.height + 40) {
    await page.screenshot({ path: file, animations: "disabled" });
  } else {
    await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  }
  await style.evaluate((el) => el.remove());
  const text = await page.locator("body").innerText();
  report.shots.push({ file, text: text.replace(/\s+/g, " ").slice(0, 4000) });
  console.log(`  shot  ${name}`);
}

try {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor({
    timeout: 45_000,
  });
  const createAccount = page.getByRole("button", { name: "Create editor account" });
  if (await createAccount.count()) {
    await page.getByLabel("Name").fill("CU Follow-ups Owner");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await createAccount.click();
    await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 60_000 });
    await completeFirstRunSetup(page, base);
    console.log("  ok    the first account owns the desk");
  } else {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 60_000 });
    console.log("  ok    signed in to an existing desk");
  }

  const seedResp = await page.request.post(`${base}${SEED_PATH}`);
  const seedBody = await seedResp.text();
  if (!seedResp.ok()) {
    throw new Error(`${SEED_PATH} answered ${seedResp.status()}: ${seedBody.slice(0, 400)}`);
  }
  console.log(`  ok    seeded the dev desk: ${seedBody.trim().slice(0, 400)}`);

  /*
    Resolve the story path once, from the seed's own answer: it is the lead the
    manual rows hang on, which is the one story a BEFORE capture can show
    anything on. Guessing from Today's link order would let the two runs open
    different stories, and the images would then differ by more than the unit.
  */
  const storyLead = JSON.parse(seedBody).storyLead;
  if (!storyLead) throw new Error(`the seed named no story lead: ${seedBody.slice(0, 300)}`);
  const storyPath = `/desk/story/${storyLead}`;
  screens.find((s) => s.slug === "story").path = storyPath;
  console.log(`  ok    story page is ${storyPath}`);

  for (const screen of screens) {
    for (const shape of shapes) {
      await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
      await page.evaluate(
        (mode) => localStorage.setItem("townreporter.desk.mode", mode),
        shape.dark ? "dark" : "light",
      );
      const resp = await page.goto(`${base}${screen.path}`, { waitUntil: "domcontentloaded" });
      if (resp && !resp.ok()) throw new Error(`${screen.path} answered ${resp.status()}`);
      await page.waitForTimeout(900);
      if (screen.openReporting) {
        const tab = page.getByRole("tab", { name: "Reporting" });
        if (await tab.count()) {
          await tab.click();
          await page.waitForTimeout(400);
        }
      }
      await shot(screen, shape);
      const body = await page.locator("body").innerText();
      if (body.trim().length < 40) {
        throw new Error(
          `${screen.path} rendered almost nothing: ${JSON.stringify(body.slice(0, 200))}`,
        );
      }
    }
  }
} catch (err) {
  const text = await page.locator("body").innerText().catch(() => "");
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        text: text.slice(0, 1500),
      },
      null,
      2,
    ),
  );
  await browser.close();
  process.exit(1);
}

await browser.close();
writeFileSync(resolve(outDir, `${prefix}-text.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: true, outDir, prefix, shots: report.shots.length }, null, 2));
