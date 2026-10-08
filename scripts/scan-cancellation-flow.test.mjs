// guards: cancelling a scan must show how many sources finished, rather than a failed scan verdict.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";

const window = installDom();
const React = await import("react"), { createRoot } = await import("react-dom/client");
const receipt = "Cancelled after 3 of 201 sources";
const row = { id: 1, started_at: "2026-10-08T12:00:00Z", finished_at: "2026-10-08T12:01:00Z", error: "Cancelled by the editor", summary: receipt, sources_selected: 201, sources_attempted: 4, sources_fetched: 3, sources_analyzed: 0, model_batches_used: 0, leads_created: 0, sources_proposed: 0 };
const scans = { rows: [row], total: 1 };
const stub = stubUrl(`import {createElement as h} from ${JSON.stringify(import.meta.resolve("react"))};
const scanFixture=${JSON.stringify(scans)}; export const createFileRoute=()=>o=>o, Link=({children})=>h('a',null,children);
export const keepPreviousData=x=>x, useQuery=({queryKey})=>({data:queryKey[0]==='scans'?scanFixture:[]}), useQueryClient=()=>({});
export const useMutation=()=>({mutate(){},isPending:false});
export const DeskShell=({children})=>h('div',null,children), SecHead=DeskShell, Notice=DeskShell, InkButton=({children,onClick})=>h('button',{onClick},children);
export const Busy=()=>null, MeetingsActivity=()=>null, ScanSourceCoverageList=()=>null, ListSkeleton=()=>null, ScreenError=()=>null, DeskJobCard=()=>null, ProviderSignInButton=()=>null, ModelPicker=()=>null, LocalModelsOnThisComputer=()=>null, PaperSetupGateNote=()=>null;
export const deleteScanSourcePackFn=()=>{}, listAcceptedScanSources=()=>[], listScanSourcePacksFn=()=>[], listScans=()=>{}, listSources=()=>[], renameScanSourcePackFn=()=>{}, runScan=()=>{}, saveScanSourcePackFn=()=>{};
export const usePaperDateFormatters=()=>({formatListDateTime:()=> 'Oct. 8'}), useDeskAction=()=>({}), invalidateDeskJobs=()=>{}, useDeskJobs=()=>({data:[]}), useFirstRunPickerSeed=()=>{}, usePaperSetupGate=()=>({ready:true}), defaultModelEffort=()=>null, useEditorSections=()=>({sections:[]});`);
const copy = await moduleUrl("src/lib/news/desk-copy.ts", {
  "./preflight.ts": stubUrl("export const looksLikeProviderAuthFailure=()=>false, providerAuthTarget=()=>'';"),
  "./lead-match.ts": stubUrl("export const distinguishingOverlap=()=>({subjects:0,names:0});"),
  "../paper.ts": stubUrl("export const TOPICS = [], PAPER = { timezone: \"America/Denver\" }; export const formatClockTime = () => \"\", formatListDateTime = () => \"\";"),
});
const imports = Object.fromEntries(["@tanstack/react-router", "@tanstack/react-query", "@/components/desk-chrome", "@/components/meetings-activity", "@/components/scan-source-coverage", "@/components/states", "@/lib/news/desk", "@/lib/paper-context-state", "@/components/desk-action", "@/components/job-card-state", "@/components/JobCard", "@/components/provider-signin-button", "@/components/model-picker", "@/components/first-run-picker-default", "@/components/first-run-model", "@/components/paper-setup-gate", "@/components/PaperSetupGateNote", "@/lib/news/provider-registry", "@/lib/use-sections"].map(name => [name, stub]));
imports["@/lib/news/desk-copy"] = copy;
imports["@/lib/news/scan-history"] = new URL("../src/lib/news/scan-history.ts", import.meta.url).href;
imports["@/lib/news/scan-source-coverage"] = await moduleUrl("src/lib/news/scan-source-coverage.ts");
const { Route } = await import(await moduleUrl("src/routes/desk.scan.tsx", imports));

test("opening a cancelled scan shows its saved source receipt and editor reason", async () => {
  const root = createRoot(document.getElementById("root"));
  try {
    await React.act(async () => root.render(React.createElement(Route.component)));
    const scan = document.querySelector(".scan-row");
    assert.ok(scan);
    assert.equal(scan.querySelector(".astra-chip").textContent, receipt);
    const open = scan.querySelector("summary[aria-label^='Open scan']");
    await React.act(async () => open.dispatchEvent(new window.Event("click", { bubbles: true })));
    // linkedom has no native details toggle; apply the summary's default action.
    open.parentElement.open = true;
    const report = scan.querySelector(".r2-scan-report");
    assert.equal(report.querySelector(".scan-line").textContent, receipt);
    assert.equal(report.querySelector(".wire-warn").textContent, row.error);
    assert.doesNotMatch(report.textContent, /Stopped before the writing pass|Failed/);
  } finally { await React.act(async () => root.unmount()); }
});
