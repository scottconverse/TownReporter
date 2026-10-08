// guards: a reporter could draft from the wrong transcript and lose which source they read
import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";

const window = installDom();
const { createRoot } = await import("react-dom/client");
const source = await moduleUrl("src/lib/news/meeting-transcript-choice.ts");
const copy = stubUrl("export const meetingTranscriptChoiceLabel = (kind) => kind === 'whisper' ? 'Whisper transcript' : 'YouTube captions'; export const meetingTranscriptReadLine = (kind) => kind === 'whisper' ? 'The reporter will read the Whisper transcript.' : 'The reporter will read the YouTube captions.';");
const chooserUrl = await moduleUrl("src/components/meeting-transcript-chooser.tsx", {
  "@/lib/news/desk-copy": copy,
  "@/lib/news/meeting-transcript-choice": source,
});
const { defaultMeetingTranscriptArtifactId, meetingArtifactIdFromDraftReceipt, meetingTranscriptChoices } = await import(source);
const { MeetingTranscriptChooser } = await import(chooserUrl);
const meetingMaterialUrl = await moduleUrl("src/lib/news/meeting-draft-material.server.ts");
const { loadMeetingDraftMaterial } = await import(meetingMaterialUrl);

test("the selected transcript is what the reporter starts with", async () => {
  const choices = meetingTranscriptChoices([
    { id: 61, source_method: "yt-dlp-captions" },
    { id: 67, source_method: "textflowkit-json" },
  ]);
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
  const draft = [...mount.querySelectorAll("button")].find((button) => button.textContent === "Draft with AI");
  await React.act(async () => draft.dispatchEvent(new window.Event("click", { bubbles: true })));
  assert.equal(calls.length, 1);
  const runArtifactId = meetingArtifactIdFromDraftReceipt(calls[0], null);
  const reads = [];
  const sql = { query: async (text, params) => {
    reads.push({ text, params });
    if (/select id,video_id,sha256 from meeting_transcript_artifacts/.test(text)) return [{ id: 61, video_id: "video", sha256: "hash" }];
    if (/from meeting_capture_records/.test(text)) return [{ title: "Council meeting", published: "2026-10-06" }];
    if (/from meeting_agenda_chunks/.test(text)) return [{ item: "1", title: "Item 1", start_seconds: 0, segment_indexes: "[0]" }];
    if (/from meeting_transcript_segments/.test(text)) return [{ segment_index: 0, start_seconds: 0, excerpt: "Decision", caption_sha256: "hash" }];
    return [];
  } };
  const material = await loadMeetingDraftMaterial(sql, {
    newsroomId: 1, artifactId: runArtifactId, videoId: "video", fallbackTitle: "Council meeting",
  });
  assert.equal(reads[0].params[0], 61);
  assert.equal(material.meeting.artifactId, 61);
  await React.act(async () => root.unmount());
});
