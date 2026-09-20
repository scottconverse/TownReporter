/*
  N-3 proof: render the Captured meetings surface with REAL + seeded data and
  dump its rendered text (DOM text is the evidence, not a screenshot).
    N3_BASE_URL=http://127.0.0.1:3500 node scripts/meeting-activity-e2e.mjs
*/
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const base = (process.env.N3_BASE_URL || "http://127.0.0.1:3500").replace(/\/$/, "");
const stamp = Date.now();
const email = `n3-${stamp}@townreporter.test`;
const password = "n3-e2e-pass-12345";

const out = { steps: [], problems: [] };
const step = (s) => { out.steps.push(s); console.log("STEP " + s); };
const fail = (s) => { out.problems.push(s); console.log("PROBLEM " + s); };

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", (e) => fail("pageerror: " + e.message));

try {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Name").fill("N3 Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45000 });
  step("owner created");

  await page.goto(`${base}/desk/scan`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Captured meetings" }).waitFor({ timeout: 30000 });
  step("Captured meetings section renders");

  const section = page.locator("section", { has: page.getByRole("heading", { name: "Captured meetings" }) });
  const text = await section.innerText();
  out.renderedText = text;
  writeFileSync("work/n3-rendered.txt", text, "utf8");

  // Assertions on rendered content
  const checks = [
    ["real title", /City Council Regular Session 07\/28\/2026/],
    ["artifact hash", /ea50d376bd50a95a0dd06416c83d96c858d766e068519882cfc9bf2c7d1e241b/],
    ["alignment", /Alignment:\s*aligned/i],
    ["chunk", /item 9:.*CONSENT AGENDA.*74:36/i],
    ["vote", /tally 6-1/i],
    ["vote mover", /Matthew Popkin/],
    ["named failure", /storage root is not configured/i],
    ["provisional label", /Provisional .* may still change/i],
  ];
  for (const [name, re] of checks) {
    if (re.test(text)) step("rendered: " + name);
    else fail("missing from rendered surface: " + name);
  }
} catch (e) {
  fail("driver error: " + (e instanceof Error ? e.message : String(e)));
} finally {
  await browser.close();
}

console.log("RESULT " + JSON.stringify({ steps: out.steps, problems: out.problems }, null, 2));
if (out.problems.length) process.exitCode = 1;
