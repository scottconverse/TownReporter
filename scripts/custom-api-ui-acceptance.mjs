import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

// Disposable in-memory built-server check. Never point this at a real newsroom.
const base = process.env.CUSTOM_API_UI_BASE;
if (base !== "http://127.0.0.1:3468" || process.env.CUSTOM_API_UI_ISOLATED !== "1") {
  throw new Error("Requires explicitly isolated in-memory test server at port 3468.");
}
const providerRequests = [];
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
      JSON.stringify({ data: [{ id: "synthetic-reporter" }, { id: "synthetic-backup" }] }),
    );
  if (request.url === "/v1/chat/completions" && request.method === "POST") {
    if (rejectNextTest) {
      response.statusCode = 401;
      return response.end(JSON.stringify({ error: { message: "synthetic rejected credential" } }));
    }
    return response.end(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "TOWNREPORTER_OK synthetic only" } }],
      }),
    );
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "synthetic route not found" }));
});
await new Promise((resolve, reject) => {
  fakeProvider.once("error", reject);
  fakeProvider.listen(3471, "127.0.0.1", resolve);
});
const browser = await chromium.launch({ headless: true });
const errors = [];
const rawLog = {
  ok: false,
  scope: "isolated built UI CRUD + fake-provider discovery/test",
  providerRequests,
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/login`);
  await page.getByLabel("Email", { exact: true }).fill("api-ui@townreporter.test");
  await page.getByLabel("Password", { exact: true }).fill("isolated-api-ui-only-2026");
  const create = page.getByRole("button", { name: "Create editor account", exact: true });
  if (await create.count()) {
    await page.getByLabel("Name", { exact: true }).fill("Isolated API UI");
    await page.getByLabel("Confirm password", { exact: true }).fill("isolated-api-ui-only-2026");
    await create.click();
  } else {
    await page.getByRole("button", { name: /Sign in/i }).click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.goto(`${base}/desk/ops#custom-ai-connections`);
  const section = page.locator("#custom-ai-connections");
  await section.getByRole("heading", { name: "Add your own AI API" }).waitFor();
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
  await mkdir("artifacts/custom-api-ui", { recursive: true });
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/custom-api-ui/desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await section.scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  await page.screenshot({ path: "artifacts/custom-api-ui/mobile.png" });
  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await section.getByText("No custom connections saved.", { exact: true }).waitFor();
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
    mobileOverflow: false,
    pageErrors: errors,
    providerRequestCount: providerRequests.length,
  });
  console.log(JSON.stringify(rawLog));
} catch (error) {
  Object.assign(rawLog, {
    error: error instanceof Error ? error.stack : String(error),
    pageErrors: errors,
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
