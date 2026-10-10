import test from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";
import { loadMeetingPublishEvidence, recordMeetingPublishEvidence, staleCitationNotice } from "./meeting-publish-guard.ts";

const ABSENT_DETAIL = "Recorded transcript file is absent.";
const ABSENT_PATH = "C:/missing/transcript.vtt";
const REFUSAL = "This meeting draft's transcript evidence is missing or incomplete. Redraft it from the current recording before publishing.";
const ABSENT_NOTICE = "The original recording file is not on this computer. Every quote was checked against the saved transcript text in the database.";

const A = "a";

const SEGMENTS = [
  { segment_index: 0, caption_sha256: A },
  { segment_index: 1, caption_sha256: A },
];

const SNAPSHOT = JSON.stringify([
  { artifactId: 7, segmentIndex: 0, captionSha256: A },
  { artifactId: 7, segmentIndex: 1, captionSha256: A },
]);

type Row = {
  draft_id: number;
  id: number;
  research_json: string | null;
  link_id: number | null;
  artifact_id: number | null;
  citation_snapshot: string | null;
  revision_notice: string | null;
  video_id: string | null;
  linked_storage_path: string | null;
  linked_integrity_detail: string | null;
  linked_sha256: string | null;
  linked_integrity_status: string | null;
  current_artifact_id: number | null;
  current_sha256: string | null;
  current_integrity_status: string | null;
  is_current: boolean | null;
};

function row(o: Partial<Row> = {}): Row {
  return {
    draft_id: 1,
    id: 1,
    research_json: JSON.stringify({ meetingEvidence: { used: true } }),
    link_id: 100,
    artifact_id: 7,
    citation_snapshot: SNAPSHOT,
    revision_notice: null,
    video_id: "vid",
    linked_storage_path: ABSENT_PATH,
    linked_integrity_detail: ABSENT_DETAIL,
    linked_sha256: A,
    linked_integrity_status: "missing",
    current_artifact_id: 7,
    current_sha256: A,
    current_integrity_status: "missing",
    is_current: true,
    ...o,
  };
}

function stubSql(rows: Row[], segments: { segment_index: number; caption_sha256: string }[] = SEGMENTS): Sql {
  const fn = (async (text: string, params?: unknown[]) => {
    const norm = String(text).replace(/\s+/g, " ").trim();
    if (/from drafts d/i.test(norm)) {
      assert.deepEqual(params, [1, 1]);
      return rows;
    }
    if (/from meeting_draft_transcript_revision_reviews/i.test(norm)) return [];
    if (/from meeting_transcript_segments/i.test(norm)) {
      const p = params as [number, number[]];
      const artifactId = Number(p[0]);
      const indices = p[1] as number[];
      if (artifactId !== 7) return [];
      return segments.filter((s) => indices.includes(Number(s.segment_index)));
    }
    throw new Error(`unexpected query: ${norm}`);
  }) as unknown as Sql;
  (fn as unknown as { query: unknown }).query = fn;
  return fn;
}

const input = { newsroomId: 1, draftId: 1 };

async function load(o: Partial<Row> = {}, opts: {
  segments?: { segment_index: number; caption_sha256: string }[];
  fileExists?: (p: string) => Promise<boolean>;
} = {}) {
  return loadMeetingPublishEvidence(
    stubSql([row(o)], opts.segments),
    input,
    opts.fileExists ?? (async () => false),
  );
}

async function loadRows(rows: Row[], opts: {
  segments?: { segment_index: number; caption_sha256: string }[];
  fileExists?: (p: string) => Promise<boolean>;
} = {}) {
  return loadMeetingPublishEvidence(
    stubSql(rows, opts.segments),
    input,
    opts.fileExists ?? (async () => false),
  );
}

test("file absent and all citations verify: allowed with artifact audit count and notice", async () => {
  let probes = 0;
  const result = await load({}, { fileExists: async (path) => {
    assert.equal(path, ABSENT_PATH);
    probes++;
    return false;
  } });
  assert.deepEqual(result.stale, []);
  assert.deepEqual(result.fileAbsent, [{ artifactId: 7, verifiedCitationCount: 2 }]);
  assert.equal(result.notice, ABSENT_NOTICE);
  assert.equal(probes, 1);
});

test("file-absent publish preserves the verified artifact and citation snapshot on the article", async () => {
  const evidence = await load();
  const writes: unknown[][] = [];
  const sql = (async () => []) as unknown as Sql;
  sql.query = async <T>(text: string, params?: unknown[]) => {
    if (/^\s*select l.newsroom_id/i.test(text)) {
      return [{ linked_integrity_status: "missing", current_integrity_status: "missing", current_artifact_id: 7 }] as T[];
    }
    assert.match(text, /insert into meeting_article_transcript_links/i);
    writes.push(params!);
    return [{ article_id: 12 }] as T[];
  };
  assert.deepEqual(await recordMeetingPublishEvidence(sql, { newsroomId: 1, articleId: 12, draftId: 1 }, evidence), { recorded: 1 });
  assert.deepEqual(writes, [[1, 12, 1, 7, A, "vid", SNAPSHOT]]);
});

test("refused evidence cannot write article provenance", async () => {
  const evidence = await load({}, { segments: [] });
  const sql = (async () => { assert.fail("refused publication must not write"); }) as unknown as Sql;
  sql.query = async () => { assert.fail("refused publication must not write"); };
  await assert.rejects(recordMeetingPublishEvidence(sql, { newsroomId: 1, articleId: 12, draftId: 1 }, evidence), { message: REFUSAL });
});

