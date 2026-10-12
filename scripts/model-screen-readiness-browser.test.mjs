// guards: the Models screen must show the same measured connection state the Server screen uses.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";
import { chromium } from "playwright";
import { screenModuleUrl } from "./screen-render-harness.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { moduleUrl, stubUrl } from "./dom-harness.mjs";

const opsRowsUrl = await moduleUrl("src/lib/desk/ops-rows.ts", {
  "../paper.ts": stubUrl("export const formatClockTime=()=>\"noon\";"),
  "../news/trash-store.ts": stubUrl("export const TRASH_DAYS=30;"),
  "../ops/health.ts": stubUrl("export const formatAgo=()=>\"just now\";"),
  "./daily-scan-counts.ts": stubUrl("export const dailyScanCounts=()=>({});"),
});
const { writingModelLines } = await import(opsRowsUrl);
const chipUrl = await moduleUrl("src/components/status-chip.tsx");
const { Chip } = await import(chipUrl);
const darkRunCopyUrl = await moduleUrl("src/lib/news/dark-run-copy.ts");
const { darkRunStopCopy } = await import(darkRunCopyUrl);

const route = await screenModuleUrl(
  "src/routes/desk.models.tsx",
  {
    createFileRoute: `()=>options=>({...options,useSearch:()=>({tab:globalThis.modelsTab??"conn"})})`,
    useQuery: `({queryKey})=>({data:globalThis.modelsData[queryKey[0]],isPending:false,isError:false,isSuccess:globalThis.modelsData[queryKey[0]]!==undefined,refetch:async()=>{}})`,
    useMutation: `({mutationFn,onSuccess,onError})=>{const [pending,setPending]=globalThis.__modelsReact.useState(false);const [variables,setVariables]=globalThis.__modelsReact.useState(undefined);const mutate=async(value)=>{setPending(true);setVariables(value);try{const result=await mutationFn?.(value);await onSuccess?.(result,value);return result}catch(error){await onError?.(error,value);return undefined}finally{setPending(false)}};return {mutate,isPending:pending,variables,data:undefined}}`,
    useQueryClient: `()=>({invalidateQueries:async()=>{},setQueryData:()=>{}})`,
    DeskShell: `({children})=>h("main",{},children)`,
    InkButton: `({children,tone,...props})=>h("button",props,children)`,
    Dialog: `({open,children})=>open?h("div",{role:"dialog"},children):null`,
    ListSkeleton: `()=>h("p",{},"Loading")`,
    CustomAiConnectionsPanel: `()=>null`,
    LocalModelsOnThisComputer: `()=>null`,
    ProviderStatusCard: `({status,chip,children})=>h("section",{role:"group","aria-label":status.name},h("h3",{},status.name),chip,children)`,
    ModelPicker: `()=>null`,
    Chip: `({label,tone,help})=>h("span",{title:help,"data-tone":tone},label)`,
    jobEffortOptions: `()=>[]`,
    refreshLocalModelCatalog: `async()=>globalThis.modelsData["local-model-catalog"]`,
    testCustomAiConnectionFn: `async()=>{await new Promise(resolve=>setTimeout(resolve,350));return globalThis.modelsTestResult}`,
  },
  [
    "@/lib/news/provider-registry",
    "@/lib/news/desk-local-model",
    "@/lib/news/model-readiness",
  ],
);

const fixture = `import * as React from ${JSON.stringify(import.meta.resolve("react"))};
  import {createRoot} from ${JSON.stringify(import.meta.resolve("react-dom/client"))};
  import {Route} from ${JSON.stringify(route)};
  globalThis.__modelsReact=React;
  globalThis.modelsData={};
  const root=createRoot(document.getElementById("root"));
  globalThis.renderModels=()=>root.render(React.createElement(Route.component));
  globalThis.setModelsFixture=(data,tab="conn",testResult={ok:false,latencyMs:1888,message:"The server replied, but did not return assistant text."})=>{globalThis.modelsData=data;globalThis.modelsTab=tab;globalThis.modelsTestResult=testResult;globalThis.renderModels()};
  globalThis.renderModels();`;

