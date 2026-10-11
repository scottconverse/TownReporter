import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { completeFirstRunSetup, fillPendingSetupCodeIfPresent } from "./first-run-setup-step.mjs";
import { checkedUrl, checkedOutputPath } from "./browser-guard.mjs";
import { startLocalModelsFixtureServer } from "./local-models-page.harness.mjs";
const fixture = process.argv.includes("--fixture");
const base = checkedUrl(process.env.LOCAL_MODELS_BASE_URL || (fixture ? "http://127.0.0.1:3488" : "http://127.0.0.1:8099")).replace(
  /\/$/,
  "",
);
const out = checkedOutputPath(
  resolve(process.env.LOCAL_MODELS_OUT_DIR || "artifacts/release-h-local"),
  [process.cwd()],
  "screenshots",
);
mkdirSync(out, { recursive: true });
const stop = fixture ? await startLocalModelsFixtureServer(base, out) : null;
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(45000);
  await page.goto(base + "/login");
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  const fresh = await page.getByLabel("Name", { exact: true }).count();
  await page.getByLabel("Email").fill("release-h-models@townreporter.test");
  await page.getByLabel("Password", { exact: true }).fill("release-h-models-pass");
  if (fresh) {
    await page.getByLabel("Name", { exact: true }).fill("Models Owner");
    await page.getByLabel("Confirm password").fill("release-h-models-pass");
    await fillPendingSetupCodeIfPresent(page);
    await page.getByRole("button", { name: "Create editor account" }).click();
  } else await page.getByRole("button", { name: "Sign in with email" }).click();
  await page.getByRole("link", { name: /^Queue\b/ }).waitFor();
  await page.goto(base + "/desk/setup");
  if (await page.getByLabel("Paper name", { exact: true }).count())
    await completeFirstRunSetup(page, base);
  await page.goto(base + "/desk/models?tab=conn");
  const box = page.getByRole("region", { name: "The desk's local model", exact: true });
  await box.waitFor({ timeout: 15000 });
  await box.getByText(/The desk uses|No model is loaded/).waitFor();
  const group = page.getByRole("group", { name: "Local & self-hosted", exact: true });
  // Choose a specific model through the page, then replace it with the sentinel.
  // This walk needs a loaded local chat model, discovered read-only; it never loads one.
  const row = group
    .getByRole("group")
    .filter({ has: page.getByText(/^in memory/) })
    .filter({
      hasNot: page.getByText("cloud — spends credits, not this computer", { exact: true }),
    })
    .first();
  await row.waitFor();
  const pair = await row.getAttribute("aria-label");
  const modelId = pair.slice(0, pair.lastIndexOf(" on "));
  await row.getByRole("button", { name: "Use this one", exact: true }).click();
  await box.getByText(`The desk uses ${modelId} on`, { exact: false }).waitFor();
  await row.getByText("The desk uses this", { exact: true }).waitFor();
  await box
    .getByRole("radio", { name: "Use whatever model is loaded (recommended)", exact: true })
    .check();
  await page.getByText("The desk's local model was saved.", { exact: true }).waitFor();
  await page.reload();
  await box
    .getByRole("radio", { name: "Use whatever model is loaded (recommended)", exact: true })
    .waitFor();
  assert.equal(
    await box
      .getByRole("radio", { name: "Use whatever model is loaded (recommended)", exact: true })
      .isChecked(),
    true,
  );
  await box.getByText(`The desk uses ${modelId} on`, { exact: false }).waitFor();
  assert.match(await box.innerText(), /this computer/);
  for (const appearance of ["light", "dark"]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const toggle = page.getByRole("button", { name: `Switch to ${appearance} appearance` });
    if (await toggle.count()) await toggle.click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await box.scrollIntoViewIfNeeded();
      const metrics = await box.evaluate((el) => {
        const nodes = [...el.querySelectorAll("*")].filter(
          (n) => n.textContent.trim() && n.getBoundingClientRect().width,
        );
        return {
          minFont: Math.min(...nodes.map((n) => parseFloat(getComputedStyle(n).fontSize))),
          width: el.getBoundingClientRect().width,
          scroll: el.scrollWidth,
          client: el.clientWidth,
          fg: getComputedStyle(el).color,
          bg: (() => {
            let n = el;
            while (n) {
              const c = getComputedStyle(n).backgroundColor;
              if (c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
              n = n.parentElement;
            }
            return "rgb(255, 255, 255)";
          })(),
        };
      });
      assert.ok(metrics.minFont >= 16, JSON.stringify(metrics));
      assert.ok(metrics.scroll <= metrics.client + 1, JSON.stringify(metrics));
      // AA normal-text contrast, using the rendered foreground and effective background.
      const luminance = (color) => {
        const rgb = color
          .match(/\d+/g)
          .slice(0, 3)
          .map(Number)
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const l1 = luminance(metrics.fg),
        l2 = luminance(metrics.bg);
      const contrast = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      assert.ok(contrast >= 4.5, `contrast ${contrast}`);
      await page.screenshot({ path: resolve(out, `local-model-${width}-${appearance}.png`) });
      console.log({ viewport: width, appearance, ...metrics });
    }
  }
  console.log(
    "PASS: Models page named choice, badge, sentinel save, reload and loaded model; four screenshots.",
  );
} finally {
  await browser?.close();
  await stop?.();
}
