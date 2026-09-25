#!/usr/bin/env node
/**
 * Browser acceptance for the real Story failure this repair answers (0.6.64,
 * Unit AB, on the desk a story's own documents are read on).
 *
 * WHAT WAS WRONG. An editor attached a scanned council packet longer than the
 * twelve pages one vision call may handle (OCR_BATCH_PAGE_LIMIT = 12,
 * src/lib/news/ocr-batches.ts:9), pressed **Redraft**, and the desk read twelve
 * pages, wrote `Read 12 of 13 pages; completed pages retained.` with a red
 * **Retry to continue**, and never rewrote the draft. Worse, that stop THREW,
 * so every document attached after the packet was never read at all -- the
 * editor's one press bought twelve pages and a crash-shaped message.
 *
 * WHAT THIS WALK PROVES, end to end, on the built server and the real desk UI:
 *
 *   1. The 13-page scanned packet and a second document are attached where the
 *      UI actually offers it, and ONE press reads BOTH -- no second press for
 *      the second batch of pages, none for the document after the packet.
 *   2. That one press produces exactly ONE job, whose stages walk the whole
 *      packet -- `Reading scanned-packet.pdf: page 1 of 13` through
 *      `... page 13 of 13` -- across the batch boundary (the continuation stage
 *      `... 12 of 13 pages read; continuing with the rest of this document`),
 *      and then reads the LATER document too.
 *   3. The draft it lands carries evidence that could only come from the pages
 *      that were read: the packet's own last-page line
 *      `FINAL PAGE DECISION: approve 731250 dollars` and the marker in the
 *      second document. The writer is only ever shown what the reading passes
 *      produced, and the fake invents nothing it was not given.
 *   4. Pressing **Redraft** on that saved story then runs ONE more job which
 *      rewrites the draft from the retained reading: it reads no page a second
 *      time (the fake is asked for pages 1..13 exactly once in the whole walk),
 *      it still drafts from BOTH sources, and it asks the editor for nothing --
 *      no red "Retry to continue", no partial-read notice.
 *   5. So reading a document longer than the twelve pages one vision call may
 *      handle (OCR_BATCH_PAGE_LIMIT = 12, src/lib/news/ocr-batches.ts:9) costs
 *      an editor one press, never N.
 *
 * WHY THE ATTACH HAPPENS ON THE WRITING PRESS. The desk offers no attach
 * control on a saved story: StoryDocumentUpload renders only on the Write and
 * Opinion pages (desk.index.tsx:553, desk.opinion.tsx:315) and the only server
 * path that puts a lead_id on an upload is the story-create commit
 * (model-request-commit.server.ts:730, linkStoryDocuments -- called nowhere
 * else; draftLead takes no document ids at all). The packet is therefore
 * attached in the writing press, and the Redraft press asserted here is the one
 * on the story the packet was attached to, with a draft already in place.
 *
 * HOW THE MODELS ARE FAKED. The fixture is a genuine scanned PDF -- 13 pages,
 * image-only `/DCTDecode` XObjects, no text layer (real pages from
 * scripts/make-scanned-packet-fixture.mjs) -- so the desk really renders each
 * page with unpdf + @napi-rs/canvas and really asks a vision model for its
 * text. ONE instance of scripts/fakes/fake-deepseek-endpoint.mjs answers every
 * call this walk needs, reached two ways: as the operator's configured gateway
 * (`LLM_BASE_URL` + `LLM_MODEL`, which Automatic resolves BEFORE its ladder
 * runs -- ai.ts:693) for the writing, research and document-notes passes, and
 * through that same base URL as the vision reader local discovery finds
 * (ocr.ts:171 `resolveVisionLocal`). With FAKE_DEEPSEEK_ECHO_EVIDENCE=1 it
 * answers the notes pass with the labels the supplied text actually carries
 * and repeats those labels in the write reply's body -- the chain this walk
 * asserts on.
 *
 * It has to be that ONE address, and it has to be the first one discovery
 * sees, because of what THIS machine really runs. A probe of the three
 * addresses `local-models.ts` walks when nothing is configured (1234, 11434,
 * 8080) found LM Studio on 1234 listing eight ids its own native endpoint types
 * `vlm` (qwen3-vl-30b-a3b-instruct among them) and Ollama on 11434 listing nine
 * cloud models whose `/api/show` reports `vision`. A walk that left
 * `LLM_BASE_URL` unset would therefore hand all thirteen pages of the packet to
 * a real model -- slowly, unrepeatably, and to a model no one chose here.
 * `discoverLocalModels` probes the configured base URL FIRST
 * (local-models.ts:340), so with `LLM_BASE_URL` naming this fake the fake is
 * the first catalog server and the only vision-capable one ahead of the real
 * ones (measured: catalog[0] = the fake, vision).
 *
 * The fake is addressed as `http://127.0.0.1:8080/v1`, not on a port of this
 * walk's own choosing: `inferKind` (local-models.ts:103) maps ONLY 1234, 11434
 * and 8080 to a local server kind, and a server of no known kind is never
 * vision-capable (local-models.ts:285-294) -- a fake on any other port could
 * serve the writing passes but could never read a page. 1234 and 11434 are the
 * real servers above; 8080 answers nothing on this machine (measured:
 * connection refused), which is why the walk refuses loudly if something DOES
 * answer there.
 *
 * OCR's unattended order is Codex, then Claude, then a discovered local vision
 * model (ocr.ts:213), so this walk points CODEX_CLI_PATH and CLAUDE_CLI_PATH at
 * files that do not exist and unsets ANTHROPIC_API_KEY: neither rung is ready,
 * and the discovered local reader is the only vision plan there is. Nothing is
 * reached, downloaded, or called off this computer, and no credential is needed
 * anywhere. The reader answers page N of 13 in call order, so the retained text
 * really is the whole packet.
 *
 *   REDRAFT_SCAN_BASE_URL=http://127.0.0.1:3339 \
 *   node scripts/redraft-scan-e2e.mjs
 *
 * The server under test must be BUILT (`npm run build`); this walk imports
 * `.output/server/index.mjs` itself and refuses to run if anything already
 * answers on the one address it will not share (8080).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { fromCrossJSON } from "seroval";
import { checkedUrl, checkedOutputPath } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** This walk's own listen port; see scripts/integration-ports-are-unique.test.mjs. */
const PORT_REDRAFT_SCAN = 3339;
/*
  8080, not a port this walk chose: `inferKind` (local-models.ts:103) maps only
  1234, 11434 and 8080 to a local server kind, and a server of no known kind can
  never be vision-capable (local-models.ts:285-294) -- a fake anywhere else
  could serve the writing passes but could never read a page. 1234 and 11434
  hold this machine's real LM Studio and Ollama; 8080 answers nothing here.
  Deliberately NOT declared as `PORT_...`: scripts/integration-ports-are-unique.test.mjs
  keys on `const (PORT\w*)\s*=\s*(\d{4,5})`.
*/
const VISION_READER_PORT = 8080;

