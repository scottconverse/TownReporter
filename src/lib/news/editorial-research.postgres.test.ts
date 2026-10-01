import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import {
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  withDatabase,
} from "../test-support/pg-admin.ts";

/*
  UNIT U30 -- THE DESK'S CAPTURES ARE REAL ROWS, ON REAL POSTGRES.

  The hermetic pass in ./editorial-research.test.ts fakes the capture write, so
  it can prove the loop, the budget and the pack but not that a page the desk
  opened is actually recorded. This file proves that half: on a real Postgres,
  with the real `rememberCapture` and the real artifact tables, a desk research
  run leaves `artifact_versions` rows holding the page text and `capture_events`
  rows whose `editorial_request_id` names the request that caused them --
  which is what makes "the pages this editorial was written from" answerable
  from the request.

  It runs on real PostgreSQL rather than PGlite on purpose, as the other
  `.postgres.test.ts` files here do: the column, the index and the linking
  UPDATE are schema and SQL, and the server is the thing that has to accept
  them. The lane is the repository's own runner:

    $env:TOWNREPORTER_RUN_POSTGRES_INTEGRATION='1'
    $env:TEST_POSTGRES_ADMIN_URL='postgres://...@127.0.0.1:5432/postgres'
    node scripts/run-postgres-integration.mjs src/lib/news/editorial-research.postgres.test.ts
*/
const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : {
      ok: false as const,
      reason: "set TEST_POSTGRES_ADMIN_URL; CI runs the real PostgreSQL capture proof",
    };
const skip = probe.ok ? false : probe.reason;
// The name the integration doc's recovery procedure expects: an interrupted
// process leaves `townreporter_test_*` behind and says so, so the leftover can
// be identified and dropped by exact name rather than guessed at.
const databaseName = `townreporter_test_editorial_research_${process.pid}_${Date.now()}`;

const CAPTURED_URL = "https://leg.colorado.gov/bills/SB21-238";
const PAGE_TEXT =
  "SB21-238 created the district and set the levy at four tenths of a cent, which is the " +
  "record this editorial's claims appendix has to cite if it makes that claim.";

let sql: import("../db.ts").Sql;
let runDeskResearch: typeof import("./editorial-research.server.ts").runDeskResearch;
const userId = `editorial-research-pg-${process.pid}`;

if (probe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`create database ${databaseName}`);
    } finally {
      await admin.end();
    }
    process.env.DATABASE_URL = new URL(withDatabase(adminUrl, databaseName)).toString();

    const db = await import("../db.ts");
    ({ runDeskResearch } = await import("./editorial-research.server.ts"));
    sql = await db.getSql();

    // The migrations the app itself applies -- including
    // 0114_editorial_research_captures.sql, the column this file is about.
    const migrationDir = resolve(process.cwd(), "migrations");
    for (const name of readdirSync(migrationDir)
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort()) {
      await sql.query(readFileSync(resolve(migrationDir, name), "utf8"));
    }
  });
}

