import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import {
  fillEvidenceVectorsOnce,
  pruneEvidenceVectorsOnce,
} from "./evidence-vector-fill.server.ts";
import { setEmbedderForTests, EVIDENCE_DIMS } from "./evidence-embed.server.ts";
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
