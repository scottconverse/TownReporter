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

  it("re-check uses the canonical helper that detects, records, and applies revisions", () => {
    const source = readFileSync(new URL("./meeting-capture.ts", import.meta.url), "utf8");
    const helperStart = source.indexOf("export async function applyCapturedMeetingTranscript");
    const helperEnd = source.indexOf("export async function recheckProvisionalMeetings", helperStart);
    const helper = source.slice(helperStart, helperEnd);
    assert.match(helper, /detectRevision/);
    assert.match(helper, /nextCheckState/);
    assert.match(helper, /applyDraftRevision/);
    assert.match(helper, /meeting_transcript_revisions/);

    const recheck = source.slice(helperEnd);
    assert.match(recheck, /dueForRecheck/);
    assert.match(recheck, /applyCapturedMeetingTranscript/,
      "the scheduled re-check must not reimplement or bypass the canonical revision path");
  });
});