after(async () => {
  if (!probe.ok) return;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${databaseName} with (force)`);
  } finally {
    await admin.end();
  }
});

/**
 * The desk's outside world, faked; its capture write is the REAL one.
 *
 * `runDeskResearch`'s `capture` is deliberately absent, so the run reaches
 * `rememberCapture`, the artifact tables and migrations/0114 -- which is the
 * whole point of running this file at all.
 */
function deskInput(
  requestId: number | null,
  deps: import("./editorial-research.server.ts").DeskResearchDeps = {},
): [import("./editorial-research.server.ts").DeskResearchInput, import("./editorial-research.server.ts").DeskResearchDeps] {
  return [
    {
      userId,
      newsroomId: 1,
      subject: "Front Range Passenger Rail sales tax",
      askedFor: "Whether a second district is needed",
      voice: "THE EDITORIAL VOICE, with the research protocol in it.",
      researchPack: "SUBJECT: Front Range Passenger Rail sales tax",
      paper: { city: "Longmont", state: "Colorado", officialDomains: ["longmontcolorado.gov"] },
      requestId,
    },
    {
      readWindow: async () => null,
      onStage: async () => {},
      // The model stops after its one round, so the run is one search and one
      // page -- the ceiling is not what ends it.
      plan: async () => ({ ok: true, text: '{"queries": ["rail district levy"], "stop": true}' }),
      localRecords: async () => ({ notes: "", reading: [] }),
      search: async () => ({
        hits: [{ title: "SB21-238", url: CAPTURED_URL, snippet: "" }],
        decision: "relevant",
      }),
      fetch: async () => ({
        ok: true,
        status: 200,
        outcome: "fetched",
        title: "SB21-238",
        text: PAGE_TEXT,
        pages: [],
        extractionMethod: "html",
      }),
      read: async () => ({ ok: true, text: `Levy — ${CAPTURED_URL}` }),
      ...deps,
    },
  ];
}

it("saves the pages the desk read and links them to the editorial request", { skip }, async () => {
  const [request] = await sql<{ id: number }>`
    insert into editorial_requests (user_id, newsroom_id, subject, source_kind, source_ref)
    values (${userId}, ${1}, ${"Front Range Passenger Rail sales tax"}, ${"paste"}, ${"desk"})
    returning id
  `;
  const requestId = request!.id;

  const out = await runDeskResearch(...deskInput(requestId));

  assert.equal(out.pages, 1, "the desk read one page");
  assert.equal(out.searches, 1);
  assert.equal(out.captures.length, 1);
  const capture = out.captures[0]!;
  assert.equal(capture.url, CAPTURED_URL);
  assert.ok(capture.captureEventId, "the capture has an id the appendix can cite");
  assert.ok(capture.versionId, "and a stored version holding the text it read");

  // What a reader of the finished piece would be able to check: the page text
  // is really stored, under the URL the piece cites.
  const [version] = await sql<{ full_text: string; fetch_status: number; url: string }>`
    select av.full_text, av.fetch_status, av.url
    from artifact_versions av
    where av.id = ${capture.versionId} and av.newsroom_id = ${1}
  `;
  assert.ok(version, "the version row exists");
  assert.equal(version!.url, CAPTURED_URL);
  assert.match(version!.full_text, /four tenths of a cent/);

  // And the link back: the request names the captures it was written from.
  const linked = await sql<{ id: number; source_url: string; trigger_kind: string }>`
    select id, source_url, trigger_kind from capture_events
    where editorial_request_id = ${requestId} and newsroom_id = ${1}
  `;
  assert.equal(linked.length, 1, "exactly the one capture this run made");
  assert.equal(linked[0]!.id, capture.captureEventId);
  assert.equal(linked[0]!.source_url, CAPTURED_URL);
  assert.equal(linked[0]!.trigger_kind, "editorial", "recorded as an editorial's research, not a dig's");
});

it("leaves an editorial's captures unlinked from any other request", { skip }, async () => {
  const [other] = await sql<{ id: number }>`
    insert into editorial_requests (user_id, newsroom_id, subject, source_kind, source_ref)
    values (${userId}, ${1}, ${"A different piece"}, ${"paste"}, ${"desk"})
    returning id
  `;
  const otherId = other!.id;

  // A run with no request behind it -- the same capture, no link.
  await runDeskResearch(...deskInput(null));

  const linkedToOther = await sql<{ id: number }>`
    select id from capture_events where editorial_request_id = ${otherId}
  `;
  assert.equal(linkedToOther.length, 0, "a capture with no request must not claim one");

  // The Dark Desk's and the name check's own captures stay null too: this
  // column is written by the editorial research pass and by nothing else.
  const orphaned = await sql<{ count: string }>`
    select count(*)::text as count from capture_events
    where newsroom_id = ${1} and user_id = ${userId} and editorial_request_id is null
  `;
  assert.ok(Number(orphaned[0]!.count) >= 1, "the unlinked capture is still saved, just unlinked");
});
