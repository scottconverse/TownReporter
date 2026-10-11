import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { ModelPicker, availabilityStub, choiceModule, writerBar } from "./model-picker-render.harness.mjs";
import { JobCard } from "./job-card-render.harness.mjs";
import { jobProgressView } from "../src/lib/news/job-progress.ts";

const connection = { id:"gemini", name:"Gemini", modelId:"gemini-3.5-flash", enabled:true };
const label = "Gemini (gemini-3.5-flash)";
for (const [path, reason] of [
  ["unreadable key", "The saved API key cannot be decrypted."],
  ["provider error", "Google says: quota exceeded (429)"],
  ["success", null],
]) test(`picker and progress retain Gemini identity: ${path}`, async () => {
  const browser = await chromium.launch({headless:true});
  availabilityStub.__setConnections([{...connection, ...(path === "unreadable key" ? {readinessError:reason} : {})}]);
  availabilityStub.__setAvailability({});
  try {
    const page = await browser.newPage();
    const view = jobProgressView({
      id:1, kind:"draft", subject_id:443, status:"running",
      model_choice:reason ? "deepseek-flash" : "custom:gemini",
      result_json:JSON.stringify({...(reason ? {requestedCustomModelLabel:label} : {customModelLabel:label}),requestedRuntime:"custom:gemini"}),
      step_text:reason ? "Switched to DeepSeek v4.1 Flash: Custom API connection was unavailable" : "Waiting on Custom API connection",
      failover_note:reason ? `Custom API connection: ${reason} -> DeepSeek v4.1 Flash` : "",
    },443,null);
    await page.setContent(renderToStaticMarkup(createElement("main", {},
      createElement("button", {}, `Model & research · ${choiceModule.modelChoiceLabel("custom:gemini","story",connection)}`),
      createElement(ModelPicker, {value:"custom:gemini",onChange(){}}),
      createElement(JobCard,{job:view,now:Date.now()}),
      createElement("p",{},writerBar.lastDraftLine({modelLabel:choiceModule.modelChoiceLabel("custom:gemini","story",connection),when:"7:48 a.m."})),
    )));
    assert.equal(await page.getByRole("button",{name:`Model & research · ${label}`,exact:true}).count(),1);
    const picker = page.getByLabel("Writing model",{exact:true});
    await picker.selectOption("custom:gemini");
    assert.match(await picker.locator("option:checked").innerText(),/Gemini.*gemini-3.5-flash/);
    assert.ok((await page.locator(".job-card-now").innerText()).includes(label));
    if (reason) assert.ok((await page.getByText(/^Model switch:/).innerText()).includes(label));
    else assert.equal(await page.getByText(/^Model switch:/).count(),0);
    assert.equal(await page.getByText(`Last draft: ${label}, 7:48 a.m.`,{exact:true}).count(),1);
    assert.doesNotMatch(await page.locator("body").innerText(),/Custom API connection/);
  } finally { availabilityStub.__setConnections([]); availabilityStub.__setAvailability(undefined); await browser.close(); }
});


test("the real Story screen resolves the writer and last-draft connection labels", async () => {
  const { act } = await import("react");
  const { installDom } = await import("./dom-harness.mjs");
  const { screenModule } = await import("./screen-render-harness.mjs");
  const screen = await screenModule("src/routes/desk.story.$leadId.tsx", {}, [
    "@/lib/news/model-choice", "@/lib/news/desk-drafts", "@/lib/news/check-gates",
    "@/lib/news/desk-copy", "@/lib/news/story-readiness", "@/components/story-readiness-chip",
  ]);
  globalThis.screenData = {
    lead:{lead:{id:22,headline:"Council votes",topic:"government",status:"published",source_urls:"[]"},
      draft:{id:8,headline:"Council votes",dek:"A plan",body:"Council approved the plan.",topic:"government"},
      job:{model_choice:"custom:gemini",model_choice_source:"editor",status:"completed",finished_at:"2026-10-10T13:48:00Z",result_json:JSON.stringify({customModelLabel:label})},
      namedOutlets:[],outletOverrides:[]},
    "custom-ai-connections":[connection], "provider-availability":{}, sources:[],memory:[],
  };
  const { document } = installDom();
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  const browser = await chromium.launch({headless:true});
  try {
    await act(async()=>root.render(createElement(screen.Route.component)));
    const page=await browser.newPage();
    await page.setContent(document.getElementById("root").innerHTML);
    assert.equal(await page.getByRole("button",{name:`Model & research · ${label}`,exact:true}).count(),1);
    assert.ok((await page.locator(".astra-wb-last").innerText()).includes(`Last draft: ${label}`));
    assert.doesNotMatch(await page.locator("body").innerText(),/Custom API connection/);
  } finally { await act(async()=>root.unmount()); await browser.close(); }
});
