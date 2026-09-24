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
const utilities = await readFile(new URL("../src/components/meeting-source-block-utils.ts", import.meta.url), "utf8");
const utilityOutput = ts.transpileModule(utilities, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const utilityStub = "data:text/javascript;base64," + Buffer.from(utilityOutput).toString("base64");
const reactStub = "data:text/javascript;base64," + Buffer.from("export const useState=(value)=>[value,()=>{}]; export const useEffect=()=>{};").toString("base64");
let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText;
const notesStub = "data:text/javascript;base64," + Buffer.from("export const emptyNotes=()=>({news:\"\",why:\"\",angle:\"\",todo:[],found:[],verify:[],opened:[],scratch:\"\"})").toString("base64");
output = output
  .replaceAll(JSON.stringify("@/lib/news/notes"), JSON.stringify(notesStub))
  .replaceAll(JSON.stringify("react"), JSON.stringify(reactStub))
  .replaceAll(JSON.stringify("@/components/meeting-source-block-utils"), JSON.stringify(utilityStub))
  .replaceAll(JSON.stringify("react/jsx-runtime"), JSON.stringify(import.meta.resolve("react/jsx-runtime")));
const mod = await import("data:text/javascript;base64," + Buffer.from(output).toString("base64"));
const { MeetingSourceBlock } = mod;
const { meetingClock, meetingCitationsFor } = await import(utilityStub);

const empty = { news: "", why: "", angle: "", todo: [], found: [], verify: [], opened: [], scratch: "" };
const full = {
  ...empty,
  meeting: { videoId: "L1AnMLsLwtk", title: "City Council Regular Session", date: "2026-09-15", artifactId: 4 },
  transcriptCitations: [{ item: "9", segmentIndex: 4612, timestampSeconds: 18450, timestamp: "05:07:30", excerpt: "the motion carries six to one", captionSha256: "abc" }],
};
const usedEvidence = {
  meeting: full.meeting,
  artifactId: 4,
  artifactSha256: "abc",
  currentArtifactId: 4,
  currentSha256: "abc",
  newerTranscriptExists: false,
  revisionNotice: null,
  citations: full.transcriptCitations,
};

test("shows the agenda item, the timestamp and the verbatim words", () => {
  const html = renderToStaticMarkup(createElement(MeetingSourceBlock, { notes: full, usedEvidence }));
  assert.match(html, /Where this draft came from/);
  assert.match(html, /Item 9/, "the editor must see which agenda item");
  assert.match(html, /05:07:30/, "the editor must see the timestamp");
  assert.match(html, /the motion carries six to one/, "the editor must see the words from the tape");
});

test("puts the recording one click away at the cited moment", () => {
  const html = renderToStaticMarkup(createElement(MeetingSourceBlock, { notes: full, usedEvidence }));
  assert.match(html, /youtube\.com\/watch\?v=L1AnMLsLwtk&amp;t=18450s/, "the tape must be one click away at the cited moment");
});

test("renders nothing for an ordinary story", () => {
  assert.equal(renderToStaticMarkup(createElement(MeetingSourceBlock, { notes: empty })), "");
});

test("renders nothing when a meeting has no transcript material", () => {
  const notes = { ...empty, meeting: { videoId: "v", title: "T", date: null, artifactId: 1 } };
  assert.equal(renderToStaticMarkup(createElement(MeetingSourceBlock, { notes })), "");
  assert.deepEqual(meetingCitationsFor(notes), []);
});

test("shows a separate citation-only review of A against B without hiding the redraft path", () => {
  const revised = {
    ...usedEvidence,
    currentArtifactId: 5,
    currentSha256: "b".repeat(64),
    newerTranscriptExists: true,
    revisionNotice: "Affected claims: segment 4612.",
    citations: [{
      ...usedEvidence.citations[0],
      currentEvidence: {
        artifactId: 5, artifactSha256: "b".repeat(64), segmentIndex: 18,
        timestampSeconds: 18455, excerpt: "the motion passed six to one", captionSha256: "c".repeat(64),
      },
    }],
  };
  const html = renderToStaticMarkup(createElement(MeetingSourceBlock, {
    notes: full, usedEvidence: revised, evidenceToken: "draft-1",
    onReverify: () => {}, onRedraft: () => {},
  }));
  assert.match(html, /Used by this draft \(artifact A\)/);
  assert.match(html, /Current transcript \(artifact 5/);
  assert.match(html, /I compared segment 4612 in A with its current passage in B/);
  assert.match(html, /What did you verify\?/);
  assert.match(html, /Save review against current transcript/);
  assert.match(html, /Redraft from current transcript/);
  assert.match(html, /disabled=""/, "the editor cannot save until every citation is checked and a note is entered");
});

test("shows the saved reviewer and B hash after citation-only acceptance", () => {
  const reviewed = {
    ...usedEvidence,
    currentArtifactId: 5,
    currentSha256: "b".repeat(64),
    newerTranscriptExists: true,
    revisionNotice: "Affected claims: segment 4612.",
    acceptedReview: {
      artifactId: 5, artifactSha256: "b".repeat(64), reviewedBy: "editor-1",
      reviewedAt: "2026-09-23T20:00:00.000Z", note: "Compared the vote quote with B.", citationCount: 1,
    },
    citations: [{
      ...usedEvidence.citations[0],
      currentEvidence: {
        artifactId: 5, artifactSha256: "b".repeat(64), segmentIndex: 18,
        timestampSeconds: 18455, excerpt: "the motion passed six to one", captionSha256: "c".repeat(64),
      },
    }],
  };
  const html = renderToStaticMarkup(createElement(MeetingSourceBlock, { notes: full, usedEvidence: reviewed, onRedraft: () => {} }));
  assert.match(html, /Citation review saved against artifact 5/);
  assert.match(html, /editor-1/);
  assert.match(html, /Compared the vote quote with B\./);
  assert.doesNotMatch(html, /Save review against current transcript/);
});

test("separates the draft's persisted used subset from candidate material", () => {
  const notes = {
    ...full,
    transcriptCitations: [
      ...full.transcriptCitations,
      { item: "10", segmentIndex: 5000, timestampSeconds: 20000, timestamp: "05:33:20", excerpt: "candidate words not used", captionSha256: "abc" },
    ],
  };
  const html = renderToStaticMarkup(createElement(MeetingSourceBlock, { notes, usedEvidence }));
  const usedHeading = html.indexOf("Where this draft came from");
  const candidateHeading = html.indexOf("Transcript material considered (2)");
  assert.ok(usedHeading >= 0 && candidateHeading > usedHeading);
  assert.match(html.slice(usedHeading, candidateHeading), /the motion carries six to one/);
  assert.doesNotMatch(html.slice(usedHeading, candidateHeading), /candidate words not used/);
  assert.match(html.slice(candidateHeading), /candidate words not used/);
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

