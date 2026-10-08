import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { prepareDarkDeskCapture } from "./desk-uiux-dark-case.mjs";

let browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
});

const settings = `<button aria-expanded="false" onclick="document.querySelector('#dark-settings').hidden=false;this.setAttribute('aria-expanded','true')">Settings</button>
<section id="dark-settings" hidden><h2>Dark Desk settings</h2><h3>How hard to dig</h3><h3>Watched pages</h3>
<button onclick="this.parentElement.hidden=true;document.querySelector('button').setAttribute('aria-expanded','false')">Close</button></section>`;
const names = [
  "Start an AI follow-up",
  "Keep investigating",
  "Wait and watch",
  "Send to the queue",
  "Close: no finding",
];
const groups = ["Open files", "Signals to review", "Waiting on an AI follow-up", "Set aside"];
function fileFixture(railGroups = groups, decisions = names) {
  return (
    settings +
    `<div class="astra-piles">${railGroups.map((name) => `<div class="astra-pile"><div class="astra-pile-h"><span>${name}</span><span>1</span></div></div>`).join("")}</div>
  <h2 class="astra-question">A synthetic investigation</h2>
  <div>${["Scope", "Depth", "Limit"].map((name) => `<p class="astra-bound-k">${name}</p>`).join("")}</div>
  <div class="astra-pair">${["Activity", "Case file"].map((name) => `<p class="astra-label">${name}</p>`).join("")}</div>
  <div aria-label="File decisions">${decisions.map((name) => `<button>${name}</button>`).join("")}</div>`
  );
}
async function withPage(html, run) {
  const page = await browser.newPage();
  page.setDefaultTimeout(1000);
  await page.route("**/*", (route) => route.abort());
  try {
    await page.setContent(html);
    await run(page);
  } finally {
    await page.close();
  }
}

test("loading rail reproduces the old scroll timeout; settled empty state passes", async () => {
  await withPage(
    settings +
      '<div class="astra-piles"><button id="rail-check">Check for signals</button></div><section class="astra-empty" hidden><h2>No investigations yet</h2></section>',
    async (page) => {
      // The old audit snapshots a visible loading-state rail control, then the
      // real empty-state render hides it before scrollIntoViewIfNeeded runs.
      const control = page.locator("#rail-check");
      assert.equal(await control.isVisible(), true);
      await page.evaluate(() => {
        document.querySelector(".astra-piles").hidden = true;
        document.querySelector(".astra-empty").hidden = false;
      });
      await assert.rejects(
        control.scrollIntoViewIfNeeded({ timeout: 300 }),
        /element is not visible/,
      );
      await prepareDarkDeskCapture(page);
      assert.equal(await page.locator("#dark-settings").isVisible(), false);
      assert.equal(await control.isVisible(), false);
    },
  );
});

test("open file, current Decide labels and all four rail groups pass", async () => {
  await withPage(fileFixture(), prepareDarkDeskCapture);
});

test("empty rail groups may be omitted in spec order", async () => {
  await withPage(fileFixture(["Open files", "Set aside"]), prepareDarkDeskCapture);
});

test("old Decide labels are rejected", async () => {
  await withPage(
    fileFixture(
      groups,
      names.map((name) => (name === "Keep investigating" ? "Keep digging" : name)),
    ),
    async (page) => {
      await assert.rejects(prepareDarkDeskCapture(page), /Timeout/);
    },
  );
});

test("old rail labels and reordered groups are rejected", async () => {
  for (const rail of [["Worth a look"], ["Set aside", "Open files"]]) {
    await withPage(fileFixture(rail), async (page) => {
      await assert.rejects(prepareDarkDeskCapture(page), /rail groups do not follow the spec/);
    });
  }
});

test("loading state is awaited before auditing controls", async () => {
  await withPage(
    settings +
      '<div class="astra-piles">Loading</div><section class="astra-empty" hidden><h2>No investigations yet</h2></section>',
    async (page) => {
      await page.evaluate(() =>
        setTimeout(() => {
          document.querySelector(".astra-piles").hidden = true;
          document.querySelector(".astra-empty").hidden = false;
        }, 100),
      );
      await prepareDarkDeskCapture(page);
      assert.equal(
        await page.getByRole("heading", { name: "No investigations yet" }).isVisible(),
        true,
      );
    },
  );
});
