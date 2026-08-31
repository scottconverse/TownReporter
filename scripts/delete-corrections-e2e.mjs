#!/usr/bin/env node
/**
 * Delete, trash, and the public corrections feed — driven in a browser.
 *
 * Five fixes shipped with no browser coverage at all, proven only by unit
 * tests: deleting a story left its correction orphaned and printable under a
 * null headline; restoring a deleted story from the trash did not bring its
 * corrections back with it; the public corrections feed could print a
 * correction for a story that was never published; and a "locator" — an
 * internal pointer into a captured transcript, meaningless to a reader — could
 * reach the article page, in two different functions that computed the same
 * thing and could drift apart. `desk-flows-e2e.mjs` proved Undo and Restore
 * for a LEAD; this walk proves the harder case, an ARTICLE with something
 * (a correction) that points back at it, because that is the case where a
 * restore that only re-inserts the row and forgets its dependents looks like
 * it worked and is actually a data-loss bug wearing a success toast.
 *
 * Deliberately model-free: nothing here starts a scan, a dig, or an
 * editorial. The locator finding is written straight into the database, the
 * way a completed Dark Desk run would have left it — this walk is proving the
 * read and delete/restore paths, not paying to regenerate one.
 *
 * Wants an UNCLAIMED desk: it creates its own throwaway owner, like the other
 * flow scripts. It also opens a direct Postgres connection (DATABASE_URL) to
 * seed the one thing no editor screen can type: a finding with a locator, and
 * a correction on a story that was never published. Both are states a
 * finished Dark Desk pass or a data migration can produce; the desk itself has
 * no button for either, so there is no UI path that reaches them.
 *
 *   DATABASE_URL=postgres://... \
 *   DELETE_CORR_BASE_URL=http://127.0.0.1:8080 node scripts/delete-corrections-e2e.mjs
 */
import { chromium } from "playwright";
import pg from "pg";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

const base = checkedUrl(
  process.env.DELETE_CORR_BASE_URL || "http://127.0.0.1:8080",
).replace(/\/$/, "");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    JSON.stringify({ ok: false, error: "DATABASE_URL must be set — this walk seeds directly" }),
  );
  process.exit(1);
}

const stamp = Date.now();
// Shared with opinion-desk-e2e, which runs second in this job and signs in
// as this account (the desk only ever has one editor).
const email = process.env.E2E_DESK_EMAIL ?? `corr-${stamp}@townreporter.test`;
const password = process.env.E2E_DESK_PASSWORD ?? "delete-corr-e2e-pass";
const leadHeadline = `Water board revisits the Kimbark tap fee ${stamp}`;
const body = "The water board revisited the Kimbark tap fee at its Tuesday session.";
const correctionText = `The fee is $4,200, not $2,400 ${stamp}.`;
const locatorText = "char:14000-16000 — plan amendment adds two parcels";
const findingUrl = "https://www.youtube.com/watch?v=_cTgf1W7188";
const findingText = `TownReporter listened to the Aug. 18 meeting recording ${stamp}.`;
const ghostHeadline = `Draft that never printed ${stamp}`;
const ghostSlug = `ghost-draft-${stamp}`;
const ghostCorrection = `This correction must never reach a reader ${stamp}.`;

let page;
const done = [];
const pool = new pg.Pool({ connectionString: databaseUrl });

function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}

async function dump(err) {
  const message = err instanceof Error ? err.message : String(err);
  let url = "";
  let text = "";
  try {
    url = page?.url() ?? "";
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 1200);
  } catch {
    /* page already gone */
  }
  console.error(JSON.stringify({ ok: false, error: message, url, text, completed: done }, null, 2));
  await pool.end().catch(() => undefined);
  process.exit(1);
}

/**
 * A ghost story: never published, so nothing on this desk ever pointed an
 * editor at it, and correcting it is not a real editorial action — but its row
 * exists, and a correction with its id in `article_id` is a state the schema
 * allows. The only thing standing between that row and a reader is the
 * `a.status = 'published'` clause in `listPublicCorrections`. Written directly
 * because there is no "publish" button that produces an unpublished article on
 * purpose.
 */
async function seedUnpublishedCorrection() {
  const art = await pool.query(
    `insert into articles (user_id, slug, headline, dek, body, topic, status)
     values ('seed', $1, $2, '', 'Never printed.', 'council', 'drafted')
     returning id`,
    [ghostSlug, ghostHeadline],
  );
  const articleId = art.rows[0].id;
  await pool.query(`insert into corrections (user_id, article_id, body) values ('seed', $1, $2)`, [
    articleId,
    ghostCorrection,
  ]);
}

/**
 * Write a finding with a locator onto the now-published, now-restored story,
 * the way a completed Dark Desk run leaves `found_note` and `provenance_json`.
 * The provenance entry's `url` and `version_id` have to match the finding's
 * `source_urls` and `artifact_version_ids` or `resolvePublicFindings` drops
 * the whole finding as unverified — that filter is not what this walk is
 * proving, so the fixture satisfies it deliberately.
 */
