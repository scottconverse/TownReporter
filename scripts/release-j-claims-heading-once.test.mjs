/*
  RELEASE J, item THU-9 (Scott, Oct 14 2026): "show it once".

  The public page of "OPINION: Walk test two - The library should open on
  Sundays" printed the heading "Claims and sources" twice. A piece the editor
  pasted in ("File one you wrote") carries its own `CLAIMS AND SOURCES` line,
  and `fileWrittenEditorial` files the pasted text as the draft BODY:

      CLAIMS AND SOURCES
      <the editor's own claims and sources>

  The body therefore opens on the section title, and the page then drew its
  ordinary "Claims and sources" heading above it -- the same words, twice, one
  line apart. The rule is in `story-body.tsx`, a `.tsx` module a plain node test
  cannot import, so this mounts the real `StoryBody` through the harness and
  reads the HTML it emits.

  THE SHAPE HERE IS THE LOAD-BEARING PART. The filing path for a
  model-written piece assembles `<body>\n\n---\n\nCLAIMS AND SOURCES\n\n…`
  (`editorial.server.ts`), where the `---` rule is its own block and the title
  is NOT first -- there the page's heading is the only one and must stay. Only
  a body whose FIRST block is the title is already carrying the page's heading,
  which is exactly the written-piece shape. Both are drawn below so the rule
  cannot be widened without failing this file.

  No DOM is installed: `renderToStaticMarkup` is the server renderer. The blind
  spot is that nothing here is pressed; the rule under test decides which tags
  are emitted, not what a press does.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { moduleUrl } from "./dom-harness.mjs";

const storyBodyUrl = await moduleUrl("src/components/story-body.tsx");
const { StoryBody } = await import(storyBodyUrl);

const render = (body, publicReading = true) =>
  renderToStaticMarkup(createElement(StoryBody, { body, publicReading }));

const headings = (html) => (html.match(/<h2[^>]*>/g) ?? []).length;
/* Every heading that reads as the section title, whatever its case. */
const titles = (html) => (html.match(/Claims and sources/gi) ?? []).length;
/*
  THE PAGE'S OWN WORDS. On the old code the pasted line was drawn as the
  heading itself -- `<h2 id="claims">CLAIMS AND SOURCES</h2>` -- so counting
  titles did not catch it: the page supplied no heading of its own and the
  reader got the desk's all-caps line instead of the page's. This is the
  assertion that separates the two behaviours.
*/
const pageTitle = (html) => /<h2[^>]*id="claims"[^>]*>Claims and sources<\/h2>/.test(html);

/* The written-piece shape: the pasted text leads with its own section title. */
const OWN_TITLE_FIRST = [
  "CLAIMS AND SOURCES",
  "The 2024 circulation figure comes from the library's annual report.",
].join("\n\n");

/* The model-written shape: `---` rule first, title after it. */
const MODEL_WRITTEN = [
  "The library should open on Sundays.",
  "---",
  "CLAIMS AND SOURCES",
  "The 2024 circulation figure comes from the library's annual report.",
].join("\n\n");

/* An ordinary reported story, which never had a claims section of its own. */
const REPORTED = [
  "Council approves the noise policy.",
  "The vote was 5-2, according to the meeting record.",
].join("\n\n");

test("a body that leads with its own claims heading prints the title once", () => {
  const html = render(OWN_TITLE_FIRST);
  assert.equal(titles(html), 1, "the pasted CLAIMS AND SOURCES line must not print twice");
  assert.equal(headings(html), 1);
  assert.ok(pageTitle(html), "the section must carry the page's own heading");
  assert.doesNotMatch(html, /<p[^>]*>CLAIMS AND SOURCES<\/p>/);
});

test("the title is recognised in any case, with or without a colon", () => {
  for (const title of ["Claims and Sources", "CLAIMS AND SOURCES:", "claims and sources"]) {
    const html = render([title, "A sourced claim."].join("\n\n"));
    assert.equal(titles(html), 1, `"${title}" must print once`);
    assert.equal(headings(html), 1);
    assert.ok(pageTitle(html), `"${title}" must be replaced by the page's own heading`);
  }
});

/* The rule must not reach the model-written shape: there the page's own
   heading is the only one and removing it would leave the section untitled. */
test("the model-written shape keeps its one claims heading", () => {
  const html = render(MODEL_WRITTEN);
  assert.equal(titles(html), 1);
  assert.equal(headings(html), 1);
  assert.ok(pageTitle(html));
});

test("an ordinary story with no claims section gains no heading", () => {
  const html = render(REPORTED);
  assert.equal(titles(html), 0);
  assert.equal(headings(html), 0);
});

/* The editor's preview is not the public page and is unchanged either way. */
test("the editor's preview gains no claims heading from the pasted line", () => {
  assert.equal(headings(render(OWN_TITLE_FIRST, false)), 0);
});
