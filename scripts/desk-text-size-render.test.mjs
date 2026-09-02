import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Renders the real DeskShell header (src/components/desk-chrome.tsx) to
// prove the "Text: Normal / Large" control the readability pass added is
// actually in the header, next to Light/Dark, with real button semantics
// (aria-pressed, not decoration). Follows the same stub-everything-but-React
// pattern lead-badge-render.test.mjs uses for desk-leads.tsx.
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
  export function Link({ to, children, ...rest }) {
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

const deskCopyStub = inlineModule(`
  export function createEditorCopy() {
    return { leave: "Give up the desk", confirm: "", confirmYes: "", confirmNo: "", mismatch: "" };
  }
`);

const { DeskShell, deskShellClassName } = await import(
  moduleUrl(
    await readFile(new URL("../src/components/desk-chrome.tsx", import.meta.url), "utf8"),
    "desk-chrome.tsx",
    {
      "@tanstack/react-router": routerStub,
      "@tanstack/react-query": reactQueryStub,
      "@/lib/paper-context": paperContextStub,
      "@/lib/auth/gates": authGatesStub,
      "@/lib/auth/client": authClientStub,
      "@/lib/auth/use-current-user": useCurrentUserStub,
      "@/lib/news/claim": claimStub,
      "@/lib/news/desk-copy": deskCopyStub,
      react: import.meta.resolve("react"),
      "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    },
  )
);

test("the desk header shows a Text: Normal / Large control next to Light/Dark", () => {
  const html = renderToStaticMarkup(
    createElement(DeskShell, { title: "Queue" }, createElement("p", null, "body")),
  );
  assert.match(html, /Light/);
  assert.match(html, /Dark/);
  assert.match(html, /Text: Normal/);
  assert.match(html, /Large/);
  // Two <button> elements with real aria-pressed semantics, not decoration.
  assert.match(html, /aria-label="Text size"/);
  assert.match(html, /aria-pressed="true"[^>]*>Text: Normal/);
  assert.match(html, /aria-pressed="false"[^>]*>Large/);
});

test("the Text size control still renders on a forced-night page (Dark Desk), which hides Light/Dark", () => {
  const html = renderToStaticMarkup(
    createElement(DeskShell, { title: "Dark Desk", night: true }, createElement("p", null, "body")),
  );
  assert.doesNotMatch(html, /aria-label="Light or dark"/);
  assert.match(html, /aria-label="Text size"/);
});

test("deskShellClassName adds .large only when size is large, independent of theme", () => {
  assert.equal(
    deskShellClassName({ mode: "light", size: "normal" }),
    "desk-ltr",
  );
  assert.equal(
    deskShellClassName({ mode: "light", size: "large" }),
    "desk-ltr large",
  );
  assert.equal(
    deskShellClassName({ mode: "dark", size: "large" }),
    "desk-ltr night large",
  );
  assert.equal(
    deskShellClassName({ night: true, mode: "light", size: "large" }),
    "desk-ltr night large",
  );
});
