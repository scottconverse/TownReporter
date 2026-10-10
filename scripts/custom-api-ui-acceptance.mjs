import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { completeFirstRunSetup, fillPendingSetupCodeIfPresent } from "./first-run-setup-step.mjs";

// Disposable in-memory built-server check. Never point this at a real newsroom.
const base = process.env.CUSTOM_API_UI_BASE;
if (base !== "http://127.0.0.1:3468" || process.env.CUSTOM_API_UI_ISOLATED !== "1") {
  throw new Error("Requires explicitly isolated in-memory test server at port 3468.");
}
const providerRequests = [];
const serverFunctionBodies = [];
let rejectNextTest = false;
const fakeProvider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  providerRequests.push({
    method: request.method,
    url: request.url,
    authorization: request.headers.authorization ?? null,
    body,
  });
  response.setHeader("content-type", "application/json");
  if (request.url === "/v1/models" && request.method === "GET")
    return response.end(
      JSON.stringify({
        data: [
          { id: "synthetic-reporter" },
          { id: "synthetic-backup" },
          { id: "fixture-model-edited" },
        ],
      }),
    );
  if (request.url === "/v1/chat/completions" && request.method === "POST") {
    if (rejectNextTest) {
      rejectNextTest = false;
      response.statusCode = 401;
      return response.end(JSON.stringify({ error: { message: "synthetic rejected credential" } }));
    }
    const sent = JSON.parse(body);
    const prompt = (sent.messages ?? []).map((message) => message.content).join("\n");
    const marker = prompt.match(/CUSTOM_(?:OPINION_)?DOCUMENT_MARKER_[A-Z0-9_]+/)?.[0] ?? "";
    const content = /Reply with TOWNREPORTER_OK\./.test(prompt)
      ? "TOWNREPORTER_OK synthetic only"
      : /UNTRUSTED SOURCE TEXT:/.test(prompt)
        ? `The supplied document contains ${marker}.`
        : /Write the complete editorial now\./.test(prompt)
          ? [
              "The retained record deserves a public answer",
              "",
              `The supplied record contains the decisive evidence ${marker}. The public deserves a decision grounded in the record. This synthetic editorial is deliberately long enough to pass TownReporter's delivery gate while testing the real document path. It confirms that the attached text reached the selected custom connection, remained associated with this newsroom, and returned through the normal Opinion workflow. Editors still control the finished draft, its evidence review, and publication. The test provider supplies no outside facts and makes no claim beyond the retained fixture. That narrow boundary keeps this acceptance run deterministic while exercising the same upload, queue, worker, parsing, persistence, and workbench path used by an editor.`,
              "",
              "CLAIMS AND SOURCES",
              "",
              `Claim: The retained record contains ${marker}. Source: custom-opinion-source.txt, characters 1-200.`,
            ].join("\n")
        : /\bLead:\s/.test(prompt) && !/NEWS ANGLE:/.test(prompt)
          ? JSON.stringify({
              news: "The supplied document records the synthetic decision.",
              why_it_matters: "The editor asked for a retained-document routing proof.",
              angle: "Use the supplied document only.",
              form: "brief",
              questions: [],
              unknowns: [],
              follow: "",
              fetch_urls: [],
            })
          : JSON.stringify({
              headline: "Custom connection read the retained document",
              dek: "The built Story path preserved its source material.",
              body: `The custom provider received the extracted document evidence ${marker}.`,
              topic: "council",
              source_urls: [],
              integrity_notes: "",
              memory_entities: [],
              form: "brief",
              found: [],
              unanswered: [],
              claims: [],
              reporting_trail: [],
            });
    return response.end(
      JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    );
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "synthetic route not found" }));
});
await new Promise((resolve, reject) => {
  fakeProvider.once("error", reject);
  fakeProvider.listen(3471, "127.0.0.1", resolve);
});
/**
 * Unit BW3: the composer an editor reaches is the drawn `NewStoryDialog`, opened
 * by the desk header's "+ New story" press (desk.index.tsx:956-963). The old
 * composer was a `Link` named "+ New story" onto the `#story-composer` hash, a
 * path this desk no longer draws a way into. Handed back so every locator stays
 * scoped to the dialog (the desk is still behind the modal).
 */
