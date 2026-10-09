// guards: Today and the sidebar could show conflicting progress and Stop controls for the same file
import assert from "node:assert/strict";
import { test } from "node:test";
import { installDom } from "./dom-harness.mjs";
import { moduleUrl, transpileToUrl } from "./dom-harness.mjs";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
installDom();
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { JobCard } = await import("./job-card-render.harness.mjs");
const { jobProgressView } = await import(await moduleUrl("src/lib/news/job-progress.ts", {
  ...Object.fromEntries(["./follow-ups.ts", "./follow-up-agents.ts", "./automatic-failover.ts", "./ai.ts", "./draft-reconcile.server.ts", "./model-request-commit.server.ts"].map((name) => [name, transpileToUrl('throw new Error("No worker in this card flow");', "stub.js")])),
  "@tanstack/react-start": transpileToUrl('export const createServerFn = () => ({ middleware() { return this; }, validator() { return this; }, handler(fn) { return fn; } });', "stub.js"),
  "../db.ts": transpileToUrl('export const getSql = () => { throw new Error("No database in this card flow"); };', "stub.js"),
  "./desk-auth.ts": transpileToUrl('export const deskMiddleware = {};', "stub.js"),
  "./model-choice.ts": transpileToUrl('export const effectiveStoryModelChoice = x => x; export const storyModelChoice = x => x; export const modelChoiceLabel = () => "Codex Sol 6.1";', "stub.js"),
  "./jobs.ts": transpileToUrl('export const jobStages = () => []; export const requestJobCancel = () => {};', "stub.js"),
}));
test("a running investigation shows its case stages and can be stopped in either card", async () => {
  const node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  let stops = 0;
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage();
  await page.route("**/*", (route) => route.abort());
  const css = await readFile("src/desk-astra.css", "utf8");
  await page.exposeFunction("stopJob", () => React.act(async () => [...node.querySelectorAll("button")].find((n) => n.textContent === "Stop").click()));
  try {
    for (const [kind, compact] of [["dark", false], ["dark", true], ["challenge", false]]) {
      const now = Date.now();
      const job = jobProgressView({ kind, status: "running", result_json: '{"modelEffort":"medium"}', started_at: new Date(now).toISOString(), beat_at: new Date(now).toISOString() }, 0, null);
      await React.act(async () => root.render(React.createElement(JobCard, { compact, now, onCancel: () => stops++, job })));
      assert.deepEqual([...node.querySelectorAll(".job-card-chip")].map((n) => n.textContent.replace("✓", "").trim()), ["Question", "Gather", "Case file", "Challenge"]);
      assert.match(node.querySelector(".job-card-model").textContent, /Codex Sol 6.1 · medium/);
      const stop = [...node.querySelectorAll("button")].find((n) => n.textContent === "Stop");
      assert.ok(stop);
      await page.setContent(`<style>${css}</style><div class="desk-ltr astra" style="width:190px">${node.innerHTML}</div>`);
      if (compact) assert.ok(await page.locator(".job-card-model").evaluate((n) => n.scrollWidth <= n.clientWidth), "the sidebar must show both model and effort");
      await page.evaluate(() => document.querySelector("button").onclick = () => window.stopJob());
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await page.waitForTimeout(10);
      assert.ok(!/Synthesizing signals/.test(node.textContent));
    }
    assert.equal(stops, 3);
  } finally { await browser.close(); await React.act(async () => root.unmount()); node.remove(); }
});
