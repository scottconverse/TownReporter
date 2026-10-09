import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

/**
 * The Server -> Sections panel, rendered for real.
 *
 * The owner's report (2026-09-24) was that a brand-new section showed a
 * collapsed line, "Assigned accepted sources (0) — none assigned yet", with
 * no way to add a website from there at all. So the things worth proving are
 * the ones that were wrong or missing on that screen: which sentence the
 * summary carries, whether an empty section's list is already open, and
 * whether the "add a new source to this section" box is really on the page
 * with labelled inputs.
 *
 * Static rendering cannot click (this repo's test toolchain has no jsdom), so
 * the draft-only surfaces -- the fixed unsaved bar, the leave-page block --
 * are left to scripts/sections-source-add-e2e.mjs, which drives a real
 * browser against a built server. What is proven here is the markup the
 * panel shows on first paint, and that the bar is not on it while nothing has
 * been edited.
 *
 * Same stub-everything-but-React pattern as scripts/desk-text-size-render.test.mjs.
 */
function moduleUrl(source, fileName, imports = {}) {
  let output = ts.transpileModule(source, {
    fileName,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [name, url] of Object.entries(imports)) {
    output = output.replaceAll(JSON.stringify(name), JSON.stringify(url));
  }
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

function inlineModule(source, imports = {}) {
  let rewritten = source.replaceAll('"react"', JSON.stringify(import.meta.resolve("react")));
  for (const [name, url] of Object.entries(imports)) {
    rewritten = rewritten.replaceAll(JSON.stringify(name), JSON.stringify(url));
  }
  return `data:text/javascript;base64,${Buffer.from(rewritten).toString("base64")}`;
}

// useQuery hands back whatever the test sets on __state before rendering, so
// one process can render the panel against several saved configurations.
const reactQueryStub = inlineModule(`
  export const __state = { data: null, isPending: false, error: null };
  export function useQuery() {
    return {
      data: __state.data,
      isPending: __state.isPending,
      isError: false,
      error: __state.error,
      refetch: async () => {},
    };
  }
  export function useQueryClient() {
    return { invalidateQueries: async () => {}, setQueryData: () => {} };
  }
  export function useMutation() {
    return { mutate: () => {}, mutateAsync: async () => {}, isPending: false, isError: false, error: null };
  }
`);

// One stub for both modules that import the router: desk-chrome.tsx needs the
// link/navigate surface, sections-setup.tsx needs useBlocker. An idle blocker
// is the honest static-render state -- nothing has been edited yet.
const routerStub = inlineModule(`
  import { createElement } from "react";
  export function Link({ to, children, activeOptions: _activeOptions, ...rest }) {
    return createElement("a", { href: String(to ?? "#"), ...rest }, children);
  }
  export function useMatchRoute() {
    return () => false;
  }
  export function useNavigate() {
    return () => Promise.resolve();
  }
  export function useRouterState() {
    return "/desk/ops";
  }
  export function useBlocker() {
    return { status: "idle", proceed: () => {}, reset: () => {} };
  }
`);

const paperContextStub = inlineModule(`
  export function usePaper() {
    return { name: "Testerville Ledger", city: "Testerville" };
  }
  export function usePaperDateFormatters() {
    return { formatDate: () => "Wednesday, September 2, 2026", formatShortDate: () => "Sep 2" };
  }
`);

const authGatesStub = inlineModule(`
  import { createElement } from "react";
  export function UserButton() {
    return createElement("span", { className: "user-button-stub" });
  }
`);
const authClientStub = inlineModule(`export async function signOut() {}`);
const useCurrentUserStub = inlineModule(
  `export function useCurrentUserState() { return { user: null, isPending: false }; }`,
);
const claimStub = inlineModule(`export async function leaveEditor() { return { ok: true }; }`);
/*
  The REAL desk-copy.ts, not a hand-written stand-in.

  desk-chrome.tsx (the shell this page draws inside) imports chipLabel,
  createEditorCopy, editorTitle, openLeads, pileForStatus and sentenceCase from
  it, and sections-setup.tsx imports editorActionError, kindFromSourceUrl and
  tierFromKind. A stub silently went stale the moment the shell gained
  `editorTitle`, which is exactly the failure this file hit. desk-copy.ts's own
  three imports are stubbed the way scripts/lead-badge-render.test.mjs stubs
  them -- it reaches preflight.ts, lead-match.ts and paper.ts for functions
  this page never calls.
*/
const preflightStub = inlineModule(`
  export function looksLikeProviderAuthFailure() { return false; }
  export function providerAuthTarget() { return ""; }
`);
const leadMatchStubForCopy = inlineModule(`
  export function distinguishingOverlap() { return { subjects: 0, names: 0 }; }
`);
const paperModuleStub = inlineModule(`
  export const PAPER = { timezone: "America/Denver" };
  export const TOPICS = [];
  export const formatClockTime = () => "2:10 p.m.";
  export const formatListDateTime = () => "Oct. 8, 2:10 p.m.";
`);
const deskCopyUrl = moduleUrl(
  await readFile(new URL("../src/lib/news/desk-copy.ts", import.meta.url), "utf8"),
  "desk-copy.ts",
  {
    "./preflight.ts": preflightStub,
    "./lead-match.ts": leadMatchStubForCopy,
    "../paper.ts": paperModuleStub,
  },
);
// The same server function the Sources page calls. In this static render it is
// never invoked -- no click can happen -- so it only has to exist and be shaped
// like the real one.
const deskServerStub = inlineModule(`
  export async function listLeads() { return []; }
  /*
    FB1 unit 3: the shell's Running box reads the one desk-jobs query now,
    through @/components/job-card-state; nothing here needs a server reader.
  */
  export async function listDeskJobs() { return []; }
  /*
    CY item 6 added the nav's Opinion, Follow-ups and Dark Desk counts to the
    shell. This render is about the page below the shell, not the counts, so
    the three reads answer empty and the nav prints nothing.
  */
  export async function listFollowUps() { return []; }
  /*
    Review D2: the shell's Drafts nav count is now a count-only server read
    (countDraftsDesk) instead of the whole list. This static render never
    invokes it -- there is no click and no live query -- it only has to exist.
  */
  export async function countDraftsDesk() { return 0; }
  export async function addSource() {
    return { ok: false, error: "not called in a static render" };
  }
`);
const opinionStub = inlineModule(`export async function listEditorials() { return []; }`);

// desk-chrome.tsx imports the appearance context (Light/Dark and Normal/Large
// live there now -- src/lib/appearance-context.ts), so the module cannot load
// without it resolving. Its shipped defaults are what a server render sees.
const appearanceContextStub = inlineModule(`
  export function useAppearance() {
    return {
      appearance: { desk: "light", size: "normal", reader: "light" },
      surface: "light",
      setDesk: () => {},
      refreshReader: () => {},
    };
  }
  export function useHydrated() { return false; }
`);

/*
  FB5: `desk-chrome-utils.ts` reaches for the desk's toast now -- announceToDesk
  draws the visible bar as well as speaking into `#desk-announcer`. Nothing the
  markup below asserts is about toasts, so the module is stubbed shut here the
  same way every other specifier in this file is: what is under test is the
  markup that renders, not what the desk says while it renders it.
*/
const deskToastStub = moduleUrl(
  `export function deskToast() {}
export function deskToastHostMounted() { return false; }`,
  "desk-toast-stub.ts",
);
const deskToasterStub = moduleUrl(
  `export function DeskToaster() { return null; }`,
  "desk-toaster-stub.ts",
);

const deskChromeUtilsUrl = moduleUrl(
  await readFile(new URL("../src/components/desk-chrome-utils.ts", import.meta.url), "utf8"),
  "desk-chrome-utils.ts",
  { "@/components/desk-toast": deskToastStub },
);

/*
  Unit U24: the nav list and the active-item rule moved out of desk-chrome.tsx
  into src/lib/desk-nav.ts, so a test can read them. It imports nothing, so the
  REAL module compiles here and the shell this file renders draws the real nav
  rather than a stand-in that would keep passing if the shell stopped using it.
*/
const deskNavUrl = moduleUrl(
  await readFile(new URL("../src/lib/desk-nav.ts", import.meta.url), "utf8"),
  "desk-nav.ts",
);

/*
  Redesign phase 2a: the job shape, the clock and the m:ss format moved out of
  desk-chrome.tsx into src/components/desk-jobs.ts (react-refresh wants a file
  that exports components to export components only). Its only bare import is
  react, so the REAL module compiles here.
*/
const deskJobsUrl = moduleUrl(
  await readFile(new URL("../src/components/desk-jobs.ts", import.meta.url), "utf8"),
  "desk-jobs.ts",
  { react: import.meta.resolve("react") },
);

// The real copy module: its sentences are half of what this file checks.
const copyUrl = moduleUrl(
  await readFile(new URL("../src/components/sections-setup-copy.ts", import.meta.url), "utf8"),
  "sections-setup-copy.ts",
);

const DESK_CHROME_IMPORTS = {
  "@tanstack/react-router": routerStub,
  "@tanstack/react-query": reactQueryStub,
  "@/lib/paper-context-state": paperContextStub,
  "@/lib/auth/gates": authGatesStub,
  "@/lib/auth/client": authClientStub,
  "@/lib/auth/use-current-user": useCurrentUserStub,
  "@/lib/news/claim": claimStub,
  "@/lib/news/desk-copy": deskCopyUrl,
  "@/lib/news/desk": deskServerStub,
  "@/lib/news/opinion": opinionStub,
  /*
    CY item 6 put the Dark Desk and Follow-ups nav counts in the shell, so
    desk-chrome.tsx now imports these two modules. Nothing here reads them.
  */
  "@/lib/news/dark": inlineModule("export async function listInvestigations() { return []; }"),
  "@/lib/news/follow-up-copy": inlineModule(
    "export function isAgentKind() { return false; } export function matchesFollowUpFilter() { return false; }",
  ),
  "@/lib/desk-nav": deskNavUrl,
  "@/components/desk-chrome-utils": deskChromeUtilsUrl,

  "@/components/desk-toaster": deskToasterStub,
  "@/components/desk-jobs": deskJobsUrl,
  /*
    FB1 units 3-4: the shell's Running box draws the real card from the one job
    query, so both specifiers have to resolve for desk-chrome.tsx to load.
    Nothing here starts or renders a job.
  */
  "@/components/JobCard": inlineModule(
    "export function DeskJobCard() { return null; } export function JobCard() { return null; }",
  ),
  "@/components/job-card-state": inlineModule(
    "export function useDeskJobs() { return { data: [], isPending: false, isError: false, refetch() {} }; } export function invalidateDeskJobs() {}",
  ),
  "@/lib/appearance-context": appearanceContextStub,
  "./shortcut-sheet": moduleUrl(
    await readFile(new URL("../src/components/shortcut-sheet.tsx", import.meta.url), "utf8"),
    "shortcut-sheet.tsx",
    {
      "../lib/save-shortcut-label.ts": import.meta.resolve("../src/lib/save-shortcut-label.ts"),
      "./dialog": inlineModule("export function Dialog() { return null; }"),
      "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    },
  ),
  /*
    Redesign phase 2a: the shell's shortcut sheet ("?") is the phase 0 Dialog
    (src/components/dialog.tsx). Nothing rendered here opens it, but
    desk-chrome.tsx cannot load without the specifier resolving.
  */
  "@/components/dialog": inlineModule(
    "export function Dialog() { return null; } export function ChoiceCard() { return null; }",
  ),
  /*
    Redesign BN item 1 put the drawn New-story dialog in the shell header,
    reached through the dialogs barrel (`@/components/dialogs`). Nothing
    rendered here opens it; it is a controlled dialog and draws nothing while
    shut. desk-chrome.tsx still cannot be compiled without the specifier
    resolving, the same reason the Dialog above is stubbed.
  */
  "@/components/dialogs": inlineModule(
    "export function NewStoryDialog() { return null; }",
  ),
  "lucide-react": import.meta.resolve("lucide-react"),
  react: import.meta.resolve("react"),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
};

const deskChromeUrl = moduleUrl(
  await readFile(new URL("../src/components/desk-chrome.tsx", import.meta.url), "utf8"),
  "desk-chrome.tsx",
  DESK_CHROME_IMPORTS,
);

// The unsaved bar and the leave-page prompt, shared with the Named outlets
// panel (Unit W). Compiled here as well so the "no bar before an edit"
// assertion below is about the component the Sections panel really renders,
// not about a stand-in that would keep passing if the panel stopped using it.
const guardUrl = moduleUrl(
  await readFile(new URL("../src/components/unsaved-changes-guard.tsx", import.meta.url), "utf8"),
  "unsaved-changes-guard.tsx",
  {
    "@tanstack/react-router": routerStub,
    "./desk-chrome": deskChromeUrl,
    react: import.meta.resolve("react"),
    "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  },
);

const sectionsStub = inlineModule(`
  export async function editorSections() { return null; }
  export async function applySections() { return { ok: true, config: null }; }
`);
const sectionTypesStub = inlineModule(`
  export function sectionPreviewChanges() { return []; }
`);

const { SectionsSetup } = await import(
  moduleUrl(
    await readFile(new URL("../src/components/sections-setup.tsx", import.meta.url), "utf8"),
    "sections-setup.tsx",
    {
      "@tanstack/react-router": routerStub,
      "@tanstack/react-query": reactQueryStub,
      "./desk-chrome": deskChromeUrl,
      "./unsaved-changes-guard": guardUrl,
      "./desk-chrome-utils": deskChromeUtilsUrl,
      "./sections-setup-copy": copyUrl,
      "@/lib/news/sections": sectionsStub,
      "@/lib/news/section-types": sectionTypesStub,
      // The add box calls the Sources page's own server function, so this
      // panel needs the same two modules desk.sources.tsx imports.
      "@/lib/news/desk": deskServerStub,
      "@/lib/news/desk-copy": deskCopyUrl,
      react: import.meta.resolve("react"),
      "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    },
  )
);

const { __state } = await import(reactQueryStub);

const section = (key, name, sourceIds = []) => ({
  key,
  name,
  visible: true,
  brief: "",
  instructions: "",
  replacementKey: null,
  sourceIds,
});

const savedConfig = (sources, businessSourceIds = []) => ({
  revision: 3,
  sections: [
    section("council", "Council"),
    section("opinion", "Opinion"),
    section("about", "About"),
    section("business", "Business", businessSourceIds),
  ],
  sources,
  counts: [],
  canEdit: true,
});

const render = () => renderToStaticMarkup(createElement(SectionsSetup, {}));

/** The attributes of the `<details>` whose summary is exactly `summaryText`. */
function detailsAttrs(html, summaryText) {
  const escaped = summaryText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<details([^>]*)><summary>${escaped}</summary>`));
  assert.ok(match, `no <details> whose summary is "${summaryText}"`);
  return match[1];
}

test("an empty section opens its source list and offers to add a source there", () => {
  __state.data = savedConfig([]);
  const html = render();

  // The old line said "Assigned accepted sources (0) — none assigned yet" and
  // named no action. It is gone.
  assert.doesNotMatch(html, /Assigned accepted sources/);
  assert.doesNotMatch(html, /none assigned yet/);

  const summary = "Sources this section reads (0) — choose or add below";
  assert.match(html, new RegExp(summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(detailsAttrs(html, summary), /\bopen\b/, "an empty list must not start collapsed");

  // The one-step add box, on this page, with labelled inputs.
  assert.match(html, /Add a new source to this section/);
  assert.match(html, /<label>New source URL<input/);
  assert.match(html, /<label>Label \(optional\)<input/);
  assert.match(html, /Adding a source here puts it on watch immediately\./);
  assert.match(html, /Its assignment to Business is saved when you confirm\./);
  assert.match(html, /Add and tick for this section/);
});

test("a section that reads sources stays collapsed but names them", () => {
  __state.data = savedConfig([
    { id: 7, title: "Times-Call", url: "https://www.timescall.com/" },
    { id: 9, title: "City Council packets", url: "https://example.test/packets" },
  ], [7, 9]);
  const html = render();

  const summary = "Sources this section reads (2) — Times-Call, City Council packets";
  assert.match(html, new RegExp(summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(detailsAttrs(html, summary), /\bopen\b/);
});

test("the unsaved-changes bar is absent until something is edited", () => {
  __state.data = savedConfig([]);
  const html = render();

  assert.doesNotMatch(html, /You have unsaved section changes/);
  assert.doesNotMatch(html, /Section changes not saved/);

  // ...but the empty live region that will carry the message is already in the
  // document, because text inserted into an existing role="status" is
  // announced while a role="status" inserted with its text is not.
  assert.match(html, /<p role="status"><\/p>/);
});
