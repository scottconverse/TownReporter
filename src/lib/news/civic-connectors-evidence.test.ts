import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { getSql, withTransaction } from "../db.ts";
import { ensureInvestigateSchema, rememberCapture } from "./investigate.ts";
import { searchEvidence, clearEvidenceVectorCache } from "./evidence-search.server.ts";
import { setEmbedderForTests } from "./evidence-embed.server.ts";

// These are actual app persistence seams, not provider or connector acceptance.
// The focused runner must preload the same migrations used by the built app.
const ownRoom = 944201;
const otherRoom = 944202;
const userId = "connector-evidence-fixture-editor";
const url = "https://records.example.test/council/2026-11-11/agenda";
const marker = "SYNTHETIC_CIVIC_REPAIR_APPROPRIATION";
const text = `Item 4. ${marker}: the agenda proposes repairs. No vote is supplied.`;
const bytes = Buffer.from('{"agenda":"repairs","unknown":{"zero":0,"empty":null}}');
const hash = createHash("sha256").update(bytes).digest("hex");

async function capture(newsroomId: number, capturedText = text, rawBytes = bytes) {
  return withTransaction((sql) =>
    rememberCapture({
      sql,
      userId,
      newsroomId,
      investigationId: null,
      url,
      title: "Synthetic council agenda",
      text: capturedText,
      hash: createHash("sha256").update(rawBytes).digest("hex"),
      status: 200,
      outcome: "fetched",
      extractionMethod: "civic-connector:synthetic",
      contentType: "application/json",
      pages: [{ page: 14, text: capturedText }],
      rawBytes,
      observedAt: new Date("2026-11-11T10:00:00Z"),
      triggerKind: "civic-connector",
      autoWatch: false,
    }),
  );
}

describe("connector evidence mapping into the existing newsroom archive", () => {
  before(async () => {
    await ensureInvestigateSchema();
    const sql = await getSql();
    for (const room of [ownRoom, otherRoom]) {
      await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict(id) do nothing", [
        room,
        `Synthetic connector newsroom ${room}`,
      ]);
    }
    setEmbedderForTests(async () => {
      throw new Error("Meaning search intentionally unavailable in this model-free fixture.");
    });
  });

  after(() => {
    clearEvidenceVectorCache();
    setEmbedderForTests(null);
  });

  it("reopens exact bytes, text and page citation; repeat capture reuses the evidence version", async () => {
    const first = await capture(ownRoom);
    const repeat = await capture(ownRoom);
    assert.ok(first.versionId);
    assert.equal(repeat.versionId, first.versionId);
    assert.notEqual(repeat.captureEventId, first.captureEventId);

    const sql = await getSql();
    const versions = await sql.query<{ id: number; full_text: string; content_hash: string }>(
      "select id,full_text,content_hash from artifact_versions where newsroom_id=$1 and url=$2",
      [ownRoom, url],
    );
    assert.deepEqual(versions, [{ id: first.versionId, full_text: text, content_hash: hash }]);
    const chunks = await sql.query<{ excerpt: string; page_number: number; locator: string }>(
      "select excerpt,page_number,locator from artifact_chunks where newsroom_id=$1 and version_id=$2",
      [ownRoom, first.versionId],
    );
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]!.excerpt, text);
    assert.equal(chunks[0]!.page_number, 14);
    assert.match(chunks[0]!.locator, /14/);
    const blobs = await sql.query<{ body_b64: string; original_url: string; sha256: string }>(
      "select body_b64,original_url,sha256 from artifact_blobs where newsroom_id=$1 and version_id=$2",
      [ownRoom, first.versionId],
    );
    assert.equal(blobs.length, 1);
    assert.deepEqual(Buffer.from(blobs[0]!.body_b64, "base64"), bytes);
    assert.equal(blobs[0]!.original_url, url);
    assert.equal(blobs[0]!.sha256, hash);
  });

  it("does not share evidence or exact search across newsrooms even for equal URL, user and bytes", async () => {
    const foreign = await capture(otherRoom);
    const sql = await getSql();
    const own = await sql.query<{ id: number }>(
      "select id from artifact_versions where newsroom_id=$1 and url=$2 and content_hash=$3",
      [ownRoom, url, hash],
    );
    assert.notEqual(foreign.versionId, own[0]!.id);
    clearEvidenceVectorCache();
    const searched = await searchEvidence({ newsroomId: ownRoom }, marker);
    assert.equal(searched.ok, true);
    assert.equal(searched.exact.length, 1);
    assert.equal(searched.exact[0]!.versionId, own[0]!.id);
    assert.equal(searched.exact[0]!.url, url);
    assert.equal(searched.meaningStatus.ready, false);
    const empty = await searchEvidence({ newsroomId: ownRoom + 100 }, marker);
    assert.equal(empty.ok, true);
    if (empty.ok) assert.deepEqual(empty.exact, []);
  });

  it("keeps a changed capture reviewable without creating stories, leads, monitors or jobs", async () => {
    const sql = await getSql();
    const counts = async () => {
      const values: number[] = [];
      for (const table of ["articles", "drafts", "leads", "source_monitors", "desk_jobs"]) {
        const [row] = await sql.query<{ count: number }>(
          `select count(*)::integer as count from ${table} where newsroom_id=$1`,
          [ownRoom],
        );
        values.push(row!.count);
      }
      return values;
    };
    const beforeCounts = await counts();
    const changed = await capture(
      ownRoom,
      `${text} Revised amount is supplied in the second capture.`,
      Buffer.from('{"agenda":"repairs","amount":200,"unknown":{"zero":0,"empty":null}}'),
    );
    const versions = await sql.query<{ id: number }>(
      "select id from artifact_versions where newsroom_id=$1 and url=$2 order by id",
      [ownRoom, url],
    );
    assert.equal(versions.length, 2);
    assert.equal(versions[1]!.id, changed.versionId);
    assert.deepEqual(await counts(), beforeCounts);
    const foreign = await sql.query<{ count: number }>(
      "select count(*)::integer as count from artifact_versions where newsroom_id=$1 and url=$2",
      [otherRoom, url],
    );
    assert.equal(foreign[0]!.count, 1);
  });
});
