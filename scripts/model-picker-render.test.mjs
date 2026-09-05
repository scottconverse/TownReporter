import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Render the real component; the test does not assert on TSX source spelling.
// Transpile in memory so this test neither builds nor writes into a live server.
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

/*
  The registry is the source of the option list as of 0.6.2, so it has to be
  transpiled and injected too: a data: URL cannot resolve a relative import.
*/
const registryUrl = moduleUrl(
  await readFile(new URL("../src/lib/news/provider-registry.ts", import.meta.url), "utf8"),
  "provider-registry.ts",
);
const registry = await import(registryUrl);
const preflightUrl = moduleUrl(
  await readFile(new URL("../src/lib/news/preflight.ts", import.meta.url), "utf8"),
  "preflight.ts",
);
const choices = moduleUrl(
  await readFile(new URL("../src/lib/news/model-choice.ts", import.meta.url), "utf8"),
  "model-choice.ts",
  { "./provider-registry.ts": registryUrl, "./preflight.ts": preflightUrl },
);

/*
  0.6.19: the picker now asks the server which offered providers are actually
  usable on this machine (see src/lib/news/provider-availability.ts) instead
  of trusting `enabled()` -- which reads `process.env` and does not exist in
  a browser bundle -- to have run anywhere near this component. This one stub
  module backs both the `useQuery` hook and the `providerAvailability` call
  it fetches with, so a test can flip `__setAvailability` and see the picker
  react, the same way the real query response would.
*/
const availabilityStubSrc = `
let current;
export function __setAvailability(data) { current = data; }
export const useQuery = () => ({ data: current });
export const providerAvailability = async () => current;

/*
  0.6.19: model-picker.tsx also renders a second, per-model select (only
  when "Local model" is both selected AND available -- see
  ModelPicker's \`!selectedUnavailable\` guard -- which no case in this file
  exercises yet). These stand in for that select's own queries/mutations and
  its provider-settings server functions so the module graph resolves; no
  test here drives them beyond module load.
*/
export function useMutation({ mutationFn }) {
  return { mutate: (...args) => { void mutationFn?.(...args); }, isPending: false };
}
export function useQueryClient() {
  return { invalidateQueries() {}, setQueryData() {} };
}
const EMPTY_CATALOG = { servers: [], defaultModel: null, checkedAt: 0 };
export const localModelCatalog = async () => EMPTY_CATALOG;
export const refreshLocalModelCatalog = async () => EMPTY_CATALOG;
export const getLocalModelChoice = async () => ({ override: null, notice: null, catalog: EMPTY_CATALOG });
export const saveLocalModelFn = async () => ({ ok: true });
`;
const availabilityStubUrl = `data:text/javascript;base64,${Buffer.from(availabilityStubSrc).toString("base64")}`;
const availabilityStub = await import(availabilityStubUrl);

