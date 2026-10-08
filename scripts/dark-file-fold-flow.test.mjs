// guards: long evidence could push Decide below the editor's first view
import assert from "node:assert/strict";
import { test } from "node:test";
import { React, createRoot, h, detail, Route } from "./dark-file-model-flow.harness.mjs";

test("the open file keeps recent activity and long case entries compact", async () => {
  const longFinding = "The public record states that the agreement was amended after the hearing. ".repeat(5).trim();
  detail.claims = [{ kind: "FINDING", capture_event_id: 9, body: longFinding, confidence: 0.9 }];
  detail.sourceCaptures = [{ id: 9, title: "Agreement", url: "https://longmontcolorado.gov/records/agreement" }];
  detail.searches = [];
  globalThis.__darkFlow.fixtures["investigation-activity"] = Array.from({ length: 10 }, (_, i) => ({
    id: `activity-${i}`, occurredAt: `2026-10-08T12:${String(i).padStart(2, "0")}:00Z`, tone: "plain", text: `Activity ${i}`,
  }));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(h(Route.component)));
  try {
    const activity = container.querySelector("#investigation-workspace .astra-pair > div:first-child");
    assert.equal(activity.querySelectorAll(":scope > .astra-log").length, 5);
    assert.ok([...activity.querySelectorAll("summary")].some((summary) => summary.textContent === "Show earlier"));
    const finding = [...container.querySelectorAll(".of-block")].find((block) => block.querySelector(".side-label")?.textContent === "Findings");
    assert.ok(finding?.querySelector("details > summary")?.textContent === "More");
    assert.ok(finding.querySelector("details")?.textContent.includes(longFinding));
    assert.equal(finding.querySelector(".side-item")?.textContent.includes(longFinding), false);
  } finally { await React.act(async () => root.unmount()); container.remove(); }
});
