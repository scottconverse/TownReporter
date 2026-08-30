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

  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Name").fill("Opinion Walk");
  await page.getByLabel("Email").fill(`opinion-${stamp}@townreporter.test`);
  await page.getByLabel("Password", { exact: true }).fill("opinion-walk-pass");
  await page.getByLabel("Confirm password").fill("opinion-walk-pass");
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  step("owns the desk");

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
  await c.end();
  step("seeded a timed-out run and one that finished producing nothing");

  await page.goto(`${base}/desk/opinion`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // Every row must offer a way out. A greyed-out button on a row that can
  // never change is a dead end the operator has to step around forever.
  const clears = page.getByRole("button", { name: /^(Delete|Clear)$/ });
  const count = await clears.count();
  if (count < 3) throw new Error(`only ${count} rows offer a way to remove them; expected 3`);
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
