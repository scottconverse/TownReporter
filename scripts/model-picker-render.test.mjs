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
const choices = moduleUrl(
  await readFile(new URL("../src/lib/news/model-choice.ts", import.meta.url), "utf8"),
  "model-choice.ts",
  { "./provider-registry.ts": registryUrl },
);
const { ModelPicker } = await import(
  moduleUrl(
    await readFile(new URL("../src/components/model-picker.tsx", import.meta.url), "utf8"),
    "model-picker.tsx",
    {
      "@/lib/news/model-choice": choices,
      react: import.meta.resolve("react"),
      "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    },
  )
);

function render(props = {}) {
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
