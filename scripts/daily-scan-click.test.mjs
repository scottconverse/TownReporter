import assert from "node:assert/strict";
import { test } from "node:test";
import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";
import { getSql } from "../src/lib/db.ts";
import { runScanInput } from "../src/lib/news/request-input.ts";
import { commitScanForAuthenticatedEditor } from "../src/lib/news/model-request-commit.server.ts";
import { applyMigrationsToTestPglite } from "../src/lib/test-support/pglite-migrations.ts";
await applyMigrationsToTestPglite();
const window = installDom();
const React = await import("react"), { createRoot } = await import("react-dom/client");
const stub = stubUrl(`import {createElement as h} from ${JSON.stringify(import.meta.resolve("react"))};
export const createFileRoute=()=>o=>({...o,useSearch:()=>({})}), Link=({children})=>h('a',null,children);
export const keepPreviousData=x=>x, useQuery=({queryKey})=>({data:globalThis.scanData[queryKey[0]]}), useQueryClient=()=>({invalidateQueries(){}});
export const useMutation=o=>({mutate:x=>globalThis.scanPress=o.mutationFn(x).then(o.onSuccess),isPending:false});
export const DeskShell=({children})=>h('div',null,children), Field=DeskShell, SecHead=DeskShell, InkButton=p=>h('button',p,p.children);
export const ModelPicker=()=>null, AddSourcesDialog=()=>null, SourceKillPattern=()=>null, ListSkeleton=()=>null, ScreenError=()=>null, DeskJobCard=()=>null, ActionButton=InkButton;
export const inkSolid='', inputClass='', PAGE_SIZE=50, showingLine=()=>'', badSourceKillsBySource=()=>new Map(), myDesk=()=>({}), getDailyScanPolicy=()=>({}), sourceStatusUndoTo=()=>null;
export const listLeads=()=>[], listScans=()=>[], checkOneSource=()=>{}, listSourcesPage=()=>{}, replacementCandidates=()=>[], reviewSuggestedSources=()=>{}, setSourceStatus=()=>{}, saveSourceScanPreference=()=>{}, findReplacement=()=>{}, runScan=x=>globalThis.startScan(x.data);
export const modelChoiceLabel=()=>'', defaultModelEffort=()=>null, dailyScheduleLabel=()=>'', dailyScanCounts=()=>[], editorActionError=()=>'', editorFetchError=()=>'', keepsFailingNote=()=>'', scanRowLine=()=>'', suggestedOriginLine=()=>'', scanSourceCoverageAge=()=>'', SOURCE_SCAN_PREFERENCE_CADENCE_OPTIONS=[], SOURCE_SCAN_PREFERENCE_COPY={}, SOURCE_SCAN_PREFERENCE_PURPOSE_OPTIONS=[];
export const keepsFailing=()=>false, candidateIsWatchedSource=()=>false, applySections=()=>{}, editorSections=()=>{}, usePaperDateFormatters=()=>({formatListDateTime:()=>''}), useDeskMutation=useMutation, rowActionPhase=()=>'', invalidateDeskJobs=()=>{}, useDeskJobs=()=>({data:[]});`);
const imports = Object.fromEntries(["@tanstack/react-router","@tanstack/react-query","@/components/desk-chrome","@/components/desk-chrome-utils","@/components/model-picker","@/components/dialogs/editor-dialogs","@/components/states","@/lib/news/desk","@/lib/news/editor-dialog-actions","@/lib/news/list-window","@/lib/news/editor-dialog-logic","@/lib/news/claim","@/lib/news/daily-scan","@/lib/news/source-status-undo","@/lib/news/model-choice","@/lib/news/provider-registry","@/lib/news/desk-copy","@/lib/news/source-rows","@/lib/news/source-replacements","@/lib/news/sections","@/lib/paper-context-state","@/components/desk-action","@/components/action-button","@/components/job-card-state","@/components/JobCard","@/lib/desk/daily-scan-counts"].map(x=>[x,stub]));
const { Route } = await import(await moduleUrl("src/routes/desk.sources.tsx", imports));
// guards: the Daily scan button must not spend an editor's scan on all 201 accepted sources.
test("pressing the daily scan plans the saved seven fixed and five rotating sources", async () => {
  const sql=await getSql(), room=9871, user='daily-click';
  await sql`insert into newsrooms(id,name) values(${room},'Click fixture')`;
  await sql`insert into paper_settings(newsroom_id,onboarded) values(${room},true)`;
  const pool=await sql.query("insert into sources(user_id,newsroom_id,url,title,kind,tier,status) select $1,$2,'https://example.test/'||n,'Source '||n,'page','A','accepted' from generate_series(1,201) n returning *",[user,room]);
  const selected=pool.slice(0,12).map(s=>s.id);
  await sql`insert into daily_scan_policies(newsroom_id,configured_by_user_id,source_cap,every_day_source_count,selected_source_ids) values(${room},${user},12,7,${JSON.stringify(selected)}::jsonb)`;
  globalThis.scanData={'sources':{rows:[],total:201,counts:{accepted:201}},'my-desk':{role:'owner'},'scans':{rows:[]},'daily-scan-policy':{ok:true,policy:{sourceCap:12,everyDaySourceCount:7,selectedSourceIds:selected}},'editor-sections':{sections:[]}};
  let subject;
  globalThis.startScan=data=>commitScanForAuthenticatedEditor({context:{userId:user,newsroomId:room},...runScanInput.parse(data)}, {probeProvider:async()=>({ok:true,choice:'codex-balanced',provider:'codex',model:'fixture'}),findOpenJob:async()=>null,assertRate:async()=>{},enqueueJob:async x=>(subject=x.subjectId,{id:1,subject_id:subject,model_choice:'codex-balanced'})});
  const root=createRoot(document.getElementById('root'));
  try {
    await React.act(async()=>root.render(React.createElement(Route.component)));
    const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Run scan now');
    assert.ok(button);
    await React.act(async()=>{button.dispatchEvent(new window.Event('click',{bubbles:true}));await globalThis.scanPress;});
    const [run]=await sql`select source_snapshot,policy_snapshot,source_coverage from scan_runs where id=${subject}`;
    const sources=JSON.parse(run.source_snapshot??'[]');
    assert.equal(sources.length,12);
    assert.deepEqual(sources.slice(0,7).map(s=>s.id),selected.slice(0,7));
    assert.equal(JSON.parse(run.policy_snapshot).rotatingSourceCount,5);
    assert.equal(run.source_coverage.length,201);
    assert.ok([...document.querySelectorAll('button')].some(b=>b.textContent==='Scan every accepted source (201)'));
  } finally {await React.act(async()=>root.unmount());}
});
