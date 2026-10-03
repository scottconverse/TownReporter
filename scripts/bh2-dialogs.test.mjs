/*
  Unit BH2: the four dialogs and the menu, mounted and pressed.

  WHY THIS FILE EXISTS AT ALL. `scripts/astra-dialog.test.mjs` pins the phase-0
  Dialog by rendering it to a string, which cannot answer the questions unit BH2
  asks: does Cancel keep the reason, does the happy path call the right server
  function with the right payload, is the legal press still gated on REMOVE. A
  string is not a press. So this file mounts the REAL components -- the real
  Radix Dialog, portaled, with focus locking and all -- in an in-process DOM.

  THE DOM, AND ITS BLIND SPOT. The repository documents "no DOM test
  environment", but `linkedom` is already a production dependency (the desk
  parses captured HTML with it) and `react-dom/client` only needs the ~20 globals
  the shim below installs. Everything the dialogs do is therefore exercised for
  real: a click on a portaled footer button reaches the React handler, and a
  state update re-renders the portaled subtree.

  Two things are NOT real, and are marked at each use:

    1. `typeInto` / `setChecked` call the element's own `onChange` with the
       event shape React would hand it, instead of typing. linkedom has no
       default action, so a dispatched keypress would not move a controlled
       input's value -- React's `updateValueIfChanged` compares the node's value
       tracker against `node.value` and suppresses the change. The real keystroke
       path is walked in the browser by `scripts/bh2-dialogs-walk.mjs`.
    2. The server functions are stubs. `@/lib/news/desk` and
       `@/lib/news/legal-removal` open a database at import time. These tests pin
       the CALL the dialog makes -- which function, which payload -- and nothing
       about what the desk then does with it.

  Anything a stub stands in for is named at its definition below.
*/
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { parseHTML } from "linkedom";

/* ------------------------------------------------------------------ the DOM */

const { window, document } = parseHTML(
  "<!doctype html><html><body><div id=root></div></body></html>",
);
try {
  window.location = new URL("http://localhost/");
} catch {
  /* linkedom's location is read-only in some versions; defined below. */
}
if (!window.location)
  Object.defineProperty(window, "location", {
    value: {
      protocol: "http:",
      host: "localhost",
      hostname: "localhost",
      href: "http://localhost/",
      origin: "http://localhost",
      pathname: "/",
      search: "",
      hash: "",
    },
    configurable: true,
  });
globalThis.window = window;
globalThis.document = document;
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
/* Radix's FocusScope asks `isSelectableInput` about HTMLInputElement and walks
   the tree with NodeFilter; neither is on linkedom's window, so both are built
   here. Per-tag constructors come from the element the document actually made. */
const TAG_INTERFACE = {
  input: "HTMLInputElement",
  textarea: "HTMLTextAreaElement",
  select: "HTMLSelectElement",
  button: "HTMLButtonElement",
  option: "HTMLOptionElement",
  a: "HTMLAnchorElement",
  form: "HTMLFormElement",
  label: "HTMLLabelElement",
  div: "HTMLDivElement",
  p: "HTMLParagraphElement",
  span: "HTMLSpanElement",
};
for (const [tag, name] of Object.entries(TAG_INTERFACE)) {
  globalThis[name] = window[name] || document.createElement(tag).constructor;
}
for (const key of [
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "DocumentFragment",
  "SVGElement",
  "MutationObserver",
  "Text",
  "Comment",
])
  if (window[key]) globalThis[key] = window[key];
globalThis.NodeFilter = window.NodeFilter || {
  FILTER_ACCEPT: 1,
  FILTER_REJECT: 2,
  FILTER_SKIP: 3,
  SHOW_ALL: 0xffffffff,
  SHOW_ELEMENT: 1,
  SHOW_TEXT: 4,
};
/* react-remove-scroll reads computed overflow; Radix's Presence reads the
   animation name to decide whether to wait for an animationend. No animation is
   defined for `.astra-modal`, so "none" is also the honest answer here. */
globalThis.getComputedStyle = () => ({
  getPropertyValue: () => "",
  overflow: "visible",
  overflowX: "visible",
  overflowY: "visible",
  paddingRight: "0px",
  position: "static",
  display: "block",
});
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");

/* ------------------------------------------------------- the real components */

/* Every bare specifier a transpiled component imports has to be rewritten: a
   `data:` module has no base to resolve one against. `react` is added to each map
   automatically because every component here imports a hook from it. Anything
   left unmapped fails loudly at import, naming the specifier. */
