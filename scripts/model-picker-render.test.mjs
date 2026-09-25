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
const choiceModule = await import(choices);

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
let connections = [];
export function __setConnections(data) { connections = data; }
export function __setAvailability(data) { current = data; }
export const useQuery = ({ queryKey }) => ({ data: queryKey[0] === "custom-ai-connections" ? connections : current });
export const getCustomAiConnectionsFn = async () => connections;
export const providerAvailability = async () => current;
export const PROVIDER_AVAILABILITY_QUERY_KEY = ["provider-availability"];

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
      "@/lib/news/provider-registry": registryUrl,
      "@/lib/news/provider-availability": availabilityStubUrl,
      "@/lib/news/provider-availability-key": availabilityStubUrl,
      "@/lib/news/provider-settings": availabilityStubUrl,
      "@/lib/news/custom-ai-settings": availabilityStubUrl,
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
  providers in display order) so adding a local-model entry makes this test
  cover it with nothing here to edit.
*/
test("the Story picker offers Automatic plus exactly the registry's story providers", () => {
  const html = render();
  const expected = [
    "Automatic",
    ...registry.providersFor("story").map((e) => e.label),
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
    ...registry.providersFor("dark").map((e) => e.label),
  ];
  const rendered = [...html.matchAll(/<option[^>]*>([^<—]+)—/g)].map((m) => m[1].trim());
  assert.deepEqual(rendered, expected);
  assert.match(html, /Digging model/);
  assert.match(html, /unfinished stage moves to the next provider/);
});

test("the Opinion picker offers the registry's opinion providers, including Codex Terra and Sol", () => {
  const html = render({ scope: "opinion" });
  const expected = [
    "Automatic",
    ...registry.providersFor("opinion").map((e) => e.label),
  ];
  const rendered = [...html.matchAll(/<option[^>]*>([^<—]+)—/g)].map((m) => m[1].trim());
  assert.deepEqual(rendered, expected);
  assert.ok(rendered.includes("Codex Terra"), "Opinion must offer Codex Terra");
  assert.ok(rendered.includes("Codex Sol"), "Opinion must offer Codex Sol");
  assert.doesNotMatch(html, /Local Qwen|Zen MiMo/);
});

test("Opinion setup help explains its voice prerequisite without advertising Story-only models", () => {
  const html = render({ scope: "opinion" });
  assert.match(html, /TOWNREPORTER_VOICE_FILE/);
  assert.match(html, /outside the repository/);
  assert.match(html, /approved restart procedure/);
  assert.doesNotMatch(html, /Local Qwen|Zen MiMo/);
});

test("disabled picker retains accessible setup help, associated label, and technical-fallback explanation", () => {
  const html = render({ value: "codex-frontier", disabled: true });
  assert.match(html, /<select[^>]* disabled=""/);
  assert.match(html, /Prefers Codex Sol for this run/);
  assert.match(html, /technical failure.*unfinished call.*next ready writing model/);
  assert.match(html, /content refusal stops the run/);
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
  // Unit P item 7: the option shows the registry's short half-line, not the
  // 56-character clause that was clipped to "...or anot" in a 191px box.
  assert.match(html, /<option[^>]*value="local-model"[^>]* disabled=""[^>]*>Local model — on this computer — not set up<\/option>/);
  // Not selected, but the only unavailable option -- still surfaced.
  assert.match(html, /TownReporter cannot reach a local model\. Start LM Studio/);
  assert.match(html, /then click Refresh\. See docs\/local-models\.md\./);
});

/*
  Unit P item 7: a native select clips its selected option's text at its own
  content box, so an option text longer than the box is a sentence with its
  ending missing on the control that decides what a run spends. Every shipped
  option is asserted against the measured bound, and against the rule that
  shortening the visible line must not lose the sentence -- the full
  `label — detail` stays reachable as the option's `title`
  (see pickerOptionText / pickerOptionTitle in src/lib/news/model-choice.ts).
*/
test("every shipped picker option fits the measured select box and keeps its full line as a title", () => {
  const { PICKER_OPTION_TEXT_MAX, pickerOptionText, pickerOptionTitle } = choiceModule;
  for (const scope of ["story", "scan", "opinion", "dark", "forced"]) {
    for (const option of registry.providersFor(scope)) {
      const text = pickerOptionText({
        value: option.id,
        label: option.label,
        detail: option.detail,
        optionDetail: option.optionDetail,
      });
      assert.ok(
        text.length <= PICKER_OPTION_TEXT_MAX,
        `${scope} option "${text}" is ${text.length} chars, over ${PICKER_OPTION_TEXT_MAX}`,
      );
      // A clause-length detail is not dropped, it moves to the title.
      const title = pickerOptionTitle({
        value: option.id,
        label: option.label,
        detail: option.detail,
        optionDetail: option.optionDetail,
      });
      if (option.detail) assert.ok(title.includes(option.detail), `${scope} title must carry the detail`);
    }
  }
});

