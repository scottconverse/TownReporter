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
import { fromCrossJSON, toJSONAsync } from "seroval";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

const base = checkedUrl(process.env.DELETE_CORR_BASE_URL || "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);

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
const foreignSlug = `foreign-published-${stamp}`;
const unpublishedSlug = `own-unpublished-${stamp}`;
const missingSlug = `missing-${stamp}`;
const foreignNewsroomId = 820_003;
const evidenceArtifactDir = resolve(
  process.env.FINDING_EVIDENCE_ARTIFACT_DIR || "../finding-evidence-proof",
);

let page;
let addCorrectionUrl;
const done = [];
const pool = new pg.Pool({ connectionString: databaseUrl });

function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}

async function callObservedAddCorrection(data) {
  if (!addCorrectionUrl) throw new Error("the correction server-function request was not observed");
  const body = JSON.stringify(await toJSONAsync({ data }));
  const response = await page.evaluate(
    async ({ url, body }) => {
      const res = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-tsr-serverFn": "true",
        },
        body,
      });
      return {
        status: res.status,
        serialized: res.headers.has("x-tss-serialized"),
        body: await res.json(),
      };
    },
    { url: addCorrectionUrl, body },
  );
  if (response.status !== 200)
    throw new Error(`correction server function returned HTTP ${response.status}`);
  const decoded = response.serialized ? fromCrossJSON(response.body, {}) : response.body;
  return decoded?.result ?? decoded;
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

/**
 * This is a direct database fixture because no editor control can create a
 * recorded finding with a cited capture, a deliberately mismatched excerpt,
 * or a newer version on demand. It uses the same real Postgres database as
 * the served built application, and every visible sentence says TEST FIXTURE
 * so this is never mistaken for reporting.
 */
