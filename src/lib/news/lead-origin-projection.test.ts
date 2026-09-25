import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { LeadRow, SourceRow } from "./types.ts";

const scannerLeadTypeProbe = {
  id: 1,
  scan_run_id: 20,
  headline: "Scanner lead",
  why: "Why",
  topic: "council",
  status: "new",
  source_urls: "[]",
  evidence: null,
  newsworthiness: 0,
  created_at: "2026-09-09T21:37:59.249Z",
} satisfies LeadRow;

const sourceTypeProbe: SourceRow = {
  id: 1,
  url: "https://example.test/source",
  title: "Source",
  kind: "official",
  tier: "A",
  status: "accepted",
  last_hash: null,
  last_fetched_at: null,
  last_error: null,
  // @ts-expect-error scanner provenance belongs to LeadRow, never SourceRow
  scan_run_id: 20,
};
void scannerLeadTypeProbe;
void sourceTypeProbe;

const desk = await readFile(new URL("./desk.ts", import.meta.url), "utf8");

function projectionQuery(name: "listLeads" | "getLead"): string {
  const start = desk.indexOf(`export const ${name} = createServerFn`);
  const endMarker = name === "listLeads" ? "async function insertLeadWithDraft" : "export const deleteLead";
  const end = desk.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `could not isolate ${name}`);
  const block = desk.slice(start, end);
  const queryStart = block.indexOf("select l.id");
  const queryEnd = block.indexOf("`;", queryStart);
  assert.ok(queryStart >= 0 && queryEnd > queryStart, `could not isolate ${name} query`);
  return block
    .slice(queryStart, queryEnd)
    .replaceAll("${owned(context)}", "1")
    .replaceAll("${id}", "1");
}

/** Pin one projection to one lead. The two queries filter differently
 * (`l.newsroom_id` in the queue, `l.id` in the story view), so both spellings
 * are narrowed; a query that stops matching either assertion below fails
 * loudly rather than silently returning the wrong row. */
function forLead(query: string, id: number): string {
  return query
    .replace("where l.newsroom_id = 1\n", `where l.newsroom_id = 1 and l.id = ${id}\n`)
    .replace("where l.id = 1 and", `where l.id = ${id} and`);
}

test("real queue and story projections carry persisted scanner provenance and import origin", async () => {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(`
    create table leads (
      id integer primary key, newsroom_id integer not null, scan_run_id integer,
      headline text, why text, topic text, status text, source_urls text, evidence text,
      newsworthiness integer, created_at timestamptz, investigation_id integer, notes_json text,
      resurfaced_count integer default 0, last_resurfaced_at timestamptz,
      last_resurfaced_scan_run_id integer, possible_duplicate_of integer,
      origin text, provenance_json text
    );
    create table articles (id integer primary key, lead_id integer, status text, slug text, headline text);
    create table drafts (id integer primary key, lead_id integer, newsroom_id integer, headline text, updated_at timestamptz);
    insert into leads(id,newsroom_id,scan_run_id,headline,why,topic,status,source_urls,newsworthiness,created_at)
    values(1,1,20,'Scanner lead','Why','council','new','[]',0,now());
    insert into leads(id,newsroom_id,scan_run_id,headline,why,topic,status,source_urls,newsworthiness,created_at,origin,provenance_json)
    values(2,1,null,'Imported story','Why','council','new','[]',0,now(),'import','{"tool":"Civic Source Scanner"}');
  `);
  try {
    for (const name of ["listLeads", "getLead"] as const) {
      const result = await pg.query<{ scan_run_id: number | null }>(
        forLead(projectionQuery(name), 1),
      );
      assert.equal(result.rows[0]?.scan_run_id, 20, `${name} must return persisted scan_run_id`);
    }
    /*
      Migration 0088 gives a lead an origin. The Queue shows an "Imported"
      badge off it, so a lead read out of a pasted report has to survive the
      same two projections that carry the scanner's provenance -- and a
      scanner lead still has to come back null rather than borrowing a word
      that is not true of it.
    */
    for (const name of ["listLeads", "getLead"] as const) {
      const result = await pg.query<{ id: number; origin: string | null }>(
        forLead(projectionQuery(name), 2),
      );
      assert.equal(result.rows[0]?.origin, "import", `${name} must return the imported lead's origin`);
    }
    for (const name of ["listLeads", "getLead"] as const) {
      const result = await pg.query<{ origin: string | null }>(forLead(projectionQuery(name), 1));
      assert.equal(result.rows[0]?.origin, null, `${name} must not claim an origin for a scanner lead`);
    }
  } finally {
    await pg.close();
  }
});
