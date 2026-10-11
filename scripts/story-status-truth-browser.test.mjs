// guards: the story page must describe queue, manual review, and uploaded passages from the saved state.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";
import { chromium } from "playwright";
import { moduleUrl } from "./dom-harness.mjs";
import { screenModuleUrl } from "./screen-render-harness.mjs";

const chip = await moduleUrl("src/components/story-readiness-chip.tsx");
const nameCheckModuleUrl = await moduleUrl("src/lib/news/name-check.ts");
const nameCheck = await moduleUrl("src/components/desk-name-check.tsx", {
  "../lib/news/name-check": nameCheckModuleUrl,
});
const evidenceListModel = await moduleUrl("src/lib/news/evidence-check-list.ts");
const evidenceList = await moduleUrl("src/components/evidence-check-list.tsx", {
  "../lib/news/evidence-check-list": evidenceListModel,
});
const meetingSourceUtils = await moduleUrl("src/components/meeting-source-block-utils.ts");
const transcriptView = await moduleUrl("src/lib/news/meeting-transcript-view.ts");
const meetingBlock = await moduleUrl("src/components/meeting-source-block.tsx", {
  "@/lib/news/meeting-transcript-view": transcriptView,
  "@/components/meeting-source-block-utils": meetingSourceUtils,
});
const nameCheckModule = await import(nameCheckModuleUrl);

const route = await screenModuleUrl(
  "src/routes/desk.story.$leadId.tsx",
  {
    createFileRoute: `()=>options=>({...options,useParams:()=>({leadId:"22"})})`,
    showsPublishPrep: `()=>true`,
    stripReporterNotebook: `body=>body`,
    parseNotes: `()=>globalThis.storyNotes`,
    StoryReadinessChip: `(props)=>h(globalThis.storyStatusComponents.StoryReadinessChip,props)`,
    DeskNameCheck: `(props)=>h(globalThis.storyStatusComponents.DeskNameCheck,props)`,
    MeetingSourceBlock: `(props)=>h(globalThis.storyStatusComponents.MeetingSourceBlock,props)`,
    FindingEvidenceReviewPanel: `({list})=>h(globalThis.storyStatusComponents.EvidenceCheckList,{rows:[],ranLine:'',compareLabel:'',onCompare:()=>{},onStylePress:()=>{},documentPassageCount:list.documentPassageCount,manualCheckRecorded:list.manualCheckRecorded,readinessReason:list.readinessReason})`,
    BeforeYouCanPublish: `({blockers,onAct})=>h('section',{'data-publish-warnings':true},blockers.map((row,index)=>h('div',{key:index},h('p',{},row.sentence),row.altAction?h('button',{type:'button',onClick:()=>onAct(row.altAction.target)},row.altAction.label):null)))`,
    useMutation: `({mutationFn})=>({isPending:false,isError:false,data:undefined,mutate(){if(String(mutationFn).includes('acknowledgeUncheckedStory')){globalThis.screenData.lead.uncheckedStoryAcknowledged=true;globalThis.renderStory();}}})`,
  },
  [
    "@/lib/news/desk-drafts",
    "@/lib/news/check-gates",
    "@/lib/news/desk-copy",
    "@/lib/news/story-readiness",
    "@/lib/news/name-check",
    "@/lib/news/writer-bar",
    "@/lib/news/publish-blockers",
  ],
);

