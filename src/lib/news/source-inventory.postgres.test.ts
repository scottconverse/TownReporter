import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import {
  latestObservationPerSource,
  observationForTouch,
  observationsForLead,
  observationsForSource,
  recordObservation,
  reverseObservation,
} from "./source-observations.server.ts";
import { acceptedSourceFacts, buildInventory } from "./source-inventory.server.ts";

/*
  THE OBSERVATION WRITE PATH AND THE INVENTORY READER, on the migrated schema
  (migration 0128 plus the source columns 0002/0115/0116). PGlite, so nothing
  opens a socket and no candidate data is touched: the fixture inserts its own
  newsroom and sources and rolls nothing back across runs because each process
  gets its own embedded database.

  WHAT IS PROVED, and why each needs the real table:
   1. `recordObservation` is idempotent for one scan run -- a retried touch does
      not double-count a failure.
   2. `reverseObservation` KEEPS the row it corrects; a correction is a new row
      pointing at the old one, never a delete.
   3. `latestObservationPerSource` returns one row per source, newest first by
      source.
   4. The inventory reader walks the accepted pool and the CSV has one header
      plus one line per source, so the editor's deliverable is the whole pool.
*/

await applyMigrationsToTestPglite();

async function seedSources(newsroomId: number, rows: Array<{ url: string; title: string }>) {
  const sql = await getSql();
  await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict (id) do nothing", [
    newsroomId,
    `Obs room ${newsroomId}`,
  ]);
  const ids: number[] = [];
  for (const row of rows) {
    const [created] = await sql.query<{ id: number }>(
      "insert into sources(newsroom_id,user_id,url,title,kind,tier,status) values($1,'fixture',$2,$3,'official','A','accepted') returning id",
      [newsroomId, row.url, row.title],
    );
    ids.push(created.id);
  }
  return ids;
}

describe("source observations: append-only history with reversible corrections", () => {
  it("records once per scan run and keeps a correction without deleting the row it fixes", async () => {
    const newsroomId = 940_001;
    const [sourceId] = await seedSources(newsroomId, [
      { url: "https://quiet.example.gov/news", title: "Quiet page" },
    ]);

    const first = await recordObservation({
      newsroomId,
      sourceId,
      kind: "retrieval-error",
      note: "fetch timed out",
      scanRunId: 777,
      observedBy: "scan",
    });
    assert.ok(first != null);
    const retried = await recordObservation({
      newsroomId,
      sourceId,
      kind: "retrieval-error",
      note: "fetch timed out",
      scanRunId: 777,
      observedBy: "scan",
    });
    assert.equal(retried, null, "a retried touch must not record a second failure");

    const correction = await reverseObservation({
      newsroomId,
      sourceId,
      correctsId: first,
      kind: "quiet",
      note: "Editor: the page was fine; the proxy was down.",
    });
    assert.ok(correction != null);

    const history = await observationsForSource(newsroomId, sourceId);
    assert.equal(history.length, 2, "the reversed row is kept, not deleted");
    assert.equal(history[0].reversal_of, first);
    assert.equal(history[0].kind, "quiet");
  });

  it("returns one latest row per source and scopes by lead", async () => {
    const newsroomId = 940_002;
    const ids = await seedSources(newsroomId, [
      { url: "https://a.example.gov/1", title: "A" },
      { url: "https://a.example.gov/2", title: "B" },
    ]);
    await recordObservation({ newsroomId, sourceId: ids[0], kind: "quiet", leadId: 55 });
    await recordObservation({ newsroomId, sourceId: ids[0], kind: "changed" });
    await recordObservation({ newsroomId, sourceId: ids[1], kind: "never-checked" });

    const latest = await latestObservationPerSource(newsroomId);
    assert.equal(latest.size, 2);
    assert.equal(latest.get(ids[0])?.kind, "changed");

    const scoped = await observationsForLead(newsroomId, 55);
    assert.equal(scoped.length, 1);
    assert.equal(scoped[0].source_id, ids[0]);
  });

  it("maps a touch outcome to an observation kind without calling a wait a failure", () => {
    assert.equal(observationForTouch({ outcome: "read", changedByHash: false }).kind, "quiet");
    assert.equal(observationForTouch({ outcome: "read", changedByHash: true }).kind, "changed");
    assert.equal(observationForTouch({ outcome: "wait" }).kind, "asked-to-wait");
    assert.equal(observationForTouch({ outcome: "blocked" }).kind, "blocked");
    assert.equal(
      observationForTouch({ outcome: "failed", last_error: "fetch timed out" }).kind,
      "retrieval-error",
    );
    assert.equal(
      observationForTouch({ outcome: "failed", last_error: "had almost no readable text" }).kind,
      "extraction-failure",
    );
  });
});

describe("source inventory reader: the whole accepted pool becomes the deliverable", () => {
  it("reads every accepted source and writes one CSV line each", async () => {
    const newsroomId = 940_003;
    await seedSources(newsroomId, [
      { url: "https://x.gov/rss.xml", title: "Feed" },
      { url: "https://x.gov/minutes.pdf", title: "Minutes" },
      { url: "https://x.gov/council/agenda-2026", title: "Agenda" },
    ]);

    const facts = await acceptedSourceFacts(newsroomId);
    assert.equal(facts.length, 3);

    const { rows, csv } = await buildInventory(newsroomId);
    assert.equal(rows.length, 3);
    const lines = csv.trim().split("\n");
    assert.match(lines[0], /^id,title,url,/);
    assert.equal(lines.length, 4, "one header plus one row per accepted source");
    const purposes = new Set(rows.map((r) => r.purpose));
    assert.ok(purposes.has("watch"));
    assert.ok(purposes.has("reference"));
  });
});