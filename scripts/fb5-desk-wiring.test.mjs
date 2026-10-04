/*
  FB5: the wiring, pinned where a browser walk cannot see it.

  `scripts/fb5-desk-action.test.mjs` proves the helper behaves and
  `scripts/fb5-desk-toast.test.mjs` proves an announcement draws a bar. Neither
  can prove the things this unit actually changed at the call sites -- that the
  named mutations now report, that the ⌘S badge is bound rather than decorative,
  that the bar is painted from the desk's own tokens. Those live in files a Node
  test cannot import (routes need a database and a router; the stylesheet is
  CSS), so they are pinned as source, the way `scripts/desk-uiux-pins.test.mjs`
  and `src/components/form-error.test.ts` already pin their own call sites.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const read = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

/*
  Compile a real .ts/.tsx source into an importable `data:` module, rewriting
  the specifiers it imports -- the same harness the render tests use
  (scripts/meeting-source-block-render.test.mjs). One test below renders the
  real shortcut chip rather than pinning its text, so it needs the real module.
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
  let rewritten = source;
  for (const [name, url] of Object.entries(imports)) {
    rewritten = rewritten.replaceAll(JSON.stringify(name), JSON.stringify(url));
  }
  return `data:text/javascript;base64,${Buffer.from(rewritten).toString("base64")}`;
}

/*
  The body of one CSS rule, however many lines it spans. Comments are blanked
  first so a rule's own explanation cannot satisfy an assertion about its
  declarations -- the same trap `scripts/desk-min-font.test.mjs` documents.
*/
function rule(css, selector) {
  const blanked = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const start = blanked.indexOf(selector);
  assert.notEqual(start, -1, `expected a ${selector} rule`);
  const open = blanked.indexOf("{", start);
  const body = blanked.slice(open + 1, blanked.indexOf("}", open));
  return body.replace(/\s+/g, " ").trim();
}

/*
  The five mutations the report names as reporting nothing on failure:
  FB0-REPORT.md Table B, "Today/Queue setStatus" (SILENT FAIL), "Sources
  Pause/Resume/Remove/Accept/Drop" (SILENT FAIL) and "Scan Delete pack / Rename"
  (SILENT FAIL). Four are shared mutations and go through `useDeskMutation`; the
  scan pair has exactly one press site each and goes through `useDeskAction` at
  the press.
*/
const CONVERTED = [
  { file: "src/routes/desk.index.tsx", what: "Today's Hold/Kill/Undo", lead: "Could not change that lead." },
  { file: "src/routes/desk.queue.tsx", what: "the Queue's rows, bulk Hold and bulk Kill", lead: "Could not change that lead." },
  { file: "src/routes/desk.sources.tsx", what: "every single-row source action", lead: "Could not change that source." },
  { file: "src/routes/desk.scan.tsx", what: "Delete pack", lead: "Could not delete that pack." },
  { file: "src/routes/desk.scan.tsx", what: "Save name", lead: "Could not rename that pack." },
];

test("every named mutation reports its failures through the shared family", () => {
  for (const { file, what, lead } of CONVERTED) {
    const source = read(file);
    assert.match(
      source,
      /useDeskMutation|useDeskAction/,
      `${file} no longer uses the shared action family, so ${what} reports nothing again`,
    );
    assert.ok(
      source.includes(lead),
      `${file} lost the failure lead "${lead}" for ${what}; a failure must say what failed and then why`,
    );
  }
});

