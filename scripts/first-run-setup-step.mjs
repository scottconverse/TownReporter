/*
  The setup step every browser walk performs after creating the owner.

  First-run changed: since CITY-SETUP, a claimed desk publishes nothing to
  the public site until the owner completes /desk/setup, so a walk that
  signs up and immediately publishes reads an empty public page.

  Written defensively, from two CI failures. These are controlled React
  inputs: a fill that lands before hydration writes the DOM value, then
  hydration resets it to empty state -- and a read-back immediately after
  the fill passes anyway, because the wipe comes later. So a fill only
  counts when its value SURVIVES a pause, and the save is retried once,
  because a submit clicked before hydration is a click into dead HTML.
*/
export async function completeFirstRunSetup(page, base, opts = {}) {
  // An obviously-fake town, so "Longmont" in a test artifact always means a
  // real leak and never this fixture -- an audit lost time on exactly that.
  const fields = [
    ["Paper name", opts.name ?? "Testerville Ledger"],
    ["City", opts.city ?? "Testerville"],
    ["State", opts.state ?? "Wyoming"],
  ];
  // Vite dev mode never goes network-idle under HMR churn, so wait only for
  // the DOM and then for the element that actually proves the page is live.
  await page.goto(`${base}/desk/setup`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Paper name", { exact: true }).waitFor({ timeout: 45_000 });

  for (let round = 0; round < 12; round++) {
    for (const [label, value] of fields) {
      await page.getByLabel(label, { exact: true }).fill(value);
    }
    await page.waitForTimeout(500);
    let survived = true;
    for (const [label, value] of fields) {
      if ((await page.getByLabel(label, { exact: true }).inputValue()) !== value) survived = false;
    }
    if (survived) break;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "Save and open the desk" }).click();
    try {
      await page.waitForURL((u) => !u.pathname.endsWith("/desk/setup"), { timeout: 20_000 });
      break;
    } catch {
      // A click into pre-hydration HTML does nothing; go around once more.
    }
  }
  // Wait for the post-setup UI to actually be there, then assert on the URL
  // -- a waitForURL alone can pass on a race where the path changes but the
  // page hasn't rendered yet, and gives no clue what page we're really on if
  // it fails.
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 60_000 });
  const finalUrl = new URL(page.url());
  if (finalUrl.pathname !== "/desk") {
    const heading = await page
      .locator("h1, h2")
      .first()
      .innerText()
      .catch(() => "(no heading found)");
    throw new Error(
      `Expected to land on /desk after setup, but url is "${finalUrl.href}" (path "${finalUrl.pathname}"); visible heading: "${heading}"`
    );
  }
}