test("selecting the unavailable provider replaces the normal help with the specific one", () => {
  availabilityStub.__setAvailability({ "local-model": false });
  const html = renderToStaticMarkup(
    createElement(ModelPicker, { value: "local-model", onChange() {} }),
  );
  assert.match(html, /TownReporter cannot reach a local model\. Start LM Studio/);
  assert.match(html, /then click Refresh\. See docs\/local-models\.md\./);
  assert.doesNotMatch(html, /Uses only Local model for this run; no fallback/);
});

test("every offered provider available leaves no option disabled and no 'not set up' copy", () => {
  const available = Object.fromEntries(registry.PICKER_PROVIDER_IDS.map((id) => [id, true]));
  availabilityStub.__setAvailability(available);
  const html = renderToStaticMarkup(createElement(ModelPicker, { value: "auto", onChange() {} }));
  assert.doesNotMatch(html, /disabled=""/);
  assert.doesNotMatch(html, /not set up/);
});

test("saved API connections supplement rather than replace all built-in picker choices", () => {
  availabilityStub.__setConnections([{ id: "abc", name: "Newsroom LiteLLM", modelId: "my-model", enabled: true }]);
  for (const scope of ["story", "dark", "opinion"]) {
    const html = render({ scope, value: "custom:abc" });
    // `[^>]*` rather than a literal space: 0.6.63 gave every option a `title`
    // (Unit P item 7), which sits between the value and `selected`.
    assert.match(html, /value="custom:abc"[^>]*selected=""/);
    assert.match(html, /Newsroom LiteLLM — my-model/);
    assert.match(html, /Prefers Newsroom LiteLLM \(my-model\) for this run/);
    assert.match(html, /technical failure can move the unfinished call/);
    assert.match(html, /value="auto"/);
    assert.match(html, /value="local-model"/);
    assert.match(html, /value="claude-frontier"/);
  }
  availabilityStub.__setConnections([]);
});

test("disabled and deleted custom picks remain visible without selecting Automatic", () => {
  for (const rows of [[], [{ id: "abc", name: "Disabled API", modelId: "my-model", enabled: false }]]) {
    availabilityStub.__setConnections(rows);
    const html = render({ value: "custom:abc" });
    assert.match(html, /value="custom:abc"[^>]*selected=""/);
    assert.doesNotMatch(html, /value="auto"[^>]*selected=""/);
    assert.match(html, /custom connection is unavailable or has no model/i);
    assert.match(html, /choose another model/i);
  }
  availabilityStub.__setConnections([]);
});

/*
  0.6.63 (Unit Y item 4). The owner's standing instruction is "REMOVE Grok".
  The registry keeps the entry only because `xai-oauth` still describes the
  transport the Server page's sign-in card reads (see RETIRED_PROVIDER_IDS in
  src/lib/news/provider-registry.ts), so the retirement is only real if the
  MENUS show it: no surface's option list may offer it, and no rendered option
  may carry the retired value.
*/
test("no picker surface offers SuperGrok", () => {
  for (const scope of ["story", "scan", "opinion", "dark", "forced"]) {
    const html = render({ scope });
    assert.doesNotMatch(html, /grok/i, `the ${scope} picker must offer no Grok option`);
    assert.doesNotMatch(
      html,
      /value="grok-oauth"/,
      `the ${scope} picker must not carry the retired value`,
    );
  }
});

/*
  A newsroom, a `desk_jobs` row, a draft batch or a page-watch row can still
  hold `grok-oauth` from 0.6.x. The run normalises it to Automatic
  (`storyModelChoice`, src/lib/news/model-choice.ts), so the control has to
  SHOW Automatic -- a select whose value matches no option renders empty --
  and its help has to say why, in the one sentence model-choice.ts owns.
*/
const RETIRED_NOTE =
  "SuperGrok is no longer offered as a writing model, so this falls back to Automatic. SuperGrok sign-in is unaffected.";

function matchesRetiredNote(html) {
  assert.ok(
    html.includes(RETIRED_NOTE),
    `the picker must show the retirement note verbatim; got:\n${html}`,
  );
}

test("a stored SuperGrok choice shows Automatic, explains itself, and offers no Grok back", () => {
  const html = render({ value: "grok-oauth" });
  matchesRetiredNote(html);
  assert.match(html, /value="auto"[^>]*selected=""/, "the control must show Automatic");
  assert.doesNotMatch(html, /value="grok-oauth"/);
  // The note explains the fallback; the surface's own help still says what
  // Automatic will actually do, read from the ladder itself.
  assert.match(html, /DeepSeek v4\.1 Flash, Qwen 3\.6 35B, then Codex Terra/);
});

test("a stored SuperGrok choice on a picker that has no Automatic falls back to that surface's first choice", () => {
  const html = render({ scope: "forced", value: "grok-oauth" });
  matchesRetiredNote(html);
  const [first] = registry.providersFor("forced");
  assert.match(html, new RegExp(`value="${first.id}"[^>]*selected=""`));
  assert.doesNotMatch(html, /value="grok-oauth"/);
});
