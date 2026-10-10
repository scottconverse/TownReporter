import assert from "node:assert/strict";
import { test } from "node:test";
import type { Sql } from "../db.ts";
import { loadMeetingDraftMaterial } from "./meeting-draft-material.server.ts";

test("unaligned selected transcript names its date and the same-lead aligned alternatives without drafting blind", async () => {
  const calls: string[] = [];
  const sql = {
    async query<T>(text: string): Promise<T[]> {
      calls.push(text);
      if (/select id,video_id,sha256/.test(text))
        return [{ id: 67, video_id: "whisper", sha256: "hash" }] as T[];
      if (/from meeting_capture_records/.test(text))
        return [{ title: "City Council October 6, 2026", published: "2026-10-08" }] as T[];
      if (/from meeting_transcript_artifacts a/.test(text))
        return [
          {
            id: 67,
            video_id: "whisper",
            source_method: "textflowkit-json",
            title: "City Council October 6, 2026",
            published: "2026-10-08",
            agenda_item_count: 0,
          },
          {
            id: 61,
            video_id: "captions",
            source_method: "yt-dlp-captions",
            title: "City Council October 6, 2026",
            published: "2026-10-07",
            agenda_item_count: 10,
          },
          {
            id: 99,
            video_id: "other",
            source_method: "yt-dlp-captions",
            title: "Water Board October 6, 2026",
            published: "2026-10-07",
            agenda_item_count: 20,
          },
        ] as T[];
      if (/from meeting_transcript_segments/.test(text))
        return [
          {
            segment_index: 0,
            start_seconds: 0,
            end_seconds: 10,
            excerpt: "Discussion",
            caption_sha256: "hash",
          },
        ] as T[];
      if (/select id,storage_path/.test(text))
        return [{ id: 67, storage_path: "saved", sha256: "hash" }] as T[];
      return [] as T[];
    },
  } as unknown as Sql;
  await assert.rejects(
    () =>
      loadMeetingDraftMaterial(sql, {
        newsroomId: 1,
        artifactId: 67,
        videoId: "captions",
        fallbackTitle: "Council",
      }),
    (error: Error) => {
      assert.match(error.message, /Whisper transcript.*2026-10-08.*not aligned to agenda items/);
      assert.match(
        error.message,
        /Pick the YouTube captions.*2026-10-07.*aligned to 10 agenda items.*or run the agenda alignment for this transcript/,
      );
      assert.doesNotMatch(error.message, /Water Board|20 agenda items/);
      return true;
    },
  );
  assert.ok(!calls.some((text) => /insert into|from meeting_structured_votes/.test(text)));
});

test("saved transcript aligns on demand using its own recording agenda and rereads persisted spans", async () => {
  const writes: { text: string; params: unknown[] }[] = [];
  let chunk: Record<string, unknown> | null = null;
  const sql = {
    async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
      if (/select id,video_id,sha256/.test(text))
        return [{ id: 67, video_id: "whisper", sha256: "hash" }] as T[];
      if (/from meeting_capture_records/.test(text))
        return [{ title: "Chosen recording October 6, 2026", published: "2026-10-08" }] as T[];
      if (/from meeting_transcript_artifacts a/.test(text))
        return [
          {
            id: 67,
            video_id: "whisper",
            source_method: "textflowkit-json",
            title: "Chosen recording October 6, 2026",
            published: "2026-10-08",
            agenda_item_count: 0,
          },
        ] as T[];
      if (/select id,storage_path/.test(text))
        return [{ id: 67, storage_path: "saved", sha256: "hash" }] as T[];
      if (/from meeting_transcript_segments/.test(text))
        return [
          {
            segment_index: 0,
            start_seconds: 0,
            end_seconds: 10,
            excerpt: "Agenda item 1 housing",
            caption_sha256: "hash",
          },
        ] as T[];
      if (/from meeting_agenda_chunks/.test(text)) return (chunk ? [chunk] : []) as T[];
      if (/insert into/.test(text)) {
        writes.push({ text, params });
        if (/meeting_agenda_chunks/.test(text)) {
          assert.deepEqual(params.slice(0, 3), [1, "whisper", 67]);
          chunk = {
            item: params[3],
            title: params[4],
            start_seconds: params[5],
            segment_indexes: params[7],
          };
        }
      }
      return [] as T[];
    },
  } as unknown as Sql;
  const material = await loadMeetingDraftMaterial(
    sql,
    { newsroomId: 1, artifactId: 67, videoId: "whisper", fallbackTitle: "Wrong fallback title" },
    {
      primeGovOrigin: async () => "https://example.primegov.com",
      packetForTitle: async (title) => {
        assert.equal(title, "Chosen recording October 6, 2026");
        return {
          meeting: {
            id: 1,
            title,
            date: "2026-10-06",
            dateTime: "2026-10-06T18:00:00",
            time: "18:00",
            location: "Council",
            documentList: [],
          },
          urls: [],
        };
      },
      packetItemsForMeeting: async () => [{ itemNumber: "1", title: "Housing" }],
      structuredVoteBaseUrl: async () => {
        throw new Error("retry must not fetch votes");
      },
      voteRecordsForMeeting: async () => {
        throw new Error("retry must not fetch votes");
      },
    },
  );
  assert.equal(material.meeting.artifactId, 67);
  assert.equal(material.citations[0].item, "1");
  assert.match(material.evidence, /Agenda item 1 housing/);
  assert.equal(writes.filter((w) => /meeting_agenda_chunks/.test(w.text)).length, 1);
  assert.ok(!writes.some((w) => /meeting_structured_votes/.test(w.text)));
});

test("agenda retry stops after 15 seconds and a late response cannot write alignment", async (context) => {
  const { runSection5ForArtifact } = await import("./meeting-story-section5-run.ts");
  const writes: string[] = [];
  const sql = { async query<T>(text: string): Promise<T[]> {
    if (/from meeting_transcript_artifacts/.test(text)) return [{ id: 67, storage_path: "saved", sha256: "hash" }] as T[];
    if (/from meeting_transcript_segments/.test(text)) return [{ segment_index: 0, start_seconds: 0, end_seconds: 10, excerpt: "Agenda item 1 housing", caption_sha256: "hash" }] as T[];
    if (/insert into/.test(text)) writes.push(text);
    return [] as T[];
  } } as unknown as Sql;
  let finish: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = runSection5ForArtifact(sql, { newsroomId: 1, videoId: "whisper", artifactId: 67, title: "Chosen recording", alignmentOnly: true }, {
    primeGovOrigin: async () => "https://example.primegov.com",
    packetForTitle: async () => {
      await gate;
      return { meeting: { id: 1, title: "Chosen recording", date: "2026-10-06", dateTime: "2026-10-06T18:00:00", time: "18:00", location: "Council", documentList: [] }, urls: [] };
    },
    packetItemsForMeeting: async () => [{ itemNumber: "1", title: "Housing" }],
  });
  await new Promise(resolve => setImmediate(resolve));
  context.mock.timers.tick(15_000);
  assert.equal((await pending).aligned, false);
  finish!();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, []);
});
