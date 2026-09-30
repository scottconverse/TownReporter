import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Client } from "pg";
import {
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  withDatabase,
} from "../test-support/pg-admin.ts";

/*
  U19: the writers U15's own report listed as still unguarded.

  U22 (batch 5) added the last of them: `persistPlan`, the planner MODEL's own
  output. An entity, an anomaly and a dead end each write their own `text`
  columns, and the dead end repeats the hypothesis' text in a `where body = ...`
  lookup against a row that was stored SANITIZED -- so the case at the bottom of
  this file checks both that the bytes cannot fail the round and that the
  lookup still finds its hypothesis. The queries the app derives from that
  hypothesis are the model's text too, and `query_fingerprint` is written from
  the same string as `query`: a guard on the column but not on the fingerprint
  fails the same INSERT one line later, which is why the plan case checks the
  search receipt's row as well.

  SCAN-001 fixed the Scan path. Everything else a MODEL writes was still going
  straight into an INSERT, and a single U+0000 from a model does not spoil one
  field -- Postgres refuses the whole statement with "invalid byte sequence for
  encoding UTF8: 0x00", the transaction around it rolls back, and a whole draft
  or a whole Dark Desk round is lost to one stray byte.

  The JSON columns are the subtler half, and the reason `sanitizeJsonLeaves`
  exists. `JSON.stringify` turns a NUL into the six-character escape `\u0000`,
  so an INSERT into a `text` column SUCCEEDS and the row looks clean; the
  failure lands on whatever reads that column back through `::jsonb` -- the
  desk's own drafts projection, the job receipt, `meeting-activity.ts` -- where
  jsonb, unlike text, has nowhere to put the byte and refuses with "unsupported
  Unicode escape sequence". A guard verified only against the write would not
  see that, so these cases read the columns back through the cast.

  This runs on REAL PostgreSQL rather than PGlite on purpose, exactly as
  scan-model-nul.postgres.test.ts does: PGlite is Postgres compiled to WASM and
  its text and jsonb handling is not the server's, so a guard proved only there
  proves nothing about the database the newsroom runs. The lane is the
  repository's own runner:

    $env:TOWNREPORTER_RUN_POSTGRES_INTEGRATION='1'
    $env:TEST_POSTGRES_ADMIN_URL='postgres://...@127.0.0.1:5432/postgres'
    node scripts/run-postgres-integration.mjs src/lib/news/model-output-nul.postgres.test.ts
*/
const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : { ok: false as const, reason: "set TEST_POSTGRES_ADMIN_URL; CI runs the real PostgreSQL NUL proof" };
const skip = probe.ok ? false : probe.reason;
const databaseName = `town_model_nul_${process.pid}_${Date.now()}`;
let created = false;
let db: typeof import("../db.ts");
let performDraftWork: typeof import("./desk.ts").performDraftWork;
let synthesizeSignals: typeof import("./dark.ts").synthesizeSignals;
let ensureDarkSchema: typeof import("./dark.ts").ensureDarkSchema;
let readDarkDials: typeof import("./dark.ts").readDarkDials;
let insertProposedNewsroomSource: typeof import("./source-seeds.server.ts").insertProposedNewsroomSource;
let ensureJobsSchema: typeof import("./jobs.ts").ensureJobsSchema;
let researchLoop: typeof import("./investigate.ts").researchLoop;
let emptyPlan: typeof import("./investigate.ts").emptyPlan;

const NUL = String.fromCharCode(0);
/* The other control character: stripped by `storableText`, accepted by Postgres. */
const CTRL = String.fromCharCode(1);

// desk.ts has Vite aliases and extensionless imports. Resolve those only in
// this Node test process, as scan-model-nul.postgres.test.ts does.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/"))
      specifier = new URL("../../" + specifier.slice(2), import.meta.url).href;
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".") && !specifier.startsWith("file:")) throw error;
      const url = new URL(specifier, context.parentURL);
      for (const suffix of [".ts", ".tsx"]) {
        if (existsSync(fileURLToPath(url) + suffix)) return nextResolve(url.href + suffix, context);
      }
      throw error;
    }
  },
});

