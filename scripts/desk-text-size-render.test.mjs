import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Renders the real DeskShell header (src/components/desk-chrome.tsx) to
// prove the Large/Normal control the readability pass added is actually in the
// header, next to Light/Dark, with real button semantics (aria-pressed, not
// decoration). Since unit BF2 it is drawn as the design's "Aa Large" button
// rather than a <select>; the behavior it toggles is unchanged. Follows the
// same stub-everything-but-React pattern lead-badge-render.test.mjs uses for
// desk-leads.tsx.
//
// DeskShell reads its Large/Normal choice from localStorage inside a
// useEffect, which renderToStaticMarkup (server rendering, no hydration)
// never runs -- so this only proves the control exists and defaults to
// Normal. Whether `.large` actually lands on the wrapping div for a
// *chosen* Large is proven separately below, against the exported pure
// `deskShellClassName` helper DeskShell itself calls to build that class
// list -- this repo's test toolchain has no jsdom to mount a real,
// interactive DOM and click through it.
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

const REACT_URL = import.meta.resolve("react");

function inlineModule(source) {
  const rewritten = source.replaceAll('"react"', JSON.stringify(REACT_URL));
  return `data:text/javascript;base64,${Buffer.from(rewritten).toString("base64")}`;
}

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
    return "/desk/queue";
  }
`);

const reactQueryStub = inlineModule(`
  export function useQuery() { return { data: [], isPending: false, isError: false }; }
  export function useMutation(opts) {
    return { mutate: () => {}, isError: false, isPending: false, error: null };
  }
  export function useQueryClient() {
    return { invalidateQueries: async () => {} };
  }
`);

const paperContextStub = inlineModule(`
  export function usePaper() {
    return { name: "The Longmont Leader", city: "Longmont" };
  }
  export function usePaperDateFormatters() {
    return { formatDate: () => "Wednesday, September 2, 2026" };
  }
`);

const authGatesStub = inlineModule(`
  import { createElement } from "react";
  export function UserButton() {
    return createElement("span", { className: "user-button-stub" });
  }
`);

const authClientStub = inlineModule(`
  export async function signOut() {}
`);

const useCurrentUserStub = inlineModule(`
  export function useCurrentUserState() {
    return { user: null, isPending: false };
  }
`);

const claimStub = inlineModule(`
  export async function leaveEditor() {
    return { ok: true };
  }
`);

const dialogStub = inlineModule(`
  import { createElement } from "react";
  export function Dialog({ open, title, children, primaryLabel, cancelLabel, onPrimary, onClose }) {
    if (!open) return null;
    return createElement(
      "div",
      { className: "dialog-stub", "data-title": String(title ?? "") },
      createElement("div", null, children),
      createElement("button", { type: "button", onClick: onPrimary }, primaryLabel ?? "OK"),
      createElement("button", { type: "button", onClick: onClose }, cancelLabel ?? "Cancel"),
    );
  }
  export function ChoiceCard({ label, note }) {
    return createElement("span", { className: "choice-stub" }, label ?? note ?? "");
  }
`);

/*
  Redesign BN item 1 put the drawn New-story dialog in the shell header, and it
  reaches it through the dialogs barrel (desk-chrome.tsx imports
  `@/components/dialogs`). The header render below never opens it -- it is a
  controlled dialog, shut until a press -- so the stand-in is one that stays
  shut, exactly what the real one draws while closed. desk-chrome.tsx cannot be
  compiled without the specifier resolving, the same reason the phase 0 Dialog
  is stubbed above.
*/
const newStoryStub = inlineModule(`
  import { createElement } from "react";
  export function NewStoryDialog({ open }) {
    if (!open) return null;
    return createElement("div", { className: "new-story-stub" });
  }
`);

const deskCopyStub = inlineModule(`
  /*
    openLeads is what the shell counts Queue from. The render test does not care
    about the arithmetic, only that the import resolves.
  */
  export function openLeads(leads) {
    return (leads ?? []).filter((l) => l.status !== "killed" && l.status !== "published");
  }
  export function createEditorCopy() {
    return { leave: "Give up the desk", confirm: "", confirmYes: "", confirmNo: "", mismatch: "" };
  }
