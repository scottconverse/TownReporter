import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("meeting capture closeout: provisional re-check is wired into the scan path", () => {
  it("exports a re-check entry point", () => {
    const source = readFileSync(new URL("./meeting-capture.ts", import.meta.url), "utf8");
    assert.match(source, /export async function recheckProvisionalMeetings/);
  });

  it("the scan path invokes the provisional re-check", () => {
    const desk = readFileSync(new URL("./desk.ts", import.meta.url), "utf8");
    const block = desk.slice(desk.indexOf("const meetingChannels"), desk.indexOf("let runId = job.subject_id"));
    assert.match(block, /recheckProvisionalMeetings/);
  });

  it("re-check calls detectRevision, nextCheckState, and applyDraftRevision", () => {
    const source = readFileSync(new URL("./meeting-capture.ts", import.meta.url), "utf8");
    const start = source.indexOf("export async function recheckProvisionalMeetings");
    const body = source.slice(start);
    assert.match(body, /detectRevision/);
    assert.match(body, /nextCheckState/);
    assert.match(body, /applyDraftRevision/);
    assert.match(body, /meeting_transcript_revisions/);
    assert.match(body, /dueForRecheck/);
  });
});
