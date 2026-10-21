// Queue and Today, real routes and lifecycle writes on a disposable embedded database.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import { confirmSectionAndWaitForPublishable } from "./confirm-section-step.mjs";
import { completeFirstRunSetup, fillPendingSetupCodeIfPresent } from "./first-run-setup-step.mjs";

async function main() {
  assert.equal(process.env.DATABASE_URL || "", "", "browser fixtures must use disposable PGlite");
  const dataRoot = await mkdtemp(join(tmpdir(), "tr-release-h-"));
  process.env.TOWNREPORTER_DATA_ROOT = dataRoot;
  process.env.DATABASE_URL = "";
  process.env.VERCEL = "";
  process.env.VERCEL_ENV = "";
  const PORT = 3586;
  process.env.PORT = String(PORT);
  process.env.NITRO_PORT = String(PORT);
  process.env.HOST = "127.0.0.1";
  process.env.NITRO_HOST = "127.0.0.1";
  const base = `http://127.0.0.1:${PORT}`;
  process.env.BETTER_AUTH_URL = base;
  await import(pathToFileURL(join(process.cwd(), ".output/server/index.mjs")).href);
  const { s: getSql } = await import(
    pathToFileURL(join(process.cwd(), ".output/server/_chunks/db.mjs")).href
  );
  const sql = await getSql();
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/login")).ok) break;
    } catch {
      /* Waiting for this fixture server to listen. */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("PAGE ERROR", e.message);
  });
  page.on("console", (m) => {
    if (m.type() === "error") console.error("CONSOLE", m.text());
  });
  await page.goto(base + "/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Name", { exact: true }).fill("Release H Editor");
  await page.getByLabel("Email", { exact: true }).fill(`release-h-${Date.now()}@townreporter.test`);
  await page.getByLabel("Password", { exact: true }).fill("release-h-fixture-password");
  await page.getByLabel("Confirm password", { exact: true }).fill("release-h-fixture-password");
  await fillPendingSetupCodeIfPresent(page, { dataRoot });
  await page.getByRole("button", { name: "Create editor account", exact: true }).click();
  await page.getByRole("link", { name: /^Queue/ }).waitFor();
  await completeFirstRunSetup(page, base);
  const [owner] = await sql.query("select user_id, newsroom_id from newsroom_members limit 1");
  assert.ok(owner, "same disposable database serves the browser");
  const failures = [];
  async function check(id, work) {
    if (process.env.WALKA_ROWS && !process.env.WALKA_ROWS.split(",").includes(id)) return;
    try {
      await work();
      console.log(`PASS ${id}`);
    } catch (error) {
      failures.push(id);
      console.error(`FAIL ${id}: ${error.message}`);
      await page.screenshot({ path: `${id}-browser.png`, fullPage: true });
    }
    await sql.query("update leads set status='killed' where newsroom_id=$1", [owner.newsroom_id]);
    await sql.query(
      "update desk_jobs set status='completed', finished_at=now() where newsroom_id=$1",
      [owner.newsroom_id],
    );
    await page.setViewportSize({ width: 1920, height: 1080 });
  }
  async function lead(
    headline,
    {
      status = "new",
      draft = false,
      body = "Saved draft prose for the disposable browser fixture.",
      prior = null,
    } = {},
  ) {
    const [row] = await sql.query(
      "insert into leads(user_id,newsroom_id,headline,why,topic,status,newsworthiness,possible_duplicate_of,dup_kind) values($1,$2,$3,'Fixture','council',$4,99,$5,$6) returning id",
      [owner.user_id, owner.newsroom_id, headline, status, prior, prior ? "possible" : null],
    );
    if (draft)
      await sql.query(
        "insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic) values($1,$2,$3,$4,'Fixture summary',$5,'council')",
        [owner.user_id, owner.newsroom_id, row.id, headline, body],
      );
    return row.id;
  }
  async function job(id, status, kind = "draft") {
    await sql.query(
      "insert into desk_jobs(user_id,newsroom_id,kind,subject_id,status,stage,model_choice,started_at,finished_at) values($1,$2,$3,$4,$5,'Writing the draft','auto',now(),case when $5 in ('failed','completed') then now() else null end)",
      [owner.user_id, owner.newsroom_id, kind, id, status],
    );
  }
  async function queue(headline) {
    await page.goto(base + "/desk/queue", { waitUntil: "networkidle" });
    await page.getByLabel("Search leads", { exact: true }).fill(headline);
    const row = page.locator(".lead-row", { hasText: headline });
    await row.waitFor();
    return row;
  }
  async function restored(id) {
    await page
      .locator("[data-sonner-toast]")
      .getByRole("button", { name: "Undo", exact: true })
      .last()
      .click();
    for (let i = 0; i < 60; i++) {
      if ((await sql.query("select status from leads where id=$1", [id]))[0].status !== "killed")
        break;
      await page.waitForTimeout(100);
    }
    assert.equal(
      (await sql.query("select status from leads where id=$1", [id]))[0].status,
      "drafted",
    );
    assert.equal(
      (await sql.query("select body from drafts where lead_id=$1", [id]))[0].body,
      "Saved draft prose for the disposable browser fixture.",
    );
  }
  await check("DHA1", async () => {
    const headline = "DHA1 selected draft";
    const id = await lead(headline, { draft: true });
    const row = await queue(headline);
    await row.getByRole("checkbox").focus();
    await page.keyboard.press("h");
    await page.getByRole("button", { name: "Hold anyway", exact: true }).click();
    for (let i = 0; i < 60; i++) {
      if ((await sql.query("select status from leads where id=$1", [id]))[0].status === "held")
        break;
      await page.waitForTimeout(100);
    }
    assert.equal((await sql.query("select status from leads where id=$1", [id]))[0].status, "held");
  });
  await check("DHA2", async () => {
    await page.setViewportSize({ width: 390, height: 1000 });
    for (const door of ["row", "X", "bulk", "Story"]) {
      const headline = `DHA2 ${door} draft`;
      const id = await lead(headline, { status: "drafted", draft: true });
      if (door === "Story") {
        await page.goto(base + `/desk/story/${id}`, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "Kill this lead", exact: true }).click();
        await page.getByRole("button", { name: "Kill, no reason", exact: true }).click();
      } else {
        const row = await queue(headline);
        if (door === "row") await row.getByRole("button", { name: /^Kill/ }).first().click();
        if (door === "X") {
          await page.locator("body").evaluate((el) => {
            el.tabIndex = -1;
            el.focus();
          });
          await page.keyboard.press("x");
        }
        if (door === "bulk") {
          await row.getByRole("checkbox").check();
          await page
            .locator('[aria-label="Bulk actions for the leads shown"]')
            .getByRole("button", { name: "Kill", exact: true })
            .click();
          /*
            TMA-2 (ae6ff2a7): a bulk Kill asks for one reason first, even for a
            single lead, so the kill is this press.
            D2-a (settleBulkKill, queue-bulk.ts:144-172) answers the saved-draft
            warning INSIDE that press -- the drafted leads are sent again with
            their own draft override -- so no "Kill all anyway" is drawn after
            it. What is left to prove is the outcome: the lead is killed and its
            Undo brings the draft back.
          */
          await page.getByRole("button", { name: "Yes, kill 1", exact: true }).click();
          for (let i = 0; i < 60; i++) {
            if ((await sql.query("select status from leads where id=$1", [id]))[0].status === "killed")
              break;
            await page.waitForTimeout(100);
          }
          assert.equal(
            (await sql.query("select status from leads where id=$1", [id]))[0].status,
            "killed",
          );
        }
      }
      if (door !== "bulk")
        await page.getByRole("button", { name: "Kill anyway", exact: true }).click();
      await restored(id);
      console.log(`PASS DHA2 ${door}: Undo restores draft`);
      await sql.query("update leads set status='killed' where id=$1", [id]);
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
  });
  await check("DHA3", async () => {
    const prior = await lead("DHA3 earlier story");
    const id = await lead("DHA3 duplicate", { status: "killed", prior, draft: true });
    await page.goto(base + `/desk/story/${id}`, { waitUntil: "networkidle" });
    page.once("dialog", (dialog) => dialog.accept());
    /* DHD2-8 (9f1695e8): this lead is already killed, so the Compare press adds
       the duplicate note instead of killing again; its name says so. */
    await page
      .getByRole("button", { name: "Already killed — add duplicate note: DHA3 duplicate", exact: true })
      .click();
    const warning = page
      .locator("[data-sonner-toast]")
      .getByRole("button", { name: "Kill anyway", exact: true });
    /*
      This lead has a written draft, so the press is answered by the desk's
      drafted warning toast, whose only press is "<verb> anyway" and which
      carries no Undo (desk-action.ts:414-425). WAIT for it: isVisible() asked
      the instant the click returns answered false, no press was sent, and the
      row then waited 15s for an Undo that the warning never draws.
    */
    await warning.waitFor({ timeout: 30_000 });
    await warning.click();
    /*
      DHD2-8 (9f1695e8): this lead is ALREADY killed, so the press adds the
      duplicate note naming the earlier story instead of killing again. The
      note is the real outcome to assert here -- not an Undo, which on a lead
      whose kill this desk did not make puts the lead back to New and drops the
      reason it is checking.
    */
    for (let i = 0; i < 60; i++) {
      const [row] = await sql.query("select kill_reason from leads where id=$1", [id]);
      if (/DHA3 earlier story/.test(row.kill_reason ?? "")) break;
      await page.waitForTimeout(100);
    }
    assert.match(
      (await sql.query("select kill_reason from leads where id=$1", [id]))[0].kill_reason,
      /DHA3 earlier story/,
    );
    await page.getByRole("button", { name: /Not a duplicate.*move to New/ }).click();
    await page.getByRole("button", { name: "Move to New anyway", exact: true }).click();
    for (let i = 0; i < 60; i++) {
      if (
        (await sql.query("select possible_duplicate_of from leads where id=$1", [id]))[0]
          .possible_duplicate_of === null
      )
        break;
      await page.waitForTimeout(100);
    }
    assert.equal(
      (await sql.query("select possible_duplicate_of from leads where id=$1", [id]))[0]
        .possible_duplicate_of,
      null,
    );
  });
  await check("DHA4", async () => {
    const id = await lead("DHA4 unchosen story", { draft: true, body: "The council approved a $10 million budget on Tuesday." });
    await page.goto(base + `/desk/story/${id}`, { waitUntil: "networkidle" });
    await page.getByText("Story from lead · Section not chosen", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Publish in Council", exact: true }).count(),
      0,
    );
    await page.getByRole("button", { name: "No section chosen. Pick one, or publish in", exact: false }).click();
    await page
      .getByText("No section has been chosen for this story.", { exact: true })
      .first()
      .waitFor();
    assert.equal(await page.locator("#story-topic-select").inputValue(), "");
    await confirmSectionAndWaitForPublishable(page, { publishable: false });
    assert.notEqual(await page.locator("#story-topic-select").inputValue(), "");
    await page.getByRole("button", { name: /^Publish in / }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Publish in / }).waitFor();
    await page.getByRole("tab", { name: "Checks", exact: true }).click();
    await page.getByRole("button", { name: "I checked this story myself", exact: true }).click();
    for (let i = 0; i < 60; i++) {
      const [saved] = await sql.query("select notes_json from leads where id=$1", [id]);
      if (JSON.parse(saved.notes_json).uncheckedStoryConfirmation) break;
      await page.waitForTimeout(100);
    }
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Publish in / }).waitFor();
  });
  await check("DHA5", async () => {
    const id = await lead("DHA5 first writer");
    await job(id, "queued");
    await job(0, "running", "scan");
    await page.goto(base + "/desk/drafts", { waitUntil: "networkidle" });
    const row = page.locator(".drafts-row", { hasText: "DHA5 first writer" });
    await row.waitFor();
    assert.match(await row.innerText(), /Queued/);
    assert.match(await page.locator('[aria-label="Filter drafts"]').innerText(), /Running.*1/s);
    await sql.query("update desk_jobs set status='running' where subject_id=$1", [id]);
    await page.reload({ waitUntil: "networkidle" });
    assert.match(await row.innerText(), /Writing/);
    assert.match(await page.locator("body").innerText(), /Running.*2/s);
  });
  await check("DHA6", async () => {
    const id = await lead("DHA6 current story", { draft: true });
    await job(id, "failed");
    await job(id, "completed");
    const printed = await lead("DHA6 printed story", { draft: true });
    await sql.query("update leads set status='published' where id=$1", [printed]);
    await page.goto(base + "/desk/drafts", { waitUntil: "networkidle" });
    const before = await page.locator('[aria-label="Filter drafts"]').innerText();
    assert.match(before, /All.*1/s);
    assert.equal(await page.locator(".drafts-row", { hasText: "DHA6 printed story" }).count(), 0);
    /* TSA-2 (9b4af8d4): the control's name starts with its visible word --
       "Dark: switch to dark appearance" / "Light: switch to light appearance". */
    await page
      .getByRole("button", { name: /^(Dark|Light): switch to (dark|light) appearance$/ })
      .click();
    assert.equal(await page.locator('[aria-label="Filter drafts"]').innerText(), before);
    await page.goto(base + "/desk", { waitUntil: "networkidle" });
    const cards = page.locator(".in-progress .today-card", { hasText: "DHA6 current story" });
    assert.equal(await cards.count(), 1, "one current state per lead");
    assert.match(await cards.innerText(), /Ready to edit/);
  });
  assert.deepEqual(errors, []);
  await browser.close();
  await rm(dataRoot, { recursive: true, force: true });
  assert.deepEqual(failures, [], `Failed rows: ${failures.join(", ")}`);
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
