import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { getSql, type Sql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import {
  loadFindingEvidenceReview,
  persistAiEvidenceDecision,
  persistFindingEvidenceJudgment,
  persistManualClaim,
  type FindingEvidenceReview,
} from "./finding-evidence-review.ts";
import { sha256 } from "./url-guard.ts";

/*
  Audit override items 13, 14, 15, 16, 17: the judgments and claim limits that
  used to REFUSE now warn once and accept a second call carrying
  `override: [key]`. These are behavior tests against a disposable PGlite
  database -- the first call answers the warning and writes nothing, the second
  call writes the real decision and one `override` audit row per accepted key.
  KEEP boundaries (missing records, another newsroom's records, an empty body,
  a reasonless contradiction) are asserted to still refuse.
*/

const room = 74001;
const otherRoom = 74002;
const leadId = 74001;
const editor = "override-editor";

const SUPPORTS_KEY = "evidence:supports-without-capture";
const CONTRADICTS_KEY = "evidence:contradicts-without-capture";
const REMOVE_KEY = "evidence:remove-sentence";
const LENGTH_KEY = "manual-claim:length";
const REFERENCES_KEY = "manual-claim:references";
const DUPLICATE_KEY = "manual-claim:duplicate-reference";

async function reset() {
  const sql = await getSql();
  await sql.query(`create table if not exists leads(
    id integer primary key, newsroom_id integer not null, status text not null)`);
  await sql.query(`create table if not exists drafts(
    id serial primary key,user_id text,newsroom_id integer not null,lead_id integer not null,
    headline text,dek text,body text,topic text,source_urls text,provenance_json text,
    found_note text,unanswered text,research_json text,updated_at timestamptz default now())`);
  await sql.query(`create table if not exists artifact_versions(
    id serial primary key,user_id text,newsroom_id integer not null,url text,content_hash text,
    title text,full_text text,fetch_status integer,fetch_outcome text,content_type text,
    captured_at timestamptz default now(),taken_down_at timestamptz,
    taken_down_reason text,taken_down_link_kept boolean not null default true)`);
  await sql.query(`create table if not exists capture_events(
    id serial primary key,user_id text,newsroom_id integer not null,investigation_id integer,
    source_url text,observed_at timestamptz default now(),http_status integer,fetch_outcome text,
    redirect_chain text,version_id integer,disappearance boolean,soft_404 boolean,trigger_kind text,
    monitor_id integer,headers_json text,content_hash text,content_type text,extraction_method text)`);
  await sql.query("delete from capture_events where newsroom_id in ($1,$2)", [room, otherRoom]);
  await sql.query("delete from artifact_versions where newsroom_id in ($1,$2)", [room, otherRoom]);
  await sql.query("delete from drafts where newsroom_id in ($1,$2)", [room, otherRoom]);
  await sql.query("delete from leads where newsroom_id in ($1,$2)", [room, otherRoom]);
  await sql.query("delete from audit_events where newsroom_id in ($1,$2)", [room, otherRoom]);
  await applyMigrationsToTestPglite();
  await sql.query(
    "insert into leads(id,newsroom_id,user_id,headline,why,status) values($1,$2,'finding-evidence','Council vote','Fixture','drafted')",
    [leadId, room],
  );
}

beforeEach(reset);

type WarningResult = { ok: false; warning: { key: string; sentence: string } };

function warningOf(result: unknown): WarningResult {
  assert.ok(result && typeof result === "object", "expected a result object");
  const candidate = result as { ok?: unknown; warning?: unknown };
  assert.equal(candidate.ok, false, "expected the warned answer");
  assert.ok(candidate.warning, "expected a warning payload");
  return result as WarningResult;
}

async function overrideAuditCount(sql: Sql, userId: string): Promise<number> {
  const [row] = await sql.query<{ count: number }>(
    "select count(*)::int as count from audit_events where user_id=$1 and action='override'",
    [userId],
  );
  return Number(row?.count ?? 0);
}

async function baseDraft(
  sql: Sql,
  input: {
    body: string;
    foundNote: unknown;
    research?: Record<string, unknown>;
    provenance?: unknown;
  },
) {
  const [draft] = await sql.query<{ id: number }>(
    `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,
      provenance_json,found_note,unanswered,research_json)
     values('editor',$1,$2,'Headline','Dek',$3,'council','[]',$4,$5,'[]',$6) returning id`,
    [
      room,
      leadId,
      input.body,
      JSON.stringify(input.provenance ?? []),
      JSON.stringify(input.foundNote),
      JSON.stringify(input.research ?? {}),
    ],
  );
  return draft;
}

describe("evidence judgment overrides (items 13 and 14)", () => {
  it("warns once, then accepts a support with no readable capture and a required editor note", async () => {
    const sql = await getSql();
    const [cited] = await sql.query<{ id: number }>(
      `insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,captured_at)
       values('editor',$1,'https://city.test/agenda','h','Agenda','','2026-09-01') returning id`,
      [room],
    );
    const draft = await baseDraft(sql, {
      body: "Body",
      foundNote: [
        {
          text: "Unsupported finding",
          source_urls: ["https://city.test/agenda"],
          artifact_version_ids: [cited.id],
          capture_event_ids: [],
          locators: [],
          excerpt: "anything",
        },
      ],
    });
    const review = await loadFindingEvidenceReview(sql, room, leadId);

    const warned = await persistFindingEvidenceJudgment(
      { newsroomId: room, userId: editor },
      {
        leadId,
        draftId: draft!.id,
        findingKey: "finding:0",
        judgment: "supports",
        reason: "",
        contraryVersionId: null,
        evidenceToken: review.evidenceToken,
      },
    );
    assert.equal(warningOf(warned).warning.key, SUPPORTS_KEY);
    assert.equal(
      (await loadFindingEvidenceReview(sql, room, leadId)).rows[0]!.judgment.value,
      "unreviewed",
      "the warned call must not write a judgment",
    );

    const withoutNote = await persistFindingEvidenceJudgment(
      { newsroomId: room, userId: editor }, {
        leadId, draftId: draft!.id, findingKey: "finding:0", judgment: "supports",
        reason: "", contraryVersionId: null, evidenceToken: review.evidenceToken,
        override: [SUPPORTS_KEY],
      });
    assert.equal((withoutNote as FindingEvidenceReview).rows[0]!.judgment.noCapture, true);
    assert.match((withoutNote as FindingEvidenceReview).rows[0]!.judgment.reason, /no explanation supplied/);
    assert.equal(await overrideAuditCount(sql, editor), 1, "even an unexplained override records the editor");
    const refreshed = await loadFindingEvidenceReview(sql, room, leadId);

    const saved = (await persistFindingEvidenceJudgment(
      { newsroomId: room, userId: editor },
      {
        leadId,
        draftId: draft!.id,
        findingKey: "finding:0",
        judgment: "supports",
        reason: "",
        contraryVersionId: null,
        evidenceToken: refreshed.evidenceToken,
        override: [SUPPORTS_KEY],
        editorNote: "I was at the meeting and heard the vote.",
      },
    )) as FindingEvidenceReview;
    const row = saved.rows[0]!;
    assert.equal(row.judgment.value, "supports");
    assert.equal(row.judgment.noCapture, true);
    assert.match(row.judgment.reason, /I know this from outside the captures/);
    assert.match(row.judgment.reason, /heard the vote/);

    // The no-capture mark survives a reload (it is not thrown back to unreviewed).
    const reloaded = await loadFindingEvidenceReview(sql, room, leadId);
    assert.equal(reloaded.rows[0]!.judgment.value, "supports");
    assert.equal(reloaded.rows[0]!.judgment.noCapture, true);
    assert.equal(
      await overrideAuditCount(sql, editor),
      2,
      "each explicit override is attributed",
    );
  });

  it("warns then accepts a contradiction with no cited contrary capture, and warns about a missing explanation", async () => {
    const sql = await getSql();
    const [cited] = await sql.query<{ id: number }>(
      `insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,captured_at)
       values('editor',$1,'https://city.test/agenda','h','Agenda','Readable text here.','2026-09-01') returning id`,
      [room],
    );
    const draft = await baseDraft(sql, {
      body: "Body",
      foundNote: [
        {
          text: "A finding",
          source_urls: ["https://city.test/agenda"],
          artifact_version_ids: [cited.id],
          capture_event_ids: [],
          locators: [],
          excerpt: "Readable text",
        },
      ],
    });
    const review = await loadFindingEvidenceReview(sql, room, leadId);

    const reasonless = await persistFindingEvidenceJudgment(
      { newsroomId: room, userId: editor }, {
        leadId, draftId: draft!.id, findingKey: "finding:0", judgment: "contradicts",
        reason: "", contraryVersionId: cited.id, evidenceToken: review.evidenceToken,
      });
    assert.equal(warningOf(reasonless).warning.key, "evidence:contradicts-without-reason");
    assert.equal(await overrideAuditCount(sql, editor), 0, "a warning alone does not write an override");

    const warned = await persistFindingEvidenceJudgment(
      { newsroomId: room, userId: editor },
      {
        leadId,
        draftId: draft!.id,
        findingKey: "finding:0",
        judgment: "contradicts",
        reason: "The record does not say this.",
        contraryVersionId: null,
        evidenceToken: review.evidenceToken,
      },
    );
    assert.equal(warningOf(warned).warning.key, CONTRADICTS_KEY);

    const saved = (await persistFindingEvidenceJudgment(
      { newsroomId: room, userId: editor },
      {
        leadId,
        draftId: draft!.id,
        findingKey: "finding:0",
        judgment: "contradicts",
        reason: "",
        contraryVersionId: null,
        evidenceToken: review.evidenceToken,
        override: [CONTRADICTS_KEY],
        editorNote: "A phone call contradicts it.",
      },
    )) as FindingEvidenceReview;
    assert.equal(saved.rows[0]!.judgment.value, "contradicts");
    assert.equal(saved.rows[0]!.judgment.noCapture, true);
    assert.equal(await overrideAuditCount(sql, editor), 1);
  });
});

describe("remove-sentence override (item 15)", () => {
  async function removeFixture(body: string, text: string) {
    const sql = await getSql();
    const fullText = "The council approved the contract Tuesday.";
    const [cited] = await sql.query<{ id: number }>(
      `insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,captured_at)
       values('editor',$1,'https://city.test/agenda','h','Agenda',$2,'2026-09-01') returning id`,
      [room, fullText],
    );
    const provenance = [
      { url: "https://city.test/agenda", version_id: cited.id, capture_event_id: null },
    ];
    const research = {
      aiEvidenceReview: {
        checkedText: body,
        rows: [
          {
            text,
            sourceUrl: "https://city.test/agenda",
            quote: text,
            sourceHash: await sha256(fullText),
            verdict: "Not supported",
            reason: "The record does not carry this.",
          },
        ],
      },
    };
    const draft = await baseDraft(sql, {
      body,
      foundNote: [
        {
          text,
          source_urls: ["https://city.test/agenda"],
          artifact_version_ids: [cited.id],
          capture_event_ids: [],
          locators: [],
          excerpt: text,
        },
      ],
      research,
      provenance,
    });
    return { sql, draft: draft!.id };
  }

  it("warns when a claim is not a whole sentence, then performs a coherent removal", async () => {
    const { sql, draft } = await removeFixture(
      "The council approved the contract Tuesday. The budget contains a deadline.",
      "approved the contract Tuesday",
    );
    const review = await loadFindingEvidenceReview(sql, room, leadId);
    const row = review.rows.find((candidate) => candidate.judgment.ai?.verdict === "Not supported");
    assert.ok(row, "the AI row must be grounded against the cited capture");

    const warned = await persistAiEvidenceDecision(
      { newsroomId: room, userId: editor },
      {
        leadId,
        draftId: draft,
        evidenceToken: review.evidenceToken,
        action: "remove-sentence",
        findingKey: row!.key,
      },
    );
    assert.equal(warningOf(warned).warning.key, REMOVE_KEY);
    assert.match(
      (await loadFindingEvidenceReview(sql, room, leadId)).canonicalDraft.body,
      /budget contains a deadline/,
      "the warned call must leave the body untouched",
    );

    const saved = (await persistAiEvidenceDecision(
      { newsroomId: room, userId: editor },
      {
        leadId,
        draftId: draft,
        evidenceToken: review.evidenceToken,
        action: "remove-sentence",
        findingKey: row!.key,
        override: [REMOVE_KEY],
      },
    )) as FindingEvidenceReview;
    assert.equal(saved.canonicalDraft.body, "The budget contains a deadline.");
    assert.equal(await overrideAuditCount(sql, editor), 1);
  });

  it("still refuses to remove the sentence that would leave an empty body", async () => {
    const { sql, draft } = await removeFixture(
      "The council approved the contract Tuesday.",
      "approved the contract Tuesday",
    );
    const review = await loadFindingEvidenceReview(sql, room, leadId);
    const row = review.rows[0]!;
    assert.equal(
      warningOf(
        await persistAiEvidenceDecision(
          { newsroomId: room, userId: editor },
          {
            leadId,
            draftId: draft,
            evidenceToken: review.evidenceToken,
            action: "remove-sentence",
            findingKey: row.key,
          },
        ),
      ).warning.key,
      REMOVE_KEY,
    );
    await assert.rejects(
      () =>
        persistAiEvidenceDecision(
          { newsroomId: room, userId: editor },
          {
            leadId,
            draftId: draft,
            evidenceToken: review.evidenceToken,
            action: "remove-sentence",
            findingKey: row.key,
            override: [REMOVE_KEY],
          },
        ),
      /body/i,
      "KEEP: an empty body stays blocked even under override",
    );
  });
});

describe("manual claim overrides (items 16 and 17)", () => {
  async function manualFixture() {
    const sql = await getSql();
    const [cited] = await sql.query<{ id: number }>(
      `insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,captured_at)
       values('editor',$1,'https://city.test/agenda','h','Agenda','Readable text.','2026-09-01') returning id`,
      [room],
    );
    const draft = await baseDraft(sql, {
      body: "Body",
      foundNote: [],
      provenance: [
        { url: "https://city.test/agenda", version_id: cited.id, capture_event_id: null },
      ],
    });
    return { sql, cited: cited.id, draft: draft!.id };
  }

  it("warns on an over-length claim, then stores it whole without truncation", async () => {
    const { sql, cited, draft } = await manualFixture();
    const review = await loadFindingEvidenceReview(sql, room, leadId);
    const fact = "A".repeat(25_000);
    const warned = await persistManualClaim(
      { newsroomId: room, userId: editor },
      {
        leadId,
        draftId: draft,
        evidenceToken: review.evidenceToken,
        action: "upsert",
        id: null,
        fact,
        kind: "record",
        references: [{ versionId: cited, relation: "corroborating" }],
      },
    );
    assert.equal(warningOf(warned).warning.key, LENGTH_KEY);
    assert.equal(
      (await loadFindingEvidenceReview(sql, room, leadId)).manualClaimRows.length,
      0,
      "the warned call must not store a claim",
    );

    const saved = (await persistManualClaim(
      { newsroomId: room, userId: editor },
      {
        leadId,
        draftId: draft,
        evidenceToken: review.evidenceToken,
        action: "upsert",
        id: null,
        fact,
        kind: "record",
        references: [{ versionId: cited, relation: "corroborating" }],
        override: [LENGTH_KEY],
      },
    )) as FindingEvidenceReview;
    assert.equal(saved.manualClaimRows.length, 1);
    assert.equal(saved.manualClaimRows[0]!.claim.fact, fact, "no silent truncation");
    // And the over-long claim reads back on a fresh load.
    assert.equal(
      (await loadFindingEvidenceReview(sql, room, leadId)).manualClaimRows[0]!.claim.fact.length,
      25_000,
    );
    assert.equal(await overrideAuditCount(sql, editor), 1);
  });

  it("warns above six references and on a duplicated reference, then accepts each under override", async () => {
    const { sql, cited, draft } = await manualFixture();
    const ids: number[] = [cited];
    for (let index = 0; index < 64; index += 1) {
      const [row] = await sql.query<{ id: number }>(
        `insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,captured_at)
         values('editor',$1,$2,'h',$3,'Text.',($4::text||'T00:00:00Z')::timestamptz) returning id`,
        [room, `https://city.test/record-${index}`, `Record ${index}`, "2026-09-02"],
      );
      ids.push(row!.id);
    }
    const review = await loadFindingEvidenceReview(sql, room, leadId);
    const references = ids.map((versionId) => ({ versionId, relation: "corroborating" as const }));
    const warned = await persistManualClaim(
      { newsroomId: room, userId: editor },
      {
        leadId,
        draftId: draft,
        evidenceToken: review.evidenceToken,
        action: "upsert",
        id: null,
        fact: "Seven records.",
        kind: "record",
        references,
      },
    );
    assert.equal(warningOf(warned).warning.key, REFERENCES_KEY);

    const saved = (await persistManualClaim(
      { newsroomId: room, userId: editor },
      {
        leadId,
        draftId: draft,
        evidenceToken: review.evidenceToken,
        action: "upsert",
        id: null,
        fact: "Seven records.",
        kind: "record",
        references,
        override: [REFERENCES_KEY],
      },
    )) as FindingEvidenceReview;
    assert.equal(saved.manualClaimRows.length, 1);

    const duplicate = await persistManualClaim(
      { newsroomId: room, userId: editor },
      {
        leadId,
        draftId: draft,
        evidenceToken: saved.evidenceToken,
        action: "upsert",
        id: null,
        fact: "Repeated record.",
        kind: "record",
        references: [
          { versionId: cited, relation: "corroborating" },
          { versionId: cited, relation: "corroborating" },
        ],
      },
    );
    assert.equal(warningOf(duplicate).warning.key, DUPLICATE_KEY);
    const duplicateSaved = (await persistManualClaim(
      { newsroomId: room, userId: editor },
      {
        leadId,
        draftId: draft,
        evidenceToken: saved.evidenceToken,
        action: "upsert",
        id: null,
        fact: "Repeated record.",
        kind: "record",
        references: [
          { versionId: cited, relation: "corroborating" },
          { versionId: cited, relation: "corroborating" },
        ],
        override: [DUPLICATE_KEY],
      },
    )) as FindingEvidenceReview;
    assert.equal(duplicateSaved.manualClaimRows.length, 2);
    assert.equal(await overrideAuditCount(sql, editor), 2, "one override row per accepted key");
  });

  it("warns for no references but keeps another newsroom's records unavailable", async () => {
    const { sql, draft } = await manualFixture();
    const [foreign] = await sql.query<{ id: number }>(
      `insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,captured_at)
       values('other',$1,'https://other.test/private','h','Private','FOREIGN','2026-09-01') returning id`,
      [otherRoom],
    );
    const review = await loadFindingEvidenceReview(sql, room, leadId);
    const input = {
      leadId,
      draftId: draft,
      evidenceToken: review.evidenceToken,
      action: "upsert" as const,
      id: null,
      fact: "No record.",
      kind: "record" as const,
      references: [],
    };
    const warned = await persistManualClaim({ newsroomId: room, userId: editor }, input);
    assert.equal(warningOf(warned).warning.key, REFERENCES_KEY);
    const saved = (await persistManualClaim(
      { newsroomId: room, userId: editor },
      { ...input, override: [REFERENCES_KEY] },
    )) as FindingEvidenceReview;
    assert.equal(saved.manualClaimRows[0].claim.fact, input.fact);
    await assert.rejects(
      () =>
        persistManualClaim(
          { newsroomId: room, userId: editor },
          {
            leadId,
            draftId: draft,
            evidenceToken: saved.evidenceToken,
            action: "upsert",
            id: null,
            fact: "Foreign record.",
            kind: "record",
            references: [{ versionId: foreign!.id, relation: "context" }],
          },
        ),
      /newsroom/i,
    );
    assert.equal(await overrideAuditCount(sql, editor), 1);
  });

it("warns on a long captured-record URL, then retains it without a new hard ceiling", async () => {
  const { sql, draft } = await manualFixture();
  const url = "https://city.test/" + "record".repeat(1500);
  const [capture] = await sql.query<{ id: number }>(
    "insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,captured_at) values('editor',$1,$2,'h','Long address','Text','2026-09-01') returning id",
    [room, url],
  );
  const review = await loadFindingEvidenceReview(sql, room, leadId);
  const input = {
    leadId,
    draftId: draft,
    evidenceToken: review.evidenceToken,
    action: "upsert" as const,
    id: null,
    fact: "Claim with a long source address.",
    kind: "record" as const,
    references: [{ versionId: capture.id, relation: "context" as const }],
  };
  const first = await persistManualClaim({ newsroomId: room, userId: editor }, input);
  const key = warningOf(first).warning.key;
  assert.equal(key, "manual-claim:reference-url");
  const saved = (await persistManualClaim(
    { newsroomId: room, userId: editor },
    { ...input, override: [key] },
  )) as FindingEvidenceReview;
  assert.equal(saved.manualClaimRows[0].captures[0].url, url);
  assert.equal(await overrideAuditCount(sql, editor), 1);
});

});
