/**
 * Put screenshot journeys in the requested desk appearance through the real
 * footer control, then wait until the document confirms the painted state.
 * Fresh desks now default dark, while several journeys deliberately capture
 * light first; pinning that baseline keeps their screenshot labels truthful.
 */
export async function chooseDeskAppearance(page, appearance) {
  if (appearance !== "light" && appearance !== "dark") {
    throw new TypeError(`Unknown desk appearance: ${appearance}`);
  }

  const expected = appearance === "dark" ? "desk-dark" : "light";
  const current = await page.locator("html").getAttribute("data-appearance");
  if (current !== expected) {
    const buttonName =
      appearance === "dark" ? "Switch to dark appearance" : "Switch to light appearance";
    const button = page.getByRole("button", { name: buttonName, exact: true });
    await button.waitFor({ state: "visible", timeout: 15_000 });
    await button.click();
  }

  await page.waitForFunction(
    (target) => document.documentElement.getAttribute("data-appearance") === target,
    expected,
    { timeout: 15_000 },
  );
}
