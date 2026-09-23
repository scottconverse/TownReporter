import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";
import { lockMeetingRevisionForCapture, lockMeetingsForDraftPublish } from "./meeting-revision-lock.ts";

function recordingSql(rows: Record<string, unknown>[]) {
  const calls: { text: string; params: unknown[] }[] = [];
  const sql = (async () => [] as never[]) as unknown as Sql;
  sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    return (calls.length === 1 ? rows : [{ video_id: String(params[1] ?? "locked") }]) as T[];
  };
  return { sql, calls };
}

describe("meeting revision lock order", () => {
  it("capture locks every affected lead in stable order before the meeting record", async () => {
    const { sql, calls } = recordingSql([{ lead_id: 9 }, { lead_id: 3 }, { lead_id: 9 }]);
    await lockMeetingRevisionForCapture(sql, { newsroomId: 2, videoId: "council-1" });
    assert.match(calls[0]!.text, /select distinct d\.lead_id/i);
    assert.match(calls[1]!.text, /from leads/i);
    assert.match(calls[1]!.text, /for update/i);
    assert.deepEqual(calls[1]!.params, [2, 3]);
    assert.deepEqual(calls[2]!.params, [2, 9]);
    assert.match(calls[3]!.text, /meeting_capture_records/i);
    assert.match(calls[3]!.text, /for update/i);
  });

  it("publication locks the linked meeting record after its caller owns the lead fence", async () => {
    const { sql, calls } = recordingSql([{ video_id: "meeting-b" }, { video_id: "meeting-a" }]);
    await lockMeetingsForDraftPublish(sql, { newsroomId: 2, draftId: 41 });
    assert.match(calls[0]!.text, /meeting_draft_transcript_links/i);
    assert.deepEqual(calls[1]!.params, [2, "meeting-a"]);
    assert.deepEqual(calls[2]!.params, [2, "meeting-b"]);
    assert.ok(calls.slice(1).every((call) => /for update/i.test(call.text)));
  });
});
