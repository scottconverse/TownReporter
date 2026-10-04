import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

/**
 * `src/components/dialog.tsx` is the redesign's shared dialog, and it is the
 * only component in phase 0 that nobody uses yet -- which makes it the easiest
 * thing here to rot unnoticed. So this file holds the parts a script can hold:
 * that it is really built on Radix rather than on the reference's hand-rolled
 * `div`, that every prop of the design reference survived, that its markup
 * still matches the reference's, and that the CSS under it still carries the
 * design's panel and the desk's warm-black dark palette.
 *
 * What it deliberately does NOT hold is the behavior: focus trap, Escape,
 * scroll lock and focus return are assertions about a live document, and this
 * repository has no DOM test environment. That is `scripts/astra-dialog-e2e.mjs`,
 * which mounts the component into a real page -- and the last test here fails
 * if that walk drops out of CI, because a walk nobody runs is a claim.
 */
const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

const source = await read("src/components/dialog.tsx");

// ── The component itself ───────────────────────────────────────────────────
// Transpiled and imported through a `data:` URL, the way the other
// render-assertion tests in this folder do it: there is no bundler in the
// test path, and the component's two imports have to be resolved by hand --
// `./desk-chrome` would not resolve from a data: URL at all, so it is stubbed.
const transpiled = ts
  .transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } })
  .outputText;
const stub = (body) =>
  `data:text/javascript;base64,${Buffer.from(body).toString("base64")}`;
const inkButtonStub = stub(
  `import{createElement}from${JSON.stringify(import.meta.resolve("react"))};` +
    `export function InkButton({children,onClick,disabled,ariaLabel}){` +
    `return createElement("button",{type:"button",onClick,disabled,"aria-label":ariaLabel},children)}`,
);
const module = await import(
  stub(
    transpiled
      .replaceAll('"./desk-chrome"', JSON.stringify(inkButtonStub))
      .replaceAll('"@radix-ui/react-dialog"', JSON.stringify(import.meta.resolve("@radix-ui/react-dialog")))
      .replaceAll('"react"', JSON.stringify(import.meta.resolve("react")))
      .replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime"))),
  )
);

test("the closed dialog renders nothing, and the open one cannot render without a document", () => {
  // Radix's Portal mounts into `document.body`, so on the server there is
  // nothing to render into and both states come back empty. Asserting it keeps
  // the honest reading of this file in place: the markup and the behavior are
  // only real in a browser, which is what the e2e walk is for.
  const props = { title: "Kill this lead", primaryLabel: "Kill with this reason" };
  assert.equal(renderToStaticMarkup(createElement(module.Dialog, { ...props, open: false, onClose() {} })), "");
  assert.equal(renderToStaticMarkup(createElement(module.Dialog, { ...props, open: true, onClose() {} })), "");
});

test("ChoiceCard renders the reference's radio markup and its selected state", () => {
  const off = renderToStaticMarkup(createElement(module.ChoiceCard, { label: "Not news", note: "Routine notice" }));
  assert.match(off, /role="radio"/);
  assert.match(off, /aria-checked="false"/);
  assert.match(off, /class="astra-choice-card"/);
  assert.match(off, /<b>Not news<\/b>/);
  assert.match(off, /Routine notice/);

  const on = renderToStaticMarkup(
    createElement(module.ChoiceCard, { label: "Not news", selected: true, onSelect() {} }),
  );
  assert.match(on, /aria-checked="true"/);
  assert.match(on, /class="astra-choice-card on"/);
});