/** The 13-page scanned fixture: image-only pages, no text layer at all. */
const PACKET_PAGES = 13;
const SCANNED_FIXTURE = join(ROOT, "src/lib/news/fixtures/story-documents/scanned-packet.pdf");

/*
  The id must LOOK vision-capable: an OpenAI-compatible server's models are
  typed by `LLAMACPP_VISION_RE` (local-models.ts:285) because that endpoint has
  no capability field to ask, and a model it does not match is listed with
  `vision: false` -- which `resolveVisionLocal` skips.
*/
const FAKE_MODEL = "qwen3-vl-fake:latest";
const FAKE_BASE = `http://127.0.0.1:${VISION_READER_PORT}/v1`;

/*
  The fake's control routes sit at its ROOT, not under `/v1`
  (`path === "/__log"`, fake-deepseek-endpoint.mjs:319) -- every other walk
  reads it the same way (story-quota-failover-e2e.mjs:337). Asking for
  `/v1/__log` would take the fake's 404 branch and be logged as an unserved
  request, which is also what the "nothing reached this fake" check looks for.
*/
const FAKE_CONTROL = `http://127.0.0.1:${VISION_READER_PORT}`;

/*
  One page of vision work holds its stage for at least as long as the desk's own
  poll (2000ms while a job is running, desk.story.$leadId.tsx:195), so every
  page's stage -- page 13's included -- is an observed fact and not a race.
*/
const OCR_PAGE_DELAY_MS = 2_500;
/** Writing-pass thinking time, so the reading stages are not the only slow part. */
const WRITE_DELAY_MS = 1_200;

