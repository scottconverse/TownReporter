import assert from "node:assert/strict";
import { test } from "node:test";
import { renderArticle } from "./article-page-render.mjs";

/*
  Unit C10: the label an opinion story carries beside its section name.

  The route printed " · Perspective" after the section tag for
  `article.topic === "opinion"`. The desk's own word for the section is
  "Opinion", and the page's label is now the same word. The render is the
  route module itself (scripts/article-page-render.mjs), so this reads the
  markup a reader gets, not a copy of the string.
*/

test("an opinion story's byline says Opinion, not Perspective", () => {
  const html = renderArticle({ topic: "opinion" });
  assert.match(html, /· Opinion/, "the opinion label must print beside the section");
  assert.doesNotMatch(html, /Perspective/, "the old label must be gone");
});

test("a non-opinion story carries no opinion label", () => {
  const html = renderArticle({ topic: "council" });
  assert.doesNotMatch(html, /· Opinion/);
  assert.doesNotMatch(html, /Perspective/);
});
