import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getSql } from "../db.ts";
import {
  fillEvidenceVectorsOnce,
  pruneEvidenceVectorsOnce,
  resetEvidenceFillCursorForTests,
} from "./evidence-vector-fill.server.ts";
import {
  setEmbedderForTests,
  vectorToBytes,
  EVIDENCE_DIMS,
} from "./evidence-embed.server.ts";
import { clearEvidenceVectorCache } from "./evidence-search.server.ts";

/**
 * D286's background half: 32 excerpts a minute until the archive is covered,
 * and a prune that removes a vector once no live excerpt can match it. The
 * embedder is fake -- the real model is checked once by the smoke script.
 */

const NEWSROOM = 821;
let counter = 0;

async function version(): Promise<number> {
  counter += 1;
  const sql = await getSql();
  const [row] = await sql<{ id: number }>`
    insert into artifact_versions (user_id, url, content_hash, title, newsroom_id)
    values (${`scanner-fill-${counter}`}, ${`https://example.com/fill/${counter}`},
            ${`fill-hash-${counter}`}, 'Fill', ${NEWSROOM})
    returning id
  `;
  return row!.id;
}

async function chunk(versionId: number, excerpt: string): Promise<number> {
  counter += 1;
  const sql = await getSql();
  const [row] = await sql<{ id: number }>`
    insert into artifact_chunks (version_id, user_id, newsroom_id, chunk_index, excerpt, locator)
    values (${versionId}, ${`scanner-fill-${counter}`}, ${NEWSROOM}, 0, ${excerpt}, '')
    returning id
  `;
  return row!.id;
}

function fakeEmbedder() {
  return async (texts: string[]): Promise<Float32Array[]> =>
    texts.map((text) => {
      const vector = new Float32Array(EVIDENCE_DIMS);
      for (let i = 0; i < text.length && i < EVIDENCE_DIMS; i += 1) {
        vector[i] = text.charCodeAt(i) / 255;
      }
      return vector;
    });
}

afterEach(() => {
  resetEvidenceFillCursorForTests();
  setEmbedderForTests(null);
  clearEvidenceVectorCache();
});

describe("fillEvidenceVectorsOnce", () => {
  it("fills in batches of 32 and then stops", async () => {
    const v = await version();
    for (let i = 0; i < 40; i += 1) {
      await chunk(v, `Unique batch excerpt number ${i} about the budget`);
    }
    setEmbedderForTests(fakeEmbedder());

    // Only this file's rows exist in this process, so the counts are exact.
    assert.equal(await fillEvidenceVectorsOnce({ batch: 32 }), 32);
    assert.equal(await fillEvidenceVectorsOnce({ batch: 32 }), 8);
    assert.equal(await fillEvidenceVectorsOnce({ batch: 32 }), 0);
  });

  it("stores one vector per distinct excerpt, not one per chunk", async () => {
    const v = await version();
    await chunk(v, "The same sentence filed twice");
    await chunk(v, "The same sentence filed twice");
    setEmbedderForTests(fakeEmbedder());

    assert.equal(await fillEvidenceVectorsOnce({ batch: 32 }), 1);
    const sql = await getSql();
    const [row] = await sql<{ n: number }>`
      select count(*)::int as n from evidence_vectors
      where excerpt_md5 = md5('The same sentence filed twice')
    `;
    assert.equal(row!.n, 1);
  });
});

describe("pruneEvidenceVectorsOnce", () => {
  it("deletes the vector of a blanked excerpt and keeps the rest", async () => {
    const v = await version();
    await chunk(v, "Prune keeps this passage");
    const blanked = await chunk(v, "Prune drops this passage");
    setEmbedderForTests(fakeEmbedder());
    await fillEvidenceVectorsOnce({ batch: 32 });

    const sql = await getSql();
    const before = await sql<{ n: number }>`select count(*)::int as n from evidence_vectors`;
    assert.ok(before[0]!.n >= 2);

    await sql`update artifact_chunks set excerpt = '' where id = ${blanked}`;
    const removed = await pruneEvidenceVectorsOnce();
    assert.equal(removed, 1);

    const [left] = await sql<{ n: number }>`
      select count(*)::int as n from evidence_vectors
    `;
    assert.equal(left!.n, before[0]!.n - 1);
  });
});

describe("broken text", () => {
  // D288: broken pieces never get a vector, and the hourly prune removes one
  // that was filled before this rule existed.
  const brokenPiece = "Budget recovery " + "\u0003".repeat(10) + "plan";
  const clean = "A clean passage about the budget recovery";
  const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");

  it("skips a broken piece when filling and prunes a hand-inserted vector for one", async () => {
    const v = await version();
    await chunk(v, brokenPiece);
    await chunk(v, clean);
    setEmbedderForTests(fakeEmbedder());

    assert.equal(await fillEvidenceVectorsOnce({ batch: 32 }), 1);
    const sql = await getSql();
    const both = [md5(clean), md5(brokenPiece)];
    const filled = await sql<{ excerpt_md5: string }>`
      select excerpt_md5 from evidence_vectors
      where excerpt_md5 = any(${both}::text[])
      order by excerpt_md5
    `;
    assert.deepEqual(
      filled.map((row) => row.excerpt_md5),
      [md5(clean)],
      "only the clean piece gets a vector",
    );

    // What the old fill left behind: a vector for the broken piece.
    const vector = new Float32Array(EVIDENCE_DIMS);
    vector[0] = 1;
    await sql`
      insert into evidence_vectors (excerpt_md5, model, dims, vector)
      values (${md5(brokenPiece)}, 'fake', ${EVIDENCE_DIMS}, ${vectorToBytes(vector)})
    `;

    assert.equal(await pruneEvidenceVectorsOnce(), 1);
    const left = await sql<{ excerpt_md5: string }>`
      select excerpt_md5 from evidence_vectors
      where excerpt_md5 = any(${both}::text[])
      order by excerpt_md5
    `;
    assert.deepEqual(left.map((row) => row.excerpt_md5), [md5(clean)]);
  });
});

describe("walk by id (Nov 17 2026)", () => {
  // The old fill read the whole table every minute. Each call now reads only
  // ids after the last one it saw, at most `window` of them.
  it("reads at most one window per call and does not read the same rows again", async () => {
    const v = await version();
    const ids: number[] = [];
    for (let i = 0; i < 6; i += 1) ids.push(await chunk(v, `Window walk excerpt ${i} on the water plan`));
    setEmbedderForTests(fakeEmbedder());
    // Walk up to just before these rows (other tests' rows already have vectors).
    while ((await fillEvidenceVectorsOnce({ batch: 32, window: 100_000 })) > 0) { /* drain */ }
    resetEvidenceFillCursorForTests();
    const sql = await getSql();
    await sql`delete from evidence_vectors where excerpt_md5 in (select md5(excerpt) from artifact_chunks where id = any(${ids}::int[]))`;

    // Small window: each call sees only some rows, so the six come in pieces.
    const got: number[] = [];
    for (let i = 0; i < 1000; i += 1) {
      const n = await fillEvidenceVectorsOnce({ batch: 32, window: 32 });
      got.push(n);
      if (got.reduce((a, b) => a + b, 0) >= 6) break;
    }
    assert.equal(got.reduce((a, b) => a + b, 0), 6);
    // The walk is at the end: nothing more to read, nothing filled.
    assert.equal(await fillEvidenceVectorsOnce({ batch: 32, window: 32 }), 0);

    // A vector lost behind the walk is not picked up until the walk starts again.
    await sql`delete from evidence_vectors where excerpt_md5 = md5(${"Window walk excerpt 0 on the water plan"})`;
    assert.equal(await fillEvidenceVectorsOnce({ batch: 32, window: 100_000 }), 0);

    // A new chunk has a higher id, so the next call finds it.
    await chunk(v, "A new chunk after the walk passed");
    assert.equal(await fillEvidenceVectorsOnce({ batch: 32, window: 100_000 }), 1);

    // After a restart (mark back at 0) the lost one is filled again.
    resetEvidenceFillCursorForTests();
    let total = 0;
    for (let i = 0; i < 1000; i += 1) {
      const before = total;
      total += await fillEvidenceVectorsOnce({ batch: 32, window: 100_000 });
      if (total === before && i > 0) break;
    }
    assert.equal(total, 1);
  });
});
