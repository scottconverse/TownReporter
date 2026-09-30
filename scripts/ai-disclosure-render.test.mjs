import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { howRoute, renderArticle } from "./article-page-render.mjs";

/*
  The reader-facing disclosure line, rendered from the real pages:

  - src/routes/articles.$slug.tsx  (every article page)
  - src/routes/how-we-report.tsx   (the standing "How we report" page)

  Both route modules are loaded as they are, with their non-page imports
  stubbed. That harness -- the stubs, the two route imports, `renderArticle` --
  lives in scripts/article-page-render.mjs so this file and
  scripts/corrections-automatic-render.test.mjs share one copy of it; it was
  this file's own top half until unit U14b needed the same page for the
  correction chip. What is real is unchanged: the route modules themselves,
  and the modules that decide the sentence -- @/components/ai-disclosure and
  the article's own body renderer.
*/

const AI_LINE =
  "A person reviewed and edited this story. AI tools helped find records and write the first draft. The records we used are listed under Sources.";

test("an article page states the AI disclosure, in the story column above the records", () => {
  const html = renderArticle();
  assert.match(html, new RegExp(AI_LINE.replace(/\./g, "\\.")));
  /*
    It closes the story body -- the drawing's last `<p>` inside `<article>` --
    and the records it points at are the band below it. So the order asserted
    here is: the body's anchor, the sentence, then the records' anchor. It used
    to be the other way round (the line was the head of `#sources`) because the
    evidence block lived inside the story column; unit DA2 moved the block out
    to a page-wide band and the sentence stayed with the story, where
    `Article Daily.dc.html` has it. The claim is unchanged: the line must not
    be buried at the foot of the page, and it must still be on the page that
    names the records.
  */
  const bodyIdx = html.indexOf('id="story-body"');
  const lineIdx = html.indexOf("A person reviewed and edited this story.");
  const sourcesIdx = html.indexOf('id="sources"');
  assert.ok(
    bodyIdx >= 0 && lineIdx > bodyIdx && sourcesIdx > lineIdx,
    "the line should render in the story column, above the sources band",
  );
});

test("a routine-notice roundup does NOT claim AI wrote it, and says what did", () => {
  const html = renderArticle({ routine_notice: true, topic: "council" });
  assert.doesNotMatch(
    html,
    /AI tools helped find records/,
    "a fixed-template roundup must not carry the story disclosure",
  );
  assert.match(html, /A fixed template assembled this routine notice from owner-approved public sources/);
  assert.match(html, /No AI wrote it/);
});

test("/how-we-report states the same disclosure sentence, word for word", () => {
  const html = renderToStaticMarkup(createElement(howRoute.Route.options.component));
  assert.match(html, new RegExp(AI_LINE.replace(/\./g, "\\.")));
});