const bundle = await rolldown({
  input: "fixture",
  plugins: [{
    name: "models-screen-browser-fixture",
    resolveId(id) {
      if (id === "fixture" || id.startsWith("data:")) return id;
      if (id.startsWith("file:")) return fileURLToPath(id);
    },
    load(id) {
      if (id === "fixture") return fixture;
      if (id.startsWith("data:")) return Buffer.from(id.split(",")[1], "base64").toString();
    },
  }],
  transform: { define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.env": "{}" } },
});
const { output } = await bundle.generate({ format: "iife" });
const browser = await chromium.launch({ channel: "msedge", headless: true });
test.after(async () => {
  await browser.close();
  await bundle.close();
});

const lmStudio = {
  kind: "lmstudio",
  baseUrl: "http://127.0.0.1:1234/v1",
  reachable: true,
  models: [{ id: "local-writer", label: "Local writer", kind: "chat", loaded: false, cloud: false, thinking: false, vision: false, contextLength: null }],
};
const ollama = {
  kind: "ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  reachable: true,
  models: [{ id: "deepseek-v4.1-flash:cloud", label: "deepseek-v4.1-flash:cloud", kind: "chat", loaded: false, cloud: true, thinking: false, vision: false, contextLength: null }],
};
const connection = {
  id: "gemini-connection",
  name: "Gemini test connection",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  hasApiKey: true,
  enabled: true,
  modelId: "gemini-2.5-flash",
};
const codex = {
  provider: "codex", name: "Codex", installed: false, path: null, signedIn: false,
  account: null, disabledByOperator: false, detail: "Codex was not found on this machine.",
  lastChecked: "2026-10-11T00:00:00.000Z", lastTest: null, login: null,
};
const baseData = () => ({
  "my-desk": { role: "owner" },
  "custom-ai-connections": [connection],
  "provider-statuses": [codex],
  "local-model-catalog": { servers: [lmStudio, ollama], defaultModel: null, checkedAt: 0 },
  "local-model-choice": { override: null, catalog: { servers: [lmStudio, ollama], defaultModel: null, checkedAt: 0 } },
  "provider-availability": Object.assign({ "local-model": true, "gemini-flash": true }, { reasons: {} }),
});

test("B07: the Server writing-model chip uses the same unloaded local-server state", async () => {
  const localTime = {
    providerId: "qwen-local", label: "Local model", detail: "", kind: "local",
    callSeconds: 600, defaultCallSeconds: 600, overridden: false, enabled: true,
    availableOnThisMachine: true, endpoint: lmStudio.baseUrl, endpointWatched: true,
    switchedOffByOperator: false,
  };
  const availability = Object.assign({ "local-model": true }, { reasons: {} });
  const line = writingModelLines({
    times: [localTime], statuses: [], catalog: { servers: [lmStudio], defaultModel: null, checkedAt: 0 }, availability,
  }).find((row) => row.name === "Local model");
  assert.ok(line?.chip && line.chip.source === "words");
  assert.equal(line.chip.tone, "slow");
  const html = renderToStaticMarkup(createElement(Chip, line.chip));
  const page = await browser.newPage({ viewport: { width: 1440, height: 500 } });
  try {
    await page.setContent(html);
    const status = page.getByText("No model loaded", { exact: true });
    await status.waitFor();
    assert.match((await status.locator("..").getAttribute("title")) ?? "", /server answers.*no on-device chat model is loaded/i);
  } finally { await page.close(); }
});

async function openModels({ width = 1440, data = baseData(), testResult } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.setDefaultTimeout(5000);
  await page.route("**/*", (request) => request.abort());
  await page.setContent('<main id="root"></main>');
  await page.addScriptTag({ content: output[0].code });
  await page.evaluate(({ data, testResult }) => globalThis.setModelsFixture(data, "conn", testResult), { data, testResult });
  return page;
}

test("FB05: a reachable LM Studio server with no loaded model is not Ready", async () => {
  const page = await openModels();
  try {
    const local = page.getByRole("group", { name: "Models on a computer or server" });
    const status = local.getByText("Server reachable", { exact: true }).first();
    await status.waitFor();
    assert.equal(await status.getAttribute("data-tone"), "slow");
    assert.match(await local.innerText(), /nothing in memory/);
    assert.match(await local.innerText(), /not loaded/);
    assert.doesNotMatch(await local.innerText(), /\bReady\b/);
  } finally { await page.close(); }
});

test("FB06: an uninstalled Codex CLI is clearly unavailable while its choices remain selectable", async () => {
  const page = await openModels();
  try {
    const codexCard = page.getByRole("group", { name: "Codex" });
    await codexCard.getByText("Not installed", { exact: true }).waitFor();
    assert.match(await codexCard.innerText(), /can be chosen.*not ready/i);
    assert.doesNotMatch(await codexCard.innerText(), /Available for writing with this connection/);
  } finally { await page.close(); }
});

test("FB08: the all-connection action says it refreshes status and reports that it made no model call", async () => {
  const page = await openModels();
  try {
    await page.getByRole("button", { name: "Refresh connection status", exact: true }).click();
    await page.getByRole("status").getByText("Connection status refreshed. No model was asked to write.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Test all connections", exact: true }).count(), 0);
  } finally { await page.close(); }
});

test("FB09: a Gemini test shows progress, elapsed time, the answer failure, and a failed status", async () => {
  const page = await openModels();
  page.on("dialog", (dialog) => dialog.accept());
  try {
    await page.getByRole("button", { name: "Test", exact: true }).first().click();
    await page.getByRole("status").getByText(/Sending a short request to Gemini test connection/, { exact: false }).waitFor();
    await page.getByRole("status").getByText(/The model did not answer in 1\.9 seconds: The server replied/, { exact: false }).waitFor();
    assert.match(await page.locator("body").innerText(), /Test failed/);
  } finally { await page.close(); }
});

test("FB10: the local-server inventory warns that hosted Ollama models can spend credits", async () => {
  const page = await openModels();
  try {
    const group = page.getByRole("group", { name: "Models on a computer or server" });
    await group.getByText("Hosted cloud models run elsewhere and may spend credits.", { exact: false }).first().waitFor();
    assert.match(await group.innerText(), /deepseek-v4\.1-flash:cloud/);
    assert.match(await group.innerText(), /cloud — spends credits, not this computer/);
  } finally { await page.close(); }
});

test("FC27: Dark Desk history displays output-length and connection failures as separate reasons", async () => {
  const copy = darkRunStopCopy(
    "Local model (halo/qwen3.8-27b-q6-fast) is unreachable. Check that it is running and that this machine is online.",
    "Synthesis: Local model (halo/qwen3.8-27b-q6-fast) is unreachable. Brief: Local model: Provider says: reply was cut off because the output token limit was reached (finish reason: length).",
  );
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 700 } });
    try {
      await page.setContent(`<article><p>Stopped: ${copy}</p></article>`);
      const text = await page.locator("article").innerText();
      assert.match(text, /Synthesis stopped because the local server could not be reached/i);
      assert.match(text, /Separately, the brief reply was cut off at the output token limit/i);
      assert.match(text, /increase the model's output limit or write a shorter brief/i);
    } finally { await page.close(); }
  }
});
