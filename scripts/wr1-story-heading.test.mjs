/*
  WR1 phase 2: the "ALSO AT THE MEETING" line, drawn by the real renderer.

  WHY THIS IS A RENDER AND NOT A RULE. The whole-meeting writer joins its lead
  story to the roundup list with a standing section title, "ALSO AT THE
  MEETING" (meeting-whole.ts's `assembleStory`). `StoryBody` drew that line as
  an ordinary paragraph, so the editor's preview and the published story page
  showed a sentence where the writer meant a heading. The fix is a rule inside
  story-body.tsx -- which is a `.tsx` file, so a plain node test cannot import
  it: `--experimental-strip-types` strips types but does not transform JSX. The
  harness transcribes the component with `typescript` and hands back an
  importable module, so this mounts the real `StoryBody` and reads the tags it
  actually emits.

  No DOM is installed: `renderToStaticMarkup` is the server renderer and needs
  no window. The blind spot is the same one every string render has -- nothing
  here is pressed -- and it does not matter, because the rule under test decides
  a tag, not a press.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { moduleUrl } from "./dom-harness.mjs";

const storyBodyUrl = await moduleUrl("src/components/story-body.tsx");
const { StoryBody } = await import(storyBodyUrl);

const render = (body, publicReading = false) =>
  renderToStaticMarkup(createElement(StoryBody, { body, publicReading }));

const DRAFT = [
  "The council set a noise policy.",
  "ALSO AT THE MEETING",
  "Airport fund budget: The 2027 airport fund budget totals $733,170.",
].join("\n\n");

test("the ALSO AT THE MEETING line is drawn as a heading, not a paragraph", () => {
  const html = render(DRAFT);
  assert.match(
    html,
    /<h2[^>]*>ALSO AT THE MEETING<\/h2>/,
    "the roundup title must be an h2 in the editor's preview",
  );
  assert.doesNotMatch(
    html,
    /<p[^>]*>ALSO AT THE MEETING/,
    "and must not be drawn as a plain paragraph",
  );
  assert.match(
    html,
    /<p[^>]*>Airport fund budget: The 2027 airport fund budget totals \$733,170\.<\/p>/,
    "the roundup paragraph under it stays a paragraph",
  );
});

test("the published reading draws the same line as a heading", () => {
  const html = render(DRAFT, true);
  assert.match(html, /<h2[^>]*>ALSO AT THE MEETING<\/h2>/, "the public page agrees with the preview");
});
