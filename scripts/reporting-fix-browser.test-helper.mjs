import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { moduleUrl, stubUrl } from "./dom-harness.mjs";

export const record = (segments) => ({
  identity: { videoId: "fixture", videoUrl: "https://example.org/meeting" },
  segments,
  windows: [],
  agenda: [],
  votes: [],
  gaps: [],
});
export const story = (draft, claims = []) => ({
  id: "story",
  headline: "Council considers neighborhood measures",
  dek: "The council considered neighborhood measures during its meeting, giving residents an opportunity to understand the proposals and the next steps for their community.",
  draft,
  plainBrief: "",
  cannotSay: "",
  readinessTier: 2,
  claims,
  sources: [],
});
export async function write(
  writingPass,
  inputRecord,
  packet,
  actions = [],
  assignment = "Report this meeting",
) {
  return writingPass({
    record: inputRecord,
    documents: [],
    further: { findings: "", documents: [], gaps: [] },
    gather: { observations: [] },
    warm: { actions: [], windows: [], gaps: [] },
    cold: { actions: [], roster: [], votes: [], gaps: [] },
    reconcile: {
      actions,
      contradictions: [],
      warmOnly: [],
      coldOnly: [],
      voteMismatches: [],
      matched: 0,
    },
    contrary: { contrary: [], unknowns: [], gaps: [] },
    scoring: { score: null, readiness: 0, why: "", gaps: [] },
    assignment,
    action: "Report this meeting",
    city: "Longmont",
    method: { text: "Use supplied records only." },
    chatOpts: {},
    workspaceDir: "",
    throwIfCancelled: async () => {},
    chat: async () => ({ ok: true, text: JSON.stringify(packet) }),
  });
}

export async function openReporting(t, stories, held = []) {
  const pkg = {
    packageVersion: 1,
    city: "Longmont",
    action: "Report this meeting",
    assignment: "Whole meeting",
    stories,
    held,
    actions: [],
    unknowns: [],
    runStatus: "PARTIAL",
    readinessTier: 2,
    coverageComplete: false,
    receipt: {},
    meetingCoverage: {},
    score: null,
  };
  const query = stubUrl(
    `export const useQuery=({queryKey})=>({data:queryKey[0]==="reporting-package"?{pkg:${JSON.stringify(pkg)},requestId:1}:[]});export const useMutation=()=>({});export const useQueryClient=()=>({});`,
  );
  const controls = stubUrl(
    `import React from "${import.meta.resolve("react")}";export const Link=({children})=>React.createElement("a",null,children);export const ActionButton=({children})=>React.createElement("button",null,children);export const Field=({children})=>children;export const Notice=({children})=>children;`,
  );
  const { ReportingPackagePanel } = await import(
    await moduleUrl("src/components/reporting-package-panel.tsx", {
      "@tanstack/react-router": controls,
      "@tanstack/react-query": query,
      "@/lib/paper-context-state": stubUrl(
        'export const usePaper=()=>({timezone:"America/Denver"});',
      ),
      "@/components/action-button": controls,
      "@/components/desk-chrome": controls,
      "@/components/states": controls,
      "@/components/job-card-state": stubUrl("export const invalidateDeskJobs=()=>{};"),
      "@/lib/news/url-guard": await moduleUrl("src/lib/news/url-guard.ts"),
      "@/lib/news/reporting-package-view": await moduleUrl(
        "src/lib/news/reporting-package-view.ts",
      ),
      "@/lib/news/desk": stubUrl(
        "export const answerReportingFollowUp=()=>{},loadLeadReportingPackage=()=>{},listReportingObservations=()=>{},saveReportingCorrection=()=>{};",
      ),
    })
  );
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route("**/*", (route) => route.abort());
  await page.setContent(renderToStaticMarkup(createElement(ReportingPackagePanel, { leadId: 1 })));
  await page.locator(".reporting-claims summary").first().click();
  return page;
}
