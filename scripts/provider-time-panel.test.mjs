import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

/**
 * The Server page's "Time per call" field (0.6.2).
 *
 * The operator's rule for this release: "timeouts are likely too short for
 * local models -- give the editor the option to make them longer or shorter in
 * the interface." That field is the interface. What matters about it is not
 * how it is spelled but what an operator can see and do: a labelled number of
 * SECONDS, the shipped default stated next to it so a changed value is
 * recognisable as changed, a plain sentence saying what the number means, a
 * Reset only when there is something to reset, and the bounds the server will
 * actually enforce declared on the input itself.
 *
 * Rendered for real, the same way scripts/model-picker-render.test.mjs renders
 * the picker: transpiled in memory so this test neither builds nor writes into
 * a live server, with its own imports swapped for stubs.
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

const registryUrl = moduleUrl(
  await readFile(new URL("../src/lib/news/provider-registry.ts", import.meta.url), "utf8"),
  "provider-registry.ts",
);
const registry = await import(registryUrl);

/*
  The server function and the desk's button are stubbed: this test is about
  what the field shows, and neither a database handle nor the desk chrome's
  whole import graph belongs in a render check. `InkButton` renders as a plain
  <button> so its label and disabled state are still assertable.
*/
const stubs = `
export const saveProviderTimeFn = async () => ({ ok: true, settings: [] });
export function InkButton(props) {
  return { $$typeof: Symbol.for("react.transitional.element"), type: "button", key: null,
    props: { disabled: props.disabled, children: props.children } };
}
export const useMutation = () => ({ mutate() {}, isPending: false, data: null });
export const useQueryClient = () => ({ invalidateQueries() {} });
`;
const stubUrl = `data:text/javascript;base64,${Buffer.from(stubs).toString("base64")}`;

const { ProviderTimeField } = await import(
  moduleUrl(
    await readFile(new URL("../src/components/provider-time-field.tsx", import.meta.url), "utf8"),
    "provider-time-field.tsx",
    {
      "@/lib/news/provider-registry": registryUrl,
      "@/lib/news/provider-settings": stubUrl,
      "@/components/desk-chrome": stubUrl,
      "@tanstack/react-query": stubUrl,
      react: import.meta.resolve("react"),
      "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    },
  )
);

function rowFor(id, extra = {}) {
  const entry = registry.PROVIDER_REGISTRY.find((e) => e.id === id);
  const seconds = entry.budget.callMs / 1000;
  return {
    providerId: entry.id,
    label: entry.label,
    detail: entry.detail,
    kind: entry.kind,
    callSeconds: seconds,
    defaultCallSeconds: seconds,
    overridden: false,
    enabled: true,
    availableOnThisMachine: true,
    ...extra,
  };
}

function render(row) {
  return renderToStaticMarkup(createElement(ProviderTimeField, { row, onNote() {} }));
}

test("the field states the model, the number of seconds, and the shipped default", () => {
  const row = rowFor("claude-frontier");
  const html = render(row);
  assert.match(html, /Time per call, Claude Opus/);
  assert.match(html, new RegExp(`default ${row.defaultCallSeconds} s`));
  assert.match(html, new RegExp(`value="${row.callSeconds}"`));
  assert.match(html, /seconds/);
});

test("it says in plain words what the number does, and why a local model needs more", () => {
  // Not "per-call timeout (ms)". The operator is point-and-click and this is
  // the sentence that has to carry the whole idea.
  const html = render(rowFor("codex-balanced"));
  assert.match(html, /How long the desk waits for one answer before giving up/);
  assert.match(html, /Local models need more/);
});

test("the input declares the same bounds the server enforces", () => {
  const html = render(rowFor("codex-balanced"));
  assert.match(html, new RegExp(`min="${registry.MIN_BUDGET_SECONDS}"`));
  assert.match(html, new RegExp(`max="${registry.MAX_BUDGET_SECONDS}"`));
  assert.match(html, /type="number"/);
  // A visible label tied to the input by id, not a bare placeholder.
  const inputId = html.match(/<input[^>]*id="([^"]+)"/)?.[1];
  assert.ok(inputId, "the number field must have an id its label can point at");
  assert.ok(html.includes(`for="${inputId}"`));
});

test("Reset appears only when this paper has actually stored a number", () => {
  // Nothing to put back means no button offering to put it back.
  assert.doesNotMatch(render(rowFor("claude-frontier")), /Reset/);
  const changed = rowFor("claude-frontier", { callSeconds: 420, overridden: true });
  const html = render(changed);
  assert.match(html, /Reset/);
  assert.match(html, /value="420"/);
  // The default is still shown next to the changed value, so "420 instead of
  // 150" reads as a decision rather than as the way it has always been.
  assert.match(html, new RegExp(`default ${changed.defaultCallSeconds} s`));
});

test("Save is offered but inert until the number actually differs", () => {
  const html = render(rowFor("claude-frontier"));
  assert.match(html, /<button[^>]*disabled[^>]*>Save<\/button>/);
});

test("every provider in the registry can be rendered as a row", () => {
  // Including the configured gateway, and including whatever local entry is
  // added next: the panel is generated from the registry, not from a list.
  for (const entry of registry.PROVIDER_REGISTRY) {
    const html = render(rowFor(entry.id));
    assert.match(html, new RegExp(`data-provider-time="${entry.id}"`));
    assert.match(html, new RegExp(`default ${entry.budget.callMs / 1000} s`));
  }
});
