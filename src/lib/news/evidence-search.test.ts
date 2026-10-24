import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getSql } from "../db.ts";
import {
  searchEvidence,
  clearEvidenceVectorCache,
} from "./evidence-search.server.ts";
import {
  setEmbedderForTests,
  vectorToBytes,
  EVIDENCE_DIMS,
} from "./evidence-embed.server.ts";

/**
 * D285/D286: "Exact words" and "Close in meaning" on the Story page. These run
 * the REAL search against the real (PGlite) `artifact_versions`,
 * `artifact_chunks` and `evidence_vectors` tables with a fake embedder -- the
 * model itself is exercised by `scripts/evidence-meaning-smoke.mjs`, never by
 * this suite.
 */

const NEWSROOM = 811;
const OTHER_ROOM = 812;
let counter = 0;

async function capture(
  url: string,
  title: string,
  capturedAt: string,
  newsroom = NEWSROOM,
): Promise<number> {
  counter += 1;
  const sql = await getSql();
  const [row] = await sql<{ id: number }>`
    insert into artifact_versions (user_id, url, content_hash, title, captured_at, newsroom_id)
    values (${`scanner-${counter}`}, ${url}, ${`hash-${counter}`}, ${title},
            ${capturedAt}::timestamptz, ${newsroom})
    returning id
  `;
  return row!.id;
}

async function chunk(
  versionId: number,
  excerpt: string,
  newsroom = NEWSROOM,
  index = 0,
): Promise<number> {
  counter += 1;
  const sql = await getSql();
  const [row] = await sql<{ id: number }>`
    insert into artifact_chunks (version_id, user_id, newsroom_id, chunk_index, excerpt, locator)
    values (${versionId}, ${`scanner-${counter}`}, ${newsroom}, ${index}, ${excerpt}, '')
    returning id
  `;
  return row!.id;
}

async function insertVector(excerpt: string, vector: Float32Array): Promise<void> {
  const sql = await getSql();
  const md5 = createHash("md5").update(excerpt, "utf8").digest("hex");
  await sql`
    insert into evidence_vectors (excerpt_md5, model, dims, vector)
    values (${md5}, 'fake', ${EVIDENCE_DIMS}, ${vectorToBytes(vector)})
    on conflict (excerpt_md5) do update set vector = excluded.vector
  `;
}

/** A 384-length vector from a few leading numbers. */
function vec(...values: number[]): Float32Array {
  const out = new Float32Array(EVIDENCE_DIMS);
  values.forEach((v, i) => {
    out[i] = v;
  });
  return out;
}

function fakeEmbedder(map: Record<string, Float32Array>) {
  return async (texts: string[]): Promise<Float32Array[]> =>
    texts.map((text) => {
      const vector = map[text];
      if (!vector) throw new Error(`no fake vector for ${text}`);
      return vector;
    });
}

afterEach(() => {
  setEmbedderForTests(null);
  clearEvidenceVectorCache();
});

describe("searchEvidence: exact words", () => {
  it("returns only the piece that holds the words", async () => {
    const v = await capture("https://example.com/one", "One", "2026-10-01T10:00:00Z");
    await chunk(v, "The council approved the broadband plan.", NEWSROOM, 0);
    await chunk(v, "A separate paragraph about water rates.", NEWSROOM, 1);
    const v2 = await capture("https://example.com/two", "Two", "2026-10-02T10:00:00Z");
    await chunk(v2, "Road work closes Main Street.", NEWSROOM, 0);

    setEmbedderForTests(fakeEmbedder({ broadband: vec(1) }));
    const result = await searchEvidence({ newsroomId: NEWSROOM }, "broadband");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exact.length, 1);
    assert.equal(result.exact[0]!.url, "https://example.com/one");
  });

  it("treats % as a literal character", async () => {
    const v = await capture("https://example.com/pct", "Pct", "2026-10-01T10:00:00Z");
    await chunk(v, "The bond is 100% funded.", NEWSROOM, 0);
    await chunk(v, "About 1000 homes are covered.", NEWSROOM, 1);

    setEmbedderForTests(fakeEmbedder({ "100%": vec(1) }));
    const result = await searchEvidence({ newsroomId: NEWSROOM }, "100%");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exact.length, 1);
    assert.match(result.exact[0]!.excerptStart, /100% funded/);
  });

  it("collapses the same excerpt in two captures to the newest one", async () => {
    const old = await capture("https://example.com/old", "Old copy", "2026-09-01T10:00:00Z");
    await chunk(old, "Repeated passage about the reservoir.");
    const newer = await capture("https://example.com/new", "New copy", "2026-10-05T10:00:00Z");
    await chunk(newer, "Repeated passage about the reservoir.");

    setEmbedderForTests(fakeEmbedder({ reservoir: vec(1) }));
    const result = await searchEvidence({ newsroomId: NEWSROOM }, "reservoir");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exact.length, 1);
    assert.equal(result.exact[0]!.url, "https://example.com/new");
    assert.equal(result.exact[0]!.title, "New copy");
  });

  it("never shows a blank excerpt", async () => {
    const v = await capture("https://example.com/blank", "Blank", "2026-10-01T10:00:00Z");
    await chunk(v, "");

    setEmbedderForTests(fakeEmbedder({ blanked: vec(1) }));
    const result = await searchEvidence({ newsroomId: NEWSROOM }, "blanked");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exact.length, 0);
  });

  it("never shows another newsroom's piece", async () => {
    const mine = await capture("https://example.com/mine", "Mine", "2026-10-01T10:00:00Z");
    await chunk(mine, "Zoning change for the north parcel.");
    const theirs = await capture(
      "https://example.com/theirs",
      "Theirs",
      "2026-10-01T10:00:00Z",
      OTHER_ROOM,
    );
    await chunk(theirs, "Zoning change somewhere else.", OTHER_ROOM);

    setEmbedderForTests(fakeEmbedder({ zoning: vec(1) }));
    const result = await searchEvidence({ newsroomId: NEWSROOM }, "zoning");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exact.length, 1);
    assert.equal(result.exact[0]!.url, "https://example.com/mine");
  });

  it("refuses an empty or overlong query", async () => {
    const empty = await searchEvidence({ newsroomId: NEWSROOM }, "   ");
    assert.equal(empty.ok, false);
    if (empty.ok) return;
    assert.equal(empty.error, "Type a few words to search.");
    const long = await searchEvidence({ newsroomId: NEWSROOM }, "x".repeat(201));
    assert.equal(long.ok, false);
  });
});

