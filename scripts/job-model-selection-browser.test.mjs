import assert from "node:assert/strict";
import { test } from "node:test";
import { jobModelBrowser } from "./job-model-selection-browser.harness.mjs";

async function saveAndReadDoors(t, baselineRef) {
  const fixture = await jobModelBrowser({ baselineRef });
  t.after(() => fixture.close());
  const { page, errors } = fixture;
  await page
    .getByLabel("First choice for Story drafting", { exact: true })
    .waitFor({ timeout: 5000 })
    .catch(async () =>
      assert.fail(JSON.stringify({ errors, body: await page.locator("body").innerText() })),
    );
  await page
    .getByLabel("First choice for Story drafting", { exact: true })
    .selectOption("deepseek-flash");
  await page.getByRole("button", { name: "Save assignments", exact: true }).click();
  await page.waitForFunction(() => window.assignmentWrites.length === 1);
  assert.equal(
    await page.evaluate(
      () =>
        window.assignmentRows.find((row) => row.jobKey === "story-draft" && row.rank === 0)
          ?.providerId,
    ),
    "deepseek-flash",
    "the real Models form saved the Story assignment through its mutation",
  );
  await page.evaluate(() => window.mountDoor("story"));
  await page
    .getByRole("button", { name: /Model & research/ })
    .waitFor({ timeout: 5000 })
    .catch(async () =>
      assert.fail(JSON.stringify({ errors, body: await page.locator("body").innerText() })),
    );
  await page.getByRole("button", { name: /Model & research/ }).click();
  const storyPicker = page
    .locator("#story-model-research")
    .getByLabel("Writing model", { exact: true });
  await storyPicker
    .waitFor({ timeout: 5000 })
    .catch(async () =>
      assert.fail(JSON.stringify({ errors, body: await page.locator("body").innerText() })),
    );
  // Wait for the independent assignment read, then let its production effects settle.
  await page.waitForFunction(() => window.assignmentReads >= 2);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const story = await storyPicker.inputValue();
  await page.evaluate(() => window.mountDoor("today"));
  await page
    .getByRole("button", { name: /\+ New story/ })
    .waitFor({ timeout: 5000 })
    .catch(async () =>
      assert.fail(JSON.stringify({ errors, body: await page.locator("body").innerText() })),
    );
  await page.getByRole("button", { name: /\+ New story/ }).click();
  const todayPicker = page.getByRole("dialog").getByLabel("Model", { exact: true });
  await todayPicker
    .waitFor({ timeout: 5000 })
    .catch(async () =>
      assert.fail(JSON.stringify({ errors, body: await page.locator("body").innerText() })),
    );
  await page.waitForFunction(() => window.assignmentReads >= 3);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const today = await todayPicker.inputValue();
  assert.deepEqual(errors, [], "isolated production routes rendered without browser errors");
  return { story, today };
}
function assertSavedStoryAssignment(doors) {
  assert.deepEqual(doors, { story: "deepseek-flash", today: "deepseek-flash" });
}

test("real Models save flows into the real Story and Today New story pickers", async (t) => {
  assertSavedStoryAssignment(await saveAndReadDoors(t, process.env.FM1_UI_BASELINE_REF));
});
