/*
  FB5: the wiring, pinned where a browser walk cannot see it.

  A route needs a database and a router, and the stylesheet is CSS, so the
  pieces of the wiring a Node test cannot import are not pinned here at all.
  What remains is the one claim that CAN be rendered: the shortcut chip's text
  follows the platform and stays out of the Save edits button's accessible name.
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