async function openNewStoryDialog(tabLabel) {
  await page.getByRole("button", { name: /^\+ New story/ }).click();
  const dialog = page.getByRole("dialog", { name: "New story" });
  await dialog.waitFor({ timeout: 45_000 });
  const tab = dialog.getByRole("tab", { name: tabLabel, exact: true });
  await tab.click();
  await tab.waitFor({ timeout: 10_000 });
  return dialog;
}

/**
 * The door the drawn dialog leaves open, for the walk that pressed it.
 *
 * The old composer navigated the desk to the story the instant it filed one
 * (`desk.index.tsx:455`, `void navigate({to: "/desk/story/$leadId", ...})`), so
 * a walk could press and land on the workspace. The drawn New story dialog does
 * not navigate: it starts the job and says so in its own foot note -- "Watch it
 * under Running now; it lands in Drafts" (`editor-dialog-forms.ts:312`). The
 * desk's own drafts grid is that sentence's door: one card per recent story,
 * "View progress" while it writes and "Open draft" once it is done
 * (`desk.index.tsx:1205`) -- so this walks through on either, which matters
 * here because the fixture provider answers in well under a second.
 */
async function openTheStoryJustFiled() {
  // The modal covers the desk and holds focus, so nothing behind it can be
  // pressed until it is closed. Escape is the desk's own close (`dialog.tsx:125`).
  await page.keyboard.press("Escape");
  // A fresh desk load asks for its stories immediately; a desk left open polls
  // its idle jobs only every 30 s (`job-card-state.ts:30`).
  await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
  const door = page
    .getByRole("region", { name: "In progress" })
    .getByRole("link", { name: /^(View progress|Open draft)$/ })
    .first();
  await door.waitFor({ timeout: 45_000 });
  await door.click();
}