const fixture = `import * as React from ${JSON.stringify(import.meta.resolve("react"))};
  import {createRoot} from ${JSON.stringify(import.meta.resolve("react-dom/client"))};
  import {Route} from ${JSON.stringify(route)};
  import {StoryReadinessChip} from ${JSON.stringify(chip)};
  import {DeskNameCheck} from ${JSON.stringify(nameCheck)};
  import {EvidenceCheckList} from ${JSON.stringify(evidenceList)};
  import {MeetingSourceBlock} from ${JSON.stringify(meetingBlock)};
  Object.assign(globalThis,{storyStatusComponents:{StoryReadinessChip,DeskNameCheck,EvidenceCheckList,MeetingSourceBlock}});
  globalThis.screenNotes={todo:[],todos:[],sources:[],opened:[],found:[],verify:[],unanswered:[]};
  globalThis.screenData={lead:{lead:{id:22,headline:'Council votes',topic:'government',status:'drafted',source_urls:'[]'},draft:{id:8,lead_id:22,headline:'Council votes',dek:'A plan',body:'',topic:'government',research_json:null,source_urls:'[]',updated_at:'2026-10-11T20:00:00.000Z'},namedOutlets:[],outletOverrides:[],evidenceToken:'draft-v1',uncheckedRecordedClaims:0,uncheckedEvidenceChecked:false,uncheckedStoryAcknowledged:false,uncheckedExempt:false,job:null,draftMeetingEvidence:null},sources:[],memory:[]};
  globalThis.storyNotes=globalThis.screenNotes;
  const root=createRoot(document.getElementById('root'));
  globalThis.storyKey=0;
  globalThis.renderStory=()=>root.render(React.createElement(Route.component,{key:++globalThis.storyKey}));
  globalThis.setStoryFixture=(lead,notes)=>{globalThis.screenData.lead=lead;globalThis.storyNotes=notes??globalThis.screenNotes;globalThis.renderStory();};
  globalThis.renderStory();`;