const base = checkedUrl(
  process.env.REDRAFT_SCAN_BASE_URL || `http://127.0.0.1:${PORT_REDRAFT_SCAN}`,
).replace(/\/$/, "");
const SHOTS = checkedOutputPath(
  resolve(
    process.env.REDRAFT_SCAN_SHOT_DIR ||
      "../townreporter-deepseek-oversight/scratch/AB",
  ),
  [resolve(ROOT, "..")],
);

const stamp = Date.now();
const agendaMarker = `AGENDA_NOTES_MARKER_${stamp}`;
const email = `redraft-scan-${stamp}@townreporter.test`;
const password = "redraft-scan-e2e-pass";

const snapshots = [];
const completed = [];
const shots = [];
const fakes = [];
let page;

function step(text) {
  completed.push(text);
  console.log(`  ok    ${text}`);
}

function stopFakes() {
  for (const child of fakes) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
}

/** Start a fake and wait for its own "listening on" line, so nothing races the bind. */
function startFake(script, env) {
  return new Promise((resolveStart, reject) => {
    const child = spawn(process.execPath, [join(ROOT, script)], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    fakes.push(child);
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
      const line = out.split("\n").find((text) => text.includes("listening on"));
      if (line) resolveStart(line.trim());
    });
    child.stderr.on("data", (chunk) => (out += String(chunk)));
    child.on("exit", (code) =>
      reject(new Error(`${script} exited with ${code} before it listened:\n${out.trim()}`)),
    );
    setTimeout(() => reject(new Error(`${script} never reported listening:\n${out.trim()}`)), 15_000);
  });
}

async function readJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Whether anything at all answers this local discovery address. */
async function answersModels(url) {
  return (await readJson(`${url}/v1/models`)) !== null;
}

/**
 * The state this walk cannot arrange for itself, checked loudly -- the standing
 * rule here: a probe that found nothing is reported as what it probed, and a
 * server that DOES answer is a refusal, not a surprise later.
 *
 * The one address this walk needs for itself is 8080: the fake answers there
 * both as the configured gateway and as the discovered vision reader, so a
 * real llama.cpp on it would be read instead of the fake. The two addresses it
 * does NOT use -- 1234 (LM Studio) and 11434 (Ollama) -- are deliberately not
 * probed: with `LLM_BASE_URL` set, discovery sees the fake first and never
 * reaches them (local-models.ts:340), and refusing to run because the owner's
 * own models are up would make the walk unusable on the machine it must run on.
 */
async function preconditions() {
  const problems = [];
  if (await answersModels(`http://127.0.0.1:${VISION_READER_PORT}`)) {
    problems.push(
      `something is already listening on ${VISION_READER_PORT} and answering GET /v1/models; this ` +
        `walk starts its own fake there -- as both the configured gateway and the vision reader ` +
        `local discovery finds -- and will not share the port.`,
    );
  }
  if (process.env.ANTHROPIC_API_KEY) {
    problems.push(
      "ANTHROPIC_API_KEY is set: OCR's rung 2 would read the packet with a real model before the " +
        "local reader is reached.",
    );
  }
  if (process.env.TOWNREPORTER_LOCAL_DISCOVERY === "0") {
    problems.push(
      "TOWNREPORTER_LOCAL_DISCOVERY=0: the discovered vision reader is switched off, so OCR has no " +
        "plan left at all and nothing could read the packet.",
    );
  }
  if (problems.length) throw new Error(`preconditions:\n  ${problems.join("\n  ")}`);
}