const browser = await chromium.launch({ headless: true });
const errors = [];
const rawLog = {
  ok: false,
  scope: "isolated built UI CRUD + fake-provider discovery/test",
  providerRequests,
};
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", async (response) => {
    if (!response.url().includes("_serverFn")) return;
    const body = await response.text().catch(() => "");
    if (body) serverFunctionBodies.push(body);
  });
  await page.goto(`${base}/login`);
  await page.getByLabel("Email", { exact: true }).fill("api-ui@townreporter.test");
  await page.getByLabel("Password", { exact: true }).fill("isolated-api-ui-only-2026");
  const create = page.getByRole("button", { name: "Create editor account", exact: true });
  if (await create.count()) {
    await page.getByLabel("Name", { exact: true }).fill("Isolated API UI");
    await page.getByLabel("Confirm password", { exact: true }).fill("isolated-api-ui-only-2026");
    await fillPendingSetupCodeIfPresent(page);
    await create.click();
  } else {
    await page.getByRole("button", { name: /Sign in/i }).click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await completeFirstRunSetup(page, base, {
    name: "Custom API Ledger",
    city: "Testerville",
    state: "Wyoming",
  });
  /*
    Unit CX: the Server page draws no connections panel any more -- both its
    doors lead to the Models screen, which owns the list. The form is that
    screen's "+ Add a connection" dialog, and the panel keeps the
    `#custom-ai-connections` anchor, so every locator below is unchanged.
  */
  await page.goto(`${base}/desk/models?tab=conn`);
  await page.getByRole("button", { name: "+ Add a connection" }).click();
  const section = page.locator("#custom-ai-connections");
  await section.getByLabel("Connection name", { exact: true }).waitFor();
  await section.getByLabel("Connection name", { exact: true }).fill("Isolated API fixture");
  await section.getByLabel("Base URL", { exact: true }).fill("http://127.0.0.1:3471/v1");
  await section.getByLabel(/^API key \(optional\)/).fill("fixture-secret-do-not-return");
  await section.getByLabel("Model id (optional)", { exact: true }).fill("fixture-model");
  await section.getByRole("button", { name: "Save connection", exact: true }).click();
  await section.getByRole("heading", { name: "Isolated API fixture", exact: true }).waitFor();
  assert.equal(providerRequests.length, 0, "saving must send zero provider requests");
  assert(!(await section.innerText()).includes("fixture-secret-do-not-return"));
  const row = section.locator("article").filter({ hasText: "Isolated API fixture" });
  await row.getByRole("button", { name: "Discover models", exact: true }).click();
  const discoveredModels = section.locator("select");
  await discoveredModels.waitFor();
  await discoveredModels.selectOption("synthetic-reporter");
  await section.getByRole("button", { name: "Save changes", exact: true }).click();
  await row.getByText(/synthetic-reporter/).waitFor();
  assert.equal(providerRequests.length, 1);
  assert.deepEqual(
    { method: providerRequests[0].method, url: providerRequests[0].url },
    { method: "GET", url: "/v1/models" },
  );

  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "Test connection", exact: true }).click();
  await section.getByText(/Success: Connection succeeded/).waitFor();
  await section.getByText(/responses: not tested; model discovery: not tested/i).waitFor();
  assert.equal(providerRequests.length, 2);
  const sent = JSON.parse(providerRequests[1].body);
  assert.equal(sent.model, "synthetic-reporter");
  assert.equal(sent.messages[0].content, "Reply with TOWNREPORTER_OK.");
  assert.equal(providerRequests[1].authorization, "Bearer fixture-secret-do-not-return");

  rejectNextTest = true;
  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "Test connection", exact: true }).click();
  await section.getByText(/Test failed: The server rejected the credentials/).waitFor();
  assert.equal(providerRequests.length, 3);
  await row.getByRole("button", { name: "Disable", exact: true }).click();
  await row.getByRole("button", { name: "Enable", exact: true }).waitFor();
  await row.getByRole("button", { name: "Enable", exact: true }).click();
  await row.getByRole("button", { name: "Disable", exact: true }).waitFor();
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  assert.equal(await section.getByLabel(/^API key \(optional\)/).inputValue(), "");
  await section.getByLabel("Model id (optional)", { exact: true }).fill("fixture-model-edited");
  await section.getByRole("button", { name: "Save changes", exact: true }).click();
  await row.getByText(/fixture-model-edited/).waitFor();
  assert.equal(providerRequests.length, 3, "editing must send zero provider requests");

  const documentMarker = `CUSTOM_DOCUMENT_MARKER_${Date.now()}`;
  await page.goto(`${base}/desk`, { waitUntil: "networkidle" });
  /*
    Unit BW3: the composer an editor reaches is the drawn New story dialog
    (src/components/dialogs/editor-dialogs.tsx), opened by the desk header's own
    "+ New story" press. Tab (a) -- "AI drafts from material" -- carries the drop
    zone, the Assignment box, the scope row and the model row. That row merges
    the newsroom's saved connections the same way the desk's own picker does
    (`model-picker.tsx:299-311`), which is the whole point of this leg: the
    editor pins "Isolated API fixture" and the fixture provider has to receive
    the document text.
  */
  const dialog = await openNewStoryDialog("AI drafts from material");
  await dialog.getByLabel("Choose files").setInputFiles({
    name: "custom-story-source.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(`Retained custom provider evidence: ${documentMarker}.`),
  });
  await dialog.getByText("Document ready. The drafter reads it.").waitFor({ timeout: 45_000 });
  await dialog.getByLabel("Assignment").fill("Write a brief from the attached source.");
  await dialog.getByLabel("Research scope").selectOption("supplied");
  /*
    The saved connection reaches the drawn row through a query, and this page
    load started fresh, so the row is waited for by the option the editor has to
    be able to pick. Scoped to the modal layer, which is where Radix portals the
    dialog (dialog.tsx:147) -- the desk behind it draws its own pickers.
  */
  const storyPicker = dialog.getByLabel("Model", { exact: true });
  await storyPicker.locator("option", { hasText: "Isolated API fixture" }).waitFor({ state: "attached", timeout: 30_000 });
  const storyCustomChoice = await storyPicker
    .locator("option", { hasText: "Isolated API fixture" })
    .getAttribute("value");
  assert.match(storyCustomChoice ?? "", /^custom:/);
  await storyPicker.selectOption(storyCustomChoice);
  await dialog.getByRole("button", { name: "Start drafting", exact: true }).click();
  await openTheStoryJustFiled();
  await page.getByRole("heading", { name: "Story workspace", exact: true }).waitFor();
  await page.getByRole("button", { name: "Redraft", exact: true }).waitFor({ timeout: 45_000 });
  assert.match(await page.getByLabel("Story", { exact: true }).inputValue(), new RegExp(documentMarker));
  assert(
    providerRequests.some(
      (request) =>
        request.url === "/v1/chat/completions" && request.body.includes(documentMarker),
    ),
    "the pinned custom provider never received the extracted document content",
  );
  assert.equal(
    serverFunctionBodies.some((body) => body.includes("fixture-secret-do-not-return")),
    false,
    "a Story server-function response exposed the saved API key",
  );

  const opinionMarker = `CUSTOM_OPINION_DOCUMENT_MARKER_${Date.now()}`;
  await page.goto(`${base}/desk/opinion`, { waitUntil: "networkidle" });
  // CY item 8: the AI intake is a shut card now, as the drawing draws it, so
  // the uploader inside it exists only after the card is opened. The rest of
  // this block is unchanged.
  await page.getByRole("button", { name: /Have the AI write an editorial/ }).click();
  await page.getByLabel("Attach documents").setInputFiles({
    name: "custom-opinion-source.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(`Retained editorial evidence: ${opinionMarker}.`),
  });
  await page.getByText("Documents saved. Ready to draft when you are.").waitFor();
  await page
    .getByLabel("Subject, source text, or links")
    .fill("Write an editorial from the attached retained record.");
  const opinionPicker = page.getByLabel("Writing model");
  const opinionCustomChoice = await opinionPicker
    .locator("option", { hasText: "Isolated API fixture" })
    .getAttribute("value");
  assert.equal(opinionCustomChoice, storyCustomChoice);
  await opinionPicker.selectOption(opinionCustomChoice);
  await page.getByRole("button", { name: "Write an editorial", exact: true }).click();
  const opinionRow = page.locator("li", { hasText: "The retained record deserves a public answer" });
  await opinionRow.getByRole("button", { name: "Read it", exact: true }).waitFor({ timeout: 45_000 });
  await opinionRow.getByRole("button", { name: "Read it", exact: true }).click();
  await page.getByText(opinionMarker, { exact: false }).waitFor();
  assert(
    providerRequests.some(
      (request) =>
        request.url === "/v1/chat/completions" && request.body.includes(opinionMarker),
    ),
    "the pinned custom provider never received the editorial document content",
  );
  assert.equal(
    serverFunctionBodies.some((body) => body.includes("fixture-secret-do-not-return")),
    false,
    "an Opinion server-function response exposed the saved API key",
  );

  await page.goto(`${base}/desk/ops/daily-scan`);
  // 0.6.81 (unit CX2): the Daily scan card's panel lives on the card's own
  // screen now, so it is reached by going there, not by scrolling the page.
  await page.getByRole("heading", { name: "Daily scan", exact: true }).first().scrollIntoViewIfNeeded();
  const dailyPanel = page.locator("section", {
    has: page.getByRole("heading", { name: "Daily scan", exact: true }),
  });
  const dailyPicker = dailyPanel.getByLabel("Writing model");
  const dailyCustomChoice = await dailyPicker
    .locator("option", { hasText: "Isolated API fixture" })
    .getAttribute("value");
  assert.equal(dailyCustomChoice, storyCustomChoice);
  await dailyPicker.selectOption(dailyCustomChoice);
  await dailyPanel.getByLabel(/^Read every day/).fill("0");
  await dailyPanel.getByRole("button", { name: "Save daily scan", exact: true }).click();
  await dailyPanel.getByText("Daily scan settings saved.").waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Daily scan", exact: true }).first().scrollIntoViewIfNeeded();
  const savedDailyPanel = page.locator("section", {
    has: page.getByRole("heading", { name: "Daily scan", exact: true }),
  });
  assert.equal(await savedDailyPanel.getByLabel("Writing model").inputValue(), dailyCustomChoice);
  assert.equal(
    serverFunctionBodies.some((body) => body.includes("fixture-secret-do-not-return")),
    false,
    "a Daily scan settings response exposed the saved API key",
  );

  const beforeBatchRequests = providerRequests.length;

  const batchHeadline = `Custom API batch selection ${Date.now()}`;
  // Filing a lead by hand is the Queue's own "File a lead" dialog now: the
  // redesign moved it off the inline `details.file-form` accordion, and the
  // #file-lead anchor is how the desk's other walks open it too.
  await page.goto(`${base}/desk/queue#file-lead`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Headline").fill(batchHeadline);
  await page.getByLabel("Why now").fill("Proves the saved custom connection reaches Batch enqueue.");
  await page.getByRole("button", { name: "File lead" }).click();
  await page.waitForFunction(() => /^\/desk\/story\/\d+$/.test(location.pathname), undefined, {
    timeout: 45_000,
  });
  await page.goto(`${base}/desk/queue`);
  await page
    .getByRole("checkbox", { name: `Select ${batchHeadline} for deletion`, exact: true })
    .check();
  // One selection mechanism now: the drawn bulk strip above the table, which is
  // also what Hold, Kill and Delete act on. Its press copies the selection into
  // the dialog that holds the writing model, and the queueing happens there.
  await page
    .getByRole("region", { name: "Bulk actions for the leads shown" })
    .getByRole("button", { name: "Start 1 story from the selected leads", exact: true })
    .click();
  const batch = page.getByRole("dialog", { name: "Draft the selected leads" });
  await batch.locator("#draft-batch").waitFor({ timeout: 45_000 });
  const batchPicker = batch.getByLabel("Writing model");
  const batchNames = (await batchPicker.locator("option").allInnerTexts()).map((line) =>
    line.split("—")[0].trim(),
  );
  assert.deepEqual(batchNames, [
    "Automatic",
    "Codex Astra",
    "Codex Sol 6.1",
    "Codex Sol 6.1 (balanced)",
    "Codex Luna",
    "Claude Fable",
    "Claude Opus",
    "Claude Sonnet",
    "Claude Haiku",
    "Local model",
    "Isolated API fixture",
  ]);
  const customOption = batchPicker.locator("option", { hasText: "Isolated API fixture" });
  const customChoice = await customOption.getAttribute("value");
  assert.match(customChoice ?? "", /^custom:/);
  await batchPicker.selectOption(customChoice);
  await batch.getByRole("button", { name: "Start 1 story", exact: true }).click();
  await batch.getByText("Draft batch started with Isolated API fixture: fixture-model-edited.").waitFor();
  await batch.getByText(/Batch #\d+ · Isolated API fixture: fixture-model-edited/).waitFor();
  assert(
    providerRequests.slice(beforeBatchRequests).some((request) => request.url === "/v1/models"),
    "Batch preflight did not probe the selected custom connection",
  );
  assert.equal(
    serverFunctionBodies.some((body) => body.includes("fixture-secret-do-not-return")),
    false,
    "a Batch server-function response exposed the saved API key",
  );
  assert.equal((await page.locator("body").innerText()).includes("fixture-secret-do-not-return"), false);
  /*
    The saved row is read back the way the first pass saved it: the Models
    screen's dialog, opened with the header button. The panel moved off Server
    settings in unit CX, and `#custom-ai-connections` moved with it, so this
    second look is the same locator on the same component -- only the way in
    changed.
  */
  await page.goto(`${base}/desk/models?tab=conn`);
  await page.getByRole("button", { name: "+ Add a connection" }).click();
  const finalSection = page.locator("#custom-ai-connections");
  const finalRow = finalSection.locator("article").filter({ hasText: "Isolated API fixture" });
  await finalRow.getByRole("heading", { name: "Isolated API fixture", exact: true }).waitFor();
  await mkdir("artifacts/custom-api-ui", { recursive: true });
  await finalSection.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/custom-api-ui/desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await finalSection.scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  await page.screenshot({ path: "artifacts/custom-api-ui/mobile.png" });
  page.once("dialog", (dialog) => dialog.accept());
  await finalRow.getByRole("button", { name: "Delete", exact: true }).click();
  await finalSection.getByText("No custom connections saved.", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  Object.assign(rawLog, {
    ok: true,
    saveWithoutRequest: true,
    discovery: true,
    syntheticTestSuccess: true,
    clearCredentialError: true,
    editWithoutRequest: true,
    disableEnable: true,
    delete: true,
    secretNotReturned: true,
    batchCustomSelectionAndEnqueue: true,
    customStoryReadAttachedDocument: true,
    customOpinionReadAttachedDocument: true,
    customDailyScanSelectionPersists: true,
    mobileOverflow: false,
    pageErrors: errors,
    providerRequestCount: providerRequests.length,
  });
  console.log(JSON.stringify(rawLog));
} catch (error) {
  Object.assign(rawLog, {
    error: error instanceof Error ? error.stack : String(error),
    pageErrors: errors,
    currentUrl: page?.url(),
    visibleText: await page?.locator("body").innerText().catch(() => ""),
    serverFunctionBodies: serverFunctionBodies.slice(-10),
  });
  console.error(JSON.stringify(rawLog));
  throw error;
} finally {
  await mkdir("artifacts/custom-api-ui", { recursive: true });
  await writeFile(
    "artifacts/custom-api-ui/raw-acceptance-log.json",
    JSON.stringify(rawLog, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => fakeProvider.close(resolve));
}
