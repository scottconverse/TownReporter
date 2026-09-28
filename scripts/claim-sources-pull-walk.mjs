#!/usr/bin/env node
/**
 * A claim's source, on the editor's own line: the short host, one press to
 * pull that page into the box under the story, one press to write the claim
 * and its link into the reporting notes -- and the proof that the redraft
 * actually reads the line the editor added.
 *
 * Unit BQ2, 0.6.74. The Reporting tab used to render a claim followed by a
 * lone "·" on its own line and the full raw URL wrapped over four lines: no
 * site name, no way to pull that claim's source, and no way to put the claim
 * in the notes. And nothing proved the notes reached the draft at all.
 *
 * What this walk measures, in one run on a story the product itself built:
 *
 *   1. the claim's line carries the SHORT host (example.com, no www., no
 *      scheme) as the link's text, the full URL in its title, and no raw URL
 *      or loose separator anywhere on the line;
 *   2. "Pull source for: <claim>" reads THAT page through the app's own safe
 *      fetch and drops the excerpt into the box under the story -- the same
 *      box the Still-to-pull Pull fills;
 *   3. "Add to notes for: <claim>" writes exactly one line, the claim and its
 *      link, and a second press is refused (the button reads "In notes");
 *   4. the redraft request carries the lines the editor added -- the button's
 *      line AND a line typed into the "Add a reporting note" box that was
 *      already there, and the page the Pull boxed. The stub is told the exact
 *      text of each line (POST /__probe) and reports, PER CALL, which of them
 *      that call's prompt held. So "the redraft carried it" rests on a literal
 *      only that line can supply.
 *
 * 4 is the sensitivity control for itself. The same claim body is written twice
 * -- once before any of the three lines exists and once after -- and the walk
 * asserts no first-draft prompt carried any of them while the redraft's did.
 * Same fixture, same stub, one difference: whether the editor's lines were in
 * the notes when the writer was asked.
 *
 * Why the probe is a typed literal and not a marker inside the claim: the
 * stub's write answer quotes the claim, the desk files that as the claim, and
 * every later prompt carries the previous draft's words again -- so a marker
 * inside the claim text is in a redraft whether or not the notes reached it.
 * The three probes here exist only in the line the editor (or the pull) wrote.
 *
 * The claim is not seeded into the database. The stub's write answer carries
 * it (`FAKE_DEEPSEEK_CLAIM_FACT` / `FAKE_DEEPSEEK_CLAIM_URL`), the desk's own
 * research/write pipeline files it, and it appears under "Claims and sources"
 * the way a real claim does. Nothing here writes a row by hand.
 *
 * Two addresses are read and one is real: the claim cites https://example.com/
 * (IANA's static example page), and the Pull is the walk's one outbound GET.
 * It is the same page scripts/daily-scan-automatic-e2e.mjs fetches, and for
 * the same reason: the app's URL guard has no escape hatch, and a walk that
 * needed one would be measuring the guard, not the product. If a runner has no
 * egress the Pull step fails with that as its reason.
 *
 * No credential, no real model: LLM_BASE_URL and LLM_MODEL point the desk at
 * the stub (scripts/fakes/fake-deepseek-endpoint.mjs) on
 * 127.0.0.1:3531, TOWNREPORTER_CLAUDE_CODE=0 makes the unattended rungs
 * unreachable, and ANTHROPIC_API_KEY must be unset -- the walk refuses to run
 * with one set.
 *
 * The server under test is the built one, started by CI (`npm start`, port
 * 8080); CLAIM_BASE_URL names it.
 *
 *   CLAIM_BASE_URL=http://127.0.0.1:8080 node scripts/claim-sources-pull-walk.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup, fillPendingSetupCodeIfPresent } from "./first-run-setup-step.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The stub's own port; see scripts/integration-ports-are-unique.test.mjs. */
const PORT_FAKE_DEEPSEEK = 3531;
/** The default address of the server under test, when CLAIM_BASE_URL is unset. */
const PORT_CLAIM_WALK = 3530;