async function seedLocatorFinding(slug) {
  const foundNote = JSON.stringify([
    {
      text: findingText,
      source_urls: [findingUrl],
      capture_event_ids: [],
      artifact_version_ids: [8801],
      locators: [locatorText],
    },
  ]);
  const provenance = JSON.stringify([
    {
      title: "Meeting recording",
      organization: "youtube.com",
      document_date: "",
      url: findingUrl,
      captured_at: null,
      version_id: 8801,
      version_count: null,
      capture_event_id: null,
      disappeared: false,
      role: "source",
    },
  ]);
  await pool.query(
    `update articles set found_note = $1, provenance_json = $2, source_urls = $3 where slug = $4`,
    [foundNote, provenance, JSON.stringify([findingUrl]), slug],
  );
}

async function main() {
  // ── The ghost, seeded before anything else opens a browser ────────────────
  await seedUnpublishedCorrection();
  step("seeded a correction on a story that was never published");

  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(45_000);

  const consoleErrors = [];
  const note = (text) => {
    // This walk deliberately loads a story's URL after deleting it, to check
    // the route answers not-found. That load's own document request legitimately
    // gets a 404 from the server — the thing being proven, not a defect — so
    // Chromium's "Failed to load resource: … 404" console line is expected
    // noise on that one step and would otherwise fail every run of a passing
    // walk.
    if (/status of 404/.test(text)) return;
    consoleErrors.push(`[after: ${done[done.length - 1] ?? "start"} | ${page.url()}] ${text}`);
  };
  page.on("pageerror", (e) => note(String(e.message ?? e).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") note(m.text().slice(0, 200));
  });

  console.log(`delete + corrections walk: ${base}`);

  // ── The ghost must never have been visible, from the very first load ──────
  // This is the control for the whole walk: if a reader can already see this
  // correction before a single real action has happened, seeding is broken,
  // not the fix. Checked before anything else, so a later "and it's still
  // absent" reads as evidence the write path never surfaced it.
  await page.goto(`${base}/corrections`, { waitUntil: "networkidle" });
  if ((await page.getByText(ghostCorrection).count()) !== 0) {
    throw new Error("a correction on an unpublished story is visible on /corrections");
  }
  step("a correction on an unpublished story never reaches the public feed");

  // ── Own the desk ──────────────────────────────────────────────────────────
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("Corrections Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("first account owns the desk with no setup token");

  // ── File, write, publish ───────────────────────────────────────────────────
  await page.goto(`${base}/desk/queue`, { waitUntil: "networkidle" });
  await page.getByText("File a lead yourself").click();
  await page.getByLabel("Headline").fill(leadHeadline);
  await page.getByLabel("Why now").fill("The packet posted with the revised fee schedule.");
  await page.getByRole("button", { name: "File lead" }).click();
  await page.getByLabel("Body").waitFor({ timeout: 30_000 });

  await page.getByLabel("Headline").fill(leadHeadline);
  await page.getByLabel("Dek").fill("Revised fee schedule");
  await page.getByLabel("Body").fill(body);
  await page.getByRole("button", { name: "Publish to the paper" }).click();
  await page.getByRole("button", { name: "Yes, print it" }).click();
  await page.getByText("On the paper").waitFor({ timeout: 30_000 });
  await page.getByRole("link", { name: "Read it on the paper" }).click();
  await page.waitForURL(/\/articles\//, { timeout: 20_000, waitUntil: "commit" });
  const articleUrl = page.url();
  const slug = articleUrl.split("/articles/")[1];
  await page.getByRole("heading", { level: 1, name: /Kimbark tap fee/i }).waitFor();
  step("a story can be filed, written, and published");

  // ── Post a real correction, and see it in both of its public places ───────
  // The migration seeds a "welcome to TownReporter" story that is published
  // from the moment the desk exists, so every published-list query on this
  // walk scopes to the row carrying THIS run's headline — otherwise a click
  // meant for the fixture story could land on the masthead piece instead.
  await page.goto(`${base}/desk/published`, { waitUntil: "networkidle" });
  const pubRow = page.locator(".pub-row", { hasText: leadHeadline }).first();
  await pubRow.waitFor({ timeout: 20_000 });
  await pubRow.getByRole("button", { name: "Post correction" }).click({ force: true });
  await pubRow.getByPlaceholder("What was wrong").fill(correctionText);
  // Deliberately NOT force-clicked: the button is disabled until React's
  // controlled-input state catches up with the fill above, and forcing the
  // click races that update. Plain click() waits for actionable (enabled,
  // visible) on its own, which is what a real editor's click implicitly
  // waits for too.
  const publishBtn = pubRow.getByRole("button", { name: "Publish correction" });
  await publishBtn.waitFor({ state: "visible", timeout: 10_000 });
  await publishBtn.click();
  /*
    Not `pubRow.getByText(correctionText)`. A <textarea>'s current value is
    text Playwright's getByText will happily match — so that locator was
    satisfied the instant the textarea was filled, before the button was ever
    clicked and regardless of whether the mutation succeeded. It is exactly
    the false-positive shape this walk exists to prevent: a check that a
    string is present, not that a reader would see it. The confirmation form
    unmounts on success and is replaced by the rendered correction in a
    `.pub-corr` paragraph, so waiting on THAT is proof the row exists, not
    proof someone typed something.
  */
  await pubRow.locator(".pub-corr").getByText(correctionText).waitFor({ timeout: 20_000 });
  step("a correction can be posted from the desk");

  await page.goto(`${base}/corrections`, { waitUntil: "networkidle" });
  await page.getByText(correctionText).waitFor({ timeout: 20_000 });
  step("the correction reached the public corrections feed");

  // ── Delete the story ────────────────────────────────────────────────────
  // This is the step that reaches deleteArticle's transaction: corrections
  // deleted first, then the article, inside one transaction. Before the fix,
  // the article went first, Postgres nulled corrections.article_id on the
  // way, and the follow-up "delete where article_id = X" cleaned up nothing —
  // the correction survived the story it belonged to.
  await page.goto(`${base}/desk/published`, { waitUntil: "networkidle" });
  const pubRow2 = page.locator(".pub-row", { hasText: leadHeadline }).first();
  await pubRow2.getByRole("button", { name: "Delete", exact: true }).click();
  await pubRow2.getByRole("button", { name: /Yes, take it off/ }).click();
  await page.getByText(/Taken off the paper, and kept for 30 days/).waitFor({ timeout: 20_000 });
  step("deleting a story asks once and says the copy is kept");

  await page.goto(articleUrl, { waitUntil: "domcontentloaded" });
  await page.getByText("That story is not in this edition").waitFor({ timeout: 20_000 });
  step("the deleted story's URL now answers not-found");

  // The reader-facing proof that the delete order (and, in depth, the public
  // query's own refusal to print an orphan) actually held: the correction
  // that was visible two steps ago is gone, not left behind under no
  // headline.
  await page.goto(`${base}/corrections`, { waitUntil: "networkidle" });
  if ((await page.getByText(correctionText).count()) !== 0) {
    throw new Error("a correction for a deleted story is still on the public corrections feed");
  }
  step("the correction did not outlive the story it belonged to");

  // ── Restore from the trash, and check what came back with it ──────────────
  // The trash row's own label is the first signal: `listTrash` describes what
  // restoring will bring back, and "with 1 correction" only appears if the
  // snapshot actually captured the correction row before the delete ran.
  await page.goto(`${base}/desk/ops`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Recently deleted" }).waitFor({ timeout: 20_000 });
  const trashRow = page.locator("li", { hasText: leadHeadline }).first();
  await trashRow.waitFor({ timeout: 20_000 });
  await trashRow.getByText(/with .*correction/).waitFor({ timeout: 10_000 });
  step("the trash entry says restoring brings the correction back");

  await trashRow.getByRole("button", { name: "Restore" }).click();
  await page.getByText(/Back on the desk/).waitFor({ timeout: 20_000 });
  step("restore from the trash reports success");

  // The story is back — same URL, because reinsert puts the row back under
  // the same id the correction's article_id still points at.
  await page.goto(articleUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1, name: /Kimbark tap fee/i }).waitFor({ timeout: 20_000 });
  step("the restored story answers at its old URL again");

  // The actual claim under test: the correction, which points AT the article
  // by id, came back attached to it — not silently dropped by a restore that
  // only knew how to reinsert one row.
  await page.getByText(correctionText).waitFor({ timeout: 20_000 });
  step("the restored story's own page shows its correction again");

  await page.goto(`${base}/corrections`, { waitUntil: "networkidle" });
  await page.getByText(correctionText).waitFor({ timeout: 20_000 });
  step("the correction is back on the public corrections feed too");

  // ── Locators: a note to the desk, never to a reader ────────────────────────
  // Written straight into the row a completed Dark Desk pass would have left.
  // `resolvePublicFindings` decides which findings survive to print AND strips
  // any locator from the ones that do; it used to exist twice, byte-identical,
  // in two files, and fixing the leak in one left the copy in the other
  // leaking. Both `public.ts` and the re-export in `report.ts` now resolve to
  // the same function, so there is exactly one place this can go wrong again.
  await seedLocatorFinding(slug);
  await page.goto(articleUrl, { waitUntil: "domcontentloaded" });
  await page.getByText(findingText).waitFor({ timeout: 20_000 });
  step("the finding itself prints on the restored story's page");

  await page.getByRole("link", { name: "Captured record" }).waitFor({ timeout: 10_000 });
  step("the reader gets the real way into the source, a link to the captured record");

  const pageText = await page.locator("body").innerText();
  if (pageText.includes(locatorText) || /char:\d+-\d+/.test(pageText)) {
    throw new Error("a raw transcript locator reached the article page");
  }
  step("no transcript locator reached the page a reader sees");

  if (consoleErrors.length > 0) {
    throw new Error(`console errors during the walk: ${consoleErrors.slice(0, 5).join(" | ")}`);
  }
  step("no console errors across every screen walked");

  await context.close();
  await browser.close();
  await pool.end();
  console.log(JSON.stringify({ ok: true, steps: done.length, email }, null, 2));
}

main().catch(dump);
