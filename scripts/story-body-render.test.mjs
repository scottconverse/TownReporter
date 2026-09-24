import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

/*
  Renders the real StoryBody (src/components/story-body.tsx) the way every
  reader-facing page does, so the assertions are on markup a reader actually
  receives rather than on a regex read out of the source file.

  The component imports nothing but React, so it loads as a data: module with
  only "react" and "react/jsx-runtime" resolved -- the same pattern
  scripts/lead-badge-render.test.mjs uses for the desk components.
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

const { StoryBody } = await import(
  moduleUrl(
    await readFile(new URL("../src/components/story-body.tsx", import.meta.url), "utf8"),
    "story-body.tsx",
    {
      react: import.meta.resolve("react"),
      "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    },
  )
);

function render(body, publicReading = false) {
  return renderToStaticMarkup(createElement(StoryBody, { body, publicReading }));
}

test("a single-asterisk phrase renders as <em>, so *emphasis* is emphasis on the page", () => {
  const html = render("The council said the *Longmont Leader* would not comment.");
  assert.match(html, /<em>Longmont Leader<\/em>/);
});

test("an underscore phrase renders as <em> too", () => {
  const html = render("The report was _unfinished_ when it was filed.");
  assert.match(html, /<em>unfinished<\/em>/);
});

test("**bold** still renders as <strong>, and only as <strong>", () => {
  const html = render("The vote was **unanimous** on Tuesday.");
  assert.match(html, /<strong>unanimous<\/strong>/);
  assert.doesNotMatch(html, /<em>/);
});

test("bold and italic together keep both, in order", () => {
  const html = render("**Bold** then *italic* then plain.");
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  // The asterisks must not survive into the reader's text.
  assert.doesNotMatch(html, /\*/);
});

test("asterisks used as arithmetic are left alone", () => {
  const html = render("The budget grew 5 * 3 percent, or 5 * 3 * 4 in the worst case.");
  assert.doesNotMatch(html, /<em>/);
  assert.match(html, /5 \* 3 \* 4/);
});

test("intraword underscores (snake_case) are left alone", () => {
  const html = render("The field is called source_kind and the column is source_urls.");
  assert.doesNotMatch(html, /<em>/);
  assert.match(html, /source_kind/);
});

test("a '-' bullet block still renders as a list", () => {
  const html = render("- Council approved the plan.\n- Staff will report back.");
  assert.match(html, /<ul/);
  assert.equal((html.match(/<li>/g) ?? []).length, 2);
  assert.match(html, /Council approved the plan\./);
});

test("a '*' bullet block renders as a list, not as one long italic phrase", () => {
  const html = render("* Council approved the plan.\n* Staff will report back.");
  assert.match(html, /<ul/);
  assert.equal((html.match(/<li>/g) ?? []).length, 2);
  assert.match(html, /Council approved the plan\./);
  assert.doesNotMatch(html, /<em>/);
  assert.doesNotMatch(html, /\*/);
});

test("a list item still renders an italic phrase inside it", () => {
  const html = render("- The *Times-Call* first reported it.\n- We confirmed it.");
  assert.equal((html.match(/<li>/g) ?? []).length, 2);
  assert.match(html, /<em>Times-Call<\/em>/);
});

test("a markdown link is untouched by the italic rule", () => {
  const html = render("Read [the notice](https://example.org/notice) for yourself.");
  assert.match(html, /<a href="https:\/\/example\.org\/notice"/);
  assert.match(html, /the notice/);
  assert.doesNotMatch(html, /<em>/);
});

test("a bare URL in the public reading is still linked", () => {
  const html = render("Posted at https://example.org/agenda today.", true);
  assert.match(html, /<a href="https:\/\/example\.org\/agenda"/);
});

test("a '## ' heading is still a heading, and can hold emphasis", () => {
  const html = render("## What *changed*\n\nThe council voted.");
  assert.match(html, /<h2/);
  assert.match(html, /<em>changed<\/em>/);
});