test("valid file publish keeps the existing provenance recorder", async () => {
  const evidence = await load({ linked_integrity_status: "valid", current_integrity_status: "valid" });
  let checkedExistingLink = false;
  const sql = (async () => []) as unknown as Sql;
  sql.query = async <T>(text: string, params?: unknown[]) => {
    if (/^\s*select l.newsroom_id/i.test(text)) {
      checkedExistingLink = true;
      assert.deepEqual(params, [1, 1]);
      return [] as T[];
    }
    assert.match(text, /insert into meeting_article_transcript_links/i);
    assert.deepEqual(params, [1, 12, 1]);
    return [{ article_id: 12 }] as T[];
  };
  assert.deepEqual(await recordMeetingPublishEvidence(sql, { newsroomId: 1, articleId: 12, draftId: 1 }, evidence), { recorded: 1 });
  assert.equal(checkedExistingLink, true);
});

test("negative: one segment hash 'different' -> no flags, refusal notice", async () => {
  const result = await load({}, { segments: [
    { segment_index: 0, caption_sha256: "different" },
    SEGMENTS[1],
  ] });
  assert.ok(result.stale.length > 0);
  assert.deepEqual(result.fileAbsent, []);
  assert.equal(result.notice, null);
  assert.equal(staleCitationNotice(result.stale), REFUSAL);
  assert.equal(result.stale[0]?.reason, "invalid-citation-segment");
});

test("negative: missing cited segment -> no flags, refusal notice", async () => {
  const result = await load({}, { segments: [SEGMENTS[0]] });
  assert.ok(result.stale.length > 0);
  assert.deepEqual(result.fileAbsent, []);
  assert.equal(result.notice, null);
  assert.equal(staleCitationNotice(result.stale), REFUSAL);
  assert.equal(result.stale[0]?.reason, "invalid-citation-segment");
});

test("negative: file present while missing-marked -> no flags, refusal notice", async () => {
  const result = await load({}, { fileExists: async () => true });
  assert.ok(result.stale.length > 0);
  assert.deepEqual(result.fileAbsent, []);
  assert.equal(result.notice, null);
  assert.equal(staleCitationNotice(result.stale), REFUSAL);
});

const negatives: { name: string; overrides: Partial<Row>; segments?: { segment_index: number; caption_sha256: string }[]; fileExists?: (p: string) => Promise<boolean> }[] = [
  { name: "blank path", overrides: { linked_storage_path: "   " } },
  { name: "null path", overrides: { linked_storage_path: null } },
  { name: "unexpected detail", overrides: { linked_integrity_detail: "Transcript file could not be located." } },
  { name: "linked corrupt status", overrides: { linked_integrity_status: "corrupt" } },
  { name: "current hash-mismatch status", overrides: { current_integrity_status: "hash-mismatch" } },
  { name: "linked valid while current missing", overrides: { linked_integrity_status: "valid" } },
  { name: "changed current artifact id", overrides: { current_artifact_id: 8, current_sha256: "b" } },
  { name: "changed current hash", overrides: { current_sha256: "b" } },
  { name: "revision notice present", overrides: { revision_notice: "Tape was revised." } },
  { name: "no segments", overrides: {}, segments: [] },
  { name: "empty snapshot", overrides: { citation_snapshot: "[]" } },
  { name: "different artifact in citation snapshot", overrides: { citation_snapshot: JSON.stringify([
    { artifactId: 8, segmentIndex: 0, captionSha256: A },
    { artifactId: 8, segmentIndex: 1, captionSha256: A },
  ]) } },
  { name: "probe cannot establish absence", overrides: {}, fileExists: async () => { throw new Error("EACCES"); } },
];

for (const n of negatives) {
  test(`negative: ${n.name} -> no flags, refusal notice`, async () => {
    const result = await load(n.overrides, { segments: n.segments, fileExists: n.fileExists ?? (async () => false) });
    assert.ok(result.stale.length > 0, "expected stale");
    assert.deepEqual(result.fileAbsent, []);
    assert.equal(result.notice, null);
    assert.equal(staleCitationNotice(result.stale), REFUSAL);
  });
}

test("valid path: unchanged artifact/hash/statuses -> no stale, no fileAbsent, no notice, no probe", async () => {
  let probes = 0;
  const result = await load({ linked_integrity_status: "valid", current_integrity_status: "valid" }, {
    fileExists: async () => { probes++; return true; },
  });
  assert.deepEqual(result.stale, []);
  assert.deepEqual(result.fileAbsent, []);
  assert.equal(result.notice, null);
  assert.equal(probes, 0);
});

test("mixed multiple linked rows: good absent-file evidence plus a bad second row -> no notice, no flags", async () => {
  const good = row({ link_id: 100 });
  const bad = row({ link_id: 200, citation_snapshot: JSON.stringify([
    { artifactId: 7, segmentIndex: 0, captionSha256: "different" },
  ]) });
  const result = await loadRows([good, bad]);
  assert.ok(result.stale.length > 0);
  assert.deepEqual(result.fileAbsent, []);
  assert.equal(result.notice, null);
  assert.deepEqual(result.publicationLinks, []);
});
