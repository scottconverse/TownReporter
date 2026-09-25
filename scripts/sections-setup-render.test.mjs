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
const deskCopyStub = inlineModule(`
  export function createEditorCopy() {
    return { leave: "Give up the desk", confirm: "", confirmYes: "", confirmNo: "", mismatch: "" };
  }
  export function kindFromSourceUrl() { return "official"; }
  export function tierFromKind() { return "A"; }
`);
// The same server function the Sources page calls. In this static render it is
// never invoked -- no click can happen -- so it only has to exist and be shaped
// like the real one.
const deskServerStub = inlineModule(`
  export async function listLeads() { return []; }
  export async function addSource() {
    return { ok: false, error: "not called in a static render" };
  }
`);
const opinionStub = inlineModule(`export async function listEditorials() { return []; }`);

const deskChromeUtilsUrl = moduleUrl(
  await readFile(new URL("../src/components/desk-chrome-utils.ts", import.meta.url), "utf8"),
  "desk-chrome-utils.ts",
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
  "@/lib/news/desk-copy": deskCopyStub,
  "@/lib/news/desk": deskServerStub,
  "@/lib/news/opinion": opinionStub,
  "@/components/desk-chrome-utils": deskChromeUtilsUrl,
  "lucide-react": import.meta.resolve("lucide-react"),
  react: import.meta.resolve("react"),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
};

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
      "./desk-chrome": moduleUrl(
        await readFile(new URL("../src/components/desk-chrome.tsx", import.meta.url), "utf8"),
        "desk-chrome.tsx",
        DESK_CHROME_IMPORTS,
      ),
      "./desk-chrome-utils": deskChromeUtilsUrl,
      "./sections-setup-copy": copyUrl,
      "@/lib/news/sections": sectionsStub,
      "@/lib/news/section-types": sectionTypesStub,
      // The add box calls the Sources page's own server function, so this
      // panel needs the same two modules desk.sources.tsx imports.
      "@/lib/news/desk": deskServerStub,
      "@/lib/news/desk-copy": deskCopyStub,
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
