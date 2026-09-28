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
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Same path `setup-code.ts` writes to -- see `dataRoot()`/`setupCodeFilePath()`. */
export function pendingSetupCodePath() {
  const root = process.env.TOWNREPORTER_DATA_ROOT?.trim() || join(process.cwd(), ".townreporter-data");
  return join(root, "logs", "SETUP-CODE.txt");
}

/**
 * Unit CJ (0.6.80): fill the first-owner setup code if the login form is
 * showing the field. Test-only in the sense that it is only ever CALLED from
 * a walk script, but it reaches no special server code path at all -- it
 * reads the exact file a human operator is told to read
 * (`installer/Install.ps1`'s closing message), and types it into the exact
 * field a human operator would. There is nothing here for production to
 * "ignore": the server has no separate branch for this caller.
 */
export async function fillPendingSetupCodeIfPresent(page) {
  const field = page.getByLabel("Setup code", { exact: true });
  if ((await field.count()) === 0) return;
  let code = "";
  try {
    code = readFileSync(pendingSetupCodePath(), "utf8").trim();
  } catch (err) {
    throw new Error(
      `Setup code field is showing but ${pendingSetupCodePath()} could not be read: ${err}`,
    );
  }
  await field.fill(code);
}

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
  const navigate = opts.navigate ?? ((target, options) => page.goto(target, options));
  await navigate(`${base}/desk/setup`, { waitUntil: "domcontentloaded" });
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

  // The desk chrome nav (including the "Queue" link) renders on EVERY /desk*
  // route, /desk/setup included, so waiting for it proves nothing about
  // whether setup actually completed -- a waitForURL(/\/desk$/) that follows
  // it just races the real /desk/setup -> /desk navigation and can time out
  // with the page still sitting on /desk/setup. The command-center h1 ("The
  // desk") only renders on the post-setup /desk landing page, never on
  // /desk/setup, so it -- not the nav -- is the real completion signal.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "Save and open the desk" }).click();
    try {
      await Promise.all([
        page.getByLabel("Paper name", { exact: true }).waitFor({ state: "hidden", timeout: 60_000 }),
        page.getByRole("heading", { level: 1, name: "Good morning. Here’s today’s paper.", exact: true }).waitFor({ timeout: 60_000 }),
      ]);
      break;
    } catch {
      // A click into pre-hydration HTML does nothing; go around once more.
    }
  }
  await page.waitForLoadState("load");
  try {
    await page.waitForLoadState("networkidle", { timeout: 5_000 });
  } catch {
    // Vite/HMR or a lingering poll can keep the network from ever going
    // idle; that's not a sign setup failed, so don't fail the walk over it.
  }
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
