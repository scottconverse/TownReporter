import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { installDom, moduleUrl } from "./dom-harness.mjs";
installDom();
const { createRoot } = await import("react-dom/client");
const { MeetingTranscriptChooser } = await import(
  await moduleUrl("src/components/meeting-transcript-chooser.tsx", {
    "@/lib/news/desk-copy": await moduleUrl("src/lib/news/desk-copy.ts"),
    "@/lib/news/meeting-transcript-choice": await moduleUrl(
      "src/lib/news/meeting-transcript-choice.ts",
    ),
  })
);
test("picker names each transcript's agenda alignment before Draft, including a single choice", async () => {
  const choices = [
    { artifactId: 67, kind: "whisper", date: "2026-10-08", agendaItemCount: 0 },
    { artifactId: 61, kind: "captions", date: "2026-10-07", agendaItemCount: 10 },
  ];
  const mount = document.getElementById("root");
  const root = createRoot(mount);
  try {
    await React.act(async () =>
      root.render(
        React.createElement(MeetingTranscriptChooser, {
          choices,
          selectedArtifactId: 67,
          onSelect() {},
        }),
      ),
    );
    const buttons = [...mount.querySelectorAll("button")];
    assert.match(
      buttons[0].textContent,
      /Whisper transcript.*2026-10-08.*not aligned to agenda items/,
    );
    assert.match(
      buttons[1].textContent,
      /YouTube captions.*2026-10-07.*aligned to 10 agenda items/,
    );
    assert.match(
      mount.querySelector('[role="alert"]').textContent,
      /Pick the YouTube captions.*or run the agenda alignment for this transcript/,
    );
    await React.act(async () =>
      root.render(
        React.createElement(MeetingTranscriptChooser, {
          choices: choices.slice(0, 1),
          selectedArtifactId: 67,
          onSelect() {},
        }),
      ),
    );
    assert.match(
      mount.textContent,
      /not aligned to agenda items.*run the agenda alignment for this transcript/i,
    );
  } finally {
    await React.act(async () => root.unmount());
  }
});
