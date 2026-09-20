import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const meeting = readFileSync(new URL("./meeting-capture.ts", import.meta.url), "utf8");
const desk = readFileSync(new URL("./desk.ts", import.meta.url), "utf8");

describe("meeting capture Slice 1 no-op guard", () => {
  it("returns before listing or writing when no meeting channels are configured", () => {
    const fn = meeting.slice(meeting.indexOf("export async function runMeetingAwareness"), meeting.indexOf("export function meetingCoverageJson"));
    const load = fn.indexOf("loadMeetingPriority");
    const noChannels = fn.indexOf("if (!channels.length) return EMPTY_RESULT;");
    const list = fn.indexOf("await list(channel.url)");
    const write = fn.indexOf("insert into meeting_capture_records");
    assert.ok(load >= 0, "loads per-newsroom priority");
    assert.ok(noChannels > load, "returns after empty config");
    assert.ok(noChannels < list, "must return before channel listing");
    assert.ok(noChannels < write, "must return before coverage writes");
  });

  it("scan only invokes meeting awareness when youtubeChannels is non-empty", () => {
    const block = desk.slice(desk.indexOf("const meetingChannels"), desk.indexOf("const sectionConfig"));
    assert.match(block, /youtubeChannels/);
    assert.match(block, /if \(meetingChannels\.length > 0\)/);
    assert.ok(block.indexOf("runMeetingAwareness") > block.indexOf("if (meetingChannels.length > 0)"));
  });

  it("meeting failure is caught before the page scan continues", () => {
    const block = desk.slice(desk.indexOf("if (meetingChannels.length > 0)"), desk.indexOf("const sectionConfig"));
    assert.match(block, /catch \(e\)/);
    assert.match(block, /meetingAwareness = \{/);
  });
});