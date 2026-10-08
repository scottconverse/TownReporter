// guards: the Dark Desk walk could ship with controls or rail groups the editor cannot find
import assert from "node:assert/strict";
import { test } from "node:test";
import { auditDarkDeskHtml, waitForDarkDeskAudit } from "./desk-uiux-dark-case.mjs";

const settings = `<button aria-expanded="false">Settings</button>
<section id="dark-settings" hidden><h2>Dark Desk settings</h2><h3>How hard to dig</h3><h3>Watched pages</h3><button>Close</button></section>`;
const names = [
  "Start an AI follow-up",
  "Keep investigating",
  "Wait and watch",
  "Send to the queue",
  "Close: no finding",
];
const groups = ["Open files", "Signals to review", "Waiting on an AI follow-up", "Set aside"];

function fileFixture(railGroups = groups, decisions = names) {
  return settings +
    `<div class="astra-piles">${railGroups.map((name) => `<div class="astra-pile"><div class="astra-pile-h"><span>${name}</span><span>1</span></div></div>`).join("")}</div>
      <h2 class="astra-question">A synthetic investigation</h2>
      <div>${["Scope", "Depth", "Limit"].map((name) => `<p class="astra-bound-k">${name}</p>`).join("")}</div>
      <div class="astra-pair">${["Activity", "Case file"].map((name) => `<p class="astra-label">${name}</p>`).join("")}</div>
      <div aria-label="File decisions">${decisions.map((name) => `<button>${name}</button>`).join("")}</div>`;
}

const emptyFixture = settings +
  '<div class="astra-piles" hidden><button id="rail-check">Check for signals</button></div><section class="astra-empty"><h2>No investigations yet</h2></section>';

test("loading rail reproduces the old scroll timeout; settled empty state passes", () => {
  const loading = settings +
    '<div class="astra-piles"><button id="rail-check">Check for signals</button></div><section class="astra-empty" hidden><h2>No investigations yet</h2></section>';
  assert.throws(() => auditDarkDeskHtml(loading), /still loading/);
  assert.match(loading, /id="rail-check"/);
  assert.equal(auditDarkDeskHtml(emptyFixture).state, "empty");
});

test("open file, current Decide labels and all four rail groups pass", () => {
  assert.deepEqual(auditDarkDeskHtml(fileFixture()).groups, groups);
});

test("empty rail groups may be omitted in spec order", () => {
  assert.deepEqual(auditDarkDeskHtml(fileFixture(["Open files", "Set aside"])).groups, ["Open files", "Set aside"]);
});

test("old Decide labels are rejected", () => {
  const old = names.map((name) => name === "Keep investigating" ? "Keep digging" : name);
  assert.throws(() => auditDarkDeskHtml(fileFixture(groups, old)), /missing Decide control: Keep investigating/);
});

test("old rail labels and reordered groups are rejected", () => {
  for (const rail of [["Worth a look"], ["Set aside", "Open files"]]) {
    assert.throws(() => auditDarkDeskHtml(fileFixture(rail)), /rail groups do not follow the spec/);
  }
});

test("loading state is awaited before auditing controls", async () => {
  let html = settings + '<div class="astra-piles">Loading</div><section class="astra-empty" hidden><h2>No investigations yet</h2></section>';
  const audit = waitForDarkDeskAudit(() => html, { timeout: 500, interval: 1 });
  setTimeout(() => { html = emptyFixture; }, 20);
  assert.equal((await audit).state, "empty");
});