const FAKE_ORIGIN = `http://127.0.0.1:${PORT_FAKE_DEEPSEEK}`;
/** The rung's own base URL: probeOpenAi does GET {this}/models. */
const FAKE_V1 = `${FAKE_ORIGIN}/v1`;
const FAKE_MODEL = "deepseek-v4.1-flash:cloud";

const base = checkedUrl(
  process.env.CLAIM_BASE_URL || `http://127.0.0.1:${PORT_CLAIM_WALK}`,
).replace(/\/$/, "");

const stamp = Date.now();
const email = `claim-sources-${stamp}@townreporter.test`;
const password = "claim-sources-walk-pass";

const LEAD_HEADLINE = "Council takes up the annexation notice";
/**
 * The claim the stub's write answer carries, and the claim the editor then puts
 * in the notes. Its marker is the claim's identity here, NOT a control: the
 * desk files this claim from the stub's own answer and feeds it forward into
 * every later prompt, so its presence in a redraft proves nothing. See PROBES.
 */
const CLAIM_FACT = "Council packet NOTEPROOF_MARKER_0674 lists the annexation hearing date.";
/**
 * The line the editor types into the box that was already on the tab. Its own
 * marker, spelled so it does not contain the other one: each line's marker then
 * proves that line and nothing else.
 */
const BOX_LINE = "Call the clerk about DESKBOX_MARKER_0674 and the hearing notice.";
/** The marker inside that line, and the only place it exists. */
const BOX_MARKER = "DESKBOX_MARKER_0674";
/** The page the claim cites. The walk's one real GET: IANA's static example page. */
const CLAIM_URL = "https://example.com/";
/** What the link must read: the site name, no scheme, no www. */
const CLAIM_HOST = "example.com";
/** The line "Add to notes" writes, exactly as the route builds it. */
const NOTE_LINE = `${CLAIM_FACT} — ${CLAIM_URL}`;
/** The accessible name the Pull and Add-to-notes buttons carry. */
const NAMED = CLAIM_FACT.slice(0, 40).trim();
/** The label the fake writes into a draft body when echo mode is on. */
const TOKENS_LABEL = "Source labels the writer was shown:";
/**
 * What a pull writes into the box before the page it read, verbatim from
 * `appendPulledDocument`. It is the pull's own wording, so this literal can
 * only be in a prompt because the pull box reached it.
 */
const PULL_LINE = `Pulled for: ${CLAIM_FACT}`;
/**
 * The three exact lines the redraft's writer prompt has to carry, one per
 * channel: the pull box, the button, and the box that was already there.
 *
 * Each is a literal the stub looks for verbatim (POST /__probe), which is what
 * makes this measurement independent of the other two. A claim's own words are
 * no use as a marker here: the stub's write answer quotes the claim in its
 * body, the desk files that as the claim, and every later write prompt carries
 * it again -- so a marker inside the claim text is present in a redraft whether
 * or not the notes ever reached it. These three are not: they exist only in the
 * line the editor (or the pull) wrote.
 */
const PROBES = [PULL_LINE, NOTE_LINE, BOX_MARKER];

let page;
const done = [];
const facts = [];
const fakes = [];

function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

/** The labels the fake said the writer's prompt carried, on the LAST draft. */
function tokensLine(body) {
  const line = body.split("\n").find((row) => row.startsWith(TOKENS_LABEL));
  return line ?? "";
}

async function dump(err) {
  const message = err instanceof Error ? err.message : String(err);
  let url = "";
  let text = "";
  try {
    url = page?.url() ?? "";
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 2000);
  } catch {
    /* the page is already gone */
  }
  /*
    Which calls the stub answered, in order, with the labels each one's prompt
    held and which of the watched lines it carried -- the only way to tell "the
    writer's prompt carried the line" from "an earlier pass did", since every
    write reply names the same labels.
  */
  const requests = ((await fakeLog())?.requests ?? []).map((row) => ({
    class: row.class,
    status: row.status,
    tokens: row.tokens,
    probes: row.probes,
  }));
  killFakes();
  console.error(
    JSON.stringify({ ok: false, error: message, url, text, requests, completed: done }, null, 2),
  );
  process.exit(1);
}

function killFakes() {
  for (const child of fakes) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
}