test("the shared failure sentence is built where the reason can never be dropped", () => {
  const source = read("src/components/desk-action.ts");
  /*
    The guarantee is structural: `failedLead` is words placed BEFORE the reason,
    and the reason is `deskErrorReason`'s. A `failed` builder that RETURNED a
    sentence would let a call site replace the reason with an apology, which is
    the silent failure with extra steps.
  */
  assert.match(source, /failedLead\?: string/);
  assert.equal(
    /failed\??:\s*\(/.test(source),
    false,
    "no shape here may let a caller substitute its own sentence for the real reason",
  );
  /*
    The shape, unchanged by M8/M9: the lead, then `deskErrorReason`'s sentence,
    and nothing else between them. What `deskErrorReason` itself does with that
    sentence gained a second argument (`what`, the verb phrase `editorActionError`
    needs to name the press) -- see `scripts/fb5-desk-action.test.mjs` for the
    composed result, and `src/components/desk-toast.test.ts` for the mapping.
  */
  assert.match(source, /return `\$\{copy\.failedLead \?\? ""\}\$\{deskErrorReason\(error, copy\.what\)\}`/);
});

test("both workbenches bind the ⌘S badge instead of drawing a dead one", () => {
  for (const file of ["src/routes/desk.story.$leadId.tsx", "src/routes/desk.story.draft.$draftId.tsx"]) {
    const source = read(file);
    assert.match(source, /<SaveShortcut\s+save=\{\(\) => save\.mutate\(\)\}/, `${file} draws ⌘S with nothing behind it`);
    assert.match(source, /from "@\/components\/desk-save-shortcut"/, `${file} must mount the binder`);
  }
});

/*
  The chip's text is the platform's now -- `SaveShortcutHint` draws `Ctrl+S` off
  a Mac and `⌘S` on one (src/lib/save-shortcut-label.ts). A test that pinned the
  literal `⌘S` would only ever be checking the Mac case, and would have gone
  green on a Windows build while the chip there read the wrong key. So the chip
  is RENDERED here, once per platform, and the button around it is the one the
  walks press.
*/
const platformStub = inlineModule(`
  export const __platform = { value: "MacIntel" };
  export function useSyncExternalStore(_subscribe, _getSnapshot, _getServerSnapshot) {
    return __platform.value;
  }
`);
const saveShortcutLabelUrl = moduleUrl(
  read("src/lib/save-shortcut-label.ts"),
  "save-shortcut-label.ts",
);
const saveShortcutUrl = moduleUrl(read("src/components/desk-save-shortcut.tsx"), "desk-save-shortcut.tsx", {
  "@/components/desk-action": inlineModule("export function useSaveShortcut() {}"),
  "@/lib/save-shortcut-label": saveShortcutLabelUrl,
  react: platformStub,
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
});

test("the shortcut chip stays out of the Save edits button's accessible name, on every platform", async () => {
  /*
    The walks ask for this press by name -- `getByRole("button", { name: "Save
    edits" })` -- and the chip has been `aria-hidden` since it was drawn so that
    a name of "Save edits ⌘S" could not stop matching. Binding the key and
    making the label follow the platform must not have changed that: the chip
    element is the one the real component renders, and the text that remains in
    the button once `aria-hidden` is stripped is the accessible name.
  */
  const { SaveShortcutHint } = await import(saveShortcutUrl);
  const { __platform } = await import(platformStub);
  const { saveShortcutLabel } = await import(saveShortcutLabelUrl);

  for (const platform of ["MacIntel", "Win32", "Linux x86_64"]) {
    __platform.value = platform;
    const html = renderToStaticMarkup(
      createElement("button", { className: "btn" }, "Save edits", createElement(SaveShortcutHint)),
    );
    const chip = html.match(/<span class="astra-wb-kbd" aria-hidden="true">([^<]*)<\/span>/);
    assert.ok(chip, `${platform}: the Save edits button draws no aria-hidden chip`);
    assert.equal(chip[1], saveShortcutLabel(platform), `${platform}: the chip shows the platform's own key`);
    const visibleText = html
      .replace(/<span[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, "")
      .replace(/<[^>]*>/g, "")
      .trim();
    assert.equal(visibleText, "Save edits", `${platform}: only "Save edits" may sit in the button's accessible name`);
  }
});

test("both workbenches draw the chip from the platform-aware component, never a literal", () => {
  /*
    The render above proves the component is safe; this proves the two Save
    edits buttons actually mount it. A hand-written `<span>⌘S</span>` -- which
    the draft workbench had -- reads wrong on Windows and can go dead again
    without the component's binding. Routes need a database and a router, so
    this half is pinned as source, the way the rest of this file is.
  */
  for (const file of ["src/routes/desk.story.$leadId.tsx", "src/routes/desk.story.draft.$draftId.tsx"]) {
    const source = read(file);
    assert.match(
      source,
      /Save edits[\s\S]{0,400}?<SaveShortcutHint \/>/,
      `${file}: the Save edits button must draw the platform-aware chip`,
    );
    assert.doesNotMatch(
      source,
      /astra-wb-kbd" aria-hidden="true">\s*⌘S/,
      `${file}: the chip must be drawn by SaveShortcutHint, not spelled out as a literal`,
    );
  }
});

test("Busy is a live region, because its sentence is the only thing a slow screen says", () => {
  const source = read("src/components/desk-chrome.tsx");
  const start = source.indexOf("export function Busy(");
  assert.notEqual(start, -1);
  const body = source.slice(start, source.indexOf("\n}", start));
  assert.match(body, /role="status"/, "Busy arrived unannounced and still does");
  assert.match(body, /aria-live="polite"/, "an element that appears with its text needs an explicit region");
  assert.match(body, /\{label\}/, "the label is the whole message");
});

test("the toast host is mounted exactly once, in the desk shell", () => {
  const shell = read("src/components/desk-chrome.tsx");
  assert.equal(
    shell.match(/<DeskToaster \/>/g)?.length,
    1,
    "one host: two would stack two toasts for the same press",
  );
  /*
    The host attribute is the contract between the two halves -- `DeskToaster`
    puts it on the DOM, `deskToastHostMounted` looks for it -- so it is stated
    once in `desk-toast.ts` and read from there by both. Pinned as both halves.
  */
  assert.match(
    read("src/components/desk-toast.ts"),
    /DESK_TOAST_HOST_ATTR = "data-desk-toaster"/,
  );
  assert.match(
    read("src/components/desk-toaster.tsx"),
    /\[DESK_TOAST_HOST_ATTR\]: ""/,
    "the host must mark itself with that attribute or nothing can find it",
  );

  const mounts = [];
  for (const file of [
    "src/routes/__root.tsx",
    "src/components/desk-chrome.tsx",
    "src/routes/desk.index.tsx",
  ]) {
    if (/<DeskToaster/.test(read(file))) mounts.push(file);
  }
  assert.deepEqual(mounts, ["src/components/desk-chrome.tsx"], "the host belongs to the shell and nowhere else");
});

test("the bar is the spec's yellow with #111 text, ruled and flat", () => {
  const css = read("src/desk-astra.css");
  const card = rule(css, ".desk-ltr .desk-toaster [data-sonner-toast] {");
  assert.match(card, /background: var\(--a\)/, "the spec asks for a yellow bar");
  assert.match(card, /color: #111/, "text on yellow is #111 in BOTH themes, never --fg");
  assert.match(card, /border-radius: 0/, "square corners (design-system §11 item 8)");
  assert.match(card, /box-shadow: none/, "no shadow except dialogs (design-system §12)");
  assert.match(card, /font-size: calc\(14px \* var\(--ts\)\)/, "Text: Large must reach the toast, and 14px is the floor");
});

test("a failure is the desk's existing failure edge, not a second accent", () => {
  const css = read("src/desk-astra.css");
  const failed = rule(css, ".desk-ltr .desk-toaster .desk-toast-err {");
  assert.match(failed, /border: 2px dashed var\(--danger\)/, "the same edge .notice-err already uses");
  assert.match(failed, /color: var\(--danger\)/);
  assert.match(failed, /background: var\(--bg2\)/, "state colours are never page backgrounds (design-system §3)");
  assert.equal(
    /background: var\(--danger\)/.test(failed),
    false,
    "a red fill would be the second accent the design system forbids",
  );
});

test("the host sits above the publish bar, the header and the sidebar, and below the dialogs", () => {
  const css = read("src/desk-astra.css");
  const host = rule(css, ".desk-ltr .desk-toaster-host {");
  const z = Number(host.match(/z-index: (\d+)/)?.[1]);
  assert.ok(Number.isFinite(z), "the host must state a z-index rather than take sonner's");
  assert.ok(z > 40, `z-index ${z} must clear the sidebar (40) and the sticky bars`);
  assert.ok(z < 60, `z-index ${z} must stay under the Radix modal layer (60) so a toast never covers a dialog`);
  assert.match(host, /position: fixed/, "out of the shell's grid flow, so mounting it adds no track");
  assert.match(host, /pointer-events: none/, "and never eats a click meant for the page");
});

test("no desk-ltr rule in the toast block drops below the 14px informational floor", () => {
  /*
    `scripts/desk-min-font.test.mjs` already sweeps every `.desk-ltr` rule in
    this stylesheet, so this is a second, narrower guard: the toast's own sizes,
    read from the block this unit added. The browser walk measures computed type
    across the whole body, so a 12px close button would fail it exactly like a
    12px label.
  */
  const css = read("src/desk-astra.css");
  const block = css.slice(css.indexOf("FB5: THE DESK'S TOAST"));
  assert.ok(block.length > 0, "expected the FB5 toast block");
  const sizes = [...block.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1].trim());
  assert.ok(sizes.length >= 4, "expected the toast, its title, its Undo and its close button to be sized");
  for (const size of sizes) {
    const px = Number(size.match(/^calc\((\d+(?:\.\d+)?)px \* var\(--ts\)\)$/)?.[1]);
    assert.ok(Number.isFinite(px), `${size} is not a --ts-scaled px size, so Text: Large would skip it`);
    assert.ok(px >= 14, `${size} resolves below the 14px floor`);
  }
});
