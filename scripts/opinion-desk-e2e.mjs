#!/usr/bin/env node
/**
 * The Opinion desk, driven the way the operator found it broken.
 *
 * Two reports from the live desk, both real, both reproduced before this was
 * written:
 *
 *   1. "Read it" appeared to do nothing. The button flipped to Close and no
 *      text arrived. It was working: the panel renders after the whole list,
 *      and measured in a browser its heading landed at 722px in a 720px
 *      viewport -- two pixels below the fold. Invisible is indistinguishable
 *      from broken, and more annoying.
 *
 *   2. Two rows could not be removed. Delete was keyed on the DRAFT, so a
 *      request that finished without producing one had a greyed-out button and
 *      sat on the desk forever. One of them reported neither a piece nor an
 *      error, so it looked like work still in progress that had actually
 *      stopped months ago.
 *
 * Both shapes are seeded directly, because both arrive from a model run that
 * went wrong and neither can be produced on demand without spending money.
 *
 *   OPINION_BASE_URL=http://127.0.0.1:3222 OPINION_DB_URL=postgres://... \
 *     node scripts/opinion-desk-e2e.mjs
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

const base = checkedUrl(process.env.OPINION_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const dbUrl = process.env.OPINION_DB_URL;
if (!dbUrl) {
  console.error("OPINION_DB_URL is required: the stuck rows can only be made directly.");
  process.exit(1);
}

const stamp = Date.now();
const done = [];
const step = (n) => {
  done.push(n);
  console.log(`  ok    ${n}`);
};

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(45_000);

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message ?? e).slice(0, 160)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 160));
  });

  console.log(`opinion desk: ${base}`);

  /*
    Create the desk, or sign in if it is already claimed.

    This script runs SECOND in its CI job, after delete-corrections-e2e has
    already claimed the desk on the shared server. It unconditionally filled
    the "Name" field -- which only exists on the first-run create form -- and
    waited 45 seconds for a field the sign-in page does not have. The two
    scripts share credentials through E2E_DESK_EMAIL / E2E_DESK_PASSWORD so
    the second can sign in as the first.
  */
  const email = process.env.E2E_DESK_EMAIL ?? `opinion-${stamp}@townreporter.test`;
  const password = process.env.E2E_DESK_PASSWORD ?? "opinion-walk-pass";
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  const loginHeading = page.getByRole("heading", { name: /Create the desk|Editor sign-in/ });
  await loginHeading.waitFor();
  const createdDesk = /Create the desk/.test((await loginHeading.textContent()) ?? "");
  if (createdDesk) {
    await page.getByLabel("Name").fill("Opinion Walk");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create editor account" }).click();
  } else {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in with email" }).click();
  }
  await page.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 45_000 });
  step("owns the desk");

  /*
    Unit CA, note 1's walk reads the published piece back from the paper, and
    the public pages print nothing until first-run setup has been completed
    (CITY-SETUP: `/articles/$slug` answers 404 on an un-onboarded desk).

    Only in the branch that just claimed the desk, exactly where every other
    walk does it. In CI this script runs SECOND, signing in to the desk
    delete-corrections-e2e already set up, and running setup again would wait
    for a form that is no longer there.
  */
  if (createdDesk) {
    await completeFirstRunSetup(page, base);
    step("the desk is set up, so the paper's own pages can print");
  }

  await page.goto(`${base}/desk/opinion`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Paste a piece I wrote" }).click();
  await page.getByPlaceholder(/Headline on the first line/).fill(
    [
      `A real editorial ${stamp}`,
      "",
      "The body of the piece, long enough to be worth reading.",
      "",
      "CLAIMS AND SOURCES",
      "",
      "Source: https://example.org/a-document",
    ].join("\n"),
  );
  await page.getByRole("button", { name: "File it as a draft" }).click();
  await page.getByText(/Filed as a draft/).waitFor({ timeout: 30_000 });
  step("one real editorial is on the desk");

  /*
    The two stuck shapes. A model run that times out leaves the first; the
    second is the one that alarmed the operator most, because it claims to have
    finished and shows no error while having produced nothing at all.

    The third is Unit CA's: finished, with a draft, and an appendix the writer's
    own source check refused. It is a piece that exists and cannot print, so it
    is the row that separates "finished" from "publishable".
  */
  const c = new Client({ connectionString: dbUrl });
  await c.connect();
  const owner = (await c.query(`select user_id from newsroom_members limit 1`)).rows[0].user_id;
  await c.query(
    `insert into editorial_requests (user_id, newsroom_id, subject, source_kind, source_ref, error, finished_at)
     values ($1, 1, 'Timed out ${stamp}', 'desk', '', 'Claude Code request timed out', now())`,
    [owner],
  );
  await c.query(
    `insert into editorial_requests (user_id, newsroom_id, subject, source_kind, source_ref, finished_at)
     values ($1, 1, 'Finished with nothing ${stamp}', 'desk', '', now())`,
    [owner],
  );
  const shortClaims = await c.query(
    `insert into drafts (user_id, newsroom_id, headline, body, topic, form, integrity_notes)
     values ($1, 1, 'Claims missing ${stamp}', 'The body of a piece whose appendix is short.', 'opinion', 'editorial',
             'Claims and sources are incomplete. This draft is saved, but every op-ed needs a sourced claims appendix before publication.')
     returning id`,
    [owner],
  );
  await c.query(
    `insert into editorial_requests (user_id, newsroom_id, subject, source_kind, source_ref, draft_id, finished_at)
     values ($1, 1, 'Claims missing ${stamp}', 'desk', '', $2, now())`,
    [owner, shortClaims.rows[0].id],
  );
  await c.end();
  step("seeded a timed-out run, one that finished producing nothing, and one whose claims are short");

  await page.goto(`${base}/desk/opinion`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // Every row must offer a way out. A greyed-out button on a row that can
  // never change is a dead end the operator has to step around forever.
  const clears = page.getByRole("button", { name: /^(Delete|Clear)$/ });
  const count = await clears.count();
  if (count < 4) throw new Error(`only ${count} rows offer a way to remove them; expected 4`);
  for (let i = 0; i < count; i++) {
    if (await clears.nth(i).isDisabled()) {
      throw new Error(`row ${i + 1} has no usable way to be removed`);
    }
  }
  step("every row can be removed, including the ones that produced nothing");

  // The report: Read it looked like it did nothing.
  await page.getByRole("button", { name: "Read it" }).first().click();
  await page.waitForTimeout(1500);
  const panel = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h1,h2,h3")].find((n) =>
      /The piece/i.test(n.textContent || ""),
    );
    if (!h) return { present: false };
    const r = h.getBoundingClientRect();
    return { present: true, top: Math.round(r.top), viewport: window.innerHeight };
  });
  if (!panel.present) throw new Error("Read it did not render the piece at all");
  if (panel.top < 0 || panel.top >= panel.viewport) {
    throw new Error(
      `the piece opened off-screen: heading at ${panel.top}px in a ${panel.viewport}px viewport`,
    );
  }
  step(`Read it brings the piece into view (${panel.top}px of ${panel.viewport}px)`);

  /*
    Unit CA, note 1. The operator pasted a finished piece, saved it, and could
    not find how to publish it: "Publish to the paper" lived only inside the
    panel that Read it opens. The row draws it now, on the same server call the
    panel makes, and only where there is a draft to print.
  */
  await page.goto(`${base}/desk/opinion`, { waitUntil: "networkidle" });
  const timedOutRow = page.locator("li", { hasText: `Timed out ${stamp}` }).first();
  const producedNothingRow = page.locator("li", { hasText: `Finished with nothing ${stamp}` }).first();
  const shortClaimsRow = page.locator("li", { hasText: `Claims missing ${stamp}` }).first();
  await timedOutRow.waitFor({ timeout: 20_000 });
  for (const [what, row] of [
    ["the run that timed out", timedOutRow],
    ["the run that finished with nothing", producedNothingRow],
    ["the finished piece whose claims appendix is short", shortClaimsRow],
  ]) {
    const offered = await row.getByRole("button", { name: "Publish", exact: true }).count();
    if (offered > 0) throw new Error(`${what} is offered Publish, and has no piece to print`);
  }
  // It is not merely offered nothing: the row says what it wants instead.
  await shortClaimsRow.getByRole("link", { name: "Repair claims" }).waitFor({ timeout: 20_000 });
  step("a row that cannot print draws no Publish, and the claims row asks for its sources");

  const finishedRow = page.locator("li", { hasText: `A real editorial ${stamp}` }).first();
  await finishedRow.waitFor({ timeout: 20_000 });
  const rowPublish = finishedRow.getByRole("button", { name: "Publish", exact: true });
  const offered = await rowPublish.count();
  if (offered !== 1) {
    throw new Error(`the finished piece offers ${offered} Publishes on its row; expected 1`);
  }
  /*
    0.6.80 (CK): publishing refuses an empty dek, and a pasted piece files
    none. The row's press says so in words and prints nothing. The editor then
    writes the dek (the full editor's Dek field; here written to the draft
    directly, the way this walk seeds its other rows) and presses again.
  */
  await rowPublish.click();
  await page.getByText(/Add a dek, the one-line summary under the headline/).waitFor({ timeout: 30_000 });
  step("a piece with no dek is refused in words from its own row");
  const dekClient = new Client({ connectionString: dbUrl });
  await dekClient.connect();
  const dekSet = await dekClient.query(
    `update drafts set dek = 'Why this piece matters, in one line.' where headline = $1 and newsroom_id = 1`,
    [`A real editorial ${stamp}`],
  );
  await dekClient.end();
  if (dekSet.rowCount !== 1) throw new Error(`the dek went to ${dekSet.rowCount} drafts; expected 1`);
  await rowPublish.click();
  await page.getByText(/On the paper\. See it under Published/).waitFor({ timeout: 30_000 });

  await page.reload({ waitUntil: "networkidle" });
  const printedRow = page.locator("li", { hasText: `A real editorial ${stamp}` }).first();
  await printedRow.getByText("Published", { exact: true }).waitFor({ timeout: 20_000 });
  if ((await printedRow.getByRole("button", { name: "Publish", exact: true }).count()) > 0) {
    throw new Error("a piece already on the paper is still offered Publish");
  }
  const href = await printedRow.getByRole("link", { name: "View" }).getAttribute("href");
  if (!href || !href.startsWith("/articles/")) {
    throw new Error(`the published row points at ${href}, not a piece on the paper`);
  }
  // Published is not a state on a row; it is a page a reader can open.
  await page.goto(`${base}${href}`, { waitUntil: "networkidle" });
  await page.getByText(`A real editorial ${stamp}`).first().waitFor({ timeout: 20_000 });
  step(`a finished piece publishes from its own row, and is readable at ${href}`);

  // Clearing a row that produced nothing must actually remove it.
  await page.goto(`${base}/desk/opinion`, { waitUntil: "networkidle" });
  const stuck = page.locator("li", { hasText: `Finished with nothing ${stamp}` }).first();
  await stuck.waitFor({ timeout: 20_000 });
  await stuck.getByRole("button", { name: "Clear", exact: true }).click();
  await stuck.getByRole("button", { name: /Yes, clear it/ }).click();
  await page.getByText(/Cleared off the desk/).waitFor({ timeout: 20_000 });
  await page.reload({ waitUntil: "networkidle" });
  if ((await page.locator("li", { hasText: `Finished with nothing ${stamp}` }).count()) > 0) {
    throw new Error("the row reported cleared but is still on the desk after a reload");
  }
  step("a run that produced nothing can be cleared, and stays gone");

  if (errors.length) throw new Error(`console errors: ${errors.slice(0, 3).join(" | ")}`);
  step("no console errors");

  await browser.close();
  console.log(JSON.stringify({ ok: true, steps: done.length }, null, 2));
}

main().catch((err) => {
  console.error(
    JSON.stringify({ ok: false, error: String(err?.message ?? err), completed: done }, null, 2),
  );
  process.exit(1);
});