async function seedFindingEvidenceReview({ newsroomId, userId }) {
  const sourceUrl = `https://library.example.test/recreation-update-${stamp}`;
  await pool.query("insert into section_config(newsroom_id) values($1) on conflict do nothing", [
    newsroomId,
  ]);
  await pool.query(
    `insert into newsroom_sections(newsroom_id,key,name,position,visible)
     select $1,'community','Community',coalesce(max(position),-1)+1,true
       from newsroom_sections where newsroom_id=$1
     on conflict(newsroom_id,key) do nothing`,
    [newsroomId],
  );
  const section = await pool.query(
    `select count(*)::int n from newsroom_sections
      where newsroom_id=$1 and key='community' and replacement_key is null`,
    [newsroomId],
  );
  if (section.rows[0]?.n !== 1)
    throw new Error("finding evidence fixture did not configure its community section");
  const lead = await pool.query(
    `insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,newsworthiness)
     values($1,$2,$3,$4,'community','drafted',$5,8) returning id`,
    [
      userId,
      newsroomId,
      `TEST FIXTURE — Library recreation center update ${stamp}`,
      "TEST FIXTURE: browser evidence-review coverage for a community record.",
      JSON.stringify([sourceUrl]),
    ],
  );
  const legacyLead = await pool.query(
    `insert into leads(user_id,newsroom_id,headline,why,topic,status)
     values($1,$2,$3,$4,'community','drafted') returning id`,
    [
      userId,
      newsroomId,
      `TEST FIXTURE — Legacy library note ${stamp}`,
      "Legacy empty-review coverage.",
    ],
  );
  const malformedLead = await pool.query(
    `insert into leads(user_id,newsroom_id,headline,why,topic,status)
     values($1,$2,$3,$4,'community','drafted') returning id`,
    [
      userId,
      newsroomId,
      `TEST FIXTURE — Incomplete structured findings ${stamp}`,
      "Malformed structured finding refusal coverage.",
    ],
  );
  const cited = await pool.query(
    `insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,captured_at)
     values($1,$2,$3,'fixture-cited',$4,$5,'2026-09-07T08:00:00Z') returning id`,
    [
      userId,
      newsroomId,
      sourceUrl,
      "TEST FIXTURE — Library agenda",
      "The library board approved the recreation room update Tuesday.",
    ],
  );
  const newer = await pool.query(
    `insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,captured_at)
     values($1,$2,$3,'fixture-newer',$4,$5,'2026-09-07T09:00:00Z') returning id`,
    [
      userId,
      newsroomId,
      sourceUrl,
      "TEST FIXTURE — Library agenda update",
      "The recreation room update was reconsidered Wednesday.",
    ],
  );
  const mismatch = await pool.query(
    `insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,captured_at)
     values($1,$2,$3,'fixture-mismatch',$4,$5,'2026-09-07T08:00:00Z') returning id`,
    [
      userId,
      newsroomId,
      `https://library.example.test/budget-${stamp}`,
      "TEST FIXTURE — Library budget",
      "The fixture budget contains no deadline passage.",
    ],
  );
  const capture = await pool.query(
    `insert into capture_events(user_id,newsroom_id,source_url,fetch_outcome,version_id)
     values($1,$2,$3,'fetched',$4) returning id`,
    [userId, newsroomId, sourceUrl, cited.rows[0].id],
  );
  const findings = [
    {
      text: `TEST FIXTURE: The library board approved the recreation room update ${stamp}.`,
      source_urls: [sourceUrl],
      artifact_version_ids: [cited.rows[0].id, 999999999],
      capture_event_ids: [capture.rows[0].id],
      locators: ["agenda paragraph 4"],
      excerpt: "approved the recreation room update Tuesday",
    },
    {
      text: `TEST FIXTURE: The library budget lists a deadline ${stamp}.`,
      source_urls: [`https://library.example.test/budget-${stamp}`],
      artifact_version_ids: [mismatch.rows[0].id],
      capture_event_ids: [],
      locators: ["budget page 2"],
      excerpt: "deadline is Friday",
    },
  ];
  await pool.query(
    `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,provenance_json,found_note,unanswered,research_json)
     values($1,$2,$3,$4,'TEST FIXTURE dek',$5,'community',$6,'[]',$7,'[]','{}')`,
    [
      userId,
      newsroomId,
      lead.rows[0].id,
      `TEST FIXTURE — Library recreation center update ${stamp}`,
      `TEST FIXTURE body: the library board considered a recreation center update ${stamp}.`,
      JSON.stringify([sourceUrl]),
      JSON.stringify(findings),
    ],
  );
  await pool.query(
    `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,provenance_json,found_note,unanswered,research_json)
     values($1,$2,$3,$4,'','TEST FIXTURE legacy body','community','[]','[]','','[]','{}')`,
    [userId, newsroomId, legacyLead.rows[0].id, `TEST FIXTURE — Legacy library note ${stamp}`],
  );
  await pool.query(
    `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,provenance_json,found_note,unanswered,research_json)
     values($1,$2,$3,$4,'','TEST FIXTURE malformed findings body','community','[]','[]',$5,'[]','{}')`,
    [
      userId,
      newsroomId,
      malformedLead.rows[0].id,
      `TEST FIXTURE — Incomplete structured findings ${stamp}`,
      '[{"text":"TEST FIXTURE truncated structured finding","source_urls":["https://library.example.test',
    ],
  );
  return {
    leadId: lead.rows[0].id,
    legacyLeadId: legacyLead.rows[0].id,
    malformedLeadId: malformedLead.rows[0].id,
    citedVersionId: cited.rows[0].id,
    newerVersionId: newer.rows[0].id,
  };
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
  const correctionRequest = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/_serverFn/"),
  );
  await publishBtn.click();
  addCorrectionUrl = (await correctionRequest).url();
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

  const owner = await pool.query(
    `select m.newsroom_id, m.user_id from newsroom_members m join "user" u on u.id = m.user_id where u.email = $1`,
    [email],
  );
  const newsroomId = owner.rows[0].newsroom_id;
  const findingFixture = await seedFindingEvidenceReview({
    newsroomId,
    userId: owner.rows[0].user_id,
  });
  await page.goto(`${base}/desk/story/${findingFixture.leadId}`, { waitUntil: "networkidle" });
  const review = page.locator("section#evidence-review");
  await review
    .getByText("TEST FIXTURE: The library board approved the recreation room update")
    .waitFor();
  const recordedPassages = review.getByText("Recorded excerpt found in cited version");
  if ((await recordedPassages.count()) !== 2)
    throw new Error("expected the direct citation and captured-event citation passages");
  await recordedPassages.first().waitFor();
  const unavailablePassages = review.getByText("Cited capture unavailable", { exact: true });
  if ((await unavailablePassages.count()) !== 1)
    throw new Error("expected exactly one unavailable cited-capture passage");
  await unavailablePassages.first().waitFor();
  await review.getByRole("button", { name: "View cited captured version" }).first().click();
  const capturedText = review.getByRole("region", { name: "Captured text" });
  await capturedText
    .getByText("The library board approved the recreation room update Tuesday.")
    .waitFor();
  await capturedText.getByRole("button", { name: "Close captured text" }).click();
  const newerCaptureButtons = review.getByRole("button", { name: /Review newer capture/ });
  if ((await newerCaptureButtons.count()) !== 2)
    throw new Error("expected a newer-capture action for each duplicate cited passage");
  await newerCaptureButtons.first().click();
  await capturedText
    .getByText("The recreation room update was reconsidered Wednesday.")
    .waitFor();
  await capturedText.getByRole("button", { name: "Close captured text" }).click();
  const panels = review.locator("article");
  const firstFinding = panels.nth(0);
  const secondFinding = panels.nth(1);
  await firstFinding.getByLabel("Judgment").selectOption("supports");
  await secondFinding.getByLabel("Judgment").selectOption("needs-reporting");
  await secondFinding
    .getByLabel(/Reason/)
    .fill("TEST FIXTURE: seek the library's written statement.");
  await firstFinding.getByRole("button", { name: "Save judgment" }).click();
  await review.getByText("Unsaved edits to another finding were retained.").waitFor();
  if ((await secondFinding.getByLabel("Judgment").inputValue()) !== "needs-reporting")
    throw new Error("saving finding A discarded typed finding B");
  await secondFinding.getByRole("button", { name: "Save judgment" }).click();
  await review.getByText("Evidence judgment saved.").waitFor();
  await page.reload({ waitUntil: "networkidle" });
  const reloadedReview = page.locator("section#evidence-review");
  if (
    (await reloadedReview.locator("article").nth(0).getByLabel("Judgment").inputValue()) !==
      "supports" ||
    (await reloadedReview.locator("article").nth(1).getByLabel("Judgment").inputValue()) !==
    "needs-reporting"
  )
    throw new Error("saved finding A and B judgments did not persist after reload");
  await reloadedReview.locator("article").nth(0).getByLabel("Judgment").selectOption("contradicts");
  await reloadedReview
    .locator("article")
    .nth(0)
    .getByRole("button", { name: "Save judgment" })
    .click();
  await reloadedReview
    .getByText("A contradiction needs cited contrary captured evidence and a reason.")
    .waitFor();
  await page.getByLabel("Body").fill(`TEST FIXTURE unsaved body ${stamp}`);
  if (
    !(await reloadedReview
      .locator("article")
      .nth(0)
      .getByRole("button", { name: "Save judgment" })
      .isDisabled())
  )
    throw new Error("unsaved draft did not disable judgment save");
  await page
    .getByLabel("Body")
    .fill(`TEST FIXTURE body: the library board considered a recreation center update ${stamp}.`);
  const secondTab = await context.newPage();
  const initialReviewResponse = secondTab.waitForResponse(
    async (response) => {
      if (
        response.request().method() !== "GET" ||
        response.request().headers()["x-tsr-serverfn"] !== "true" ||
        !response.ok()
      ) return false;
      const body = await response.text().catch(() => "");
      return body.includes("canonicalDraft") && body.includes("evidenceToken");
    },
    { timeout: 10_000 },
  );
  await secondTab.goto(`${base}/desk/story/${findingFixture.leadId}`, { waitUntil: "networkidle" });
  const reviewRpcPath = new URL((await initialReviewResponse).url()).pathname;
  const secondReview = secondTab.locator("section#evidence-review");
  await secondReview
    .locator("article")
    .nth(0)
    .getByLabel("Judgment")
    .selectOption("does-not-support");
  await secondReview
    .locator("article")
    .nth(0)
    .getByLabel(/Reason/)
    .fill("TEST FIXTURE: preserve this unsaved note through reload failure.");
  await reloadedReview
    .locator("article")
    .nth(0)
    .getByLabel("Judgment")
    .selectOption("needs-reporting");
  await reloadedReview
    .locator("article")
    .nth(0)
    .getByLabel(/Reason/)
    .fill("TEST FIXTURE: concurrent editor requests a fresh source check.");
  await reloadedReview
    .locator("article")
    .nth(0)
    .getByRole("button", { name: "Save judgment" })
    .click();
  await secondReview
    .locator("article")
    .nth(0)
    .getByRole("button", { name: "Save judgment" })
    .click();
  await secondReview
    .getByText("Reload the current review before recording a fresh judgment.")
    .waitFor();
  let failedReloadRequests = 0;
  const blockReviewReload = async (route) => {
    if (
      route.request().method() === "GET" &&
      route.request().headers()["x-tsr-serverfn"] === "true" &&
      new URL(route.request().url()).pathname === reviewRpcPath
    ) {
      failedReloadRequests += 1;
      await route.fulfill({ status: 503, contentType: "text/plain", body: "fixture reload failure" });
      return;
    }
    await route.continue();
  };
  await secondTab.route("**/*", blockReviewReload);
  await secondReview
    .getByRole("button", { name: "Reload current review and discard unsaved judgment edits" })
    .click();
  await secondReview.getByText("Could not reload the evidence review.").waitFor();
  if (failedReloadRequests === 0) throw new Error("failed reload proof intercepted no review request");
  if (
    (await secondReview.locator("article").nth(0).getByLabel("Judgment").inputValue()) !==
      "does-not-support" ||
    (await secondReview.locator("article").nth(0).getByLabel(/Reason/).inputValue()) !==
      "TEST FIXTURE: preserve this unsaved note through reload failure."
  )
    throw new Error("failed evidence reload discarded unsaved judgment input");
  await secondReview
    .locator("article")
    .nth(0)
    .getByLabel(/Reason/)
    .fill("TEST FIXTURE: edit made after failed reload survives a later refetch.");
  await secondTab.unroute("**/*", blockReviewReload);
  const laterReviewRefetch = secondTab.waitForResponse(
    async (response) => {
      if (
        new URL(response.url()).pathname !== reviewRpcPath ||
        response.request().method() !== "GET" ||
        !response.ok()
      ) return false;
      const body = await response.text().catch(() => "");
      return (
        body.includes("canonicalDraft") &&
        body.includes("evidenceToken") &&
        body.includes(`TEST FIXTURE — Library recreation center update ${stamp}`)
      );
    },
    { timeout: 10_000 },
  );
  await secondTab.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });
  await laterReviewRefetch;
  await secondTab.waitForFunction(
    (expectedReason) => {
      const firstFinding = document.querySelector("section#evidence-review article");
      const reason = firstFinding?.querySelector("textarea");
      return reason instanceof HTMLTextAreaElement && reason.value === expectedReason;
    },
    "TEST FIXTURE: edit made after failed reload survives a later refetch.",
  );
  if (
    (await secondReview.locator("article").nth(0).getByLabel("Judgment").inputValue()) !==
      "does-not-support" ||
    (await secondReview.locator("article").nth(0).getByLabel(/Reason/).inputValue()) !==
      "TEST FIXTURE: edit made after failed reload survives a later refetch."
  )
    throw new Error("a refetch after failed reload discarded newer unsaved judgment input");
  await secondTab.close();
  await page.goto(`${base}/desk/story/${findingFixture.legacyLeadId}`, {
    waitUntil: "networkidle",
  });
  await page.getByText("No recorded findings for this draft.").waitFor();
  await page.goto(`${base}/desk/story/${findingFixture.malformedLeadId}`, {
    waitUntil: "networkidle",
  });
  const malformedReview = page.locator("section#evidence-review");
  await malformedReview
    .getByText(
      "Stored findings are incomplete or unreadable. Review the original material or generate a replacement before recording judgments.",
    )
    .waitFor();
  if ((await malformedReview.locator("article").count()) !== 0)
    throw new Error("malformed structured findings rendered as judgment rows");
  if ((await malformedReview.getByRole("button", { name: "Try again" }).count()) !== 0)
    throw new Error("malformed stored findings incorrectly offered retry as a repair");
  step("malformed structured findings fail closed without judgment controls or a retry claim");
  await page.goto(`${base}/desk/story/${findingFixture.leadId}`, { waitUntil: "networkidle" });
  mkdirSync(evidenceArtifactDir, { recursive: true });
  const originalViewport = page.viewportSize();
  await page
    .locator("section#evidence-review")
    .screenshot({ path: join(evidenceArtifactDir, "finding-evidence-review-desktop.png") });
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Large", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  if (!(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)))
    throw new Error("finding evidence review overflows at 390px dark large text");
  await page
    .locator("section#evidence-review")
    .screenshot({
      path: join(evidenceArtifactDir, "finding-evidence-review-mobile-dark-large.png"),
    });
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.getByRole("button", { name: "Text: Normal", exact: true }).click();
  if (originalViewport) await page.setViewportSize(originalViewport);
  step(
    "recorded finding judgments save sequentially, conflict honestly, and remain readable on a narrow dark large-text desk",
  );
  await pool.query(`insert into newsrooms (id, name) values ($1, $2)`, [
    foreignNewsroomId,
    `Foreign paper ${stamp}`,
  ]);
  await pool.query(
    `insert into articles (user_id, newsroom_id, slug, headline, dek, body, topic, status, published_at)
     values ('foreign-editor', $1, $2, 'Foreign story', '', 'Foreign body.', 'council', 'published', now()),
            ($3, $4, $5, 'Own draft', '', 'Own unpublished body.', 'council', 'drafted', now())`,
    [foreignNewsroomId, foreignSlug, owner.rows[0].user_id, newsroomId, unpublishedSlug],
  );
  const attacks = [
    [foreignSlug, `Rejected foreign correction ${stamp}.`],
    [unpublishedSlug, `Rejected unpublished correction ${stamp}.`],
    [missingSlug, `Rejected missing correction ${stamp}.`],
  ];
  for (const [attackSlug, attackBody] of attacks) {
    const result = await callObservedAddCorrection({ articleSlug: attackSlug, body: attackBody });
    if (
      result?.ok !== false ||
      result?.error !== "That published story is not available in this newsroom."
    ) {
      throw new Error(
        `correction target ${attackSlug} was not generically refused: ${JSON.stringify(result)}`,
      );
    }
  }
  const leakedWrites = await pool.query(
    `select
       (select count(*)::int from corrections where body = any($1::text[])) as corrections,
       (select count(*)::int from audit_events where action = 'correction' and detail = any($2::text[])) as audits`,
    [attacks.map(([, attackBody]) => attackBody), attacks.map(([attackSlug]) => attackSlug)],
  );
  if (leakedWrites.rows[0].corrections !== 0 || leakedWrites.rows[0].audits !== 0) {
    throw new Error(
      `a refused correction mutated storage: ${JSON.stringify(leakedWrites.rows[0])}`,
    );
  }
  step("foreign, unpublished, and missing correction targets share one refusal and write nothing");

  await page.goto(`${base}/corrections`, { waitUntil: "networkidle" });
  await page.getByText(correctionText).waitFor({ timeout: 20_000 });
  for (const [, attackBody] of attacks) {
    if ((await page.getByText(attackBody, { exact: true }).count()) !== 0) {
      throw new Error(`a refused correction reached the public feed: ${attackBody}`);
    }
  }
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
  await page
    .getByRole("heading", { level: 1, name: /Kimbark tap fee/i })
    .waitFor({ timeout: 20_000 });
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