const { ModelPicker } = await import(
  moduleUrl(
    await readFile(new URL("../src/components/model-picker.tsx", import.meta.url), "utf8"),
    "model-picker.tsx",
    {
      "@/lib/news/model-choice": choices,
      "@/lib/news/provider-availability": availabilityStubUrl,
      "@/lib/news/provider-settings": availabilityStubUrl,
      "@tanstack/react-query": availabilityStubUrl,
      react: import.meta.resolve("react"),
      "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    },
  )
);

function render(props = {}) {
  // Undefined (the default) means "the query hasn't answered yet" --
  // ModelPicker treats that as every provider available, same as a real
  // slow network response would, so existing tests that don't care about
  // availability keep seeing every option enabled.
  availabilityStub.__setAvailability(undefined);
  return renderToStaticMarkup(
    createElement(ModelPicker, { value: "auto", onChange() {}, ...props }),
  );
}

test("every story picker exposes keyboard-native setup help and real operator links", () => {
  for (const compact of [false, true]) {
    const html = render({ compact });
    assert.match(html, /<details[\s>]/);
    assert.match(html, /<summary[^>]*>Set up a writing model<\/summary>/);
    assert.match(html, /https:\/\/developers.openai.com\/codex\/cli\//);
    assert.match(html, /https:\/\/code.claude.com\/docs\/en\/setup/);
    assert.match(
      html,
      /https:\/\/github.com\/scottconverse\/TownReporter\/blob\/main\/docs\/setup.md/,
    );
    assert.match(html, /computer running TownReporter/);
    assert.match(html, /sign in/);
    assert.match(html, /reload this page/);
  }
});

/*
  Read from the registry, not typed out.

  Until 0.6.2 this test pinned the four labels as literals, which is a second
  place to update when a provider is added -- and a place that can be forgotten
  while still passing, because a hardcoded list agrees with itself. It now
  asserts the SHAPE (Automatic first, then exactly the registry's story
  providers in registry order) so adding a local-model entry makes this test
  cover it with nothing here to edit.
*/
test("the Story picker offers Automatic plus exactly the registry's story providers", () => {
  const html = render();
  const expected = [
    "Automatic",
    ...registry.PROVIDER_REGISTRY.filter((e) => e.offeredFor.story).map((e) => e.label),
  ];
  const rendered = [...html.matchAll(/<option[^>]*>([^<—]+)—/g)].map((m) => m[1].trim());
  assert.deepEqual(rendered, expected);
  // Zen and Local Qwen were removed from the picker 2026-09-02 ("it's not
  // working it seems" -- Claude/Codex only for now).
  assert.doesNotMatch(html, /Local Qwen|Zen MiMo/);
});

test("the Dark Desk picker offers the registry's dark providers, and says it digs", () => {
  // 0.6.2: Dark Desk was the one surface with no picker at all. Its label
  // differs from Story's on purpose -- the model there digs, it does not write.
  const html = render({ scope: "dark" });
  const expected = [
    "Automatic",
    ...registry.PROVIDER_REGISTRY.filter((e) => e.offeredFor.dark).map((e) => e.label),
  ];
  const rendered = [...html.matchAll(/<option[^>]*>([^<—]+)—/g)].map((m) => m[1].trim());
  assert.deepEqual(rendered, expected);
  assert.match(html, /Digging model/);
  assert.match(html, /the round moves to the next/);
});

test("the Opinion picker offers only the registry's opinion providers", () => {
  const html = render({ scope: "opinion" });
  const expected = [
    "Automatic",
    ...registry.PROVIDER_REGISTRY.filter((e) => e.offeredFor.opinion).map((e) => e.label),
  ];
  const rendered = [...html.matchAll(/<option[^>]*>([^<—]+)—/g)].map((m) => m[1].trim());
  assert.deepEqual(rendered, expected);
  /*
    Codex is not an OPTION here, but it is named in the help text and in the
    setup steps -- deliberately, because an editor who sees it on the Story
    picker and not this one deserves to be told why rather than left to guess.
    So this asserts the option list, not the absence of the word.
  */
  assert.ok(!rendered.some((label) => /codex/i.test(label)));
});

test("Opinion setup help explains its voice prerequisite without advertising Story-only models", () => {
  const html = render({ scope: "opinion" });
  assert.match(html, /TOWNREPORTER_VOICE_FILE/);
  assert.match(html, /outside the repository/);
  assert.match(html, /approved restart procedure/);
  assert.doesNotMatch(html, /Local Qwen|Zen MiMo/);
});

test("disabled picker retains accessible setup help, associated label, and no-fallback explanation", () => {
  const html = render({ value: "codex-frontier", disabled: true });
  assert.match(html, /<select[^>]* disabled=""/);
  assert.match(html, /Uses only Codex Sol for this run; no fallback/);
  assert.match(html, /<summary[^>]*>Set up a writing model<\/summary>/);
  const selectId = html.match(/<select[^>]*id="([^"]+)"/)?.[1];
  assert.ok(selectId, "select must have an ID for its explicit label");
  assert.ok(html.includes(`for="${selectId}"`), "visible label must identify the select");
  assert.doesNotMatch(html, /<details[^>]*disabled|<summary[^>]*disabled/);
});

/*
  0.6.19: LLM_BASE_URL unset used to mean "Local model" rendered as a plain,
  always-selectable option that could only fail once picked (owner report
  2026-09-05). These pin the fix: an unavailable option is a disabled
  <option> that says so in its own text, and the help line names it too --
  whether or not it is the current selection.
*/
test("an unavailable provider renders as a disabled option labelled 'not set up'", () => {
  availabilityStub.__setAvailability({ "local-model": false });
  const html = renderToStaticMarkup(createElement(ModelPicker, { value: "auto", onChange() {} }));
  assert.match(html, /<option[^>]*value="local-model"[^>]* disabled=""[^>]*>Local model — llama\.cpp, LM Studio, or another OpenAI-compatible server — not set up<\/option>/);
  // Not selected, but the only unavailable option -- still surfaced.
  assert.match(html, /Local model is not set up on this server\. See docs\/local-models\.md\./);
});

test("selecting the unavailable provider replaces the normal help with the specific one", () => {
  availabilityStub.__setAvailability({ "local-model": false });
  const html = renderToStaticMarkup(
    createElement(ModelPicker, { value: "local-model", onChange() {} }),
  );
  assert.match(html, /Local model is not set up on this server\. See docs\/local-models\.md\./);
  assert.doesNotMatch(html, /Uses only Local model for this run; no fallback/);
});

test("every offered provider available leaves no option disabled and no 'not set up' copy", () => {
  const available = Object.fromEntries(registry.PICKER_PROVIDER_IDS.map((id) => [id, true]));
  availabilityStub.__setAvailability(available);
  const html = renderToStaticMarkup(createElement(ModelPicker, { value: "auto", onChange() {} }));
  assert.doesNotMatch(html, /disabled=""/);
  assert.doesNotMatch(html, /not set up/);
});
