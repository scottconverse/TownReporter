import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

/*
  What the editor sees on a meeting story: the "Where this came from" block.

  The block is the whole reason the feature is worth building. Without it a
  meeting story is a claim about a four-hour recording that the editor cannot
  check without watching the recording. With it, every line the draft drew from
  the tape resolves to an agenda item, a timestamp and the verbatim words.

  Transpiled and rendered the way the other component render tests in this repo
  do it, so this exercises the real component source rather than a copy.
*/
const source = await readFile(new URL("../src/components/meeting-source-block.tsx", import.meta.url), "utf8");
let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText;
const notesStub = "data:text/javascript;base64," + Buffer.from("export const emptyNotes=()=>({news:\"\",why:\"\",angle:\"\",todo:[],found:[],verify:[],opened:[],scratch:\"\"})").toString("base64");
output = output
  .replaceAll(JSON.stringify("@/lib/news/notes"), JSON.stringify(notesStub))
  .replaceAll(JSON.stringify("react/jsx-runtime"), JSON.stringify(import.meta.resolve("react/jsx-runtime")));
const mod = await import("data:text/javascript;base64," + Buffer.from(output).toString("base64"));
const { MeetingSourceBlock, meetingClock, meetingCitationsFor } = mod;

const empty = { news: "", why: "", angle: "", todo: [], found: [], verify: [], opened: [], scratch: "" };
const full = {
  ...empty,
  meeting: { videoId: "L1AnMLsLwtk", title: "City Council Regular Session", date: "2026-09-15", artifactId: 4 },
  transcriptCitations: [{ item: "9", segmentIndex: 4612, timestampSeconds: 18450, timestamp: "05:07:30", excerpt: "the motion carries six to one", captionSha256: "abc" }],
};

test("shows the agenda item, the timestamp and the verbatim words", () => {
  const html = renderToStaticMarkup(createElement(MeetingSourceBlock, { notes: full }));
  assert.match(html, /Where this came from/);
  assert.match(html, /Item 9/, "the editor must see which agenda item");
  assert.match(html, /05:07:30/, "the editor must see the timestamp");
  assert.match(html, /the motion carries six to one/, "the editor must see the words from the tape");
});

test("puts the recording one click away at the cited moment", () => {
  const html = renderToStaticMarkup(createElement(MeetingSourceBlock, { notes: full }));
  assert.match(html, /youtube\.com\/watch\?v=L1AnMLsLwtk&amp;t=18450s/, "the tape must be one click away at the cited moment");
});

test("renders nothing for an ordinary story", () => {
  assert.equal(renderToStaticMarkup(createElement(MeetingSourceBlock, { notes: empty })), "");
});

test("renders nothing when a meeting has no citations recorded", () => {
  const notes = { ...empty, meeting: { videoId: "v", title: "T", date: null, artifactId: 1 } };
  assert.equal(renderToStaticMarkup(createElement(MeetingSourceBlock, { notes })), "");
  assert.deepEqual(meetingCitationsFor(notes), []);
});

test("formats a clock the way the editor reads it, and never renders NaN", () => {
  assert.equal(meetingClock(0), "00:00:00");
  assert.equal(meetingClock(18450), "05:07:30");
  assert.equal(meetingClock(3661), "01:01:01");
  assert.equal(meetingClock(Number.NaN), "00:00:00");
  assert.equal(meetingClock(undefined), "00:00:00");
});

test("falls back to raw seconds when a stored timestamp is absent", () => {
  const notes = {
    ...empty,
    meeting: { videoId: "v", title: "T", date: null, artifactId: 2 },
    transcriptCitations: [{ item: "5", segmentIndex: 1, timestampSeconds: 1258, excerpt: "x", captionSha256: "h" }],
  };
  const html = renderToStaticMarkup(createElement(MeetingSourceBlock, { notes }));
  assert.match(html, /00:20:58/, "the block must still show when the citation was spoken");
});