if (probe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`create database ${databaseName}`);
      created = true;
    } finally {
      await admin.end();
    }

    const appUrl = new URL(withDatabase(adminUrl, databaseName));
    process.env.DATABASE_URL = appUrl.toString();
    db = await import("../db.ts");
    ({ performDraftWork } = await import("./desk.ts"));
    ({ synthesizeSignals, ensureDarkSchema, readDarkDials } = await import("./dark.ts"));
    ({ insertProposedNewsroomSource } = await import("./source-seeds.server.ts"));
    ({ ensureJobsSchema } = await import("./jobs.ts"));
    ({ researchLoop, emptyPlan } = await import("./investigate.ts"));

    const sql = await db.getSql();
    const migrationDir = resolve(process.cwd(), "migrations");
    for (const name of readdirSync(migrationDir)
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort()) {
      await sql.query(readFileSync(resolve(migrationDir, name), "utf8"));
    }
    await ensureJobsSchema();
    await ensureDarkSchema();
  });

  after(async () => {
    await db?.closePoolForTests();
    if (!created) return;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()",
        [databaseName],
      );
      await admin.query(`drop database ${databaseName}`);
    } finally {
      await admin.end();
    }
  });
}

let fixtureCounter = 0;
const carriesNul = (value: unknown) => String(value ?? "").includes(NUL);

/**
 * A newsroom with the paper settings, membership and lead a draft pass needs.
 *
 * A fresh room per fixture rather than a shared one: `withClaimedLeadDraftLock`
 * reads `newsroom_members`, and a room reused across cases would let one
 * fixture's cleanup lock another's lead.
 */
async function seedDraftFixture() {
  const sql = await db.getSql();
  const suffix = ++fixtureCounter;
  const room = 97100 + suffix;
  const user = `model-nul-draft-${process.pid}-${suffix}`;
  await sql.query("insert into newsrooms(id,name) values($1,'NUL room')", [room]);
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'editor')", [
    user,
    room,
  ]);
  await sql.query(
    `insert into paper_settings
      (newsroom_id,name,city,state,timezone,onboarded,youtube_channels,meeting_keywords,seed_sources)
     values ($1,'Test Paper','Longmont','CO','America/Denver',true,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb)`,
    [room],
  );
  const [lead] = await sql.query<{ id: number }>(
    `insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json)
     values($1,$2,'Fixture lead','Why','council','new','[]','',1,'{}') returning id`,
    [user, room],
  );
  const [jobRow] = await sql.query<{ id: number }>(
    `insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token)
     values($1,$2,'draft',$3,'local-model','editor','public','default','running','Writing',$4) returning id`,
    [user, room, lead.id, `model-nul-claim-${suffix}`],
  );
  const job = {
    id: jobRow.id,
    user_id: user,
    newsroom_id: room,
    kind: "draft",
    subject_id: lead.id,
    model_choice: "local-model",
    model_choice_source: "editor",
    research_scope: "public",
    lane: "default",
    status: "running",
    stage: "Writing",
    claim_token: `model-nul-claim-${suffix}`,
  } as import("./jobs.ts").DeskJob;
  return { room, user, leadId: lead.id, job };
}

/** The writer's checkpoint, with a NUL in every field it carries. */
function nulCheckpoint() {
  return {
    headline: `Checkpoint${NUL} headline`,
    dek: `Checkpoint${NUL} dek`,
    body: `Checkpoint${NUL} body text.`,
    topic: "council",
    source_urls: ["https://example.test/nul-record"],
    integrity_notes: `Checkpoint${NUL} note`,
    form: "brief",
    found: null,
    unanswered: [`Open${NUL} question`],
    claims: [{ text: `Checkpoint${NUL} claim` }],
    reporting_trail: [],
    captures: [
      { url: "https://example.test/nul-record", title: "Record", version_id: 44, capture_event_id: 55 },
    ],
  };
}

/**
 * The finished writer result.
 *
 * The fields that become plain `text` columns always carry the byte -- they
 * are the `storableText` guards. The fields that are stringified into a JSON
 * blob only carry it when `nulInJson` is set, so the two cases fail for
 * different reasons: one proves the text columns, the other proves the
 * `sanitizeJsonLeaves` walk that keeps the byte out of the blobs the desk reads
 * back through `::jsonb`.
 */
