// guards: Today and the sidebar could show conflicting progress and Stop controls for the same file
import assert from "node:assert/strict";
import { test } from "node:test";
import { installDom } from "./dom-harness.mjs";
installDom();
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { JobCard } = await import("./job-card-render.harness.mjs");
test("a running investigation shows its case stages and can be stopped in either card", async () => {
  const node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  let stops = 0;
  try {
    for (const compact of [false, true]) {
      const now = Date.now();
      await React.act(async () => root.render(React.createElement(JobCard, { compact, now, onCancel: () => stops++, job: { kind: "dark", status: "running", title: "Digging the file", model: "Codex", startedAt: now, beatAt: now, stages: ["Researching the file", "Synthesizing signals", "Testing explanations", "Writing editor brief"], stageIndex: 1, step: "Synthesizing signals" } })));
      if (!compact) assert.deepEqual([...node.querySelectorAll(".job-card-chip")].map((n) => n.textContent.replace("✓", "").trim()), ["Question", "Gather", "Case file", "Challenge"]);
      const stop = [...node.querySelectorAll("button")].find((n) => n.textContent === "Stop");
      assert.ok(stop); await React.act(async () => stop.click());
      assert.ok(!/Synthesizing signals/.test(node.textContent));
    }
    assert.equal(stops, 2);
  } finally { await React.act(async () => root.unmount()); node.remove(); }
});
