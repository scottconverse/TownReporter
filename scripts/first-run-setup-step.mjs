/*
  The setup step every browser walk performs after creating the owner.

  First-run changed: since CITY-SETUP, a claimed desk publishes nothing to
  the public site until the owner completes /desk/setup, so a walk that
  signs up and immediately publishes now reads an empty public page -- three
  CI walks went red exactly that way. This is the same form a real operator
  fills, driven the same way, and it lives in one file so the walks cannot
  drift apart on it.
*/
export async function completeFirstRunSetup(page, base, opts = {}) {
  const name = opts.name ?? "TownReporter";
  const city = opts.city ?? "Longmont";
  const state = opts.state ?? "Colorado";
  await page.goto(`${base}/desk/setup`, { waitUntil: "networkidle" });
  /*
    Filled AFTER hydration, and read back before submitting.

    These are controlled React inputs: a fill that lands before hydration
    writes the DOM value, hydration then resets it to empty state, and the
    save fails validation and stays on /desk/setup -- which is exactly how
    two CI walks died while a third passed on timing. Reading the value back
    and refilling makes the race lose instead of the walk.
  */
  for (const [label, value] of [
    ["Paper name", name],
    ["City", city],
    ["State", state],
  ]) {
    const field = page.getByLabel(label, { exact: true });
    for (let i = 0; i < 10; i++) {
      await field.fill(value);
      if ((await field.inputValue()) === value) break;
      await page.waitForTimeout(500);
    }
  }
  await page.getByRole("button", { name: "Save and open the desk" }).click();
  // Wait for the redirect to actually land: the nav's Queue link is visible
  // on the setup page too, so waiting on it alone let the next click race
  // the redirect and get swallowed.
  await page.waitForURL(/\/desk$/, { timeout: 45_000 });
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
}
