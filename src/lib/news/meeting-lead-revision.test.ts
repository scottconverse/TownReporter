import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { fileMeetingLead } from "./meeting-lead.ts";

test("a revised transcript refreshes one meeting lead without resetting its editorial state", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table leads (
      id serial primary key,
      user_id text not null,
      newsroom_id integer not null,
      headline text not null,
      why text not null,
      topic text not null,
      source_urls text not null,
      evidence text not null,
      newsworthiness integer not null,
      status text not null,
      notes_json text not null,
      meeting_video_id text,
      meeting_artifact_id integer,
      meeting_lead_purpose text
    )`);
    await db.exec(`create unique index leads_meeting_artifact_purpose_uidx
      on leads (newsroom_id,meeting_video_id,meeting_artifact_id,meeting_lead_purpose)
      where meeting_video_id is not null and meeting_artifact_id is not null and meeting_lead_purpose is not null`);
    const migration = await readFile(
      new URL("../../../migrations/0081_meeting_lead_video_identity.sql", import.meta.url),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T>(text: string, params: unknown[] = []) =>
      (await db.query<T>(text, params)).rows;
    const base = {
      newsroomId: 1,
      userId: "editor",
      videoId: "revision-1",
      title: "City Council",
      meetingDate: "2026-09-22",
      topic: "council",
      sourceUrls: ["https://www.youtube.com/watch?v=revision-1"],
      items: [{ item: "8", title: "Annexation" }],
      establishedVotes: 0,
      votes: [],
    };
    const first = await fileMeetingLead(sql, {
      ...base,
      artifactId: 10,
      citations: [{ item: "8", segmentIndex: 1, timestampSeconds: 30, excerpt: "artifact A", captionSha256: "a" }],
    });
    await db.query("update leads set status='drafted' where id=$1", [first.leadId]);
    const revised = await fileMeetingLead(sql, {
      ...base,
      artifactId: 11,
      citations: [{ item: "8", segmentIndex: 1, timestampSeconds: 30, excerpt: "artifact B", captionSha256: "b" }],
    });
    const rows = (await db.query<{
      id: number; status: string; meeting_artifact_id: number; notes_json: string;
    }>("select id,status,meeting_artifact_id,notes_json from leads")).rows;
    assert.equal(revised.leadId, first.leadId, "the revision must return the existing Queue lead");
    assert.equal(rows.length, 1, "one meeting video must not create a second transcript-story lead");
    assert.equal(rows[0]!.status, "drafted", "the revision must preserve the editor's workflow state");
    assert.equal(rows[0]!.meeting_artifact_id, 11, "the existing lead must point at artifact B for redrafting");
    assert.equal(JSON.parse(rows[0]!.notes_json).meeting.artifactId, 11);
    assert.match(rows[0]!.notes_json, /artifact B/);
  } finally {
    await db.close();
  }
});
