#!/usr/bin/env node
/** Browser regression for the Story workspace's model and research controls. */
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

const base = checkedUrl(process.env.STORY_CONTROLS_BASE_URL || "http://127.0.0.1:3491")
  .replace(/\/$/, "");
const stamp = Date.now();
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(45_000);
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Name").fill("Story Controls Editor");
  await page.getByLabel("Email").fill(`story-controls-${stamp}@townreporter.test`);
  await page.getByLabel("Password", { exact: true }).fill("story-controls-e2e-pass");
  await page.getByLabel("Confirm password").fill("story-controls-e2e-pass");
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor();
  await completeFirstRunSetup(page, base);

  await page.goto(`${base}/desk/queue`, { waitUntil: "networkidle" });
  await page.getByText("File a lead yourself").click();
  await page.getByLabel("Headline").fill(`Story model controls ${stamp}`);
  await page.getByLabel("Why now").fill("Browser regression fixture for Story settings.");
  await page.getByRole("button", { name: "File lead" }).click();
  await page.getByLabel("Body").waitFor();
  await page.getByLabel("Pulled notes").fill(
    "TEST SOURCE MATERIAL: On September 15, 2026, the fictional Testerville City Council voted 5-0 to authorize a $42,000 roof repair at the town library. The public works director, Morgan Ellis, said work would begin October 1 and take about three weeks. The authorization covers replacement of storm-damaged shingles and repair of two roof drains. This paragraph is a browser-test fixture supplied by the editor; do not add facts beyond it.",
  );

  const toolbarControl = page.getByRole("button", { name: /Model & research · Automatic/ });
  await toolbarControl.waitFor();

  // Reproduce the owner's screenshot: the Reporting rail retains a deep
  // internal scroll position while the page toolbar remains visible.
  await page.getByRole("tab", { name: "Reporting" }).click();
  const railScroll = await page.locator("#story-inspector").evaluate((rail) => {
    const spacer = document.createElement("div");
    spacer.dataset.storyControlsTestSpacer = "true";
    spacer.style.height = "1800px";
    rail.querySelector("#inspector-reporting")?.append(spacer);
    rail.scrollTop = rail.scrollHeight;
    return rail.scrollTop;
  });
  if (railScroll <= 0) throw new Error("could not reproduce a deeply scrolled Reporting rail");

  await toolbarControl.click();
  const panel = page.locator("#story-model-research");
  await panel.waitFor({ state: "visible" });
  const picker = panel.getByLabel("Writing model");
  await picker.waitFor({ state: "visible" });
  if (!(await picker.evaluate((element) => element === document.activeElement))) {
    throw new Error("opening Model & research did not focus its picker");
  }

  await picker.selectOption("codex-frontier");
  await page.getByRole("button", { name: /Model & research · Codex Sol/ }).waitFor();
  await panel.getByRole("button", { name: "Close" }).click();
  await panel.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: /Model & research · Codex Sol/ }).click();
  if ((await panel.getByLabel("Writing model").inputValue()) !== "codex-frontier") {
    throw new Error("the selected model was lost when the settings panel reopened");
  }

  // This is a real model run against the local OpenAI-compatible endpoint,
  // not a mocked mutation or a DOM-only assertion. It proves that the same
  // visible controls choose the provider used by Draft with AI.
  await panel.getByLabel("Writing model").selectOption("local-model");
  await panel.getByLabel("Drafting scope").selectOption("supplied");
  await panel.getByRole("button", { name: "Close" }).click();
  page.setDefaultTimeout(12 * 60_000);
  await page.getByRole("button", { name: "Draft with AI", exact: true }).click();
  let draftedBody = "";
  for (let elapsed = 0; elapsed < 12 * 60_000; elapsed += 2_000) {
    await page.waitForTimeout(2_000);
    draftedBody = await page.getByLabel("Body").inputValue();
    if (draftedBody.trim().length >= 200) break;
    const failure = await page.locator('[role="alert"]:visible').allInnerTexts();
    if (failure.some((text) => /No model job was started|did not finish|failed/i.test(text))) {
      throw new Error(`real local-model draft failed: ${failure.join(" | ")}`);
    }
  }
  if (draftedBody.trim().length < 200) {
    throw new Error(`real local-model draft was unexpectedly short (${draftedBody.length} characters)`);
  }
  if (browserErrors.length) throw new Error(`browser errors: ${browserErrors.join(" | ")}`);

  console.log("story model controls: browser interaction passed");
  console.log("  ok    deeply scrolled Reporting rail reproduced");
  console.log("  ok    toolbar opened visible model and research controls");
  console.log("  ok    model picker received focus and changed the toolbar label");
  console.log("  ok    selected model remained set after close and reopen");
  console.log(`  ok    local model completed a real ${draftedBody.length}-character story`);
} finally {
  await browser.close();
}