describe("searchEvidence: close in meaning", () => {
  it("puts the nearest piece first, at most five, and never repeats an exact hit", async () => {
    const v = await capture("https://example.com/city", "City internet", "2026-10-01T10:00:00Z");
    const queryText = "city internet";
    const nearest = "NextLight broadband service for Longmont homes";
    const second = "Municipal fiber reaches more neighborhoods";
    const exactPiece = "city internet plan advances";
    await chunk(v, queryText);
    await chunk(v, nearest);
    await chunk(v, second);
    await chunk(v, exactPiece);
    for (let i = 0; i < 6; i += 1) {
      await chunk(v, `Unrelated piece number ${i} about sewer rates`);
    }
    await insertVector(queryText, vec(1, 0));
    await insertVector(nearest, vec(0.9, 0.1));
    await insertVector(second, vec(0.8, 0.2));
    await insertVector(exactPiece, vec(0.95, 0.05));
    for (let i = 0; i < 6; i += 1) {
      await insertVector(`Unrelated piece number ${i} about sewer rates`, vec(0, 1));
    }
    setEmbedderForTests(fakeEmbedder({ [queryText]: vec(1, 0) }));

    const result = await searchEvidence({ newsroomId: NEWSROOM }, queryText);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.exact.length >= 1, "the literal words are on the left");
    assert.ok(result.exact.some((row) => row.excerptStart === exactPiece));
    assert.equal(result.meaning.length, 5, "never more than five");
    assert.equal(result.meaning[0]!.excerptStart, nearest, "nearest by meaning comes first");
    assert.ok(
      result.meaning.every((row) => !result.exact.some((exact) => exact.md5 === row.md5)),
      "no piece repeats across the two lists",
    );
    assert.equal(result.meaningStatus.ready, true);
  });

  it("drops a piece once its excerpt is blanked (what a takedown does)", async () => {
    const v = await capture("https://example.com/gone", "Gone", "2026-10-01T10:00:00Z");
    const kept = "Water treatment plant upgrade approved";
    const takenDown = "Water treatment plant contract details";
    await chunk(v, kept);
    const hit = await chunk(v, takenDown);
    // Higher than the earlier tests' pieces (which share this newsroom), so
    // this test's own two rows are the ones at the top of the list.
    await insertVector(kept, vec(2, 0));
    await insertVector(takenDown, vec(3, 0));
    setEmbedderForTests(fakeEmbedder({ "water plant": vec(1, 0) }));

    const first = await searchEvidence({ newsroomId: NEWSROOM }, "water plant");
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.meaning[0]!.excerptStart, takenDown);

    const sql = await getSql();
    await sql`update artifact_chunks set excerpt = '' where id = ${hit}`;
    const next = await searchEvidence({ newsroomId: NEWSROOM }, "water plant");
    assert.equal(next.ok, true);
    if (!next.ok) return;
    assert.ok(next.meaning.every((row) => row.excerptStart !== takenDown));
    assert.equal(next.meaning[0]!.excerptStart, kept);
  });

  it("counts covered and total evidence pieces", async () => {
    const v = await capture("https://example.com/counts", "Counts", "2026-10-01T10:00:00Z");
    await chunk(v, "Counted piece one");
    await chunk(v, "Counted piece two");
    await chunk(v, "");
    await insertVector("Counted piece one", vec(1, 0));
    setEmbedderForTests(fakeEmbedder({ counts: vec(1, 0) }));

    const result = await searchEvidence({ newsroomId: NEWSROOM }, "counts");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // This test's own two pieces plus everything the earlier tests in this file
    // filed in NEWSROOM: covered counts vectors that match a live excerpt.
    assert.ok(result.meaningStatus.total >= 2);
    assert.ok(result.meaningStatus.covered >= 1);
    assert.ok(result.meaningStatus.covered <= result.meaningStatus.total);
  });

  it("keeps the exact list when the meaning model throws", async () => {
    const v = await capture("https://example.com/model", "Model", "2026-10-01T10:00:00Z");
    await chunk(v, "Emergency shelter opens tonight.");
    setEmbedderForTests(async () => {
      throw new Error("the model could not load");
    });

    const result = await searchEvidence({ newsroomId: NEWSROOM }, "shelter");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exact.length, 1);
    assert.equal(result.meaning.length, 0);
    assert.equal(result.meaningStatus.ready, false);
    assert.match(result.meaningStatus.reason ?? "", /model could not load/);
  });
});
