import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
let code = ts.transpileModule(
  await readFile(new URL("../src/components/search-trail-entry.tsx", import.meta.url), "utf8"),
  { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } },
).outputText;
for (const [key, url] of Object.entries({
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "../lib/news/url-guard.ts": new URL("../src/lib/news/url-guard.ts", import.meta.url).href,
}))
  code = code.replaceAll(JSON.stringify(key), JSON.stringify(url));
const { SearchTrailEntry } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
const render = (record) => renderToStaticMarkup(createElement(SearchTrailEntry, { record }));
test("search trail links returned evidence and blocks unsafe URLs", () => {
  const html = render({
    query: "housing",
    tier: "official",
    outcome: "1 result(s)",
    url: "https://records.example/report",
  });
  assert.match(html, /href="https:\/\/records.example\/report"/);
  assert.match(html, /Open returned source/);
  assert.match(html, /noopener noreferrer/);
  for (const url of ["javascript:alert(1)", "http://127.0.0.1/private"])
    assert.doesNotMatch(render({ query: "q", url }), /href=/);
});
test("search trail uses plain failure labels and never implies zero results when blocked", () => {
  for (const [state, label] of Object.entries({
    SEARCH_FAILED_NETWORK: "Search could not connect",
    SEARCH_FAILED_PROVIDER: "Search service failed",
    SEARCH_FAILED_PARSE: "Search response could not be read",
    SEARCH_BLOCKED: "Search was blocked",
    SEARCH_TIMEOUT: "Search timed out",
    SEARCH_SUCCESS_ZERO_RESULTS: "No results found",
  })) {
    const html = render({ query: "q", state });
    assert.ok(html.includes(label), html);
    assert.doesNotMatch(html, /SEARCH_/);
  }
  assert.match(
    render({ query: "q", outcome: "search failed: socket dump secret" }),
    /Search could not finish/,
  );
  assert.doesNotMatch(
    render({ query: "q", outcome: "search failed: socket dump secret" }),
    /socket dump secret/,
  );
});
test("ordinary research trail links selected source URLs", () => {
  const html = render({
    query: "q",
    state: "SEARCH_SUCCESS_RESULTS",
    selected_json: JSON.stringify(["https://records.example/selected", "javascript:alert(1)"]),
  });
  assert.match(html, /href="https:\/\/records.example\/selected"/);
  assert.doesNotMatch(html, /javascript:/);
});