const bundle = await rolldown({
  input: "fixture",
  plugins: [{
    name: "story-status-browser-fixture",
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

const baseLead = ({ body = "", job = null, research = null, ack = false, documentPassageCount = 0 } = {}) => ({
  lead: { id: 22, headline: "Council votes", topic: "government", status: "drafted", source_urls: "[]", why: "A local decision." },
  draft: { id: 8, lead_id: 22, headline: "Council votes", dek: "A plan", body, topic: "government", research_json: research, source_urls: "[]", form: "brief", updated_at: "2026-10-11T20:00:00.000Z" },
  namedOutlets: [],
  outletOverrides: [],
  evidenceToken: "draft-v1",
  uncheckedRecordedClaims: 0,
  uncheckedEvidenceChecked: false,
  uncheckedStoryAcknowledged: ack,
  uncheckedExempt: false,
  job,
  draftMeetingEvidence: null,
  documentPassageCount,
});

async function draw(lead, notes) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(4000);
  await page.route("**/*", (request) => request.abort());
  await page.setContent('<main id="root"></main>');
  await page.addScriptTag({ content: output[0].code });
  await page.evaluate(({ lead, notes }) => globalThis.setStoryFixture(lead, notes), { lead, notes });
  return page;
}

async function assertQueued(page) {
  const chip = page.locator("[data-story-readiness]");
  try {
    await page.waitForFunction(
      () => document.querySelector("[data-story-readiness]")?.dataset.storyReadiness === "queued",
      undefined,
      { timeout: 8000 },
    );
  } catch {
    const state = await chip.getAttribute("data-story-readiness");
    const visible = (await page.locator("body").innerText()).slice(0, 900);
    throw new Error(`Story readiness did not reach queued (state: ${state}). Visible text: ${visible}`);
  }
  assert.equal(await chip.innerText(), "Queued");
  assert.equal(await chip.getAttribute("title"), "Queued, waiting for the writing worker.");
  const visible = await page.locator("body").innerText();
  assert.match(visible, /Queued, waiting for the writing worker\./);
  assert.doesNotMatch(visible, /Checking facts|The AI is checking facts|app restarted|recovering automatically|written before notes were kept/i);
}

test("FA06: a stale queued story stays Queued and does not claim a restart", async (t) => {
  const page = await draw(baseLead({ job: { id: 1, status: "queued", updated_at: "2026-10-11T07:00:00.000Z", created_at: "2026-10-11T07:00:00.000Z" } }));
  t.after(() => page.close());
  await assertQueued(page);
});

test("FB15: a new queued story does not say facts are being checked", async (t) => {
  const page = await draw(baseLead({ job: { id: 2, status: "queued", updated_at: "2026-10-11T20:00:00.000Z", model_choice: "deepseek" } }));
  t.after(() => page.close());
  await assertQueued(page);
});

test("FC05: an empty OCR draft shows the queue state until its first run", async (t) => {
  const page = await draw(baseLead({ job: { id: 3, status: "queued", updated_at: "2026-10-11T20:00:00.000Z" } }));
  t.after(() => page.close());
  await assertQueued(page);
});

test("FC06: a long-waiting queued OCR or meeting draft is not described as recovering", async (t) => {
  const page = await draw(baseLead({ job: { id: 4, status: "queued", updated_at: "2026-10-11T07:00:00.000Z", created_at: "2026-10-11T07:00:00.000Z" } }));
  t.after(() => page.close());
  await assertQueued(page);
});

test("FC07: Reporting explains that notes arrive after an empty draft's first run", async (t) => {
  const page = await draw(baseLead({ job: { id: 5, status: "queued", updated_at: "2026-10-11T20:00:00.000Z" } }));
  t.after(() => page.close());
  await page.getByRole("tab", { name: /^Reporting$/ }).click();
  await page.getByText("Reporting notes will appear after the first draft run.", { exact: true }).waitFor();
  assert.equal(await page.getByText("This draft was written before notes were kept.", { exact: false }).count(), 0);
});

test("FB18: recording a manual check changes the Checks panel and removes the repeated instruction", async (t) => {
  const body = "The council approved a $2 million budget on Tuesday.";
  const page = await draw(baseLead({ body }));
  t.after(() => page.close());
  await page.getByRole("tab", { name: /^Checks$/ }).click();
  await page.getByRole("button", { name: "I checked this story myself" }).click();
  await page.locator('[aria-label="Evidence check"] [role="status"]').filter({ hasText: "Manual check recorded." }).waitFor();
  const visible = await page.locator("body").innerText();
  assert.match(visible, /You confirmed that you checked this story against your sources\./);
  assert.doesNotMatch(visible, /No claims were recorded.*nothing has been checked|press .*I checked this story myself/i);
  assert.equal(await page.getByRole("button", { name: "I checked this story myself" }).count(), 0);
});

test("FC22: Reporting names the recorded manual route for a meeting story without saved citations", async (t) => {
  const notes = {
    todo: [], todos: [], sources: [], opened: [], found: [], verify: [], unanswered: [],
    meeting: { title: "Council meeting", date: "2026-10-11", artifactId: 4 },
    transcriptCitations: [{ item: "4", segmentIndex: 1, timestampSeconds: 30, excerpt: "The board voted 4 to 1.", captionSha256: "abc" }],
  };
  const page = await draw(baseLead({ body: "The council approved the plan.", ack: true }), notes);
  t.after(() => page.close());
  await page.getByRole("tab", { name: /^Reporting$/ }).click();
  await page.locator("p.note-gate").filter({ hasText: "You confirmed that you checked this story against your sources." }).waitFor();
  const visible = await page.locator("body").innerText();
  assert.doesNotMatch(visible, /Publishing will remain blocked until .*redraft/i);
});

test("FC23: Checks distinguishes five matched OCR passages from missing evidence judgments", async (t) => {
  const headline = "Council votes";
  const dek = "A plan";
  const body = "The test document carries CLEAR RECORD 7319.";
  const rows = Array.from({ length: 5 }, (_, index) => ({
    fact: `Selected claim ${index + 1}`,
    kind: "uploaded document",
    filename: "record.png",
    locator: `page 1, line ${index + 1}`,
    excerpt: index === 0 ? "CLEAR RECORD 7319" : `Retained passage ${index + 1}`,
  }));
  const research = JSON.stringify({ reportedDocumentClaims: { version: 1, checkedText: nameCheckModule.nameCheckText({ headline, dek, body }), rows } });
  const page = await draw(baseLead({ body, research }));
  t.after(() => page.close());
  await page.getByRole("tab", { name: /^Checks$/ }).click();
  await page.getByText("Selected claims with verified uploaded passages (5)", { exact: true }).waitFor();
  const evidence = page.getByLabel("Evidence check");
  await evidence.waitFor();
  const visible = await evidence.innerText();
  assert.match(visible, /5 uploaded passages were matched to selected claims/i);
  assert.match(visible, /do not verify every statement/i);
  assert.doesNotMatch(visible, /No claims are recorded for this draft yet/i);
  assert.doesNotMatch(await page.locator("body").innerText(), /nothing to review here/i);
});