function nulReport(nulInJson: boolean) {
  const j = (text: string) => (nulInJson ? text.replace(/\{N\}/g, NUL) : text.replace(/\{N\}/g, ""));
  return {
    headline: `Finished${NUL} headline`,
    dek: `Finished${NUL} dek`,
    body: `Finished${NUL} body text.`,
    topic: "council",
    source_urls: [],
    integrity_notes: `Finished${NUL} note`,
    memory_entities: [],
    form: "news",
    provenance: [],
    found_note: `Found${NUL} note`,
    findings: [],
    unanswered: [j("Unanswered{N} question")],
    claims: [{ fact: j("Model{N} claim"), url: j("https://example.test/claim{N}"), kind: "primary" }],
    research_memo: {
      news: j("Memo{N} news"),
      why_it_matters: j("Memo{N} why"),
      angle: j("Memo{N} angle"),
      nameCheck: { complete: true, rows: [{ status: "verified" }] },
    },
    citation_status: j("review-required{N}"),
  } as unknown as import("./desk-model-run.ts").ReportedDraftResult;
}

it(
  "a model-written NUL cannot fail a real PostgreSQL draft write, checkpoint or final",
  { skip, timeout: 60000 },
  async () => {
    assert.equal(db.getDbSource(), "neon", "fixture must use the real pg adapter, not PGLite");
    const sql = await db.getSql();
    const fixture = await seedDraftFixture();

    // Before the guard these lines rejected with the Postgres encoding error and
    // took the whole pass with them. That rejection IS the failure this test
    // reproduces, so it must not be caught and asserted on separately.
    await performDraftWork(fixture.job, {
      setJobStage: async () => {},
      reportAndDraft: async (_input, deps) => {
        await deps!.onWriterDraft?.(nulCheckpoint());
        return nulReport(false);
      },
    });

    const rows = await sql.query<{
      id: number;
      headline: string;
      dek: string;
      body: string;
      integrity_notes: string;
      found_note: string;
      unanswered: string;
      research_json: string;
    }>(
      `select id,headline,dek,body,integrity_notes,found_note,unanswered,research_json
       from drafts where newsroom_id=$1 and lead_id=$2 order by id`,
      [fixture.room, fixture.leadId],
    );
    assert.equal(rows.length, 2, "the checkpoint and the finished draft must both have been filed");

    const [checkpoint, finished] = rows;
    assert.equal(checkpoint!.headline, "Checkpoint headline");
    assert.equal(checkpoint!.dek, "Checkpoint dek");
    assert.equal(checkpoint!.body, "Checkpoint body text.");
    assert.match(checkpoint!.integrity_notes, /Checkpoint note/);
    assert.equal(finished!.headline, "Finished headline");
    assert.equal(finished!.dek, "Finished dek");
    assert.equal(finished!.body, "Finished body text.");
    assert.match(finished!.integrity_notes, /Finished note/);
    assert.equal(finished!.found_note, "Found note");

    for (const [index, row] of rows.entries()) {
      for (const [column, value] of Object.entries(row)) {
        assert.equal(
          carriesNul(value),
          false,
          `drafts.${column} of row ${index} must hold no NUL`,
        );
      }
    }
  },
);

