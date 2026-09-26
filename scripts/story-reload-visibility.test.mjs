import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const desk = await readFile(new URL("../src/lib/news/desk.ts", import.meta.url), "utf8");
const story = await readFile(
  new URL("../src/routes/desk.story.$leadId.tsx", import.meta.url),
  "utf8",
);

test("Story reload hydrates the durable draft and retains the latest job result", () => {
  assert.match(
    desk,
    /latestJob\(\{\s*newsroomId:[\s\S]*?kind:\s*"draft"[\s\S]*?subjectId:\s*id\s*\}\)/,
    "getLead must reload the durable draft job instead of relying on mutation memory",
  );
  assert.match(desk, /return\s*\{[\s\S]*?lead,[\s\S]*?draft,[\s\S]*?job,/);
  /*
    0.6.67: on a published story the headline box starts from the article's
    own headline, which an editor may have changed since it went up, and falls
    back to the draft's. Either way the field is hydrated from what was saved,
    which is the property here -- the dek, body and section still come from the
    draft alone.
  */
  assert.match(
    story,
    /if\s*\(!waitingSince\)[\s\S]*?setHeadline\([\s\S]{0,160}?d\.headline\)[\s\S]*?setBody\(stripReporterNotebook\(d\.body\s*\?\?\s*""\)\)/,
    "a newly loaded page must hydrate its editor fields from the saved draft",
  );
});

test("Story reload surfaces a durable failed job when no newer click message exists", () => {
  assert.match(
    story,
    /previousJobError\s*=\s*!waiting\s*&&\s*!msg\s*&&\s*data\?\.job\?\.status\s*===\s*"failed"/,
    "a reload must derive the error from the durable failed job",
  );
  /*
    The Notice carries a child now (the Sign in button that appears when the
    failure is a lapsed provider login), so this can no longer require the
    text to be the Notice's ONLY content -- it requires it to be the FIRST
    thing in it. That is the property that mattered: the recovered failure is
    what the editor reads, not something tucked under a button.
  */
  assert.match(
    story,
    /draftProblem\s*&&\s*!onPaper[\s\S]*?<Notice[\s\S]*?>\s*\{draftProblem\}/,
    "the recovered failure must be rendered as an editor-visible notice",
  );
  assert.match(
    story,
    /<Notice[\s\S]*?\{draftProblem\}[\s\S]{0,900}?<\/Notice>/,
    "the notice must still close around the recovered failure",
  );
});

test("Model and research opens controls beside the toolbar instead of jumping into a scrolled inspector", () => {
  assert.match(story, /aria-controls="story-model-research"/);
  assert.match(story, /id="story-model-research"[\s\S]*?<ModelPicker[\s\S]*?<DraftScopePicker/);
  assert.match(story, /Model & research · \{modelChoiceLabel\(modelChoice\)\}/);
  assert.match(story, /Choose another model/);
  assert.doesNotMatch(
    story,
    /Model & research[\s\S]{0,500}?document\.getElementById\("story-inspector"\)\?\.scrollIntoView/,
  );
});