/** Start the stub and wait for its own "listening on" line. */
function startFake(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(REPO, "scripts/fakes/fake-deepseek-endpoint.mjs")], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    fakes.push(child);
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
      const line = out.split("\n").find((text) => text.includes("listening on"));
      if (line) resolve(line.trim());
    });
    child.stderr.on("data", (chunk) => (out += String(chunk)));
    child.on("exit", (code) =>
      reject(new Error(`the fake exited with ${code} before it listened:\n${out.trim()}`)),
    );
    setTimeout(() => reject(new Error(`the fake never reported listening:\n${out.trim()}`)), 15_000);
  });
}

/** Poll a read-only check until it returns something truthy, or fail loudly. */
async function waitForTruth(describe, read, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  do {
    last = await read();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 500));
  } while (Date.now() < deadline);
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for ${describe}; last read ${JSON.stringify(last)}`,
  );
}

/** What the stub has answered, in order (path, class, mode, status -- no bodies). */
async function fakeLog() {
  try {
    const res = await fetch(`${FAKE_ORIGIN}/__log`, { signal: AbortSignal.timeout(2_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * Tell the stub which exact lines to look for, verbatim, in each prompt it
 * answers -- so the log can answer "did THIS call carry this line?" instead of
 * inferring it from a label some earlier pass could have copied forward.
 */
async function setProbes(probes) {
  const wanted = [...new Set(probes)];
  const res = await fetch(`${FAKE_ORIGIN}/__probe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ probes: wanted }),
    signal: AbortSignal.timeout(5_000),
  });
  must(res.ok, `the stub refused the probe list: HTTP ${res.status}`);
  const body = await res.json();
  must(
    body?.probes === wanted.length,
    `the stub kept ${body?.probes} of ${wanted.length} probes`,
  );
  return wanted.length;
}

/** Every write-class call the stub has answered, in order, with its probe hits. */
async function writeCalls() {
  const log = await fakeLog();
  return (log?.requests ?? []).filter((row) => row.class === "write");
}

/**
 * The state this walk cannot arrange for itself, checked loudly before
 * anything is started.
 */
async function preconditions() {
  const problems = [];
  let stranger = false;
  try {
    const res = await fetch(`${FAKE_V1}/models`, { signal: AbortSignal.timeout(2_000) });
    stranger = res.ok || res.status < 500;
  } catch {
    /* nothing there, which is what this walk needs */
  }
  if (stranger) {
    problems.push(
      `something is already answering on ${FAKE_V1}; this walk starts its own stub there and ` +
        `will not share the port.`,
    );
  }
  if (process.env.ANTHROPIC_API_KEY) {
    problems.push(
      "ANTHROPIC_API_KEY is set: a rung below the stub could answer the writing pass with a real " +
        "model, which is a call off this computer and a draft this walk did not choose.",
    );
  }
  let reachable = false;
  try {
    const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(5_000) });
    reachable = res.status < 500;
  } catch {
    /* reported below */
  }
  if (!reachable) {
    problems.push(
      `${base} did not answer. This walk reads a built server (npm start, built by npm run build); ` +
        `CI starts it and names it with CLAIM_BASE_URL.`,
    );
  }
  if (problems.length) throw new Error(`preconditions:\n  ${problems.join("\n  ")}`);
  /*
    The route builds the accessible name from the claim's first 40 characters,
    so the claim has to be longer than 40 for that slice to be a slice and not
    the whole claim -- a short fixture would make the assertion pass for the
    wrong reason.
  */
  must(
    CLAIM_FACT.length > 40 && NAMED === CLAIM_FACT.slice(0, 40),
    `the fixture's claim must be longer than 40 characters (it is ${CLAIM_FACT.length})`,
  );
}

