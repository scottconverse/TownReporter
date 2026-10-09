// guards: open capture claims could falsely label a published draft Ready after an explicit publish acceptance.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";
import { chromium } from "playwright";
import { moduleUrl, stubUrl } from "./dom-harness.mjs";
import { screenModuleUrl } from "./screen-render-harness.mjs";

test("opening Checks shows live capture claims as Not ready even after publish acceptance", async (t) => {
  const types = Object.fromEntries(["./finding-evidence-review.ts", "./draft-specifics.ts", "./draft-audit.ts", "./evidence-check-state.ts", "./name-check.ts", "./notes.ts"].map((name) => [name, stubUrl("export {}; ")]));
  const list = await moduleUrl("src/lib/news/evidence-check-list.ts", types);
  const state = await moduleUrl("src/lib/news/evidence-check-state.ts", { ...types, "./evidence-check-list.ts": list, "./notes.ts": stubUrl("export const topicConfirmationFingerprint = token => token;") });
  const screen = await screenModuleUrl("src/routes/desk.story.$leadId.tsx", {
    createFileRoute: `()=>options=>({...options,useParams:()=>({leadId:"461"})})`,
    showsPublishPrep: `()=>true`,
    stripReporterNotebook: `body=>body`,
    FindingEvidenceReviewPanel: `({list})=>{const {useEffect}=globalThis.fixtureReact; const review=globalThis.captureReview; const state=globalThis.reviewState({review,recorded:list.evidenceRecorded,openClaims:0}); useEffect(()=>list.onEvidenceState({...state,evidenceToken:review.evidenceToken}),[list.onEvidenceState]); return h('p',{'data-checks-reason':true},globalThis.ranLine({state,checkedAt:null,modelLabel:'',captures:globalThis.captureCount(review.rows,review.claimRows,review.manualClaimRows)}));}`,
    RedraftDialog: `({writerStatus})=>h('span',{'data-writer':true,title:writerStatus.reason},writerStatus.label)`,
  }, ["@/lib/news/desk-drafts", "@/lib/news/check-gates", "@/lib/news/desk-copy", "@/lib/news/story-readiness", "@/components/story-readiness-chip", "@/lib/news/writer-bar", "@/lib/news/publish-blockers", "@/components/publish-blockers"]);
  const entry = `import * as React from ${JSON.stringify(import.meta.resolve("react"))};
    import {createRoot} from ${JSON.stringify(import.meta.resolve("react-dom/client"))};
    import {Route} from ${JSON.stringify(screen)};
    import {reviewEvidenceCheckState} from ${JSON.stringify(state)};
    import {evidenceRanLine,citedCaptureCount} from ${JSON.stringify(list)};
    Object.assign(globalThis,{fixtureReact:React,reviewState:reviewEvidenceCheckState,ranLine:evidenceRanLine,captureCount:citedCaptureCount});
    globalThis.captureReview={rows:[],manualClaimRows:[],evidenceToken:'live-review',claimRows:Array.from({length:11},(_,i)=>({key:'claim-'+i,judgment:{value:'unreviewed'},captures:[{versionId:i%3+1,available:true,readable:true}]}))};
    globalThis.screenData={lead:{lead:{id:461,headline:'Service changes',topic:'transportation',status:'published',source_urls:'[]'},draft:{id:8,headline:'Service changes',dek:'Feedback is open',body:'Residents can comment on service changes.',topic:'transportation',research_json:null},unreviewedClaimsAcceptedCount:11,namedOutlets:[],outletOverrides:[]},sources:[],memory:[]};
    createRoot(document.getElementById('root')).render(React.createElement(Route.component));`;
  const bundle = await rolldown({ input: "fixture", plugins: [{
    name: "isolated-screen",
    resolveId(id) { if (id === "fixture" || id.startsWith("data:")) return id; if (id.startsWith("file:")) return fileURLToPath(id); },
    load(id) { if (id === "fixture") return entry; if (id.startsWith("data:")) return Buffer.from(id.split(",")[1], "base64").toString(); },
  }], transform: { define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.env": "{}" } } });
  t.after(() => bundle.close());
  const { output } = await bundle.generate({ format: "iife" });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route("**/*", (route) => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: output[0].code });
  await page.getByRole("tab", { name: /^Checks$/ }).click();
  const checks = page.locator("[data-checks-reason]");
  await checks.waitFor();
  assert.match(await checks.textContent(), /3 captures.*11 claims/);
  const chip = page.locator("[data-story-readiness]");
  assert.equal(await chip.getAttribute("data-story-readiness"), "not-ready");
  const reason = await chip.getAttribute("title");
  assert.match(reason, /11 claims.*review/);
  assert.equal(await page.locator("[data-writer]").getAttribute("title"), reason);
  // The explicit acceptance still clears the Publish gate; it does not verify the claims.
  assert.equal(await page.getByText(reason, { exact: true }).count(), 0);
});