function moduleUrl(source, fileName, imports = {}) {
  let output = ts.transpileModule(source, {
    fileName,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText;
  const resolved = { react: import.meta.resolve("react"), "react-dom": import.meta.resolve("react-dom"), ...imports };
  for (const [name, url] of Object.entries(resolved)) {
    output = output.replaceAll(JSON.stringify(name), JSON.stringify(url));
  }
  const leftover = [...output.matchAll(/(?:from|import\()\s*"([^".][^"]*)"/g)]
    .map((m) => m[1])
    .filter((specifier) => !/^(data|file|node):/.test(specifier));
  assert.deepEqual(leftover, [], `${fileName} imports a specifier this test does not stub`);
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}
const stub = (body) => `data:text/javascript;base64,${Buffer.from(body).toString("base64")}`;
const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/*
  `InkButton` is reproduced rather than imported: `@/components/desk-chrome`
  pulls in the router, auth, react-query and a dozen contexts, and the only thing
  the dialogs need from it is a real `<button>` that carries `disabled`. The
  class computation is copied verbatim from desk-chrome.tsx:603-608 so the class
  vocabulary these tests see is the one the product renders. What is NOT
  reproduced is DeskShell or any chrome -- nothing here mounts them.
*/
const inkButtonStub = stub(
  `import{createElement}from${JSON.stringify(import.meta.resolve("react"))};
export function InkButton({children,onClick,disabled,tone="solid",type="button",small=false,ariaLabel}){
const cls="btn"+(tone==="solid"||tone==="invert"||tone==="danger"?" solid":"")+(tone==="danger"||tone==="quiet-danger"?" danger":"")+(tone==="quiet"||tone==="quiet-danger"?" quiet":"")+(small?" small":"");
return createElement("button",{type,onClick,disabled,className:cls,"aria-label":ariaLabel},children);}`,
);

/*
  The two server-function modules, recorded. `answer` keeps the whole call so a
  test can assert the payload; `__set*` puts a value in the desk's hands the way
  a real refusal or a real preview response would.
*/
const deskStubSrc = `
export const calls = [];
let mode = "ok";
export function __setMode(next) { mode = next; }
export function __reset() { calls.length = 0; mode = "ok"; }
async function answer(fn, data) {
  calls.push({ fn, data });
  if (mode === "silent") return undefined;
  if (mode === "refuse") return { ok: false, error: "the desk refused" };
  return fn === "suggestCorrectionWording"
    ? { ok: true, wording: "The story said " + data.wasWrong + ", not what it printed." }
    : { ok: true };
}
export const addCorrection = async ({ data }) => answer("addCorrection", data);
export const suggestCorrectionWording = async ({ data }) => answer("suggestCorrectionWording", data);
export const setLeadStatus = async ({ data }) => answer("setLeadStatus", data);
`;
const deskStubUrl = stub(deskStubSrc);
const desk = await import(deskStubUrl);

const legalStubSrc = `
export const calls = [];
let preview = { counts: { articles: 1 }, blockers: [], reviewPending: false, selectedHistorical: [], candidates: [], capturedCopies: [], sharedInvestigationIds: [] };
let fingerprint = "fp-1";
export function __setPreview(next) { preview = next; }
export function __setFingerprint(next) { fingerprint = next; }
export function __reset() { calls.length = 0; }
export const legalPreview = async ({ data }) => {
  calls.push({ fn: "legalPreview", data });
  /* The desk echoes back the scope it reviewed, which is what makes the flow's
     own "is this preview still current" check pass for the selection it just
     sent -- the same thing the real server function does. */
  return { ok: true, value: { ...preview, selection: data, fingerprint } };
};
export const legalConfirm = async ({ data }) => {
  calls.push({ fn: "legalConfirm", data });
  return { ok: true, value: { caseId: "case-1" } };
};
`;
const legalStubUrl = stub(legalStubSrc);
const legal = await import(legalStubUrl);

const modelPickerStubUrl = stub(
  /*
    The real `ModelPicker` takes an `onChange`; a stub without one makes React
    print "a form field without an onChange handler" on every run, which is a
    line of noise in a run that otherwise has none. The no-op keeps the stub
    shaped like the component it stands in for.
  */
  `import{createElement}from${JSON.stringify(import.meta.resolve("react"))};
export function ModelPicker({value,effort,disabled,onChange}){
return createElement("select",{id:"stub-model-picker",value,disabled,onChange:onChange||(()=>{}),"aria-label":"Model and effort"},
createElement("option",{value:"auto"},"Automatic"),createElement("option",{value:effort||"high"},"Effort: "+(effort||"high")));}`,
);

const dialogUrl = moduleUrl(await source("src/components/dialog.tsx"), "dialog.tsx", {
  "./desk-chrome": inkButtonStub,
  "@radix-ui/react-dialog": import.meta.resolve("@radix-ui/react-dialog"),
  react: import.meta.resolve("react"),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
});
const { Dialog } = await import(dialogUrl);

const emptyStubUrl = stub("");

/* UI1a3: the Kill dialog hands the foot its pending word through this module,
   so the REAL one is transpiled and loaded here rather than stubbed. */
const dialogPressUrl = moduleUrl(
  await source("src/lib/news/dialog-press.ts"),
  "dialog-press.ts",
);
const killUrl = moduleUrl(await source("src/components/dialogs/KillDialog.tsx"), "KillDialog.tsx", {
  "@/components/dialog": dialogUrl,
  "@/lib/news/desk": deskStubUrl,
  "@/lib/news/dialog-press": dialogPressUrl,
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
});
const correctionUrl = moduleUrl(
  await source("src/components/dialogs/CorrectionDialog.tsx"),
  "CorrectionDialog.tsx",
  {
    "@/components/dialog": dialogUrl,
    "@/lib/news/desk": deskStubUrl,
    "@/lib/news/correction-wording": moduleUrl(
      await source("src/lib/news/correction-wording.ts"),
      "correction-wording.ts",
      { "./request-input.ts": stub("export const LIMITS = { correctionBody: 2000, correctionLine: 400 };") },
    ),
    "@/lib/paper": moduleUrl(await source("src/lib/paper.ts"), "paper.ts"),
    "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  },
);
const legalUrl = moduleUrl(
  await source("src/components/dialogs/LegalRemovalDialog.tsx"),
  "LegalRemovalDialog.tsx",
  {
    "@/components/dialog": dialogUrl,
    "@/components/desk-chrome": inkButtonStub,
    "@/lib/news/legal-removal": legalStubUrl,
    "@/lib/news/legal-removal-types": emptyStubUrl,
    "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  },
);
const redraftUrl = moduleUrl(
  await source("src/components/dialogs/RedraftDialog.tsx"),
  "RedraftDialog.tsx",
  {
    "@/components/dialog": dialogUrl,
    "@/components/model-picker": modelPickerStubUrl,
    "@/lib/news/model-choice": emptyStubUrl,
    "@/lib/news/provider-registry": emptyStubUrl,
    "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  },
);
const compareUrl = moduleUrl(
  await source("src/components/dialogs/CompareVersionsDialog.tsx"),
  "CompareVersionsDialog.tsx",
  {
    "@/components/dialog": dialogUrl,
    "@/components/draft-reconcile-control": emptyStubUrl,
    "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  },
);
const moreUrl = moduleUrl(
  await source("src/components/dialogs/PublishedMoreMenu.tsx"),
  "PublishedMoreMenu.tsx",
  {
    "@/components/dialog": dialogUrl,
    "@/components/desk-chrome": inkButtonStub,
    "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  },
);

const { KillDialog } = await import(killUrl);
const { CorrectionDialog } = await import(correctionUrl);
const { LegalRemovalDialog, LegalRemovalFlow } = await import(legalUrl);
const { RedraftDialog } = await import(redraftUrl);
const { CompareVersionsDialog } = await import(compareUrl);
const { PublishedMoreMenu } = await import(moreUrl);

/* --------------------------------------------------------------- the helpers */

/*
  A test that throws mid-way leaves its dialog OPEN in the document, and a Radix
  portal is one shared body: the next test's `document.querySelectorAll("textarea")`
  would then be reading the previous dialog's boxes. The cleanup runs whether the
  test passed or threw, so the failures above are about the components and not
  about the test next door.
*/
const live = [];
test.afterEach(async () => {
  for (const page of live.splice(0)) await page.close();
});

async function mount(element) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(element);
  });
  const page = {
    container,
    async rerender(next) {
      await React.act(async () => {
        root.render(next);
      });
    },
    async click(node) {
      assert.ok(node, "expected a control to press");
      await React.act(async () => {
        node.dispatchEvent(new window.Event("click", { bubbles: true }));
      });
      await settle();
    },
    /** Blind spot 1: the handler, not a keystroke. */
    async typeInto(node, value) {
      assert.ok(node, "expected a field to type into");
      await React.act(async () => {
        propsOf(node).onChange({ target: { value } });
      });
    },
    /** Blind spot 1, for a checkbox: linkedom has no activation behavior. */
    async setChecked(node, checked) {
      assert.ok(node, "expected a checkbox");
      await React.act(async () => {
        propsOf(node).onChange({ target: { checked } });
      });
    },
    async close() {
      await React.act(async () => {
        root.unmount();
      });
      container.remove();
      for (const layer of document.querySelectorAll(".astra-modal-layer")) layer.remove();
    },
  };
  live.push(page);
  return page;
}

/** Flush the server-function promise chain and React's work. */
async function settle() {
  await React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function propsOf(node) {
  const key = Object.keys(node).find((name) => name.startsWith("__reactProps$"));
  assert.ok(key, "expected React to have attached props to this node");
  return node[key];
}
const buttons = () => [...document.querySelectorAll("button")];
const button = (label) =>
  buttons().find((b) => (b.textContent ?? "").trim().split("\n")[0].trim() === label);
const radio = (label) =>
  buttons().find(
    (b) => b.getAttribute("role") === "radio" && (b.textContent ?? "").startsWith(label),
  );
/* The last portaled layer is the dialog this test is driving; earlier layers
   would be a leak, and the cleanup above means there are none. */
const lastLayer = () => [...document.querySelectorAll(".astra-modal-layer")].at(-1) ?? document.body;
const field = (selector) => lastLayer().querySelector(`.astra-modal-body ${selector}`);
const fields = (selector) => [...lastLayer().querySelectorAll(`.astra-modal-body ${selector}`)];

/*
  A controlled <textarea>'s painted text, read the way THIS DOM exposes it.
  MEASURED, not assumed (`work/probe-textarea.mjs` printed all four columns):
  React writes a textarea's `value` as a property only when it UPDATES one. On
  MOUNT it sets `defaultValue` and never touches `.value`, and linkedom's
  `.value` getter mirrors the child text node -- which React leaves empty. So a
  box React mounted with a value reads `""` from `.value` and its text from
  `.defaultValue`; a box React has re-rendered since reads from `.value`. React
  keeps both in step on update, so a deliberately cleared box still reads `""`
  and this helper does not resurrect a stale mount value. `<input>` needs none
  of it -- React sets both there at mount, which is why the input reads below
  use `.value` directly, and why the first run of this file failed on exactly
  the four textarea reads that had not been updated since mount. A real browser
  needs neither branch; `scripts/bh2-dialogs-walk.mjs` is what covers that.
*/
const text = (node) => (node.value !== "" ? node.value : (node.defaultValue ?? ""));
const openHost = (make, initial = true) =>
  React.createElement(function Host() {
    const [open, setOpen] = React.useState(initial);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement("button", { id: "reopen", onClick: () => setOpen(true) }, "reopen"),
      make(open, setOpen),
    );
  });
const reopen = async (page) => {
  await page.click(document.getElementById("reopen"));
};

/* ------------------------------------------------------------------- static */

test("a closed Dialog renders to static markup without throwing and paints no layer", () => {
  const html = renderToStaticMarkup(
    React.createElement(Dialog, {
      open: false,
      onClose() {},
      title: "Kill this lead",
      primaryLabel: "Kill with this reason",
      onPrimary() {},
    }),
  );
  assert.equal(html, "");
  assert.doesNotMatch(html, /astra-modal-layer|astra-modal/);
  /*
    Unit BH2 decision 1 also says the OPEN dialog must not throw on the server:
    Radix's Portal is what renders nothing there, and the fix must not have
    replaced that with something that reaches for `document`.
  */
  const openHtml = renderToStaticMarkup(
    React.createElement(Dialog, {
      open: true,
      onClose() {},
      title: "Kill this lead",
      primaryLabel: "Kill with this reason",
      onPrimary() {},
    }),
  );
  assert.equal(openHtml, "");
});

test("the story page mounts the three dialogs, and the legal page mounts the shared dialog", async () => {
  const story = await source("src/routes/desk.story.$leadId.tsx");
  for (const name of ["KillDialog", "RedraftDialog", "CompareVersionsDialog"]) {
    assert.match(story, new RegExp(`import \\{[^}]*${name}`), `the story page must import ${name}`);
    assert.match(story, new RegExp(`<${name}\\b`), `the story page must mount <${name}>`);
  }
  assert.match(story, /<KillDialog[\s\S]{0,200}?leadId=\{/, "the Kill dialog takes the lead id");
  const route = await source("src/routes/desk.legal-removals.tsx");
  assert.match(route, /import \{ LegalRemovalDialog \} from "@\/components\/dialogs\/LegalRemovalDialog"/);
  assert.match(route, /<LegalRemovalDialog\b/);
  /*
    One gate, one flow. If a second copy of the REMOVE comparison appears, one of
    the two surfaces has quietly become the soft one.
  */
  const flow = await source("src/components/dialogs/LegalRemovalDialog.tsx");
  assert.equal(
    flow.split('confirm !== "REMOVE"').length - 1,
    1,
    "the REMOVE gate must exist exactly once in the flow",
  );
  assert.equal(
    route.split('confirm !== "REMOVE"').length - 1,
    0,
    "the route must re-derive no part of the REMOVE gate",
  );
  assert.equal(
    route.split("legalConfirm").length - 1,
    0,
    "the route must not call legalConfirm itself",
  );
});

test("Published opens Correction and Legal removal in the existing dialogs", async () => {
  const published = await source("src/routes/desk.published.tsx");
  assert.match(published, /<Dialog\b[\s\S]*?title="Add a correction"/);
  assert.match(published, /Preview · the note as readers will see it/);
  assert.match(published, /<LegalRemovalDialog\b/);
  assert.doesNotMatch(published, /href=\{`\/desk\/legal-removals\?article=/);
});

/* --------------------------------------------------------------------- kill */

test("the Kill dialog draws its quick fills, reason and link, with the reason required", async () => {
  const page = await mount(
    openHost((open, setOpen) =>
      React.createElement(KillDialog, { leadId: 7, open, onOpenChange: setOpen }),
    ),
  );
  const text = lastLayer().textContent;
  assert.match(text, /Kill this lead/);
  /* The four quick fills by their names. Two of them carry a short note; the
     other two draw none, which is why the reasons they write -- "Outside our
     coverage area.", "The source is unusable…" -- are asserted from the box in
     the test below rather than looked for here. */
  assert.match(text, /Not news/);
  assert.match(text, /Already printed/);
  assert.match(text, /Outside our area/);
  assert.match(text, /Bad source or unreadable/);
  assert.match(text, /Routine notice, no public interest/);
  assert.match(text, /Matches a story we ran/);
  assert.equal(button("Kill with this reason").disabled, true, "an empty reason cannot kill");
  assert.equal(button("Kill, no reason").disabled, false);
  assert.ok(field("textarea"), "the reason is a box, not a single line");
  await page.close();
});

test("a quick fill writes the reason in the editor's words, and the press then works", async () => {
  desk.__reset();
  const page = await mount(
    openHost((open, setOpen) =>
      React.createElement(KillDialog, { leadId: 7, open, onOpenChange: setOpen }),
    ),
  );
  await page.click(radio("Not news"));
  assert.equal(text(field("textarea")), "Routine notice with no public interest.");
  assert.equal(radio("Not news").getAttribute("aria-checked"), "true");
  assert.equal(button("Kill with this reason").disabled, false);
  await page.close();
});

test("the happy kill sends the reason, and no link when none was given", async () => {
  desk.__reset();
  let killed = 0;
  const page = await mount(
    openHost((open, setOpen) =>
      React.createElement(KillDialog, {
        leadId: 7,
        open,
        onOpenChange: setOpen,
        onKilled: () => {
          killed += 1;
        },
      }),
    ),
  );
  await page.click(radio("Already printed"));
  await page.click(button("Kill with this reason"));
  assert.deepEqual(desk.calls, [
    {
      fn: "setLeadStatus",
      data: {
        id: 7,
        status: "killed",
        killReason: "Matches a story we have already printed.",
        killReasonUrl: undefined,
      },
    },
  ]);
  assert.equal(killed, 1, "the page is told, so it can refetch the lead");
  assert.equal(document.querySelectorAll(".astra-modal-layer").length, 0, "a landed kill closes");
  await page.close();
});

test("a link is sent with the reason, and is never sent on its own", async () => {
  desk.__reset();
  const page = await mount(
    openHost((open, setOpen) =>
      React.createElement(KillDialog, { leadId: 7, open, onOpenChange: setOpen }),
    ),
  );
  await page.click(radio("Outside our area"));
  await page.typeInto(field('input[type="url"]'), "https://example.test/notice");
  await page.click(button("Kill with this reason"));
  assert.deepEqual(desk.calls[0].data, {
    id: 7,
    status: "killed",
    killReason: "Outside our coverage area.",
    killReasonUrl: "https://example.test/notice",
  });
  await page.close();
});

test("'Kill, no reason' kills without a reason at all", async () => {
  desk.__reset();
  const page = await mount(
    openHost((open, setOpen) =>
      React.createElement(KillDialog, { leadId: 7, open, onOpenChange: setOpen }),
    ),
  );
  assert.equal(button("Kill, no reason").disabled, false, "no reason is allowed");
  await page.click(button("Kill, no reason"));
  assert.deepEqual(desk.calls, [
    { fn: "setLeadStatus", data: { id: 7, status: "killed", killReason: undefined, killReasonUrl: undefined } },
  ]);
  await page.close();
});

test("Cancel keeps the lead and keeps the reason", async () => {
  desk.__reset();
  const page = await mount(
    openHost((open, setOpen) =>
      React.createElement(KillDialog, { leadId: 7, open, onOpenChange: setOpen }),
    ),
  );
  await page.click(radio("Bad source or unreadable"));
  await page.typeInto(field('input[type="url"]'), "https://example.test/scan.pdf");
  await page.click(button("Cancel"));
  assert.equal(desk.calls.length, 0, "Cancel must not touch the lead");
  assert.equal(document.querySelectorAll(".astra-modal-layer").length, 0);
  await reopen(page);
  assert.equal(
    text(field("textarea")),
    "The source is unusable, or the document cannot be read.",
    "the box is exactly as it was left",
  );
  assert.equal(field('input[type="url"]').value, "https://example.test/scan.pdf");
  await page.close();
});

test("a refused kill keeps the box and says so, and nothing closes", async () => {
  desk.__reset();
  desk.__setMode("refuse");
  const page = await mount(
    openHost((open, setOpen) =>
      React.createElement(KillDialog, { leadId: 7, open, onOpenChange: setOpen }),
    ),
  );
  await page.click(radio("Not news"));
  await page.click(button("Kill with this reason"));
  assert.equal(document.querySelector('[role="alert"]').textContent, "The desk refused that kill. The lead is unchanged.");
  assert.equal(text(field("textarea")), "Routine notice with no public interest.");
  assert.equal(document.querySelectorAll(".astra-modal-layer").length, 1, "the dialog stays open");
  desk.__setMode("ok");
  await page.close();
});

/* --------------------------------------------------------------- correction */

test("the correction dialog defaults to leaving the story text as is", async () => {
  const page = await mount(
    openHost((open, setOpen) =>
      React.createElement(CorrectionDialog, {
        articleSlug: "the-fee",
        articleBody: "The fee was $4,200.",
        open,
        onOpenChange: setOpen,
        formatDate: () => "Sep 26",
      }),
    ),
  );
  assert.match(document.body.textContent, /Add a correction/);
  assert.equal(radio("Leave the story text as is").getAttribute("aria-checked"), "true");
  assert.equal(radio("Also fix the story text").getAttribute("aria-checked"), "false");
  assert.equal(
    fields("textarea").length,
    3,
    "two lines and the note; the printed text box only appears once asked for",
  );
  assert.equal(button("Post as a plain note").disabled, true, "an empty note cannot post");
  assert.equal(button("Suggest wording (AI)").disabled, true, "nothing to suggest from yet");
  await page.close();
});

test("the correction note is the desk's own sentence, and posting sends the call the inline form sends", async () => {
  desk.__reset();
  let posted = 0;
  const page = await mount(
    openHost((open, setOpen) =>
      React.createElement(CorrectionDialog, {
        articleSlug: "the-fee",
        articleBody: "The fee was $4,200.",
        open,
        onOpenChange: setOpen,
        reviewId: 31,
        reviewLabel: "Linked: 1 open request on this story",
        onPosted: () => {
          posted += 1;
        },
        formatDate: () => "Sep 26",
      }),
    ),
  );
  const boxes = fields("textarea");
  await page.typeInto(boxes[0], "the fee was $4,200.");
  await page.typeInto(boxes[1], "it was $4,000");
  /* The note is written by the desk, with no model and no network: one click of
     "Suggest wording (AI)" was never needed for the box to fill. */
  assert.equal(text(fields("textarea")[2]), "An earlier version of this story said the fee was $4,200. In fact, it was $4,000.");
  assert.equal(button("Suggest wording (AI)").disabled, false);
  assert.equal(button("Post as a plain note").disabled, false);
  await page.click(button("Post as a plain note"));
  assert.deepEqual(desk.calls, [
    {
      fn: "addCorrection",
      data: {
        articleSlug: "the-fee",
        body: "An earlier version of this story said the fee was $4,200. In fact, it was $4,000.",
        meetingReviewId: 31,
        alsoFixBody: false,
        storyBody: undefined,
      },
    },
  ]);
  assert.equal(posted, 1);
  assert.equal(document.querySelectorAll(".astra-modal-layer").length, 0);
  await page.close();
});

test("asking for the story text to be fixed adds the printed body to the call", async () => {
  desk.__reset();
  const page = await mount(
    openHost((open, setOpen) =>
      React.createElement(CorrectionDialog, {
        articleSlug: "the-fee",
        articleBody: "The fee was $4,200.",
        open,
        onOpenChange: setOpen,
        formatDate: () => "Sep 26",
      }),
    ),
  );
  const boxes = () => fields("textarea");
  await page.typeInto(boxes()[0], "the fee was $4,200.");
  await page.typeInto(boxes()[1], "it was $4,000");
  await page.click(radio("Also fix the story text"));
  assert.equal(boxes().length, 4, "the printed text box appears");
  assert.equal(text(boxes()[2]), "The fee was $4,200.", "seeded from the story's own body");
  await page.typeInto(boxes()[2], "The fee was $4,000.");
  await page.click(button("Post as a plain note"));
  assert.equal(desk.calls[0].fn, "addCorrection");
  assert.equal(desk.calls[0].data.alsoFixBody, true);
  assert.equal(desk.calls[0].data.storyBody, "The fee was $4,000.");
  await page.close();
});

test("suggesting wording posts nothing, and Cancel keeps the two lines", async () => {
  desk.__reset();
  const page = await mount(
    openHost((open, setOpen) =>
      React.createElement(CorrectionDialog, {
        articleSlug: "the-fee",
        open,
        onOpenChange: setOpen,
        formatDate: () => "Sep 26",
      }),
    ),
  );
  await page.typeInto(fields("textarea")[0], "the fee was $4,200");
  await page.typeInto(fields("textarea")[1], "it was $4,000");
  await page.click(button("Suggest wording (AI)"));
  assert.deepEqual(desk.calls, [
    {
      fn: "suggestCorrectionWording",
      data: { articleSlug: "the-fee", wasWrong: "the fee was $4,200", isRight: "it was $4,000" },
    },
  ]);
  assert.equal(
    text(fields("textarea")[2]),
    "The story said the fee was $4,200, not what it printed.",
    "the suggestion wins from then on",
  );
  await page.click(button("Cancel"));
  assert.equal(desk.calls.length, 1, "Cancel posts nothing");
  await reopen(page);
  assert.equal(text(fields("textarea")[0]), "the fee was $4,200");
  assert.equal(text(fields("textarea")[1]), "it was $4,000");
  await page.close();
});

/* ------------------------------------------------------------ legal removal */

const ARTICLES = [
  { id: 1, headline: "Council approves the fee rise" },
  { id: 2, headline: "Bridge closes for repairs" },
];
const previewResponse = (over = {}) => ({
  counts: { articles: 1, drafts: 0 },
  blockers: [],
  reviewPending: false,
  selectedHistorical: [],
  candidates: [],
  capturedCopies: [],
  sharedInvestigationIds: [],
  ...over,
});

test("legal removal cannot be pressed until the reason and REMOVE are both given", async () => {
  legal.__reset();
  legal.__setPreview(previewResponse());
  const page = await mount(
    openHost((open, setOpen) =>
      React.createElement(LegalRemovalDialog, {
        open,
        onOpenChange: setOpen,
        articleId: 1,
        articles: ARTICLES,
      }),
    ),
  );
  const press = () => button("Remove permanently");
  assert.match(document.body.textContent, /Legal removal/);
  assert.equal(press().disabled, true, "the drawn gate: no reason and no REMOVE");

  /*
    Unit BH3 decision 1: this surface opens on ONE story, so it has no step one
    to press. It asks the desk for the counts itself, at mount, with the same
    `legalPreview` call the route's "Review connected copies" press makes.
  */
  await settle();
  assert.equal(legal.calls[0].fn, "legalPreview");
  assert.deepEqual(legal.calls[0].data.articleIds, [1], "the opened story is the scope");
  assert.equal(press().disabled, true, "a measured scope alone is not enough");
  assert.equal(button("Review connected copies"), undefined, "no picker press on this surface");

  const reason = field('input[placeholder="e.g. Court order, case no. …"]');
  const confirm = field('input[placeholder="REMOVE"]');
  await page.typeInto(reason, "Court order, case no. 4-2026");
  assert.equal(press().disabled, true, "a reason alone is not enough");
  await page.typeInto(confirm, "REMOVE");
  assert.equal(press().disabled, false, "reason and REMOVE together are the gate");

  /*
    A blocker the desk reported closes the gate again, even with both. The
    counts are re-asked by shutting the dialog and opening it again, which is
    the only way this surface asks twice -- the auto-load fires once per mount.
  */
  legal.__setPreview(previewResponse({ blockers: ["Court destruction is blocked until captured copies are resolved."] }));
  await page.click(button("Cancel"));
  await reopen(page);
  await settle();
  assert.equal(legal.calls.at(-1).fn, "legalPreview", "reopening asks the desk again");
  assert.match(document.body.textContent, /Court destruction is blocked/);
  await page.typeInto(field('input[placeholder="e.g. Court order, case no. …"]'), "Court order, case no. 4-2026");
  await page.typeInto(field('input[placeholder="REMOVE"]'), "REMOVE");
  assert.equal(press().disabled, true, "a blocker closes the press");

  /* Destruction while evidence review is pending closes it too. */
  legal.__setPreview(previewResponse({ reviewPending: true }));
  await page.click(button("Cancel"));
  await reopen(page);
  await settle();
  const reason2 = field('input[placeholder="e.g. Court order, case no. …"]');
  const confirm2 = field('input[placeholder="REMOVE"]');
  await page.typeInto(reason2, "Court order, case no. 4-2026");
  await page.typeInto(confirm2, "REMOVE");
  assert.equal(press().disabled, false, "a sealed copy may proceed with review pending");
  await page.click(radio("Keep nothing: a court order requires destruction"));
  assert.equal(press().disabled, true, "changing the rule clears the typed REMOVE");
  await page.typeInto(confirm2, "REMOVE");
  assert.equal(press().disabled, true, "destruction cannot proceed with review pending");
  await page.click(radio("Keep an owner-only copy for 12 months"));
  await page.typeInto(confirm2, "REMOVE");
  assert.equal(press().disabled, false, "a sealed copy may proceed with review pending");
  await page.setChecked(field('input[type="checkbox"]'), true);
  assert.equal(press().disabled, true, "a changed selection invalidates the measured scope");
  assert.ok(button("Review connected copies"), "the dialog keeps the existing refresh action available");
  await page.click(button("Review connected copies"));
  assert.equal(legal.calls.at(-1).data.reviewedLegacy, true, "refresh measures the updated selection");
  await page.typeInto(field('input[placeholder="REMOVE"]'), "REMOVE");
  assert.equal(press().disabled, false, "only a fresh preview and retyped REMOVE reopen the gate");
  await page.close();
});

test("the confirmed removal sends the scope, the fingerprint, the rule and the reason", async () => {
  legal.__reset();
  legal.__setPreview(previewResponse());
  legal.__setFingerprint("fp-9");
  const done = [];
  const page = await mount(
    openHost((open, setOpen) =>
      React.createElement(LegalRemovalDialog, {
        open,
        onOpenChange: setOpen,
        articleId: 1,
        articles: ARTICLES,
        onConfirmed: (caseId) => {
          done.push(caseId);
        },
        onDone: () => done.push("done"),
      }),
    ),
  );
  await settle();
  assert.equal(legal.calls[0].fn, "legalPreview", "the drawn dialog asks the desk on its own");
  assert.deepEqual(legal.calls[0].data.articleIds, [1], "the opened story is the scope");
  await page.typeInto(field('input[placeholder="e.g. Court order, case no. …"]'), "Court order, case no. 4-2026");
  await page.typeInto(field('input[placeholder="REMOVE"]'), "REMOVE");
  await page.click(button("Remove permanently"));
  const confirmCall = legal.calls.find((c) => c.fn === "legalConfirm");
  assert.ok(confirmCall, "the press must reach the desk");
  assert.equal(confirmCall.data.fingerprint, "fp-9");
  assert.equal(confirmCall.data.policy, "retain");
  assert.equal(confirmCall.data.caseRef, "Court order, case no. 4-2026");
  assert.deepEqual(confirmCall.data.selection.articleIds, [1]);
  assert.deepEqual(done, ["case-1", "done"], "the page is told the case id, then allowed to refetch");
  assert.equal(document.querySelectorAll(".astra-modal-layer").length, 0);
  await page.close();
});

test("the route's own drawing is the same flow and the same gate", async () => {
  /*
    `desk.legal-removals.tsx` renders this component without `onPressChange`, so
    the flow draws the danger press and the return link itself. If the two
    surfaces ever diverge, this is where it shows: the same steps that enable the
    dialog's footer must enable this button, and no step fewer.
  */
  legal.__reset();
  legal.__setPreview(previewResponse());
  const confirmed = [];
  const page = await mount(
    React.createElement(LegalRemovalFlow, {
      articles: ARTICLES,
      initialArticleIds: [2],
      onConfirmed: (caseId) => confirmed.push(caseId),
    }),
  );
  /* This surface draws its press only once there is a preview to act on, so
     before that there is nothing to press and no way back to Published either. */
  assert.equal(document.querySelector(".astra-flow-press"), null);
  await page.click(button("Review connected copies"));
  assert.deepEqual(legal.calls[0].data.articleIds, [2], "the ?article= entry point is still the scope");
  const pressNow = () => button("Remove selected stories and connected copies");
  assert.ok(pressNow(), "the route still gets its own press");
  assert.equal(pressNow().disabled, true);
  assert.ok(
    document.querySelector('a[href="/desk/published"]'),
    "the route still gets its way back to Published",
  );
  await page.typeInto(
    document.querySelector('input[placeholder="e.g. Court order, case no. …"]'),
    "Owner request, ref 88",
  );
  assert.equal(pressNow().disabled, true, "REMOVE is still required on this surface too");
  await page.typeInto(document.querySelector('input[placeholder="REMOVE"]'), "REMOVE");
  assert.equal(pressNow().disabled, false);
  await page.click(pressNow());
  assert.deepEqual(confirmed, ["case-1"]);
  await page.close();
});

/* ------------------------------------------------- redraft, compare, the menu */

test("the redraft dialog starts from the saved direction and sends what is typed", async () => {
  const started = [];
  const page = await mount(
    openHost((open, setOpen) =>
      React.createElement(RedraftDialog, {
        open,
        onOpenChange: setOpen,
        direction: "cut the second paragraph",
        modelChoice: "auto",
        modelEffort: null,
        onModelChange() {},
        onEffortChange() {},
        onStart: (what) => started.push(what),
      }),
    ),
  );
  assert.match(document.body.textContent, /Redraft/);
  assert.equal(text(field("textarea")), "cut the second paragraph", "the saved direction seeds the box");
  assert.match(document.body.textContent, /My headline and my edits/);
  assert.equal(document.querySelector("#stub-model-picker").value, "auto", "the desk's own picker");
  await page.typeInto(field("textarea"), "lead with the cancellation");
  await page.click(button("Start redraft"));
  assert.deepEqual(started, ["lead with the cancellation"]);
  await page.close();
});

test("compare versions offers the two decisions the evidence check already offers", async () => {
  const kept = [];
  const restored = [];
  /* One word taken out and two put in, so both halves of the mark-up are
     exercised: a version with only an insertion has nothing to strike through. */
  const review = {
    original: { headline: "Council approves the fee rise", dek: "", body: "", topic: "" },
    checked: { headline: "Council approves the 4% price rise", dek: "", body: "", topic: "" },
    integrityNotes: "Check the figure with the clerk.",
  };
  const page = await mount(
    openHost((open, setOpen) =>
      React.createElement(CompareVersionsDialog, {
        open,
        onOpenChange: setOpen,
        review,
        onKeepChecked: () => kept.push("keep"),
        onRestoreOriginal: () => restored.push("restore"),
      }),
    ),
  );
  assert.match(document.body.textContent, /Compare versions/);
  assert.ok(document.querySelector(".astra-diff-add"), "the added words are marked");
  assert.ok(document.querySelector(".astra-diff-del"), "the removed words are struck through");
  assert.match(document.body.textContent, /Check the figure with the clerk/);
  await page.click(button("Restore previous"));
  await page.click(button("Keep checked version"));
  assert.deepEqual(restored, ["restore"]);
  assert.deepEqual(kept, ["keep"]);
  await page.close();
});

test("the More menu draws only the rows it was given, and closes before the row runs", async () => {
  const ran = [];
  const page = await mount(
    openHost((open, setOpen) =>
      React.createElement(PublishedMoreMenu, {
        open,
        onOpenChange: setOpen,
        headline: "Council approves the fee rise",
        printedLabel: "printed Sep 25",
        onAddCorrection: () => ran.push("correction"),
        onLegalRemoval: () => ran.push("legal"),
      }),
    ),
  );
  assert.match(document.body.textContent, /More for this story/);
  assert.match(document.body.textContent, /Council approves the fee rise · printed Sep 25/);
  const rows = [...document.querySelectorAll(".astra-menu-row")];
  assert.deepEqual(
    rows.map((r) => r.querySelector("b").textContent),
    ["Add a correction", "Legal removal…"],
    "a row with no handler is not drawn: no update path exists yet",
  );
  assert.equal(rows[1].className, "astra-menu-row is-danger", "the legal row is the marked one");
  await page.click(button("Start"));
  assert.deepEqual(ran, ["legal"]);
  assert.equal(document.querySelectorAll(".astra-modal-layer").length, 0, "the menu closes first");
  await page.close();
});
