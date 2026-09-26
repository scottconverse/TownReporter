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
 * What it deliberately does NOT hold is the behaviour: focus trap, Escape,
 * scroll lock and focus return are assertions about a live document, and this
 * repository has no DOM test environment. That is `scripts/astra-dialog-e2e.mjs`,
 * which mounts the component into a real page -- and the last test here fails
 * if that walk drops out of CI, because a walk nobody runs is a claim.
 */
const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

const source = await read("src/components/dialog.tsx");
const styles = await read("src/styles.css");
const reference = await read(
  "docs/design/handoff-2026-09-26/design-system/components/desk/Dialog.d.ts",
);

const between = (text, open, close) => {
  const from = text.indexOf(open);
  assert.notEqual(from, -1, `could not find ${open} in the source`);
  const to = text.indexOf(close, from);
  assert.notEqual(to, -1, `could not find the end of ${open}`);
  return text.slice(from, to + close.length);
};

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

test("the dialog is Radix's, not a hand-rolled div with an Escape listener", () => {
  assert.match(source, /from "@radix-ui\/react-dialog"/);
  for (const part of ["Root", "Portal", "Overlay", "Content", "Title", "Description"]) {
    assert.ok(
      new RegExp(`DialogPrimitive\\.${part}\\b`).test(source),
      `the dialog does not use Radix's ${part}`,
    );
  }
  // The reference `Dialog.jsx` does all four of these by hand. Radix does them
  // better (and the design package's own prompt says to use it), so their
  // absence is the point -- each one would be a second implementation.
  assert.doesNotMatch(source, /addEventListener\("keydown"/, "Escape is hand-rolled again");
  assert.doesNotMatch(source, /role="dialog"/, "the dialog role is hand-rolled again");
  assert.doesNotMatch(source, /aria-modal/, "modal semantics are hand-rolled again");
  assert.doesNotMatch(source, /createPortal/, "the portal is hand-rolled again");
});

test("every prop of the design reference is kept", () => {
  const referenceProps = [
    ...between(reference, "interface DialogProps {", "}").matchAll(/(\w+)\??:/g),
  ].map((m) => m[1]);
  assert.ok(referenceProps.includes("primaryLabel") && referenceProps.includes("onClose"));

  const ours = between(source, "export type DialogProps = {", "};");
  const missing = referenceProps.filter((name) => !new RegExp(`\\b${name}\\??:`).test(ours));
  assert.deepEqual(missing, [], `the dialog dropped props the design reference declares: ${missing.join(", ")}`);

  const referenceChoiceProps = [
    ...between(reference, "interface ChoiceCardProps {", "}").matchAll(/(\w+)\??:/g),
  ].map((m) => m[1]);
  const ourChoiceCard = between(source, "export function ChoiceCard({", "}");
  const missingChoice = referenceChoiceProps.filter((name) => !new RegExp(`\\b${name}\\b`).test(ourChoiceCard));
  assert.deepEqual(missingChoice, [], `ChoiceCard dropped: ${missingChoice.join(", ")}`);
});

test("the closed dialog renders nothing, and the open one cannot render without a document", () => {
  // Radix's Portal mounts into `document.body`, so on the server there is
  // nothing to render into and both states come back empty. Asserting it keeps
  // the honest reading of this file in place: the markup and the behaviour are
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

test("the modal CSS carries the design's panel and the desk's warm-black dark palette", () => {
  const panel = between(styles, ".desk-ltr.astra-modal-layer .astra-modal {", "}");
  assert.match(panel, /width: 820px/, "the panel is not the design's 820px");
  assert.match(panel, /border: 2px solid var\(--fg\)/, "the panel lost its 2px ink border");
  assert.match(panel, /border-radius: 0/, "the panel is not square");
  assert.match(panel, /box-shadow: var\(--shadow-dialog\)/, "the panel does not use the one allowed shadow");
  assert.match(panel, /font-family: var\(--fd\)/, "the panel does not use the display face");

  const dark = between(styles, ':root[data-appearance="desk-dark"] .desk-ltr.astra-modal-layer {', "}");
  for (const [token, value] of [
    ["--bg", "#1b1916"],
    ["--bg2", "#27231f"],
    ["--fg", "#e8e6e1"],
    ["--ok", "#9fd4a8"],
    ["--warn", "#f0b27a"],
    ["--danger", "#f0998c"],
  ]) {
    assert.match(dark, new RegExp(`${token}: ${value};`), `the portaled layer's dark ${token} is not ${value}`);
  }
  assert.doesNotMatch(dark, /#000|#fff\b/i, "pure black or white came back to the dialog's dark palette");

  // The portal is outside the desk shell, so the layer has to re-establish the
  // desk scope and the desk's text-size control itself.
  assert.match(between(styles, ".desk-ltr.astra-modal-layer {", "}"), /color: var\(--fg\)/);
  assert.match(styles, /:root\[data-desk-size="large"\] \.desk-ltr\.astra-modal-layer \{\s*--ts: 1\.2;/);
});

test("the browser walk that proves the behaviour is run by CI", async () => {
  await read("scripts/astra-dialog-e2e.mjs");
  const ci = await read(".github/workflows/ci.yml");
  assert.ok(
    ci.includes("scripts/astra-dialog-e2e.mjs"),
    "scripts/astra-dialog-e2e.mjs exists but no CI job runs it",
  );
});
