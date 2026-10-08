// guards: a reporter could draft from the wrong transcript and lose which source they read
import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { PGlite } from "@electric-sql/pglite";
import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";

const window = installDom();
const { createRoot } = await import("react-dom/client");
const source = await moduleUrl("src/lib/news/meeting-transcript-choice.ts");
const copy = stubUrl("export const meetingTranscriptChoiceLabel = (kind) => kind === 'whisper' ? 'Whisper transcript' : 'YouTube captions'; export const meetingTranscriptReadLine = (kind) => kind === 'whisper' ? 'The reporter will read the Whisper transcript.' : 'The reporter will read the YouTube captions.';");
const chooserUrl = await moduleUrl("src/components/meeting-transcript-chooser.tsx", {
  "@/lib/news/desk-copy": copy,
  "@/lib/news/meeting-transcript-choice": source,
});
const { defaultMeetingTranscriptArtifactId, meetingArtifactIdFromDraftReceipt } = await import(source);
const { MeetingTranscriptChooser } = await import(chooserUrl);
const meetingMaterialUrl = await moduleUrl("src/lib/news/meeting-draft-material.server.ts");
const { loadMeetingDraftMaterial } = await import(meetingMaterialUrl);

test("transcripts from two videos of the same meeting default to Whisper and keep the reporter's choice", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table meeting_capture_records(newsroom_id int,video_id text,title text,published text);
      create table meeting_transcript_artifacts(id int,newsroom_id int,video_id text,source_method text,artifact_type text,captured_at timestamptz);
      insert into meeting_capture_records values (1,'captions','City Council Regular Session - October 6, 2026','2026-10-07'),
        (1,'whisper','City Council Regular Session - 06 October 2026','2026-10-08'),(1,'other','Water Board - October 6, 2026','2026-10-07');
      insert into meeting_transcript_artifacts values (61,1,'captions','yt-dlp-captions','transcript',now()),
        (67,1,'whisper','textflowkit-json','transcript',now()),(68,1,'other','textflowkit-json','transcript',now());`);
    const { loadMeetingTranscriptChoices } = await import(await moduleUrl("src/lib/news/meeting-transcript-choice.server.ts"));
    const choices = await loadMeetingTranscriptChoices({ query: async (text, params) => (await db.query(text, params)).rows }, 1, "captions");
    assert.equal(choices.length, 2);
    await db.exec(`alter table meeting_transcript_artifacts add column sha256 text default 'hash';
      create table meeting_agenda_chunks(newsroom_id int,video_id text,artifact_id int,id int,item text,title text,start_seconds int,segment_indexes text);
      create table meeting_transcript_segments(artifact_id int,segment_index int,start_seconds int,excerpt text,caption_sha256 text);
      create table meeting_structured_votes(newsroom_id int,video_id text,item text,established bool,motion text,mover text,seconder text,tally text,result text,source text);
      insert into meeting_agenda_chunks values (1,'whisper',67,1,'1','Item 1',0,'[0]');
      insert into meeting_transcript_segments values (67,0,0,'Decision','hash');`);
  assert.equal(defaultMeetingTranscriptArtifactId(choices), 67);
  const calls = [];
  function Screen() {
    const [selectedId, setSelectedId] = React.useState(defaultMeetingTranscriptArtifactId(choices));
    return React.createElement(React.Fragment, null,
      React.createElement(MeetingTranscriptChooser, { choices, selectedArtifactId: selectedId, onSelect: setSelectedId }),
      React.createElement("button", { onClick: () => calls.push(JSON.stringify({ meetingArtifactId: selectedId })) }, "Draft with AI"),
    );
  }
  const mount = document.getElementById("root");
  const root = createRoot(mount);
  await React.act(async () => root.render(React.createElement(Screen)));
  assert.equal(mount.querySelector('[role="status"]').textContent, "The reporter will read the Whisper transcript.");
  const captions = [...mount.querySelectorAll("button")].find((button) => button.textContent === "YouTube captions");
  await React.act(async () => captions.dispatchEvent(new window.Event("click", { bubbles: true })));
  assert.equal(mount.querySelector('[role="status"]').textContent, "The reporter will read the YouTube captions.");
  const whisper = [...mount.querySelectorAll("button")].find((button) => button.textContent === "Whisper transcript");
  await React.act(async () => whisper.dispatchEvent(new window.Event("click", { bubbles: true })));
  const draft = [...mount.querySelectorAll("button")].find((button) => button.textContent === "Draft with AI");
  await React.act(async () => draft.dispatchEvent(new window.Event("click", { bubbles: true })));
  assert.equal(calls.length, 1);
  const runArtifactId = meetingArtifactIdFromDraftReceipt(calls[0], null);
  const material = await loadMeetingDraftMaterial({ query: async (text, params) => (await db.query(text, params)).rows }, {
    newsroomId: 1, artifactId: runArtifactId, videoId: "captions", fallbackTitle: "Council meeting",
  });
  assert.equal(runArtifactId, 67);
  assert.equal(material.meeting.artifactId, 67);
  assert.equal(material.meeting.videoId, "whisper");
  await React.act(async () => root.unmount());
  } finally { await db.close(); }
});
