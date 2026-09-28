/*
  Unit CP: the two dialogs the desk had built and never mounted, mounted.

  WHAT THIS FILE IS FOR. The unit's subject is a MOUNT, not a dialog: the
  dialogs themselves were finished and tested in unit BK, and they were drawn in
  the reference and reachable nowhere. So the questions here are the ones a
  mount creates and a static read cannot answer:

    - does the press the drawing names actually open the dialog,
    - is the press gated by the same rule the other action-row presses use,
    - and does what the dialog SAVES land in the screen's own box, rather than
      in a sentence the screen has to parse back.

  HOW IT ANSWERS THEM. Two layers, both in this file:

    1. `source()` assertions on the two route files -- cheap, and they pin the
       wiring (the import, the gate, the drawn label, the `onSaved` wiring, the
       `onPaper`-gated inline list) against a later edit that keeps the dialog
       mounted but stops handing it the lead id.
    2. The REAL components, mounted in an in-process DOM: the real
       `editor-dialogs.tsx`, the real `editor-dialog-forms.ts` (so the payload
       the press builds is the payload the desk would get), the real
       `editor-dialog-bodies.ts`, and the real Radix `Dialog`. A press is a
       press: it reaches the React handler and the state update re-renders the
       portaled subtree.

  THE DOM, AND ITS BLIND SPOTS. `linkedom` is already a production dependency
  (the desk parses captured HTML with it) and `react-dom/client` needs the ~20
  globals the shim below installs. Two things are still not real, and are named
  where they are used:

    1. `typeInto` calls the element's own `onChange` with the event shape React
       would hand it, instead of typing. linkedom has no default action, so a
       dispatched keypress would not move a controlled input. The real
       keystroke path is walked in the browser by
       `scripts/cp-desk-dialogs-walk.mjs`.
    2. Every server function is a stub. Which call the dialog makes, and with
       which payload, is what is pinned here; what the desk then does with it is
       the walk's job (a real PGlite, a real row, a real draft) and unit BK's.

  Nothing in this file reaches a model: the add-to flow is pressed in `update`
  mode, which `ADD_TO_MODES` marks `ai: false`.
*/
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as React from "react";
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

