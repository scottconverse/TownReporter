import { installDom, transpileToUrl } from "./dom-harness.mjs";
const window = installDom();
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const h = React.createElement;
const calls = { keep: [], draft: [] };
globalThis.__darkFlow = { calls };

const stub = (source) => transpileToUrl(source, "dark-flow-stub.js", {});
const queryStub = stub(`
  export function useQuery({ queryKey }) {
    const data = globalThis.__darkFlow.fixtures;
    const name = queryKey[0];
    const value = name === "investigation" ? data.details?.[queryKey[1]] ?? data.detail : data[name];
    return { data: value, isPending: false, isError: false, isRefetching: false, refetch: async () => {} };
  }
  export function useMutation(options) {
    return { isPending: false, isError: false, mutate(value) { Promise.resolve(options.mutationFn(value)).then((result) => options.onSuccess?.(result, value), (error) => options.onError?.(error, value)); } };
  }
  export function useQueryClient() { return { invalidateQueries() {}, setQueryData() {} }; }
`);
const routerStub = stub(`
  import { createElement } from "react";
  export function createFileRoute() { return (options) => options; }
  export function Link({ children, to, ...props }) { return createElement("a", { href: String(to ?? "#"), ...props }, children); }
`);
const chromeStub = stub(`
  import { createElement } from "react";
  export function DeskShell({ children }) { return createElement("main", null, children); }
  export function InkButton({ children, tone, small, pending, pendingLabel, ...props }) { return createElement("button", props, pending ? pendingLabel : children); }
  export function Busy() { return null; } export function Score() { return null; } export function SecHead() { return null; }
`);
const statesStub = stub(`import { createElement } from "react"; export function ListSkeleton() { return null; } export function Notice({ children }) { return createElement("div", null, children); } export function ScreenError() { return null; }`);
const darkStub = stub(`
  export const continueInvestigation = async ({ data }) => { globalThis.__darkFlow.calls.keep.push(data); return { ok: true, pending: true, jobId: 9 }; };
  export const listInvestigations = async () => globalThis.__darkFlow.fixtures.investigations;
  export const listWorthALook = async () => globalThis.__darkFlow.fixtures["worth-a-look"];
  export const getInvestigation = async () => globalThis.__darkFlow.fixtures.detail;
  export const getDarkDials = async () => ({ place: { city: "Longmont", county: "Boulder County" } });
  export const investigationActivity = async () => [];
  export const challengeInvestigation = async () => ({ ok: true });
  export const draftSignalFile = async () => { globalThis.__darkFlow.calls.draft.push(true); return { ok: false }; };
  export const findSomethingToDigInto = async () => ({ ok: false });
  export const fileRedditTip = async () => ({ ok: true });
  export const getArtifact = async () => null; export const getArtifactOcrJob = async () => null;
  export const openDarkInvestigation = async () => ({ ok: true, investigationId: 2 });
  export const parkInvestigation = async () => ({ ok: true }); export const queueInvestigation = async () => ({ ok: true });
  export const queuePacket = async () => null; export const closeInvestigation = async () => ({ ok: true });
  export const queueArtifactOcr = async () => ({ ok: true }); export const refreshBrief = async () => ({ ok: true });
  export const reopenParkedInvestigation = async () => ({ ok: true }); export const retryDarkRound = async () => ({ ok: true });
  export const scanTipSubreddit = async () => ({ ok: true }); export const getTipSubreddit = async () => ({ subreddit: "longmont" });
`);
const copyStub = stub(`
  export const DIG_STOP_ACK = "Stop requested.";
  export const blockedDigBannerText = () => ""; export const editorError = (v) => /invalid byte sequence for encoding UTF8:\\s*0x00/i.test(String(v ?? "")) ? "Could not read one record (bad text in the file)" : String(v ?? ""); export const editorPauseReason = (v) => v ? (/invalid byte sequence for encoding UTF8:\\s*0x00/i.test(String(v)) ? "Could not read one record (bad text in the file)" : String(v)) : null;
  export const editorKindLabel = () => "Record"; export const elapsedLabel = () => ""; export const excerptForEditor = (v) => String(v ?? "");
  export const headlineFromUrl = () => ""; export const humanFrontierLabel = (v) => String(v ?? "");
  export const darkJobActive = () => false; export const observedDarkJobFinished = () => false;
  export const organizationFromUrl = () => ""; export const editorTitle = (v) => String(v ?? "");
  export const investigationPileFor = (row) => row.status === "closed" ? "aside" : "desk";
  export const plainEditorText = (v) => String(v ?? ""); export const plainFinding = (v) => String(v ?? "");
  export const progressLine = () => ""; export const digStopControl = () => ({ visible: false, label: "Stop", disabled: false, line: null });
  export const recordKindFromUrl = () => "page"; export const redditFeedLabel = () => "r/longmont";
  export const redditFeedStatusLabel = () => ""; export const redditPostStateLabel = () => "";
  export const redditResultHeadline = () => ""; export const sentenceCase = (v) => String(v ?? "");
  export const stalledRunCopy = () => ""; export const worthItemOnDeskLine = () => ""; export const worthItemOnDeskReason = () => "";
`);
const modelPickerStub = stub(`
  import { createElement } from "react";
  export function ModelPicker(props) { return createElement("div", { className: "model-picker-stub", "data-value": props.value, "data-scope": props.scope, "data-effort": String(Boolean(props.onEffortChange)) }, createElement("span", null, props.label ?? "Digging model"), createElement("button", { type: "button", onClick: () => props.onChange("claude-sonnet") }, "Choose Claude Sonnet")); }
`);
const darkRailStub = stub(`
  export const newestTouchedFile = (rows) => rows.slice().sort((a,b) => Date.parse(b.updated_at)-Date.parse(a.updated_at))[0];
  export const fullFileQuestion = (title) => title; export const signalCounts = () => ({ total: 0, covered: 0, toReview: 0 });
`);
const nullComponents = stub(`import { createElement } from "react"; export const DarkDialsPanel = () => null; export const PageWatchPanel = () => null; export function DarkFileDialog({ open, prefill }) { return open ? createElement("div", { role: "dialog", "data-question": prefill?.question ?? "", "data-tip": prefill?.tip ?? "", "data-explanation": prefill?.explanation ?? "" }) : null; } export const Dialog = () => null; export function FollowUpDialog({ initial }) { return createElement("div", { role: "dialog", "aria-label": "New AI follow-up" }, initial.what); } export const InvestigationBriefCard = () => null; export const SectionTldr = () => null; export const SearchTrailEntry = () => null; export const ProviderSignInButton = () => null; export const PaperSetupGateNote = () => null;`);
const imports = {
  "@/lib/news/dark-rail": darkRailStub,
  "@tanstack/react-router": routerStub,
  "@tanstack/react-query": queryStub,
  "@/components/desk-chrome": chromeStub,
  "@/components/states": statesStub,
  "@/lib/news/dark": darkStub,
  "@/lib/news/job-progress": stub(`export const cancelStoryJob = async () => ({ ok: true });`),
  "@/components/job-card-state": stub(`export const invalidateDeskJobs = () => {}; export const useDeskJobs = () => ({ data: [], isPending: false, isError: false });`),
  "@/components/JobCard": stub(`export const DeskJobCard = () => null; export function JobCard() { return null; }`),
  "@/components/paper-setup-gate": stub(`export const usePaperSetupGate = () => ({ blocked: false });`),
  "@/components/PaperSetupGateNote": nullComponents,
  "@/lib/news/desk-copy": copyStub,
  "@/lib/paper-context-state": stub(`export const usePaperDateFormatters = () => ({ formatListDateTime: () => "Sept. 26", formatShortDate: () => "Sept. 26", formatClockTime: () => "7:02 a.m." });`),
  "@/components/dark-dials-panel": nullComponents,
  "@/components/model-picker": modelPickerStub,
  "@/components/first-run-picker-default": stub(`export const useFirstRunPickerSeed = () => {}; export const useFirstRunPickerDefault = () => "claude-haiku";`),
  "@/lib/news/dark-dials": stub(`export const scopeLabelsFor = () => ({ city: "Longmont", county: "Boulder County", region: "Region", adjacent: "Nearby" });`),
  "@/lib/news/editor-dialog-logic": stub(`export const DARK_LIMITS = [{ key: "standard", label: "Standard", minutes: 120, hops: 5 }];`),
  "@/components/investigation-brief": stub(`export const InvestigationBriefCard = () => null; export const SectionTldr = () => null;`),
  "@/components/search-trail-entry": stub(`export const SearchTrailEntry = () => null;`),
  "@/lib/news/dark-fact-lines": stub(`export const dedupeFactLines = () => []; export const factLinesDropped = () => 0;`),
  "@/lib/news/html-text": stub(`export const captureBatchStats = () => ({ total: 0, blockedRatio: 0 }); export const readableCapture = () => ""; export const captureRefusalLabel = () => "";`),
  "@/lib/news/extraction-label": stub(`export const describeExtractionMethod = () => "";`),
  "@/lib/news/dark-seed": stub(`
    export const DARK_OPEN_KEY = "townreporter.dark.openId";
    export const takeDarkSeed = () => null;
    export function takeDarkFilePrefill(storage) {
      const raw = storage.getItem("townreporter.dark.prefill");
      if (raw == null) return null;
      storage.removeItem("townreporter.dark.prefill");
      return JSON.parse(raw);
    }
  `),
  "@/components/provider-signin-button": nullComponents,
  "@/lib/news/preflight": stub(`export const looksLikeProviderAuthFailure = () => false;`),
  "@/components/dialogs/editor-dialogs": nullComponents,
  "@/components/page-watch-panel": nullComponents,
  "@/components/dialog": nullComponents,
  "@/components/follow-up-dialog": nullComponents,
  "@/lib/news/desk": stub(`export const createAiFollowUp = async () => ({ ok: true }); export const listFollowUpStoryOptions = async () => [];`),
  "@/lib/news/page-watch-actions": stub(`export const checkPageWatch = async () => ({ ok: true }); export const createPageWatch = async () => ({ ok: true, id: 1 });`),
  "@/lib/news/model-choice": stub(`export const darkModelChoice = (v) => v === "codex-sol" || v === "claude-sonnet" || v === "claude-haiku" ? v : "auto"; export const modelChoiceLabel = () => "Automatic"; export const shouldHydrateDarkModel = (selected, id, last, status) => selected === id && (last != null || status !== "investigating");`),
  "@/lib/news/provider-registry": stub(`export const defaultModelEffort = () => null; export const modelEffort = (_choice, effort) => effort ?? null;`),
};
const routeUrl = await (async () => {
  const { readFile } = await import("node:fs/promises");
  return (await import("./dom-harness.mjs")).transpileToUrl(await readFile(new URL("../src/routes/desk.dark.tsx", import.meta.url), "utf8"), "desk.dark.tsx", imports);
})();
const Route = (await import(routeUrl)).Route;

const file = { id: 1, title: "When was the notice posted?", status: "open", updated_at: "2026-10-08T12:00:00Z", limit_key: "standard", limit_minutes: 120, still_open: 0 };
const detail = {
  investigation: { ...file, ordinary_explanation: "A routine delay", scope_json: '{"scope":"city"}', budget: 5, hops: 0, last_model_choice: "codex-sol", pause_reason: null },
  artifacts: [], claims: [], hypotheses: [], searches: [], frontier: [], deadEnds: [], anomalies: [], entities: [], signals: [], sourceCaptures: [], investigationFollowUps: [], captureCounts: { captures: 0, readable: 0, unreadable: 0 },
};
detail.investigation.ordinary_explanation = "A routine delay";
globalThis.__darkFlow.fixtures = { investigations: [file], "worth-a-look": [], "tip-subreddit": { subreddit: "longmont" }, "dark-dials": { place: { city: "Longmont", county: "Boulder County" } }, "investigation-activity": [], "follow-up-story-options": [], detail };

export { window, React, createRoot, h, calls, file, detail, Route };
