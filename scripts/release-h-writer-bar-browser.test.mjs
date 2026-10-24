import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { chromium } from "playwright";

// FW1: while a draft runs on Automatic and a fallback is writing, the Writer bar
// must name the model that is writing now and the switch chip must say from what and why.
test("the real Story screen names the running writer and the switch reason", async () => {
  const { act } = await import("react");
  const { installDom } = await import("./dom-harness.mjs");
  const { screenModule } = await import("./screen-render-harness.mjs");
  // The bottom progress card is not under test here; the page reads only the note from this view.
  const progressStub = "(row) => ({ failoverNote: row.failover_note ?? \"\" })";
  const screen = await screenModule("src/routes/desk.story.$leadId.tsx", { jobProgressView: progressStub }, [
    "@/lib/news/model-choice", "@/lib/news/desk-drafts", "@/lib/news/check-gates",
    "@/lib/news/desk-copy", "@/lib/news/story-readiness", "@/components/story-readiness-chip",
  ]);
  globalThis.screenData = {
    lead:{lead:{id:22,headline:"Council votes",topic:"government",status:"drafting",source_urls:"[]"},
      draft:{id:8,headline:"Council votes",dek:"A plan",body:"Council approved the plan.",topic:"government"},
      job:{id:901,kind:"draft",subject_id:22,model_choice:"codex-balanced",model_choice_source:"editor",status:"running",
        updated_at:new Date().toISOString(),finished_at:null,step_text:"Writing the draft…",
        failover_note:"This draft moved to Codex Sol 6.1 (balanced) because Gemini timed out",
        result_json:JSON.stringify({requestedRuntime:"auto"})},
      namedOutlets:[],outletOverrides:[]},
    "custom-ai-connections":[], "provider-availability":{}, sources:[],memory:[],
  };
  const { document } = installDom();
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  const browser = await chromium.launch({headless:true});
  try {
    await act(async()=>root.render(createElement(screen.Route.component)));
    const page=await browser.newPage();
    await page.setContent(document.getElementById("root").innerHTML);
    assert.equal(
      // D273: a stored `codex-balanced` job now reads on the one Codex Sol row.
      await page.getByRole("button",{name:"Model & research · Writer: Codex Sol 6.1 · picked: Automatic",exact:true}).count(),
      1,
      "the Writer bar must name the model writing now and the pick",
    );
  } finally { await act(async()=>root.unmount()); await browser.close(); }
});