it(
  "a model-written NUL cannot poison the JSON columns the desk reads back through jsonb",
  { skip, timeout: 60000 },
  async () => {
    assert.equal(db.getDbSource(), "neon", "fixture must use the real pg adapter, not PGLite");
    const sql = await db.getSql();
    const fixture = await seedDraftFixture();

    await performDraftWork(fixture.job, {
      setJobStage: async () => {},
      reportAndDraft: async () => nulReport(true),
    });

    /*
      THE CAST IS THE ASSERTION. Reading each column through `::jsonb` is
      exactly what the desk does -- the drafts projection at `listDeskDrafts`,
      `meeting-activity.ts` on the lead's notes -- and it is the read, not the
      write, that a NUL-in-escaped-JSON kills. If `sanitizeJsonLeaves` were
      removed these three queries would each reject with "unsupported Unicode
      escape sequence".
    */
    const [research] = await sql.query<{ research: Record<string, unknown> }>(
      `select research_json::jsonb as research from drafts
       where newsroom_id=$1 and lead_id=$2 order by id desc limit 1`,
      [fixture.room, fixture.leadId],
    );
    const rows = (research!.research as { reportedClaims: { rows: { fact: string }[] } }).reportedClaims
      .rows;
    assert.equal(rows[0]!.fact, "Model claim");
    assert.equal(carriesNul(JSON.stringify(research!.research)), false);

    const [lead] = await sql.query<{ notes: Record<string, unknown> }>(
      `select notes_json::jsonb as notes from leads where id=$1`,
      [fixture.leadId],
    );
    assert.equal(carriesNul(JSON.stringify(lead!.notes)), false);

    const [receipt] = await sql.query<{ receipt: { quality: { citationStatus: string } } }>(
      `select result_json::jsonb as receipt from desk_jobs where id=$1`,
      [fixture.job.id],
    );
    assert.equal(
      receipt!.receipt.quality.citationStatus,
      "review-required",
      "the receipt's model-written leaf must be stored stripped, not dropped",
    );
    assert.equal(carriesNul(JSON.stringify(receipt!.receipt)), false);
  },
);

it(
  "a model-written NUL cannot fail the Dark Desk's signal and promise write",
  { skip, timeout: 60000 },
  async () => {
    assert.equal(db.getDbSource(), "neon", "fixture must use the real pg adapter, not PGLite");
    const sql = await db.getSql();
    const suffix = ++fixtureCounter;
    const room = 97200 + suffix;
    const user = `model-nul-dark-${process.pid}-${suffix}`;
    await sql.query("insert into newsrooms(id,name) values($1,'NUL dark room')", [room]);
    await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'editor')", [
      user,
      room,
    ]);
    await sql.query(
      `insert into paper_settings
        (newsroom_id,name,city,state,timezone,onboarded,youtube_channels,meeting_keywords,seed_sources)
       values ($1,'Test Paper','Longmont','CO','America/Denver',true,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb)`,
      [room],
    );
    const [investigation] = await sql.query<{ id: number }>(
      "insert into investigations(user_id,newsroom_id,title) values($1,$2,'NUL investigation') returning id",
      [user, room],
    );
    const [run] = await sql.query<{ id: number }>(
      "insert into dark_runs(user_id,newsroom_id,model_choice,model_effort) values($1,$2,'local-model','none') returning id",
      [user, room],
    );
    /*
      A frontier item whose `why` carries the promise's own words, because the
      grounding check reads the ASSEMBLED PACK -- the research context the
      prompt was built from -- and not the model's reply. `buildDarkSynthesisPack`
      renders each item as `kind: label — why`, so this is where a promise can
      be grounded from.
    */
    await sql.query(
      `insert into frontier_items(user_id,newsroom_id,investigation_id,kind,label,label_norm,why,status,priority)
       values($1,$2,$3,'records','Clerk minutes','clerk-minutes-nul',
              'The clerk will publish the amended minutes by 2026-10-01, per Minutes p.4.','open',9)`,
      [user, room, investigation.id],
    );

    /*
      Every field of the signal is the model's prose, and the promise beside it
      is written by the same reply in the same pass. The observation is ordinary
      civic prose rather than desk-talk on purpose: `isPoisonedSignal` drops a
      signal whose every field reads as the desk talking about itself, and this
      fixture has to survive that check to reach the insert.

      The promise is a different matter -- `isGroundedDarkPromise` requires the
      named actor, the commitment and the source locator to appear in the
      evidence pack, so the observation repeats the promise's own words (NUL and
      all) verbatim. `normalizedEvidenceText` turns the byte into a space on
      both sides of that comparison, so the grounding check reads the same
      either way and the guard is what the test is actually exercising.
    */
    const reply = JSON.stringify({
      editor_summary: `A quiet${NUL} week in the records.`,
      inventory_gaps: [`No${NUL} minutes published`],
      signals: [
        {
          name: `Assessor${NUL} file and the parcel`,
          posture: "whisper",
          type: "records",
          strength: 7,
          confidence: 0.4,
          observation:
            `The county assessor's file${NUL} lists a parcel the council never voted on. ` +
            `The clerk will publish the amended minutes by 2026-10-01, per Minutes${NUL} p.4.`,
          pattern: `Same${NUL} parcel, two owners`,
          linkage_map: `Assessor${NUL} to clerk`,
          alternatives: `A${NUL} clerical error`,
          counter_narrative: `The clerk${NUL} says the file was amended.`,
          what_would_kill: `A signed${NUL} deed`,
          pathway: `Ask the clerk${NUL} for the deed`,
          privacy_review: `Public${NUL} record`,
          handoff: "HOLD FOR PATTERN",
        },
      ],
      promises: [
        {
          who: "The clerk",
          what: "publish the amended minutes",
          when_due: `2026-10-01${NUL}`,
          source_cite: `Minutes${NUL} p.4`,
          status: "open",
        },
      ],
    });

    const stored = await synthesizeSignals(
      user,
      run.id,
      investigation.id,
      "",
      await readDarkDials(room),
      "local-model",
      null,
      room,
      undefined,
      undefined,
      undefined,
      null,
      { chat: async () => ({ ok: true as const, text: reply }) },
    );
    assert.equal(stored.error, undefined, "the synthesis must have reached the model");
    assert.equal(stored.stored, 1, "the signal must have been stored");

    const [signal] = await sql.query<Record<string, string>>(
      "select name,observation,pattern,linkage_map,alternatives,counter_narrative,what_would_kill,pathway,privacy_review,signal_type from dark_signals where investigation_id=$1",
      [investigation.id],
    );
    assert.ok(signal, "the signal must have been filed instead of lost to the encoding error");
    assert.equal(signal!.name, "Assessor file and the parcel");
    assert.equal(
      signal!.observation,
      "The county assessor's file lists a parcel the council never voted on. " +
        "The clerk will publish the amended minutes by 2026-10-01, per Minutes p.4.",
    );
    assert.equal(signal!.counter_narrative, "The clerk says the file was amended.");
    for (const [column, value] of Object.entries(signal!)) {
      assert.equal(carriesNul(value), false, `dark_signals.${column} must hold no NUL`);
    }

    const [promise] = await sql.query<Record<string, string>>(
      "select who_promised,what,when_due,source_cite from dark_promises where newsroom_id=$1",
      [room],
    );
    assert.ok(promise, "the promise written by the same reply must have been filed");
    assert.equal(promise!.who_promised, "The clerk");
    assert.equal(promise!.when_due, "2026-10-01");
    for (const [column, value] of Object.entries(promise!)) {
      assert.equal(carriesNul(value), false, `dark_promises.${column} must hold no NUL`);
    }
  },
);

