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
  await page.goto(`${base}/desk/setup`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Paper name").fill(name);
  await page.getByLabel("City", { exact: true }).fill(city);
  await page.getByLabel("State", { exact: true }).fill(state);
  await page.getByRole("button", { name: "Save and open the desk" }).click();
  // Wait for the redirect to actually land: the nav's Queue link is visible
  // on the setup page too, so waiting on it alone let the next click race
  // the redirect and get swallowed.
  await page.waitForURL(/\/desk$/, { timeout: 45_000 });
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
}
