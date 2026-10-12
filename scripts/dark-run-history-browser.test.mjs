// guards: the Server history must preserve the provider's actual stop reason.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";
import { chromium } from "playwright";
import { screenModuleUrl } from "./screen-render-harness.mjs";

const route = await screenModuleUrl(
  "src/routes/desk.ops.tsx",
  {
    createFileRoute: `()=>options=>({...options,useSearch:()=>({})})`,
    useRouterState: `()=>""`,
    useQuery: `({queryKey})=>({data:globalThis.opsData[queryKey[0]],isPending:false,isError:false,error:null,refetch:async()=>{}})`,
    DeskShell: `({children})=>h("main",{},children)`,
    OPS_CARDS: `[]`,
    opsCard: `()=>({anchor:""})`,
  },
  ["@/lib/news/dark-run-copy"],
);
const run = {
  id: "history-1",
  started_at: "2026-10-11T22:00:00.000Z",
  investigation_id: null,
  model_choice: "Local model",
  summary: "Synthesis: Local model is unreachable. Brief: Provider says: reply was cut off because the output token limit was reached (finish reason: length).",
  error: "Local model (halo/qwen3.8-27b-q6-fast) is unreachable. Check that it is running and that this machine is online.",
  stopReason: "length",
  usageRecorded: true,
  usage: { totals: { modelCalls: 1, searches: 0, documentReads: 0, elapsedMs: 1200, totalTokens: 4096 }, calls: [] },
};
const fixture = `import * as React from ${JSON.stringify(import.meta.resolve("react"))};
  import {createRoot} from ${JSON.stringify(import.meta.resolve("react-dom/client"))};
  import {Route} from ${JSON.stringify(route)};
  globalThis.opsData={"my-desk":{role:"editor"},"dark-runs":[${JSON.stringify(run)}]};
  const root=createRoot(document.getElementById("root"));
  root.render(React.createElement(Route.component));`;
const bundle = await rolldown({
  input: "fixture",
  plugins: [{
    name: "dark-run-history-browser-fixture",
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

test("FC27: Server history distinguishes the synthesis connection failure from the brief output limit", async () => {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(5000);
    await page.route("**/*", (request) => request.abort());
    try {
      await page.setContent('<main id="root"></main>');
      await page.addScriptTag({ content: output[0].code });
      const history = page.getByRole("region", { name: "Dark Desk run history" });
      await history.getByText("Dark Desk run history · 1 recent runs", { exact: true }).click();
      const text = await history.innerText();
      assert.match(text, /Synthesis stopped because the local server could not be reached/i);
      assert.match(text, /Separately, the brief reply was cut off at the output token limit/i);
      assert.match(text, /Increase the model's output limit or write a shorter brief/i);
      assert.doesNotMatch(text, /Stopped: Local model \(halo\/qwen3\.8-27b-q6-fast\) is unreachable/);
    } finally { await page.close(); }
  }
});