it(
  "a model-written NUL cannot fail a proposed source, through the one door every propose path uses",
  { skip, timeout: 60000 },
  async () => {
    assert.equal(db.getDbSource(), "neon", "fixture must use the real pg adapter, not PGLite");
    const sql = await db.getSql();
    const suffix = ++fixtureCounter;
    const room = 97300 + suffix;
    const user = `model-nul-source-${process.pid}-${suffix}`;
    await sql.query("insert into newsrooms(id,name) values($1,'NUL source room')", [room]);
    await sql.query(
      `insert into paper_settings
        (newsroom_id,name,city,state,timezone,onboarded,youtube_channels,meeting_keywords,seed_sources)
       values ($1,'Test Paper','Longmont','CO','America/Denver',true,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb)`,
      [room],
    );

    const url = `https://example.test/nul-proposed-${suffix}`;
    const wrote = await insertProposedNewsroomSource(sql, {
      userId: user,
      newsroomId: room,
      url,
      title: `Proposed${NUL} page`,
      reason: `The agenda${NUL} names it`,
      proposedBy: "research",
      section: `council${NUL}`,
    });
    assert.equal(wrote, true, "the proposal must have been written, not refused");

    const [row] = await sql.query<{
      title: string;
      proposed_reason: string | null;
      proposed_section: string | null;
      status: string;
    }>("select title,proposed_reason,proposed_section,status from sources where url=$1", [url]);
    assert.ok(row, "the proposed source must be on the review list");
    assert.equal(row!.title, "Proposed page");
    assert.equal(row!.proposed_reason, "The agenda names it");
    assert.equal(row!.proposed_section, "council", "the section key must survive, stripped");
    assert.equal(row!.status, "proposed");
    for (const [column, value] of Object.entries(row!)) {
      assert.equal(carriesNul(value), false, `sources.${column} must hold no NUL`);
    }
  },
);

