// guards: rail rows must stay findable, single-action, and ordered with no false waiting group
import assert from "node:assert/strict";
import { test } from "node:test";
import { React, createRoot, h, window, file, Route } from "./dark-file-model-flow.harness.mjs";

function fileDetail(row) {
  return {
    investigation: { ...row, ordinary_explanation: "", scope_json: '{"scope":"city"}', budget: 5, hops: 0, last_model_choice: "codex-sol", pause_reason: null },
    artifacts: [], claims: [], hypotheses: [], searches: [], frontier: [], deadEnds: [], anomalies: [], entities: [], signals: [], sourceCaptures: [], investigationFollowUps: [], captureCounts: { captures: 0, readable: 0, unreadable: 0 },
  };
}

function groups(container) {
  return [...container.querySelectorAll(".astra-pile")].filter((group) => !group.hidden);
}

function groupNamed(container, name) {
  return groups(container).find((group) => group.querySelector(".astra-pile-h")?.textContent.includes(name));
}

test("rail groups show five rows and one action, and waiting stays after the first follow-up", async () => {
  const openRows = Array.from({ length: 6 }, (_, index) => ({
    ...file,
    id: index + 1,
    title: "Open file " + (index + 1),
    status: index === 0 ? "investigating" : "open",
    updated_at: "2026-10-08T0" + (index + 1) + ":00:00Z",
    records: 4,
    still_open: 2,
    has_ai_followup: false,
  }));
  const aside = { ...file, id: 10, title: "Set aside file", status: "closed", updated_at: "2026-10-08T12:00:00Z", has_ai_followup: false };
  const signals = Array.from({ length: 6 }, (_, index) => ({
    id: "signal:" + index,
    kind: index === 0 ? "reddit-tip" : "notice",
    title: "Signal " + (index + 1),
    happened: "A public record is worth checking.",
    why: "The record may have changed.",
    evidence: "https://example.test/records",
    source_url: "https://example.test/records",
    question: "What changed?",
    seed: "Check this public record.",
    priority: 1,
  }));
  const rows = [...openRows, aside];
  globalThis.__darkFlow.fixtures.investigations = rows;
  globalThis.__darkFlow.fixtures["worth-a-look"] = signals;
  globalThis.__darkFlow.fixtures.details = Object.fromEntries(rows.map((row) => [row.id, fileDetail(row)]));

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(h(Route.component)));
  try {
    assert.deepEqual(
      groups(container).map((group) => group.querySelector(".astra-pile-h")?.textContent.replace(/\s+/g, " ").trim().replace(/\d+$/, "").trim()),
      ["Open files", "Signals to review", "Set aside"],
    );
    const open = groupNamed(container, "Open files");
    const signal = groupNamed(container, "Signals to review");
    const asideGroup = groupNamed(container, "Set aside");
    assert.equal(open?.querySelectorAll(".astra-file-open").length, 5);
    assert.equal(open?.querySelectorAll(".astra-show-all")[0]?.textContent, "Show all 6");
    assert.equal(signal?.querySelectorAll(".astra-file-open").length, 5);
    assert.equal(signal?.querySelectorAll(".astra-show-all")[0]?.textContent, "Show all 6");
    assert.equal(open?.querySelector(".astra-file-open")?.parentElement?.querySelectorAll("button").length, 1);
    assert.equal(signal?.querySelector(".astra-signal-open")?.tagName, "BUTTON");
    assert.equal(open?.querySelector(".astra-file-m")?.textContent, "Reading · 4 of 6 records");
    assert.equal(signal?.querySelector(".astra-file-m")?.textContent, "1 post · unverified");
    const asideRow = asideGroup?.querySelector(".astra-set-aside-row");
    assert.ok(asideRow);
    assert.match(asideRow.textContent, /Set aside Sept\. 26/);
    assert.equal(asideRow.tagName, "BUTTON");
    await React.act(async () => open?.querySelector(".astra-show-all")?.dispatchEvent(new window.Event("click", { bubbles: true })));
    assert.equal(open?.querySelectorAll(".astra-file-open").length, 6);
    await React.act(async () => open?.querySelector(".astra-file-open")?.dispatchEvent(new window.Event("click", { bubbles: true })));
    assert.equal(container.querySelector("#investigation-workspace .astra-question")?.textContent, "Open file 1");
    assert.ok(container.querySelector(".astra-file-head .astra-more-file-actions"));
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }

  aside.has_ai_followup = true;
  globalThis.__darkFlow.fixtures.investigations = [aside];
  globalThis.__darkFlow.fixtures["worth-a-look"] = [];
  globalThis.__darkFlow.fixtures.details = { [aside.id]: fileDetail(aside) };
  const followUpContainer = document.createElement("div");
  document.body.append(followUpContainer);
  const followUpRoot = createRoot(followUpContainer);
  await React.act(async () => followUpRoot.render(h(Route.component)));
  try {
    const names = groups(followUpContainer).map((group) => group.querySelector(".astra-pile-h")?.textContent.replace(/\s+/g, " ").trim().replace(/\d+$/, "").trim());
    assert.deepEqual(names, ["Waiting on an AI follow-up", "Set aside"]);
    assert.equal(groupNamed(followUpContainer, "Waiting on an AI follow-up")?.querySelectorAll(".astra-file-open").length, 0);
  } finally {
    await React.act(async () => followUpRoot.unmount());
    followUpContainer.remove();
  }
});
