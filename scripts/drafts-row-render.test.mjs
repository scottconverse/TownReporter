import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { rolldown } from "rolldown";
import { chromium } from "playwright";
import { screenModuleUrl } from "./screen-render-harness.mjs";

test("Drafts keeps a queued empty draft and isolates one unreadable row", async (t) => {
  const screen = await screenModuleUrl(
    "src/routes/desk.drafts.tsx",
    {
      DeskShell: `({children,title,lede})=>h("main",{},h("h1",{},title),lede,children)`,
      DeskMoreMenu: `()=>null`,
      DeskJobCard: `()=>null`,
      Link: `({children,to,hash,className})=>h("a",{href:(typeof to==="string"?to:String(to))+(hash?"#"+hash:""),className},children)`,
      editorTitle: `(headline)=>headline`,
      useDeskJobs: `()=>({data:[]})`,
      useNowMs: `()=>0`,
    },
    [
      "@/lib/news/desk-drafts",
      "@/lib/news/draft-item",
      "@/components/draft-item-boundary",
    ],
  );

  const queued = {
    id: 376,
    lead_id: 477,
    headline: "Queued draft stays visible",
    topic: "council",
    updated_at: "2026-10-11T18:02:35.302Z",
    has_body: false,
    story_readiness: {
      version: 1,
      state: "not-ready",
      openCount: 0,
      totalCount: 0,
      reason: "No draft has been written.",
    },
    job_status: "queued",
    job_stage: "Queued",
    job_started_at: null,
    job_updated_at: null,
    job_model_choice: "local-model",
    job_error: null,
    evidence_required: false,
    evidence_decision: null,
    evidence_checked_at: null,
    names_checked_at: null,
    imported_text: false,
    name_check_complete: false,
    names_unresolved: 0,
    unreviewed_claims: 0,
    unreviewed_claims_accepted_count: 0,
    headline_source: null,
    model_headline: null,
  };
  const saved = {
    ...queued,
    id: 378,
    lead_id: 479,
    headline: "A saved draft also stays visible",
    has_body: true,
    job_status: null,
  };
  const data = {
    "drafts-desk": {
      rows: [null, queued, saved],
      total: 3,
      counts: { all: 3, running: 1, "needs-you": 0, yours: 0, failed: 0 },
    },
  };
  const entry = `
    import * as React from ${JSON.stringify(import.meta.resolve("react"))};
    import {createRoot} from ${JSON.stringify(import.meta.resolve("react-dom/client"))};
    import {Route} from ${JSON.stringify(screen)};
    globalThis.screenData = ${JSON.stringify(data)};
    createRoot(document.getElementById("root")).render(React.createElement(Route.component));
  `;
  const bundle = await rolldown({
    input: "fixture",
    plugins: [
      {
        name: "isolated-drafts-screen",
        resolveId(id) {
          if (id === "fixture" || id.startsWith("data:")) return id;
          if (id.startsWith("file:")) return fileURLToPath(id);
        },
        load(id) {
          if (id === "fixture") return entry;
          if (id.startsWith("data:")) return Buffer.from(id.split(",")[1], "base64").toString();
        },
      },
    ],
    transform: {
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
        "import.meta.env": "{}",
      },
    },
  });
  t.after(() => bundle.close());
  const { output } = await bundle.generate({ format: "iife" });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: output[0].code });

  await page.getByRole("heading", { name: "Drafts" }).waitFor();
  await page.getByRole("link", { name: "+ New story" }).waitFor();
  assert.equal(await page.locator(".drafts-row").count(), 2);
  await page.getByRole("heading", { name: "Queued draft stays visible" }).waitFor();
  await page.getByRole("heading", { name: "A saved draft also stays visible" }).waitFor();
  assert.match(await page.locator(".drafts-row").first().innerText(), /Queued/);

  const unavailable = page.getByRole("alert");
  assert.equal(await unavailable.count(), 1);
  assert.match(await unavailable.innerText(), /Draft 1: This draft could not be shown:/);
  assert.match(await unavailable.innerText(), /Cannot read properties of null/);
  await page.getByRole("link", { name: "Open it from the Queue." }).waitFor();
  assert.deepEqual(pageErrors, []);
});