it(
  "a model-written NUL in a research plan cannot fail the real PostgreSQL round it is written in",
  { skip, timeout: 120000 },
  async () => {
    assert.equal(db.getDbSource(), "neon", "fixture must use the real pg adapter, not PGLite");
    const sql = await db.getSql();
    const suffix = ++fixtureCounter;
    const room = 97400 + suffix;
    const user = `model-nul-plan-${process.pid}-${suffix}`;
    await sql.query("insert into newsrooms(id,name) values($1,'NUL plan room')", [room]);
    await sql.query(
      `insert into paper_settings
        (newsroom_id,name,city,state,timezone,onboarded,youtube_channels,meeting_keywords,seed_sources)
       values ($1,'Test Paper','Longmont','CO','America/Denver',true,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb)`,
      [room],
    );
    const [investigation] = await sql.query<{ id: number }>(
      "insert into investigations(user_id,newsroom_id,title) values($1,$2,'NUL plan investigation') returning id",
      [user, room],
    );

    /*
      U22: `persistPlan` was the last writer of model-written prose without a
      guard. An entity, an anomaly and a dead end each reach their own `text`
      columns, and each of them is the model's own sentence -- so one U+0000
      anywhere in the plan fails the statement it lands in and, because a plan
      write happens inside the pass's transaction, takes every write after it
      with it.

      The dead end repeats the hypothesis' text on purpose. The hypothesis loop
      stores a SANITIZED body, so the dead end's `where body = ...` lookup has
      to compare the sanitized value too; if it compared the model's raw text it
      would match no row at all, and the assertion at the end -- that the
      hypothesis row was found and updated -- is what would fail. Nothing here
      throws in that case: the dead end would simply be filed against no
      hypothesis, silently.
    */
    const hypothesisText = `The clerk${NUL} amended the minutes after the vote`;
    const plan = emptyPlan();
    plan.summary = `Planned${NUL} a records sweep.`;
    plan.entities = [
      { name: `Clerk${NUL} office`, kind: `agency${NUL}`, why: `Named${NUL} in the minutes` },
    ];
    plan.hypotheses = [
      { text: hypothesisText, supporting: `Minutes${NUL} p.4`, contradicting: "" },
      /*
        A second pair whose byte is a control character rather than a NUL. A
        NUL in the lookup's comparison always rejects at the driver, so it can
        only ever prove the guard is present; this one is accepted by Postgres
        and would be stored, which is the case a lookup comparing the model's
        RAW text gets silently wrong -- the dead end is filed and the
        hypothesis it names stays open, with no error anywhere.
      */
      { text: `The packet${CTRL} was withheld`, supporting: "", contradicting: "" },
    ];
    plan.anomalies = [{ kind: `records${NUL}`, summary: `The minutes${NUL} were amended` }];
    plan.dead_ends = [
      { hypothesis: hypothesisText, reason: `No${NUL} record of the amendment` },
      { hypothesis: `The packet${CTRL} was withheld`, reason: `No index${CTRL} entry for it` },
    ];

    // Before the guard each of these three writes rejected with the Postgres
    // encoding error, so the rejection IS the failure this reproduces: it is
    // deliberately not caught here.
    await researchLoop({
      userId: user,
      investigationId: investigation.id,
      newsroomId: room,
      hops: 1,
      planner: async () => plan,
      // The hypothesis is real, so the app's own search minimums derive queries
      // from its text -- NUL and all. The stub keeps that inside the process;
      // what it searches is not what this case is testing.
      search: async () => [],
      archives: async () => [],
    });

    const [entity] = await sql.query<{ name: string; kind: string; why: string }>(
      "select name, kind, why from entities where newsroom_id=$1",
      [room],
    );
    assert.ok(entity, "the entity must have been filed instead of lost to the encoding error");
    assert.equal(entity!.name, "Clerk office");
    assert.equal(entity!.kind, "agency");
    assert.equal(entity!.why, "Named in the minutes");
    for (const [column, value] of Object.entries(entity!)) {
      assert.equal(carriesNul(value), false, `entities.${column} must hold no NUL`);
    }

    const [anomaly] = await sql.query<{ kind: string; summary: string }>(
      "select kind, summary from anomalies where investigation_id=$1",
      [investigation.id],
    );
    assert.ok(anomaly, "the anomaly must have been filed");
    assert.equal(anomaly!.kind, "records");
    assert.equal(anomaly!.summary, "The minutes were amended");
    for (const [column, value] of Object.entries(anomaly!)) {
      assert.equal(carriesNul(value), false, `anomalies.${column} must hold no NUL`);
    }

    const deadEnds = await sql.query<{
      hypothesis: string;
      dismissed_because: string;
      entities: string;
    }>(
      "select hypothesis, dismissed_because, entities from dead_ends where investigation_id=$1 order by id",
      [investigation.id],
    );
    assert.equal(deadEnds.length, 2, "both dead ends must have been filed");
    for (const [index, row] of deadEnds.entries()) {
      for (const [column, value] of Object.entries(row)) {
        assert.equal(carriesNul(value), false, `dead_ends.${column} of row ${index} must hold no NUL`);
      }
    }
    const deadEnd = deadEnds.find(
      (row) => row.hypothesis === "The clerk amended the minutes after the vote",
    );
    assert.ok(deadEnd, "the hypothesis whose text carried a NUL must be stored stripped");
    assert.equal(deadEnd!.dismissed_because, "No record of the amendment");
    assert.match(deadEnd!.entities, /Clerk office/, "the stored entity names join the blob");
    assert.ok(
      deadEnds.some((row) => row.hypothesis === "The packet was withheld"),
      "the control character is stripped from the dead end's own copy too",
    );

    const hypotheses = await sql.query<{
      body: string;
      status: string;
      transition_note: string;
    }>("select body, status, transition_note from hypotheses where investigation_id=$1 order by id", [
      investigation.id,
    ]);
    assert.equal(hypotheses.length, 2, "both hypotheses must have been filed");
    for (const [index, row] of hypotheses.entries()) {
      for (const [column, value] of Object.entries(row)) {
        assert.equal(carriesNul(value), false, `hypotheses.${column} of row ${index} must hold no NUL`);
      }
    }
    const hypothesis = hypotheses.find(
      (row) => row.body === "The clerk amended the minutes after the vote",
    );
    assert.ok(hypothesis, "the hypothesis whose text carried a NUL must be stored stripped, not dropped");
    assert.equal(
      hypothesis!.status,
      "open",
      "the dead end's sanitized `body = ...` lookup must match the sanitized hypothesis row",
    );
    assert.match(hypothesis!.transition_note, /Possible dead end 1\/3/);
    const controlHypothesis = hypotheses.find((row) => row.body === "The packet was withheld");
    assert.ok(controlHypothesis, "the control character must be stripped out of the body too");
    assert.equal(
      controlHypothesis!.status,
      "open",
      "a lookup comparing the model's raw text would match no row here, silently",
    );
    assert.match(controlHypothesis!.transition_note, /No index entry for it/);

    /*
      The queries the app derived from that hypothesis are the model's words
      too, and `query_fingerprint` is written from the same string as `query`.
      A guard applied to the column but not to the fingerprint leaves the same
      failed INSERT one line later, which is what this row is here to catch.
    */
    const [log] = await sql.query<Record<string, string>>(
      "select query, query_fingerprint, research_question, caused_by from search_log where investigation_id=$1",
      [investigation.id],
    );
    assert.ok(log, "the hop's search receipt must have been filed");
    assert.match(log!.query, /amended the minutes/);
    for (const [column, value] of Object.entries(log!)) {
      assert.equal(carriesNul(value), false, `search_log.${column} must hold no NUL`);
    }
  },
);

after(() => hooks.deregister());