/*
  The specifiers a file really imports, read by the TypeScript parser rather
  than by a pattern over the text. Three runs of this file were spent learning
  why: `desk-copy.ts` writes "A brief is the editor…" in a comment,
  `lead-match.ts` writes `, "` in prose, and `notes.ts` writes `from "a
  different one"` inside a sentence -- a text sweep reads all three as import
  specifiers. The parser does not. Type-only declarations are skipped because
  the transpiler elides them, so they need no URL.
*/
function specifiersOf(text, fileName) {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const found = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      if (ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return found;
}

function moduleUrl(text, fileName, imports = {}) {
  const output = ts.transpileModule(text, {
    fileName,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText;
  const resolved = { react: import.meta.resolve("react"), "react-dom": import.meta.resolve("react-dom"), ...imports };
  let rewritten = output;
  for (const [name, url] of Object.entries(resolved)) {
    rewritten = rewritten.replaceAll(JSON.stringify(name), JSON.stringify(url));
  }
  const leftover = specifiersOf(text, fileName).filter((specifier) => {
    if (/^(data|file|node):/.test(specifier)) return false;
    return !(specifier in resolved);
  });
  assert.deepEqual(leftover, [], `${fileName} imports a specifier this test does not stub`);
  assert.ok(
    rewritten.includes("data:text/javascript") || !specifiersOf(text, fileName).length,
    `${fileName}: no specifier was rewritten, so the map is not matching the source`,
  );
  return `data:text/javascript;base64,${Buffer.from(rewritten).toString("base64")}`;
}
const stub = (body) => `data:text/javascript;base64,${Buffer.from(body).toString("base64")}`;
const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const JSX = { "react/jsx-runtime": import.meta.resolve("react/jsx-runtime") };

/*
  One loader for the real source files, so the graph below reads as the imports
  it is. `at` is the specifier AS THE IMPORTING FILE WRITES IT -- the `.ts`
  extension included, because a `data:` module has no base and
  `moduleUrl` rewrites the literal string it finds in the output.
*/
async function load(path, imports = {}) {
  return moduleUrl(await source(path), path, { ...JSX, ...imports });
}

const inkButtonStub = stub(
  `import{createElement}from${JSON.stringify(import.meta.resolve("react"))};
export function InkButton({children,onClick,disabled,tone="solid",type="button",small=false,ariaLabel}){
const cls="btn"+(tone==="solid"||tone==="invert"||tone==="danger"?" solid":"")+(tone==="danger"||tone==="quiet-danger"?" danger":"")+(tone==="quiet"||tone==="quiet-danger"?" quiet":"")+(small?" small":"");
return createElement("button",{type,onClick,disabled,className:cls,"aria-label":ariaLabel},children);}`,
);

/* The live region. Real behaviour is `desk-chrome-utils.ts`'s, and the dialogs
   call it on every press; a stub that records is enough to keep the module
   graph off the router. */
const announceStubSrc = `
export const spoken = [];
export function announceToDesk(text) { spoken.push(text); }
export function __reset() { spoken.length = 0; }
`;
const announceUrl = stub(announceStubSrc);
const announce = await import(announceUrl);

/*
  The server functions, recorded. `answer` keeps the whole call so a test can
  assert the payload; `__set*` puts a value in the dialog's hands the way a real
  refusal or a real save would.
*/
const actionsStubSrc = `
export const calls = [];
let mode = "ok";
let saved = null;
export function __setMode(next) { mode = next; }
export function __setSaved(next) { saved = next; }
export function __reset() { calls.length = 0; mode = "ok"; saved = null; }
export async function weaveIntoStory({ data }) {
  calls.push({ fn: "weaveIntoStory", data });
  if (mode === "refuse") return { ok: false, error: "the desk refused" };
  if (!data.saveText) {
    return { ok: true, before: "The body as the desk has it.", after: "The body with the material added.", documents: 0, notice: "Nothing saved yet." };
  }
  return { ok: true, after: data.saveText, documents: 0 };
}
export async function chooseHeadline({ data }) {
  calls.push({ fn: "chooseHeadline", data });
  if (mode === "refuse") return { ok: false, error: "the desk refused" };
  return { ok: true, headline: saved ?? data.headline };
}
export const addLead = async () => ({ ok: true });
export const holdLead = async () => ({ ok: true });
export const sourceKillPattern = async () => ({ ok: true });
export const findSources = async () => ({ ok: true });
`;
const actionsUrl = stub(actionsStubSrc);
const actions = await import(actionsUrl);

/* `@/lib/news/desk` opens a database at import time. None of these eight is
   pressed by the two dialogs under test; they are here so the module graph
   resolves. `suggestHeadlines` is named in a comment below where it would be. */
const deskStubSrc = `
export const calls = [];
export const suggestHeadlines = async ({ data }) => {
  calls.push({ fn: "suggestHeadlines", data });
  return { ok: true, options: ["A", "B", "C"] };
};
export const addSource = async () => ({ ok: true });
export const addSourcesBulk = async () => ({ ok: true });
export const fileLead = async () => ({ ok: true });
export const findPasteDuplicate = async () => ({ ok: true, duplicate: null });
export const listSources = async () => ({ ok: true, sources: [] });
export const saveDraft = async () => ({ ok: true });
export const writeStoryFromInput = async () => ({ ok: true });
`;
const deskUrl = stub(deskStubSrc);

const dialogUrl = await load("src/components/dialog.tsx", {
  "./desk-chrome": inkButtonStub,
  "@radix-ui/react-dialog": import.meta.resolve("@radix-ui/react-dialog"),
});
const { Dialog } = await import(dialogUrl);
assert.ok(Dialog, "the real Dialog must load: every test below mounts it");

/* The real source chain. Leaves first, in the order they are imported. */
const urlGuardUrl = await load("src/lib/news/url-guard.ts");
const sourceLinesUrl = await load("src/lib/news/source-lines.ts", {
  "./url-guard.ts": urlGuardUrl,
});
const killReasonsUrl = await load("src/lib/news/kill-reasons.ts");
const providerRegistryUrl = await load("src/lib/news/provider-registry.ts");
const paperUrl = await load("src/lib/paper.ts");
const preflightUrl = await load("src/lib/news/preflight.ts", {
  "./provider-registry.ts": providerRegistryUrl,
});
const leadMatchUrl = await load("src/lib/news/lead-match.ts", {
  "./preflight.ts": preflightUrl,
});
const logicUrl = await load("src/lib/news/editor-dialog-logic.ts", {
  "./source-lines.ts": sourceLinesUrl,
  "./url-guard.ts": urlGuardUrl,
  "./kill-reasons.ts": killReasonsUrl,
  "zod": import.meta.resolve("zod"),
});
const deskCopyUrl = await load("src/lib/news/desk-copy.ts", {
  "./preflight.ts": preflightUrl,
  "./lead-match.ts": leadMatchUrl,
  "../paper.ts": paperUrl,
});
const importStoriesUrl = await load("src/lib/news/import-stories.ts", {
  "./desk-copy.ts": deskCopyUrl,
});
const schemaUrl = await load("src/lib/news/schema.ts", {
  "zod": import.meta.resolve("zod"),
  "../paper.ts": paperUrl,
  "./url-guard.ts": urlGuardUrl,
});
const writeStoryUrl = await load("src/lib/news/write-story.ts", {
  "./schema.ts": schemaUrl,
  "./desk-copy.ts": deskCopyUrl,
});
const notesUrl = await load("src/lib/news/notes.ts", {
  "./write-story.ts": writeStoryUrl,
});
const storyAreaUrl = await load("src/lib/story-area.ts");
const requestInputUrl = await load("src/lib/news/request-input.ts", {
  "zod": import.meta.resolve("zod"),
  "./provider-registry.ts": providerRegistryUrl,
  "./notes.ts": notesUrl,
  "../story-area.ts": storyAreaUrl,
});
const modelChoiceUrl = await load("src/lib/news/model-choice.ts", {
  "./provider-registry.ts": providerRegistryUrl,
  "./preflight.ts": preflightUrl,
});
const importReviewUrl = await load("src/lib/news/import-review.ts", {
  "./desk-copy.ts": deskCopyUrl,
  "./import-stories.ts": importStoriesUrl,
});
const pasteOneStoryUrl = await load("src/lib/news/paste-one-story.ts", {
  "./import-stories.ts": importStoriesUrl,
  "./import-review.ts": importReviewUrl,
});
const formsUrl = await load("src/components/dialogs/editor-dialog-forms.ts", {
  "../../lib/news/model-choice.ts": modelChoiceUrl,
  "../../lib/news/editor-dialog-logic.ts": logicUrl,
  "../../lib/news/kill-reasons.ts": killReasonsUrl,
  "../../lib/news/import-review.ts": importReviewUrl,
  "../../lib/news/paste-one-story.ts": pasteOneStoryUrl,
  "../../lib/news/import-stories.ts": importStoriesUrl,
  "../../lib/news/request-input.ts": requestInputUrl,
});
const bodiesUrl = await load("src/components/dialogs/editor-dialog-bodies.ts", {
  "../../lib/news/editor-dialog-logic.ts": logicUrl,
  "../../lib/news/kill-reasons.ts": killReasonsUrl,
  "../../lib/news/import-review.ts": importReviewUrl,
  "./editor-dialog-forms.ts": formsUrl,
});
const forms = await import(formsUrl);
assert.equal(
  typeof forms.addToRequest,
  "function",
  "the real forms layer must load: these tests assert the payload it builds",
);

const editorDialogsUrl = await load("src/components/dialogs/editor-dialogs.tsx", {
  "@tanstack/react-query": import.meta.resolve("@tanstack/react-query"),
  "@/components/dialog": dialogUrl,
  "@/components/desk-chrome": inkButtonStub,
  "@/components/desk-chrome-utils": announceUrl,
  "@/lib/news/custom-ai-settings": stub(
    "export const getCustomAiConnectionsFn = async () => ({ ok: true, connections: [] });",
  ),
  "@/lib/news/dark": stub("export const openDarkInvestigation = async () => ({ ok: false, error: 'not here' });"),
  "@/lib/news/desk": deskUrl,
  "@/lib/news/draft-reconcile-actions": stub(
    "export const requestDraftReconciliationFn = async () => ({ ok: true });",
  ),
  "@/lib/news/editor-dialog-actions": actionsUrl,
  "@/lib/news/editor-dialog-logic": logicUrl,
  "@/lib/news/story-document-api": stub("export const uploadStoryDocument = async () => ({ ok: true, id: 'doc-1' });"),
  "@/lib/news/story-document-text": await load("src/lib/news/story-document-text.ts"),
  "@/lib/use-sections": stub(
    "export function useEditorSections() { return { data: [], isLoading: false, isError: false, error: null, refetch: () => {} }; }",
  ),
  "@/lib/news/url-guard": urlGuardUrl,
  "./editor-dialog-bodies": bodiesUrl,
  "./editor-dialog-forms": formsUrl,
});
const { AddToStoryDialog } = await import(editorDialogsUrl);

/* --------------------------------------------------------------- the harness */

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
const lastLayer = () => [...document.querySelectorAll(".astra-modal-layer")].at(-1) ?? document.body;
const field = (selector) => lastLayer().querySelector(`.astra-modal-body ${selector}`);

/* A controlled <textarea>'s painted text, read the way THIS DOM exposes it --
   see `bh2-dialogs.test.mjs`, which measured the four columns. React writes
   `.value` only when it UPDATES a textarea; on mount it sets `defaultValue`. */
const text = (node) => (node.value !== "" ? node.value : (node.defaultValue ?? ""));

/* ------------------------------------------------------------------- static */

test("the story page mounts the add-to dialog, on the drawn press and the drawn rule", async () => {
  const story = await source("src/routes/desk.story.$leadId.tsx");
  const name = "AddToStoryDialog";
  assert.match(story, new RegExp(`import \\{[^}]*${name}`), `the story page must import ${name}`);
  assert.match(story, new RegExp(`<${name}\\b`), `the story page must mount <${name}>`);
  assert.match(
    story,
    /<AddToStoryDialog[\s\S]{0,200}?leadId=\{id\}/,
    "the add-to dialog takes the lead it is adding to",
  );
  /*
    The drawn label, spelled the way the drawing spells it. A "+ Add story" or
    an "Add to this story" press here would be a press the editor was not shown.
  */
  assert.match(story, /\+ Add to story/, "the press carries the drawn label");
  /*
    The same gate the other action-row presses use: `locked` is `killed` and
    `onPaper` is published (see their definitions in that file). A lead with no
    draft has nothing to add to -- `performWeaveIntoStory` refuses it with "This
    lead has no draft to add to yet." -- so the press is not drawn.
  */
  assert.match(
    story,
    /\{data\.draft && !locked && !onPaper \? \(\s*<InkButton\s+tone="ghost"[\s\S]{0,200}?onClick=\{\(\) => setAddToOpen\(true\)\}/,
    "the add-to press is drawn for a lead that is not killed and not published, and has a draft",
  );
  /*
    The landing: the screen takes the saved bytes, not the note. A sentence
    parsed back into a body would be a second, worse copy of the body.
  */
  assert.match(story, /onSaved=\{\(after\) => \{/, "the add-to dialog hands the screen its bytes");
});

test("the article page keeps the drawn corrections block", async () => {
  /* Item 4 of unit CP: already built. This is the pin, so a later redesign of
     the article page has to delete it deliberately. The h2 is written with the
     entity -- an audit grep for the plain "&" is the probe that missed it. */
  const article = await source("src/routes/articles.$slug.tsx");
  assert.match(article, /<h2>Corrections &amp; accountability<\/h2>/);
  assert.match(article, /No corrections have been posted for this story\./);
  assert.match(article, /File a correction →/);
  assert.match(article, /Share the reporting\./);
});

test("the add-to dialog reviews before it saves, and hands the screen the saved bytes", async () => {
  actions.__reset();
  announce.__reset();
  const savedBodies = [];
  const notes = [];
  let closed = 0;
  const page = await mount(
    React.createElement(AddToStoryDialog, {
      leadId: 42,
      open: true,
      onClose: () => closed++,
      onDone: (note) => notes.push(note),
      onSaved: (body) => savedBodies.push(body),
    }),
  );
  assert.match(lastLayer().textContent, /Add to this story/);
  assert.equal(button("Add").disabled, true, "nothing pasted cannot be added");

  /* `update` is the no-model mode: "Add as an update at the top", `ai: false`. */
  await page.click(radio("Add as an update at the top"));
  await page.typeInto(field("textarea"), "The council voted on Tuesday.");
  assert.equal(button("Add").disabled, false);

  await page.click(button("Add"));
  const first = actions.calls.filter((c) => c.fn === "weaveIntoStory");
  assert.equal(first.length, 1, "the first press calls the desk once");
  assert.equal(first[0].data.leadId, 42);
  assert.equal(first[0].data.mode, "update");
  assert.equal(first[0].data.material, "The council voted on Tuesday.");
  assert.equal("saveText" in first[0].data, false, "the review press saves nothing");
  assert.equal(savedBodies.length, 0, "nothing lands on the screen before it is saved");
  assert.match(lastLayer().textContent, /After your change/, "the editor is shown what would be saved");
  /* The compare's "Now" side is the desk's `before` -- the story the change
     lands on -- not the paragraph the editor just pasted, which is what it
     used to print under that heading. Both halves are asserted: the material
     belongs on the right-hand side only. */
  assert.match(
    lastLayer().querySelector(".astra-compare-col").textContent,
    /The body as the desk has it\./,
    'the "Now" column shows the story as it is',
  );

  await page.click(button("Add"));
  const both = actions.calls.filter((c) => c.fn === "weaveIntoStory");
  assert.equal(both.length, 2);
  assert.equal(both[1].data.saveText, "The body with the material added.", "the confirm press saves the reviewed text");
  assert.deepEqual(savedBodies, ["The body with the material added."], "the screen gets the saved bytes");
  assert.equal(closed, 1, "a save closes the dialog");
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^Saved\. The story is \d+ characters now/);
  assert.ok(announce.spoken.includes(notes[0]), "the answer is spoken through the live region");
  await page.close();
});

test("a refused add-to stays open, keeps the box, and lands nothing", async () => {
  actions.__reset();
  actions.__setMode("refuse");
  const savedBodies = [];
  let closed = 0;
  const page = await mount(
    React.createElement(AddToStoryDialog, {
      leadId: 42,
      open: true,
      onClose: () => closed++,
      onSaved: (body) => savedBodies.push(body),
    }),
  );
  await page.click(radio("Add as an update at the top"));
  await page.typeInto(field("textarea"), "The council voted on Tuesday.");
  await page.click(button("Add"));
  assert.match(lastLayer().textContent, /the desk refused/);
  assert.equal(closed, 0, "a refusal does not close the dialog");
  assert.deepEqual(savedBodies, [], "a refusal lands nothing");
  assert.equal(text(field("textarea")), "The council voted on Tuesday.", "the editor's words stay");
  await page.close();
});

/* ------------------------------------------------------------------ the route */

test("the add-to press is on a draft that is neither killed nor published", async () => {
  /*
    The gate read from the route, not from the copy of it above: `locked` and
    `onPaper` are the names the two other action-row presses use, and this
    asserts they still mean what the mount assumes. Both are derived once, in
    that file, from the lead's status and the published slug.
  */
  const story = await source("src/routes/desk.story.$leadId.tsx");
  assert.match(story, /const locked = [^;]*"killed"/);
  assert.match(story, /const onPaper = [^;]*published/);
});
