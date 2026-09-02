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

const choices = moduleUrl(
  await readFile(new URL("../src/lib/news/model-choice.ts", import.meta.url), "utf8"),
  "model-choice.ts",
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

test("Story picker offers exactly Automatic, Codex Terra, Codex Sol, and Claude Opus", () => {
  // Zen and Local Qwen were removed from the picker 2026-09-02 ("it's not
  // working it seems" -- Claude/Codex only for now); the picker went from 6
  // options down to these 4.
  const html = render();
  const optionCount = (html.match(/<option[^>]*>/g) ?? []).length;
  assert.equal(optionCount, 4);
  assert.doesNotMatch(html, /Local Qwen|Zen MiMo/);
  for (const label of ["Automatic", "Codex Terra", "Codex Sol", "Claude Opus"]) {
    assert.match(html, new RegExp(`<option[^>]*>${label} `));
  }
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
