import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

/*
  The Drafts screen's query, run against a real database.

  `desk.ts` opens a database at import time and cannot be loaded under
  `node --experimental-strip-types`, so the one thing that cannot be checked
  from the pure module -- that the SQL actually reads the keys it claims to,
  out of a TEXT column that has to be projected to jsonb first, one row per
  lead, with the newest job beside it -- is checked here the way
  `lead-origin-projection.test.ts` checks the queue and story projections:
  isolate the query from the source, run it, read the rows.

  The failures this catches are quiet ones: `research_json` is text, so the
  `->` operators cannot be applied to it directly and a query that forgot the
  cast would not compile; `distinct on` without the matching order returns a
  row, just not the newest one; and a name check whose rows are not an array
  (an older shape, or `{}`) must count 0 rather than fail the whole screen.
*/

const desk = await readFile(new URL("./desk.ts", import.meta.url), "utf8");

function draftsQuery(): string {
  const start = desk.indexOf("export const listDraftsDesk = createServerFn");
  assert.ok(start >= 0, "desk.ts no longer defines listDraftsDesk");
  const queryStart = desk.indexOf("with latest_draft as (", start);
  assert.ok(queryStart > start, "could not isolate the listDraftsDesk query");
  const queryEnd = desk.indexOf("`;", queryStart);
  assert.ok(queryEnd > queryStart, "could not find the end of the listDraftsDesk query");
  const query = desk.slice(queryStart, queryEnd).replaceAll("${owned(context)}", "1");
  assert.ok(!query.includes("${"), "the isolated query still holds a template slot");
  return query;
}

test("the drafts list reads the desk's real state out of a text column", async () => {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(`
    create table leads (
      id integer primary key, newsroom_id integer not null, headline text, status text,
      origin text, newsworthiness integer, why text
    );
    create table drafts (
      id integer primary key, lead_id integer, newsroom_id integer, headline text, dek text,
      topic text, form text, model_headline text, headline_source text, updated_at timestamptz,
      research_json text not null default '{}'
    );
    create table desk_jobs (
      id integer primary key, newsroom_id integer, kind text, subject_id integer, status text,
      stage text, started_at timestamptz, updated_at timestamptz, model_choice text, error text
    );
  `);
  const nameCheck = (unresolved: number) =>
    JSON.stringify({
      evidenceReview: { required: true, decision: null },
      nameCheck: {
        version: 1,
        checkedAt: "2026-09-26T09:00:00.000Z",
        checkedText: "…",
        complete: true,
        note: "n",
        rows: Array.from({ length: unresolved + 1 }, (_, i) => ({
          name: `Person ${i}`,
          role: "councilmember",
          status: i < unresolved ? "unresolved" : "matched",
          spelling: `Person ${i}`,
          reason: "",
          url: "",
          excerpt: "",
          captureId: null,
        })),
      },
    });
  await pg.exec(`
    -- Lead 1 has TWO draft rows: the older one is not the draft on this desk.
    insert into leads(id,newsroom_id,headline,status,origin,newsworthiness,why)
      values(1,1,'The lead headline','drafted',null,11,'Because'),
            (2,1,'An imported story','new','import',4,'Why not'),
            (3,1,'Already printed','published',null,9,'No'),
            (4,1,'Not touched yet','new',null,3,'Not yet written');
    insert into drafts(id,lead_id,newsroom_id,headline,dek,topic,form,model_headline,headline_source,updated_at,research_json)
      values(1,1,1,'The model first wrote this','d','council','news','The model first wrote this','model','2026-09-26T08:00:00.000Z','{}'),
            (2,1,1,'The editor rewrote it','d','council','news','The model first wrote this','model','2026-09-26T09:00:00.000Z','${nameCheck(2)}'),
            (3,2,1,'An imported story','d','schools','news','An imported story','model','2026-09-26T09:10:00.000Z','{"importedText":true}'),
            -- A published lead keeps its draft, and a lead with no draft at all
            -- is not a draft row: neither belongs on "everything not yet printed".
            (4,3,1,'Already printed','d','arts','news','Already printed','model','2026-09-26T09:20:00.000Z','{}'),
            -- An older row shape: nameCheck present but rows missing entirely.
            (5,4,1,'Not touched yet','d','housing','news','Not touched yet','model','2026-09-26T07:00:00.000Z','{"nameCheck":{"version":1,"complete":false}}');
    -- Lead 1 is being written right now, so its newest job is 'running' and its
    -- row sorts by the heartbeat rather than by the draft's own updated_at.
    insert into desk_jobs(id,newsroom_id,kind,subject_id,status,stage,started_at,updated_at,model_choice,error)
      values(7,1,'draft',1,'completed','Done','2026-09-26T08:30:00.000Z','2026-09-26T08:35:00.000Z','sonnet',null),
            (8,1,'draft',1,'running','Researching the story','2026-09-26T09:30:00.000Z','2026-09-26T09:59:00.000Z','codex-sol',null),
            -- A failed job carries the reason the Drafts row prints beside the
            -- chip; the row for lead 4 shows it and reads the newest job, so a
            -- later running job on the same lead would hide it.
            (9,1,'draft',4,'failed','Writing','2026-09-26T07:10:00.000Z','2026-09-26T07:14:00.000Z','codex-sol','Codex quota reached');
  `);
  try {
    const result = await pg.query<Record<string, unknown>>(draftsQuery());
    assert.deepEqual(
      result.rows.map((r) => r.lead_id),
      [1, 2, 4],
      "one row per lead, published leads left out, newest work first",
    );
    const [writing, imported, bare] = result.rows;
    assert.equal(writing.id, 2, "the newest draft row for the lead, not the first");
    assert.equal(writing.headline, "The editor rewrote it");
    assert.equal(writing.job_status, "running");
    assert.equal(writing.job_stage, "Researching the story");
    assert.equal(writing.job_model_choice, "codex-sol", "the newest job's model rides with the row");
    assert.equal(writing.names_checked_at, "2026-09-26T09:00:00.000Z");
    assert.equal(writing.names_unresolved, 2, "unresolved rows counted out of the name check");
    assert.equal(writing.name_check_complete, true);
    assert.equal(writing.evidence_required, true, "the evidence review's key is read as jsonb");
    assert.equal(writing.evidence_decision, null);
    assert.equal(writing.imported_text, false);
    assert.equal(imported.imported_text, true);
    assert.equal(imported.origin, "import");
    assert.equal(bare.names_unresolved, 0, "a name check with no rows counts zero, and does not throw");
    assert.equal(bare.name_check_complete, false);
    assert.equal(bare.evidence_required, false);
    assert.equal(bare.headline, "Not touched yet", "a draft with no headline falls back to the lead's");
    assert.equal(bare.job_status, "failed");
    assert.equal(bare.job_error, "Codex quota reached", "the failed row's reason rides with the row");
    assert.equal(imported.job_status, null, "a lead with no job at all reads null, not undefined");
    assert.equal(imported.job_error, null);
  } finally {
    await pg.close();
  }
});