async function ownTheDesk() {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("Claim Sources Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await fillPendingSetupCodeIfPresent(page);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("the first account owns the desk");
}

/** File a lead whose own source URL is the page the claim will cite. */
async function fileTheLead() {
  /*
    Filing a lead is a dialog in redesign phase 2a (unit BF3): the Queue's
    inline "<details> File a lead yourself" form is gone, and
    `/desk/queue#file-lead` opens the dialog that replaced it -- the same
    anchor the desk's other walks file through (scripts/lifecycle-e2e.mjs,
    scripts/delete-corrections-e2e.mjs). The fields and the "File lead" press
    keep their names, so this step still files the same lead.
  */
  await page.goto(`${base}/desk/queue#file-lead`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Headline").fill(LEAD_HEADLINE);
  await page.getByLabel("Why now").fill("A claim in the packet needs its own source read.");
  await page.getByLabel(/source|link|url/i).first().fill(CLAIM_URL);
  await page.getByRole("button", { name: "File lead" }).click();
  await page.getByLabel("Story", { exact: true }).waitFor({ timeout: 45_000 });
  step("filed a lead whose own source URL is the claim's");
}

/**
 * One draft, written by the stub, before the editor adds anything. Its answer
 * quotes the claim and names the labels the writer's prompt carried; the stub's
 * log says which of the watched lines each of those prompts held.
 */
async function theFirstDraftLands() {
  await page.getByRole("button", { name: "Draft with AI", exact: true }).click();
  const body = await waitForTruth(
    "the first draft to land",
    async () => {
      const value = await page
        .locator("textarea.astra-story-body")
        .inputValue()
        .catch(() => "");
      return value.includes(CLAIM_FACT) ? value : null;
    },
    180_000,
  );
  const line = tokensLine(body);
  must(line, `the stub's answer carries no "${TOKENS_LABEL}" line: ${JSON.stringify(body)}`);
  /*
    The control. Not one prompt the stub answered for this draft may carry any
    of the three lines: they do not exist yet, so a hit here would mean the
    redraft measurement proves nothing. Asked of the log, per call, because the
    draft is more than one write.
  */
  const before = await writeCalls();
  assert.ok(before.length >= 1, "the stub answered no write call for the first draft");
  for (const row of before) {
    assert.deepEqual(
      row.probes ?? [],
      [],
      `a first-draft prompt already carried an editor's line: ${JSON.stringify(row.probes)}`,
    );
  }
  facts.push({ firstDraftTokens: line, firstDraftWrites: before.length });
  step("the first draft lands, and no prompt behind it carried any editor's line");
  return body;
}

/** The claim, on the Reporting tab, with a source. */
async function theClaimRowReadsRight() {
  await page.locator("#inspector-tab-reporting").click();
  const row = page.locator(".claim-row").filter({ hasText: CLAIM_FACT }).first();
  await row.waitFor({ timeout: 45_000 });
  const shown = (await row.locator(".claim-t").innerText()).trim();
  assert.equal(shown, CLAIM_FACT, "the claim is the claim the desk filed");

  const link = row.locator("a").first();
  assert.equal(
    (await link.innerText()).trim(),
    CLAIM_HOST,
    "the link reads the site name, not the raw URL",
  );
  assert.equal(await link.getAttribute("title"), CLAIM_URL, "the full URL is in the title");
  assert.equal(await link.getAttribute("href"), CLAIM_URL, "and the link still opens the source");

  /*
    The bug the editor reported: a lone "·" on its own line, and the raw URL
    wrapped over four lines. Neither may be on the claim's own line any more.
  */
  const rowText = await row.innerText();
  assert.ok(!rowText.includes("·"), `a loose separator is still on the claim's line: ${rowText}`);
  assert.ok(
    !rowText.includes(CLAIM_URL),
    `the raw URL is still printed as text on the claim's line: ${rowText}`,
  );
  facts.push({ claimLine: rowText.replace(/\s+/g, " ").trim() });
  step(`the claim's line reads "${CLAIM_HOST}" and no raw URL is printed`);
  return row;
}

/** Pull THAT page, and watch the excerpt land in the box under the story. */
async function pullingTheSourceFillsTheBox(row) {
  const pull = row.getByRole("button", { name: `Pull source for: ${NAMED}` });
  await pull.waitFor({ timeout: 15_000 });
  await pull.click();
  const progress = row.locator(".pull-progress");
  await progress.waitFor({ timeout: 30_000 });
  await waitForTruth(
    "the pull of the claim's own page to finish",
    async () => {
      const text = await progress.innerText().catch(() => "");
      return /the source page is in the box under the story/.test(text) ? text : null;
    },
    180_000,
  );
  const box = await page.getByLabel("Pulled notes").inputValue();
  /*
    The box opens with the desk's own "Pulled for: <the claim>" line, which is
    also the literal the redraft measure watches: it is this pull's wording, so
    a prompt holding it can only have it from this box.
  */
  assert.ok(
    box.trimStart().startsWith(PULL_LINE),
    `the box does not open with the desk's pull line for this claim: ${JSON.stringify(box.slice(0, 200))}`,
  );
  assert.ok(
    box.includes(CLAIM_URL),
    `the pull finished but the box under the story does not name ${CLAIM_URL}: ${JSON.stringify(box)}`,
  );
  const afterUrl = box.slice(box.indexOf(CLAIM_URL) + CLAIM_URL.length).trim();
  assert.ok(
    afterUrl.length > 40,
    `the source page gave the box no excerpt, only its URL: ${JSON.stringify(box)}`,
  );
  facts.push({ pulledExcerptChars: afterUrl.length });
  step("Pull read the claim's own page and dropped the excerpt in the box");
  return box;
}

/** One line, the claim and its link, and a second press refused. */
async function addToNotesWritesOneLine(row) {
  const add = row.getByRole("button", { name: `Add to notes for: ${NAMED}` });
  await add.waitFor({ timeout: 15_000 });
  await add.click();
  const rows = page.locator(".todo-t", { hasText: NOTE_LINE });
  await waitForTruth(
    "the line to reach the reporting notes",
    async () => ((await rows.count()) > 0 ? true : null),
    60_000,
  );
  assert.equal(await rows.count(), 1, `the line is in the notes exactly once: ${NOTE_LINE}`);
  const shown = (await rows.first().innerText()).trim();
  assert.equal(shown, NOTE_LINE, "the line is the claim and its link, whole");
  /*
    The button's own words change to "In notes"; its aria-label stays the
    accessible name, so this reads the text rather than asking for a button by
    the new label -- which would find nothing.
  */
  await page.getByText("In notes", { exact: true }).waitFor({ timeout: 15_000 });
  assert.equal(await add.isDisabled(), true, "and the button refuses a second copy");
  assert.equal(await rows.count(), 1, "the notes still hold one copy");
  step("Add to notes wrote exactly one line, and a second press is refused");
}

/**
 * The box that was already there. A line typed into "Add a reporting note"
 * reaches the writer by the same code path as the button's, so the redraft
 * must carry all three lines -- and no first-draft prompt carried any.
 */
async function theExistingNoteBoxAlsoReachesTheRedraft() {
  await page.getByLabel("Add a reporting note").fill(BOX_LINE);
  await page.locator(".note-add").getByRole("button", { name: "Add", exact: true }).click();
  const row = page.locator(".todo-t", { hasText: BOX_LINE });
  await waitForTruth(
    "the typed line to reach the reporting notes",
    async () => ((await row.count()) > 0 ? true : null),
    60_000,
  );
  assert.equal(await row.count(), 1, `the typed line is in the notes once: ${BOX_LINE}`);
  assert.equal(
    (await row.first().innerText()).trim(),
    BOX_LINE,
    "the typed line is kept whole",
  );
  step("the existing Add a reporting note box wrote its own line");
}

/**
 * The redraft, and the three lines the editor added, in the writer's own
 * prompt — read from the stub's log, per call, not from a label the answer
 * names (every write answer names the same labels).
 */
async function theRedraftCarriesTheLines(body) {
  const baseline = (await writeCalls()).length;
  /*
    Unit BH2 decision 6 put the direction in front of the redraft: pressing
    Redraft on the story page opens RedraftDialog, and the dialog's own "Start
    redraft" is what starts the run -- the same two presses
    `scripts/delete-corrections-e2e.mjs` makes on this same button since BH8.
    The dialog arrives holding the direction already on the page, so the same
    draft is asked for and every measurement below is unchanged.

    The dialog's press is waited for with a bound, as BH8 bounded its own: a
    press that opens nothing used to leave this walk waiting on a 240 s timeout
    whose sentence named the wrong thing.
  */
  await page.getByRole("button", { name: "Redraft", exact: true }).click({ noWaitAfter: true });
  const startRedraft = page.getByRole("button", { name: "Start redraft", exact: true });
  const dialogOpened = await Promise.race([
    startRedraft.waitFor({ timeout: 30_000 }).then(() => true),
    new Promise((settle) => setTimeout(() => settle(false), 30_000)),
  ]);
  if (!dialogOpened)
    throw new Error('pressing "Redraft" did not open the redraft dialog within 30 s');
  await startRedraft.click({ noWaitAfter: true });
  const redrafted = await waitForTruth(
    "the redraft to carry the editor's lines",
    async () => {
      const value = await page
        .locator("textarea.astra-story-body")
        .inputValue()
        .catch(() => "");
      const line = tokensLine(value);
      /*
        The answer names the labels the writer's prompt held; the box's line is
        one of them, so the body only carries BOX_MARKER if the redraft's writer
        was shown it. The exact per-call check is below.
      */
      return line.includes(BOX_MARKER) ? { value, line } : null;
    },
    240_000,
  );
  assert.notEqual(
    redrafted.value,
    body,
    "the redraft wrote a new body, not the first draft left standing",
  );
  const writes = await writeCalls();
  assert.ok(
    writes.length > baseline,
    `the stub answered ${writes.length} write calls, ${baseline} before the redraft`,
  );
  const after = writes.slice(baseline);
  /*
    The measurement: one redraft prompt has to carry all three lines, verbatim.
    Each exists only in the line the editor (or the pull) wrote -- the claim's
    own words are no use, since the desk files the stub's claim and feeds it
    forward into every later prompt.
  */
  const carried = after.filter((row) =>
    PROBES.every((literal) => (row.probes ?? []).includes(literal)),
  );
  assert.ok(
    carried.length >= 1,
    `no redraft prompt carried all three lines the editor added; each call held ` +
      `${JSON.stringify(after.map((row) => row.probes ?? []))} of ${JSON.stringify(PROBES)}`,
  );
  for (const literal of PROBES) {
    assert.ok(
      carried.some((row) => (row.probes ?? []).includes(literal)),
      `no redraft prompt carried "${literal}"`,
    );
  }
  facts.push({
    redraftTokens: redrafted.line,
    writeCalls: writes.length,
    redraftWrites: after.length,
    carriedProbes: carried[0].probes,
  });
  step("the redraft's writer prompt carries the notes line, the box line and the pulled page");
}

async function main() {
  await preconditions();
  const fake = await startFake({
    FAKE_DEEPSEEK_PORT: String(PORT_FAKE_DEEPSEEK),
    FAKE_DEEPSEEK_MODEL: FAKE_MODEL,
    FAKE_DEEPSEEK_MODE: "ready",
    FAKE_DEEPSEEK_ECHO_EVIDENCE: "1",
    FAKE_DEEPSEEK_CLAIM_FACT: CLAIM_FACT,
    FAKE_DEEPSEEK_CLAIM_URL: CLAIM_URL,
  });
  console.log(`  fake  ${fake}`);
  /*
    Before the first prompt: the exact lines the log has to report per call.
    Without this the log's `probes` is empty and the control below passes for
    the wrong reason.
  */
  const watched = await setProbes(PROBES);
  console.log(`  probe ${watched} lines watched: ${JSON.stringify(PROBES)}`);

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`));
  try {
    await ownTheDesk();
    await fileTheLead();
    const firstBody = await theFirstDraftLands();
    const row = await theClaimRowReadsRight();
    await pullingTheSourceFillsTheBox(row);
    await addToNotesWritesOneLine(row);
    await theExistingNoteBoxAlsoReachesTheRedraft();
    await theRedraftCarriesTheLines(firstBody);
    assert.deepEqual(consoleErrors, [], "the desk reached all of this without a console error");
  } catch (err) {
    await dump(err);
  }
  await browser.close();
  killFakes();
  console.log(
    JSON.stringify(
      { ok: true, steps: done.length, facts, consoleErrors: consoleErrors.slice(0, 10) },
      null,
      2,
    ),
  );
  process.exit(0);
}

await main();
