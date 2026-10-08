// guards: unusable citation tokens could reach published stories and hide missing source links.
import assert from "node:assert/strict";
import { test } from "node:test";
import { moduleUrl } from "./dom-harness.mjs";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
const { parseEditorial } = await import(await moduleUrl("src/lib/news/editorial.ts"));
const { StoryBody } = await import(await moduleUrl("src/components/story-body.tsx"));
test("pasted and old published editorials remove machine citation tokens", () => {
  const raw =
    'Headline\n\nEvidence :chatgpt-content-reference{index="0"} [oaicite:1]{index=1} citeturn0search0 citeturn0search1. [Record](https://city.gov/record)';
  assert.doesNotMatch(
    parseEditorial(raw).body,
    /chatgpt-content-reference|oaicite|citeturn|turn0search/,
  );
  const html = render(h(StoryBody, { body: raw }));
  assert.doesNotMatch(html, /chatgpt-content-reference|oaicite|citeturn|turn0search/);
  assert.ok(html.includes('href="https://city.gov/record"'));
});