`);

/*
  DeskShell now reads Light/Dark and Normal/Large from AppearanceProvider
  (src/lib/appearance-context.ts) instead of two local read-on-mount effects
  -- same store, applied before the first paint by the head script in
  __root.tsx. This stub answers with the shipped defaults, which is what a
  server render produces: both controls therefore render in their light /
  Normal states below. `.large` still lands on the wrapping div through the
  same pure helper this test asserts against directly.
*/
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

const deskChromeUtilsUrl = moduleUrl(
  await readFile(new URL("../src/components/desk-chrome-utils.ts", import.meta.url), "utf8"),
  "desk-chrome-utils.ts",
);

/*
  Redesign phase 2a: the job shape, the clock and the m:ss format moved out of
  desk-chrome.tsx into src/components/desk-jobs.ts (react-refresh wants a file
  that exports components to export components only -- desk-chrome.tsx had been
  exporting useNowMs and elapsedLabel besides). Its only bare import is react,
  so the REAL module compiles here and the elapsed format stays single-sourced
  rather than being re-implemented in this stub.
*/
const deskJobsUrl = moduleUrl(
  await readFile(new URL("../src/components/desk-jobs.ts", import.meta.url), "utf8"),
  "desk-jobs.ts",
  { react: import.meta.resolve("react") },
);

const { DeskShell } = await import(
  moduleUrl(
    await readFile(new URL("../src/components/desk-chrome.tsx", import.meta.url), "utf8"),
    "desk-chrome.tsx",
    {
      "@tanstack/react-router": routerStub,
      "@tanstack/react-query": reactQueryStub,
      "@/lib/paper-context-state": paperContextStub,
      "@/lib/auth/gates": authGatesStub,
      "@/lib/auth/client": authClientStub,
      "@/lib/auth/use-current-user": useCurrentUserStub,
      "@/lib/news/claim": claimStub,
      "@/lib/news/desk-copy": deskCopyStub,
      "lucide-react": import.meta.resolve("lucide-react"),
      "@/lib/news/desk": inlineModule(
        "export async function listLeads() { return []; } export async function listRecentStoryWork() { return []; }",
      ),
      "@/lib/news/opinion": inlineModule("export async function listEditorials() { return []; }"),
      "@/components/desk-chrome-utils": deskChromeUtilsUrl,
      "@/components/desk-jobs": deskJobsUrl,
      "@/lib/appearance-context": appearanceContextStub,
      "@/components/dialog": dialogStub,
      "@/components/dialogs": newStoryStub,
      react: import.meta.resolve("react"),
      "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    },
  )
);

const { deskShellClassName } = await import(deskChromeUtilsUrl);

test("the desk exposes accessible appearance and text size controls alongside every section", () => {
  const html = renderToStaticMarkup(
    createElement(DeskShell, { title: "Queue" }, createElement("p", null, "body")),
  );
  assert.match(html, /aria-label="Switch to dark appearance"/);
  /*
    Unit BF2, defect 9: the footer is drawn as buttons -- "Dark" and "Aa Large"
    side by side -- not a text-size <select>. The Large/Normal behavior is the
    same one the select had; only the control changed.
  */
  assert.match(html, /class="astra-foot-row"/);
  assert.match(html, />Dark</);
  assert.match(html, /aria-label="Switch to large text"/);
  assert.match(html, /aria-pressed="false"[^>]*>Aa Large</);
  assert.match(html, /Press \? for keyboard shortcuts/);
  assert.doesNotMatch(html, /<select aria-label="Text size"/);
  for (const route of [
    "/desk",
    "/desk/sources",
    "/desk/scan",
    "/desk/queue",
    "/desk/published",
    "/desk/opinion",
    "/desk/ops",
    "/desk/stats",
    "/desk/dark",
    "/desk/follow-ups",
  ])
    assert.ok(html.includes(`href="${route}"`), route);
  assert.match(html, /id="desk-announcer"[^>]*aria-live="polite"/);
});

test("the Aa control still renders on a forced-night page (Dark Desk), which hides Light/Dark", () => {
  const html = renderToStaticMarkup(
    createElement(DeskShell, { title: "Dark Desk", night: true }, createElement("p", null, "body")),
  );
  assert.doesNotMatch(html, /aria-label="Light or dark"/);
  assert.doesNotMatch(html, /aria-label="Switch to dark appearance"/);
  assert.match(html, /aria-label="Switch to large text"/);
});

test("deskShellClassName adds .large only when size is large, independent of theme", () => {
  assert.equal(deskShellClassName({ mode: "light", size: "normal" }), "desk-ltr");
  assert.equal(deskShellClassName({ mode: "light", size: "large" }), "desk-ltr large");
  assert.equal(deskShellClassName({ mode: "dark", size: "large" }), "desk-ltr night large");
  assert.equal(
    deskShellClassName({ night: true, mode: "light", size: "large" }),
    "desk-ltr night large",
  );
});
