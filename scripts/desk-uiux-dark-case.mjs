/** The rebuilt Dark Desk's settled states, before the walk indexes controls. */
export async function prepareDarkDeskCapture(page) {
  await page.waitForFunction(
    () => {
      const empty = document.querySelector(".astra-empty");
      const question = document.querySelector(".astra-question");
      return Boolean(
        (empty?.checkVisibility() && document.querySelector(".astra-piles")?.hidden) ||
        (question?.checkVisibility() &&
          document.querySelector('[aria-label="File decisions"]')?.checkVisibility()),
      );
    },
    undefined,
    { timeout: 20_000 },
  );

  const settings = page.getByRole("button", { name: "Settings", exact: true });
  const panel = page.locator("#dark-settings");
  if ((await settings.getAttribute("aria-expanded")) !== "false" || (await panel.isVisible())) {
    throw new Error("Dark Desk Settings must start collapsed");
  }
  await settings.click();
  try {
    await panel.getByRole("heading", { name: "How hard to dig", exact: true }).waitFor();
    await panel.getByRole("heading", { name: "Watched pages", exact: true }).waitFor();
    // Read names and geometry without pressing any model or network action.
    const controls = panel.locator('button,select,input:not([type="hidden"]),a[href]');
    for (const control of await controls.all()) {
      if (!(await control.isVisible())) continue;
      await control.scrollIntoViewIfNeeded();
      const snapshot = await control.ariaSnapshot();
      if (!/\b(button|combobox|textbox|link) "[^"\n]+"/.test(snapshot)) {
        throw new Error("Dark Desk Settings has an unnamed control: " + snapshot);
      }
    }
    const overflow = await page.evaluate(
      () => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
    );
    if (overflow > 1) throw new Error("Dark Desk Settings overflows by " + overflow + "px");
  } finally {
    await panel.getByRole("button", { name: "Close", exact: true }).click();
  }
  await panel.waitFor({ state: "hidden" });

  const empty = page.getByRole("heading", { name: "No investigations yet", exact: true });
  if (await empty.isVisible()) return;
  await page.locator(".astra-question").waitFor();
  for (const name of ["Scope", "Depth", "Limit"]) {
    await page
      .locator(".astra-bound-k")
      .filter({ hasText: new RegExp("^" + name + "$") })
      .waitFor();
  }
  for (const name of ["Activity", "Case file"]) {
    await page
      .locator(".astra-pair .astra-label")
      .filter({ hasText: new RegExp("^" + name + "$") })
      .waitFor();
  }
  const decisions = page.getByLabel("File decisions", { exact: true });
  for (const name of [
    "Start an AI follow-up",
    "Keep investigating",
    "Wait and watch",
    "Send to the queue",
    "Close: no finding",
  ]) {
    await decisions.getByRole("button", { name, exact: true }).waitFor();
  }
  const groups = await page
    .locator(".astra-pile:visible .astra-pile-h > span:first-child")
    .allTextContents();
  const expected = ["Open files", "Signals to review", "Waiting on an AI follow-up", "Set aside"];
  if (
    !groups.length ||
    groups.some(
      (name, index) =>
        !expected.includes(name.trim()) ||
        (index > 0 && expected.indexOf(name.trim()) <= expected.indexOf(groups[index - 1].trim())),
    )
  ) {
    throw new Error("Dark Desk rail groups do not follow the spec: " + groups.join(", "));
  }
}