/**
 * Boot the BUILT server in-process on PGlite, with the environment this walk
 * needs and nothing it does not: the fake as the saved gateway (Automatic
 * resolves a configured gateway BEFORE its ladder runs -- ai.ts:693), both OCR
 * CLI rungs made unreachable on purpose, and no DATABASE_URL, so the boot path
 * migrates a throwaway in-memory database and never touches a shared Postgres.
 */
async function bootTheServer() {
  process.env.PORT = String(PORT_REDRAFT_SCAN);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.BETTER_AUTH_SECRET ||= "redraft-scan-e2e-secret";
  process.env.LLM_BASE_URL = FAKE_BASE;
  process.env.LLM_MODEL = FAKE_MODEL;
  delete process.env.TOWNREPORTER_DEEPSEEK_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  // OCR's unattended order is Codex, then Claude, then a discovered local
  // vision model (ocr.ts:213). A CLI path that is not there makes both probes
  // answer "not ready" (ai-codex.server.ts:129-136, ai-claude-code.server.ts:115)
  // without running a real CLI or needing a subscription.
  process.env.CODEX_CLI_PATH = join(ROOT, "scripts/fakes/no-such-codex-cli.mjs");
  process.env.CLAUDE_CLI_PATH = join(ROOT, "scripts/fakes/no-such-claude-cli.mjs");
  await import(pathToFileURL(join(ROOT, ".output/server/index.mjs")).href);
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the built server never answered on ${base}`);
}

async function screenshot(name) {
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const file = join(SHOTS, name);
  await page.screenshot({ path: file, fullPage: false });
  shots.push(file);
  return file;
}

/** The stage text the desk itself shows: its "Draft progress" banner. */
const banner = () => page.locator(".story-running-banner");

/**
 * The document rows in the desk's own words live in the inspector's Sources tab
 * (desk.story.$leadId.tsx:1302-1309), which is `hidden` until that tab is
 * picked -- so the walk has to open it before any of the row text is on the
 * page at all. The list re-queries every 5s (story-documents.tsx:232), which is
 * why each caller also waits for the row it is about to assert.
 */
async function openSourcesTab() {
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  await page.locator("#inspector-sources:not([hidden])").waitFor({ timeout: 10_000 }).catch(() => {});
}

/** Wait (never throw) for a pattern to reach the page, so the assert can report it. */
async function waitForText(pattern, timeout = 30_000) {
  await page
    .waitForFunction((source) => new RegExp(source).test(document.body.innerText), pattern.source, {
      timeout,
    })
    .catch(() => {});
}

async function main() {
  await preconditions();

  /*
    The cap this walk has to cross, read from the product's own source rather
    than assumed here: if OCR_BATCH_PAGE_LIMIT ever grew past the fixture, one
    batch would finish the packet and the walk would silently stop testing the
    batch boundary at all.
  */
  const batchLimit = Number(
    /OCR_BATCH_PAGE_LIMIT\s*=\s*(\d+)/.exec(
      readFileSync(join(ROOT, "src/lib/news/ocr-batches.ts"), "utf8"),
    )?.[1] ?? 0,
  );
  assert.ok(batchLimit > 0, "could not read OCR_BATCH_PAGE_LIMIT out of src/lib/news/ocr-batches.ts");
  assert.ok(
    PACKET_PAGES > batchLimit,
    `the fixture is ${PACKET_PAGES} pages but one batch is ${batchLimit}, so this walk would not ` +
      `cross a batch boundary at all`,
  );

  // One fake, both roles: the saved gateway (Automatic resolves it before its
  // ladder) and the vision reader local discovery finds (same base URL).
  console.log(
    `  fake  ${await startFake("scripts/fakes/fake-deepseek-endpoint.mjs", {
      FAKE_DEEPSEEK_PORT: String(VISION_READER_PORT),
      FAKE_DEEPSEEK_MODEL: FAKE_MODEL,
      FAKE_DEEPSEEK_DELAY_MS: String(WRITE_DELAY_MS),
      FAKE_DEEPSEEK_OCR_DELAY_MS: String(OCR_PAGE_DELAY_MS),
      FAKE_DEEPSEEK_ECHO_EVIDENCE: "1",
      FAKE_DEEPSEEK_OCR_PAGES: String(PACKET_PAGES),
    })} (the configured gateway, and the vision reader local discovery finds)`,
  );
  assert.ok(
    await answersModels(FAKE_BASE),
    `the fake is not answering GET /v1/models on ${FAKE_BASE}, so neither the gateway rung nor ` +
      `the vision reader would resolve to it`,
  );

  await bootTheServer();

  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  // The wire the desk's own poll reads: every getLead response carries a
  // desk_jobs row with `stage` and `model_choice` as strings.
  page.on("response", async (response) => {
    try {
      if (!response.url().includes("_serverFn")) return;
      if (!(response.headers()["content-type"] || "").includes("application/json")) return;
      const decoded = fromCrossJSON(await response.json(), {});
      const job = decoded?.result?.job;
      if (job && typeof job.stage === "string" && typeof job.model_choice === "string") {
        snapshots.push({ at: Date.now(), job });
      }
    } catch {
      // Other server-function responses do not have the Story payload shape.
    }
  });

  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Name").fill("Redraft Scan Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor();
  await completeFirstRunSetup(page, base);
  await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
  step("created an isolated editor and opened Write a story");

  // ---- The press under test: the 13-page scan, plus a document AFTER it,
  // attached on the Write page because that is the only page a story's own
  // attach control exists on (see this file's header). ONE press, both sources.
  await page.getByLabel("Attach documents").setInputFiles([
    {
      name: "scanned-packet.pdf",
      mimeType: "application/pdf",
      buffer: readFileSync(SCANNED_FIXTURE),
    },
    {
      name: "agenda-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        `Agenda notes typed by the editor. Exact retained evidence: ${agendaMarker}.\n` +
          "Item 7 was pulled from the consent agenda and will be heard next month.",
      ),
    },
  ]);
  await page.getByText("scanned-packet.pdf", { exact: false }).waitFor();
  await page.getByText("agenda-notes.txt", { exact: false }).waitFor();
  await page
    .getByLabel("What story do you want?")
    .fill("Write a short news story from the attached documents and keep their exact evidence.");
  await page.getByText("Research & section", { exact: false }).click();
  await page.getByLabel("Drafting scope").selectOption("supplied");
  assert.equal(await page.getByLabel("Writing model").inputValue(), "auto");
  const beforeReadingPress = snapshots.length;
  await page.getByRole("button", { name: "Write draft", exact: true }).click();
  await page.getByRole("heading", { name: "Story workspace", exact: true }).waitFor();
  step("attached a 13-page scanned packet and a second document, then pressed once");

  // The desk's own progress, caught live: this is the reading stage for a page
  // of the packet, on the built server, in the browser.
  await banner().waitFor({ timeout: 120_000 }).catch(() => {});
  await page
    .waitForFunction(
      () => /Reading scanned-packet\.pdf: page \d+ of 13/.test(document.body.innerText),
      null,
      { timeout: 120_000 },
    )
    .catch(() => {});
  await banner().scrollIntoViewIfNeeded().catch(() => {});
  if (/Reading scanned-packet\.pdf: page \d+ of 13/.test(await banner().innerText().catch(() => ""))) {
    await screenshot("redraft-scan-progress-1280-light.png");
    step("the desk showed the packet being read, page by page, during the press");
  }

  const readDeadline = Date.now() + Number(process.env.REDRAFT_SCAN_DEADLINE_MS || 300_000);
  while (Date.now() < readDeadline) {
    const failed = snapshots
      .slice(beforeReadingPress)
      .findLast((entry) => entry.job.status === "failed");
    if (failed) throw new Error(`the reading press failed: ${JSON.stringify(failed.job)}`);
    const done = snapshots
      .slice(beforeReadingPress)
      .findLast((entry) => entry.job.status === "completed");
    if (done && (await page.getByRole("button", { name: "Redraft", exact: true }).count())) break;
    await page.waitForTimeout(500);
  }
  await page.getByRole("button", { name: "Redraft", exact: true }).waitFor({ timeout: 5_000 });
  const readPress = snapshots.slice(beforeReadingPress);
  const stages = readPress.map((entry) => entry.job.stage);
  const firstDraft = await page.getByLabel("Body").inputValue();
  await openSourcesTab();
  await waitForText(/Read all [\d,]+ characters in \d+ parts? across 13 pages\./);
  const deskAfterRead = await page.locator("body").innerText();
  step("the reading press finished, landing a draft from both attached sources");

  // ---- One press, one job, and that job read every page and both documents.
  const readJobs = [...new Set(readPress.map((entry) => entry.job.id).filter((id) => typeof id === "number"))];
  assert.equal(readJobs.length, 1, `one press should run ONE job, saw ${readJobs.length}: ${JSON.stringify(readJobs)}`);
  const reading = stages
    .map((stage) => /^Reading scanned-packet\.pdf: page (\d+) of (\d+)$/.exec(stage || ""))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  assert.ok(
    reading.length > 0,
    `the desk never showed the packet being read: ${JSON.stringify(stages)}`,
  );
  const maxPageSeen = Math.max(...reading);
  assert.equal(
    maxPageSeen,
    PACKET_PAGES,
    `the wire stopped at page ${maxPageSeen} of ${PACKET_PAGES}: ${JSON.stringify(stages)}`,
  );
  /*
    Pages 12 and 13 in ONE job is the batch boundary, proven by its outcome. The
    continuation stage the desk writes for it
    (`scanned-packet.pdf: 12 of 13 pages read; continuing with the rest of this
    document`, story-documents.server.ts:724) is emitted live and then replaced
    by the next page's own stage within milliseconds -- the desk's own poll is
    2s (desk.story.$leadId.tsx:195), so the walk cannot sample it reliably and
    does not try. The old code THREW here instead of continuing, so a single job
    that shows page 13 at all is exactly what the fix adds.
  */
  assert.ok(
    reading.includes(batchLimit),
    `the read never reached the ${batchLimit}-page batch boundary: ${JSON.stringify(stages)}`,
  );
  step(`one press ran one job, and its stages walked the packet to page ${maxPageSeen} of ${PACKET_PAGES}`);

  // The durable row, not just the transient stage: the packet finished whole.
  assert.match(
    deskAfterRead,
    /Read all [\d,]+ characters in \d+ parts? across 13 pages\./,
    "the packet's own row does not report a complete 13-page read",
  );
  // The desk renders the filename and its status on their own lines
  // (`<b>{d.filename}</b> · {d.status}`, story-documents.tsx:260), so the
  // separator is a line break, not a space -- matched with \s, not " ".
  assert.match(deskAfterRead, /scanned-packet\.pdf\s*·\s*read/, "the packet's row is not left read");
  assert.match(
    deskAfterRead,
    /agenda-notes\.txt\s*·\s*read/,
    "the document AFTER the packet was never read",
  );
  step("the packet's row reports all 13 pages read, and the later document was read too");

  // ---- Nothing in that press asked the editor to press anything again.
  assert.doesNotMatch(deskAfterRead, /Retry to continue/, "the desk still offers the red Retry to continue");
  assert.doesNotMatch(deskAfterRead, /only partly read|Read the rest/, "a partial-read notice was shown");
  assert.equal(readPress.filter((entry) => entry.job.status === "failed").length, 0);
  step("no red Retry to continue, no partial notice, and no failed job");

  // ---- The draft used both sources, and could only have got this from them.
  assert.match(
    firstDraft,
    /SCANNED PAGE 13 OF 13/,
    `the draft never saw the packet's last page: ${firstDraft}`,
  );
  assert.match(
    firstDraft,
    /FINAL PAGE DECISION: approve 731250 dollars/,
    "the draft is missing the packet's own final-page line",
  );
  assert.match(firstDraft, new RegExp(agendaMarker), "the draft is missing the later document's marker");
  step("the landed draft carries the packet's last page and the later document's evidence");

  // ---- Press 2, the press the owner's complaint is about: a draft already
  // exists and the packet is already retained, so ONE Redraft press must still
  // redraft from BOTH sources and must ask the editor for nothing.
  const beforeRedraftPress = snapshots.length;
  const trafficBeforeRedraft = await readJson(`${FAKE_CONTROL}/__log`);
  assert.ok(
    trafficBeforeRedraft,
    `the fake never answered GET ${FAKE_CONTROL}/__log before the Redraft press`,
  );
  await page.getByRole("button", { name: "Redraft", exact: true }).click();
  step("pressed Redraft once on the story the packet and second document are attached to");

  const redraftDeadline = Date.now() + Number(process.env.REDRAFT_SCAN_DEADLINE_MS || 300_000);
  while (Date.now() < redraftDeadline) {
    const failed = snapshots
      .slice(beforeRedraftPress)
      .findLast((entry) => entry.job.status === "failed");
    if (failed) throw new Error(`the Redraft press failed: ${JSON.stringify(failed.job)}`);
    const done = snapshots
      .slice(beforeRedraftPress)
      .findLast((entry) => entry.job.status === "completed");
    if (done) break;
    await page.waitForTimeout(500);
  }
  const redraft = snapshots.slice(beforeRedraftPress);
  const redraftStages = redraft.map((entry) => entry.job.stage);
  const body = await page.getByLabel("Body").inputValue();
  await openSourcesTab();
  await waitForText(/Read all [\d,]+ characters in \d+ parts? across 13 pages\./);
  const desk = await page.locator("body").innerText();
  step("the Redraft press finished and rewrote the draft");

  const redraftJobs = [
    ...new Set(redraft.map((entry) => entry.job.id).filter((id) => typeof id === "number")),
  ];
  assert.equal(
    redraftJobs.length,
    1,
    `the Redraft press should run ONE job, saw ${redraftJobs.length}: ${JSON.stringify(redraftJobs)}`,
  );
  assert.ok(
    !redraftJobs.some((id) => readJobs.includes(id)),
    "the Redraft press did not run a job of its own",
  );
  assert.equal(
    redraftStages.filter((stage) => /^Reading scanned-packet\.pdf: page \d+ of 13$/.test(stage || ""))
      .length,
    0,
    `the Redraft press made the desk read pages again: ${JSON.stringify(redraftStages)}`,
  );
  assert.equal(redraft.filter((entry) => entry.job.status === "failed").length, 0);
  step("one Redraft press ran one new job and read no page of the packet again");

  assert.match(body, /SCANNED PAGE 13 OF 13/, `the redraft never saw the packet's last page: ${body}`);
  assert.match(
    body,
    /FINAL PAGE DECISION: approve 731250 dollars/,
    "the redraft is missing the packet's own final-page line",
  );
  assert.match(body, new RegExp(agendaMarker), "the redraft is missing the later document's marker");
  assert.doesNotMatch(desk, /Retry to continue/, "the desk still offers the red Retry to continue");
  assert.doesNotMatch(desk, /only partly read|Read the rest/, "a partial-read notice was shown");
  step("the redrafted body carries both sources, with no red Retry and no partial notice");

  // ---- The wire: 13 pages really were read ONCE, and every pass really went
  // here. The fake answers both roles, so one log shows the whole walk: the
  // vision calls that read the packet AND the notes/write calls that used what
  // was read, before and after the Redraft press. A page reaching any other
  // model would not appear here at all.
  const traffic = await readJson(`${FAKE_CONTROL}/__log`);
  assert.ok(traffic, `the fake never answered GET ${FAKE_CONTROL}/__log`);
  const countOf = (log, klass) => log.requests.filter((entry) => entry.class === klass).length;
  const pagesRead = traffic.requests
    .filter((entry) => entry.class === "ocr")
    .map((entry) => entry.page);
  assert.deepEqual(
    pagesRead,
    Array.from({ length: PACKET_PAGES }, (_, i) => i + 1),
    `the fake was asked for something other than exactly pages 1..${PACKET_PAGES}, once each`,
  );
  assert.ok(
    countOf(traffic, "document") >= countOf(trafficBeforeRedraft, "document"),
    "a request disappeared from the fake's log during the Redraft press",
  );
  const notesCallsDuringRedraft = countOf(traffic, "document") - countOf(trafficBeforeRedraft, "document");
  assert.ok(
    countOf(traffic, "write") > countOf(trafficBeforeRedraft, "write"),
    "the Redraft press made no write call, so nothing was rewritten",
  );
  assert.equal(
    countOf(traffic, "ocr"),
    countOf(trafficBeforeRedraft, "ocr"),
    "the Redraft press re-read a page of the packet instead of using the retained text",
  );
  const classes = [...new Set(traffic.requests.map((entry) => entry.class))].sort();
  assert.ok(
    classes.includes("document"),
    `the desk never asked for document notes: ${JSON.stringify(classes)}`,
  );
  assert.ok(
    classes.includes("write"),
    `the desk never made a write call: ${JSON.stringify(classes)}`,
  );
  assert.ok(
    !classes.includes("other"),
    `something reached this fake that it does not serve: ${JSON.stringify(
      traffic.requests.filter((entry) => entry.class === "other"),
    )}`,
  );
  step(
    `the fake read exactly pages 1..${PACKET_PAGES} once (no page read again on the redraft), ` +
      `and the Redraft press added a write call and ${notesCallsDuringRedraft} notes call(s)`,
  );

  // ---- Screenshots, 1280 light and dark.
  await page.getByLabel("Body").scrollIntoViewIfNeeded().catch(() => {});
  await screenshot("redraft-scan-draft-1280-light.png");
  await page.getByRole("button", { name: "Switch to dark appearance" }).click();
  await page.waitForTimeout(400);
  await screenshot("redraft-scan-draft-1280-dark.png");
  await page.getByRole("button", { name: "Switch to light appearance" }).click();

  await browser.close();
  stopFakes();
  assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join(" | ")}`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        agendaMarker,
        packetPages: PACKET_PAGES,
        readingStages: reading,
        stages,
        redraftStages,
        notesCallsDuringRedraft,
        pagesReadFromTheFake: pagesRead,
        fakeCallClasses: classes,
        body: body.slice(0, 1_200),
        screenshots: shots,
        browserErrors,
        completed,
      },
      null,
      2,
    ),
  );
  // This walk boots the built server IN THIS PROCESS (bootTheServer), so its
  // listener keeps the loop alive; the sibling walk that boots the same way
  // leaves the same way (daily-scan-automatic-e2e.mjs:580). The failure path
  // below exits on its own (process.exit(1)); a pass has to say so too.
  process.exit(0);
}

main().catch(async (error) => {
  const text = await page
    ?.locator("body")
    .innerText()
    .catch(() => "");
  stopFakes();
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        body: text?.slice(0, 2_000),
        completed,
        shots,
        snapshots: snapshots.slice(-8).map((entry) => [entry.job.status, entry.job.stage]),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
