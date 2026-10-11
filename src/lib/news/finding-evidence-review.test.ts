import type { FindingEvidenceReview } from "./finding-evidence-review.ts";
import type { OverrideWarning } from "./override.ts";
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import {
  loadFindingEvidenceCapture,
  loadFindingEvidenceReview,
  persistManualClaim,
  persistFindingEvidenceJudgment,
} from "./finding-evidence-review.ts";
import { takeDownCapture } from "./evidence-takedown.ts";
import { reportingStoryReviewClaims } from "./reporting-evidence-adapter.ts";
import type { PackageStory } from "./civic-reporting.ts";

const room = 73001;
const otherRoom = 73002;
const leadId = 73001;

async function reset() {
  const sql = await getSql();
  await sql.query(`create table if not exists leads(
    id integer primary key, newsroom_id integer not null, status text not null)`);
  await sql.query(`create table if not exists drafts(
    id serial primary key,user_id text,newsroom_id integer not null,lead_id integer not null,
    headline text,dek text,body text,topic text,source_urls text,provenance_json text,
    found_note text,unanswered text,research_json text,updated_at timestamptz default now())`);
  /*
    Unit U11b: the real column is added by migrations/0110_evidence_capture_takedown.sql
    and mirrored in investigate.ts's ensure list. This file's scratch table is
    a hand-made copy of the real one, so it carries it too -- the loader reads
    it for every cited version, and a fixture without it fails on the read
    rather than on the property under test.
  */
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
  /*
    Unit U11b2: the five stores a takedown purges (the capture's own passages
    and bytes, the Dark Desk's copy of the fetch, and the passage a claim or a
    relationship recorded). This file runs the REAL action in one case to prove
    that a judgment binding to the captured text comes back unreviewed, and
    that action writes to all five -- so they exist here, empty, with the
    columns the purge touches.
  */
  await sql.query(`create table if not exists artifact_chunks(
    id serial primary key,version_id integer,user_id text,newsroom_id integer not null,
    chunk_index integer,page_number integer,section text not null default '',
    excerpt text not null default '',locator text not null default '')`);
  await sql.query(`create table if not exists artifact_blobs(
    id serial primary key,version_id integer,user_id text,newsroom_id integer not null,
    sha256 text,original_url text,byte_length integer not null default 0,
    body_b64 text not null default '')`);
  await sql.query(`create table if not exists artifacts(
    id serial primary key,user_id text,newsroom_id integer not null,investigation_id integer,
    url text,title text,content_hash text,full_text text not null default '',version_id integer)`);
  await sql.query(`create table if not exists claims(
    id serial primary key,user_id text,newsroom_id integer not null,investigation_id integer,
    body text,kind text,evidence text,source_url text,version_id integer,excerpt text)`);
  await sql.query(`create table if not exists relationships(
    id serial primary key,user_id text,newsroom_id integer not null,investigation_id integer,
    from_name text,to_name text,kind text,evidence text,source_url text,version_id integer,
    excerpt text)`);
  await sql.query("delete from capture_events where newsroom_id in ($1,$2)", [room, otherRoom]);
  await sql.query("delete from artifact_versions where newsroom_id in ($1,$2)", [room, otherRoom]);
  await sql.query("delete from drafts where newsroom_id in ($1,$2)", [room, otherRoom]);
  await sql.query("delete from leads where newsroom_id in ($1,$2)", [room, otherRoom]);
  // U18a-1: `leads` is the real table now, so the row carries the columns it
  // declares `not null` (`user_id`, `headline`, `why`); the fixtures above are
  // `if not exists` and no longer stand in for it. scripts/run-tests-safe.mjs
  // applies migrations/*.sql before this file loads, and the
  // postgres-integration runner runs this same file without that preload, so
  // the fixture asks for the same schema itself -- through the one applier,
  // which does nothing when the ledger is already full.
  await applyMigrationsToTestPglite();
  await sql.query(
    "insert into leads(id,newsroom_id,user_id,headline,why,status) values($1,$2,'finding-evidence','Council vote','Fixture','drafted')",
    [leadId, room],
  );
}
beforeEach(reset);

it("reviews every complete reporting claim and multiple precise references with durable draft-scoped judgments", async () => {
  const f = await fixture();
  const fact = "A consequential documentary statement. ".repeat(20);
  const story: PackageStory = {
    id: "story-a", headline: "Headline", draft: "Body", plainBrief: "", cannotSay: "", readinessTier: 2,
    sources: [
      { id: "agenda", title: "Agenda", tier: "A", url: "https://city.test/agenda", locator: "page 4", offlineReference: "" },
      { id: "budget", title: "Budget", tier: "A", url: "https://city.test/budget", locator: "page 8", offlineReference: "" },
      { id: "offline", title: "Interview", tier: "C", url: "", locator: "paragraph 2", offlineReference: "Reporter notes 2026-09-01" },
    ],
    claims: Array.from({ length: 25 }, (_, index) => ({
      id: `claim-${index}`, text: fact + index, status: "VERIFIED", sourceIds: ["agenda", "budget", "offline", "missing"], nextCheck: "Read both pages", item: "Budget proposal",
    })),
  };
  const claims = await reportingStoryReviewClaims(f.sql, room, story, "2026-09-01T23:59:59Z");
  await f.sql.query("update drafts set research_json=$1,found_note='[]' where id=$2", [JSON.stringify({ reportedClaims: claims }), f.draft.id]);
  const review = await loadFindingEvidenceReview(f.sql, room, leadId);
  assert.equal(review.claimRows.length, 25);
  assert.equal(review.claimRows[24].claim.fact, fact + "24");
  assert.deepEqual(review.claimRows[0].claim.reporting?.references.map((ref) => ref.locator), ["page 4", "page 8", "paragraph 2"]);
  assert.deepEqual(review.claimRows[0].claim.reporting?.missingSourceIds, ["missing"]);
  assert.deepEqual(review.claimRows[0].captures.map((capture) => capture.versionId), [f.cited.id, f.mismatch.id]);
  assert.equal(review.claimRows[0].judgment.value, "unreviewed");
  await persistFindingEvidenceJudgment({ newsroomId: room }, {
    leadId, draftId: f.draft.id, findingKey: review.claimRows[0].key, judgment: "needs-reporting",
    reason: "Budget proposal is not adoption", contraryVersionId: null, evidenceToken: review.evidenceToken,
  });
  const reloaded = await loadFindingEvidenceReview(f.sql, room, leadId);
  assert.equal(reloaded.claimRows[0].judgment.value, "needs-reporting");
  assert.equal(reloaded.claimRows[0].judgment.reason, "Budget proposal is not adoption");
  assert.equal(reloaded.claimRows[0].claim.reporting?.status, "VERIFIED");
  // A stored reference ID cannot grant access to another URL's captured text.
  const wrongSource = structuredClone(claims);
  wrongSource.rows[0].reporting!.references[0].versionId = f.mismatch.id;
  wrongSource.rows[0].reporting!.references[1].versionId = f.foreign.id;
  await f.sql.query("update drafts set research_json=$1 where id=$2", [JSON.stringify({ reportedClaims: wrongSource }), f.draft.id]);
  const guarded = await loadFindingEvidenceReview(f.sql, room, leadId);
  assert.equal(guarded.claimRows[0].captures.every((capture) => !capture.available), true);
  const warned = await persistFindingEvidenceJudgment({ newsroomId: room, userId: "editor" }, {
    leadId, draftId: f.draft.id, findingKey: guarded.claimRows[0].key, judgment: "supports",
    reason: "", contraryVersionId: null, evidenceToken: guarded.evidenceToken,
  });
  assert.ok("warning" in warned);
  assert.equal((warned as { warning: { key: string } }).warning.key, "evidence:supports-without-capture");
  assert.equal(
    (await loadFindingEvidenceReview(f.sql, room, leadId)).claimRows[0].judgment.value,
    "unreviewed",
    "the warned call must not record a judgment",
  );
  // Same ledger in a follow-up draft cannot inherit the previous editor decision.
  await f.sql.query(`insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,research_json,updated_at)
    values('editor',$1,$2,'Follow-up','','New copy','council',$3,now()+interval '1 second')`, [room, leadId, JSON.stringify({ reportedClaims: claims })]);
  const followUp = await loadFindingEvidenceReview(f.sql, room, leadId);
  assert.notEqual(followUp.draftId, review.draftId);
  assert.equal(followUp.claimRows[0].judgment.value, "unreviewed");
});

it("hydrates historical reporting drafts from their own saved package without writing on load", async () => {
  const f = await fixture();
  const story: PackageStory = { id: "historical", headline: "Old", draft: "Body", plainBrief: "", cannotSay: "", readinessTier: 2,
    sources: [{ id: "s", title: "Agenda", tier: "A", url: "https://city.test/agenda", locator: "page 4", offlineReference: "" }],
    claims: [{ id: "c", text: "An archived claim", status: "UNVERIFIED", sourceIds: ["s"], nextCheck: "Check page" }],
  };
  const [pack] = await f.sql.query<{ request_id: number }>(`insert into reporting_packages(request_id,newsroom_id,lead_id,draft_id,package,created_at)
    values(73001001,$1,$2,$3,$4::jsonb,'2026-09-01T23:59:59Z') returning request_id`, [room, leadId, f.draft.id, JSON.stringify({ stories: [story] })]);
  const original = JSON.stringify({ civicReporting: true, requestId: Number(pack.request_id), storyId: "historical" });
  await f.sql.query("update drafts set research_json=$1,found_note='[]' where id=$2", [original, f.draft.id]);
  const review = await loadFindingEvidenceReview(f.sql, room, leadId);
  assert.equal(review.claimRows.length, 1);
  const checkedAgain = await loadFindingEvidenceReview(f.sql, room, leadId);
  assert.equal(checkedAgain.evidenceToken, review.evidenceToken, "derived documentary check timestamps cannot change the judgment token");
  assert.equal(checkedAgain.contentToken, review.contentToken);
  assert.equal(checkedAgain.claimRows[0].key, review.claimRows[0].key);
  assert.equal(checkedAgain.claimRows[0].currentDocumentCheck?.state, "unavailable");
  assert.equal(review.claimRows[0].captures[0].versionId, f.cited.id);
  const [stored] = await f.sql.query<{ research_json: string }>("select research_json from drafts where id=$1", [f.draft.id]);
  assert.equal(stored.research_json, original);
  await persistFindingEvidenceJudgment({ newsroomId: room }, { leadId, draftId: f.draft.id, findingKey: review.claimRows[0].key,
    judgment: "needs-reporting", reason: "Needs page check", contraryVersionId: null, evidenceToken: review.evidenceToken });
  assert.equal((await loadFindingEvidenceReview(f.sql, room, leadId)).claimRows[0].judgment.value, "needs-reporting");
});

async function fixture() {
  const sql = await getSql();
  const [cited] = await sql.query<{ id: number }>(
    `insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,captured_at)
     values('editor',$1,'https://city.test/agenda','old','Agenda','Council approved the water contract Tuesday.','2026-09-01') returning id`,
    [room],
  );
  const [newer] = await sql.query<{ id: number }>(
    `insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,captured_at)
     values('editor',$1,'https://city.test/agenda','new','Agenda update','The contract notice was updated.','2026-09-02') returning id`,
    [room],
  );
  const [mismatch] = await sql.query<{ id: number }>(
    `insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,captured_at)
     values('editor',$1,'https://city.test/budget','budget','Budget','No matching passage here.','2026-09-01') returning id`,
    [room],
  );
  const [foreign] = await sql.query<{ id: number }>(
    `insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,captured_at)
     values('other',$1,'https://other.test/private','secret','Private','FOREIGN PRIVATE TEXT','2026-09-01') returning id`,
    [otherRoom],
  );
  const [capture] = await sql.query<{ id: number }>(
    `insert into capture_events(user_id,newsroom_id,source_url,fetch_outcome,version_id)
     values('editor',$1,'https://city.test/agenda','fetched',$2) returning id`,
    [room, cited.id],
  );
  const findings = [
    {
      text: "Council approved the contract.",
      source_urls: ["https://city.test/agenda"],
      artifact_version_ids: [cited.id, foreign.id, 999999],
      capture_event_ids: [capture.id],
      locators: ["paragraph 4"],
      excerpt: "approved the water contract Tuesday",
    },
    {
      text: "The budget contains a deadline.",
      source_urls: ["https://city.test/budget"],
      artifact_version_ids: [mismatch.id],
      capture_event_ids: [],
      locators: ["page 2"],
      excerpt: "deadline is Friday",
    },
  ];
  const [draft] = await sql.query<{ id: number }>(
    `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,
      provenance_json,found_note,unanswered,research_json)
     values('editor',$1,$2,'Headline','Dek','Body','council','[]',$4,$3,'[]',$5) returning id`,
    [
      room,
      leadId,
      JSON.stringify(findings),
      JSON.stringify([
        {
          url: "https://city.test/agenda",
          version_id: cited.id,
          capture_event_id: capture.id,
        },
      ]),
      JSON.stringify({
        reportedClaims: {
          version: 1,
          rows: [
            {
              fact: "Council approved the water contract.",
              url: "https://city.test/agenda",
              kind: "record",
            },
          ],
        },
      }),
    ],
  );
  return { sql, cited, newer, mismatch, foreign, capture, draft };
}

describe("finding evidence resolution", () => {
  for (const provenanceUrl of ["https://city.test/agenda/", "https://city.test/agenda"]) {
    it(`resolves a trailing-slash claim against canonical captures and ${provenanceUrl} provenance`, async () => {
      const f = await fixture();
      await f.sql.query("update drafts set provenance_json=$1,research_json=$2,found_note='[]' where id=$3", [
        JSON.stringify([{ url: provenanceUrl, version_id: f.cited.id, capture_event_id: f.capture.id }]),
        JSON.stringify({ reportedClaims: { version: 1, rows: [{ fact: "Council approved the water contract.", url: "https://city.test/agenda/", kind: "record" }] } }),
        f.draft.id,
      ]);
      const review = await loadFindingEvidenceReview(f.sql, room, leadId);
      assert.deepEqual(review.claimRows[0].captures.map(c => ({ versionId: c.versionId, captureEventId: c.captureEventId, available: c.available })), [
        { versionId: f.cited.id, captureEventId: null, available: true },
        { versionId: f.cited.id, captureEventId: f.capture.id, available: true },
      ]);
      assert.equal((await loadFindingEvidenceCapture(f.sql, room, leadId, f.draft.id, f.cited.id)).ok, true);
      const saved = requireReview(await persistFindingEvidenceJudgment({ newsroomId: room }, {
        leadId, draftId: f.draft.id, findingKey: review.claimRows[0].key,
        judgment: "supports", reason: "Exact captured record supports the claim.",
        contraryVersionId: null, evidenceToken: review.evidenceToken,
      }));
      assert.equal(saved.claimRows[0].judgment.value, "supports");
    });
  }
  for (const claimUrl of ["https://city.test/budget", "https://city.test/agenda?record=2"]) {
    it(`does not equate a distinct path or document query with the cited capture: ${claimUrl}`, async () => {
      const f = await fixture();
      await f.sql.query("update drafts set provenance_json=$1,research_json=$2,found_note='[]' where id=$3", [
        JSON.stringify([{ url: claimUrl, version_id: f.cited.id, capture_event_id: f.capture.id }]),
        JSON.stringify({ reportedClaims: { version: 1, rows: [{ fact: "Council approved the water contract.", url: claimUrl, kind: "record" }] } }),
        f.draft.id,
      ]);
      const review = await loadFindingEvidenceReview(f.sql, room, leadId);
      assert.equal(review.claimRows[0].captures.length, 2);
      assert.ok(review.claimRows[0].captures.every(c => !c.available && c.url === null));
    });
  }
  it("keeps the draft-pass claim inventory separate and binds it only to exact draft provenance", async () => {
    const f = await fixture();
    const review = await loadFindingEvidenceReview(f.sql, room, leadId);
    assert.equal(review.rows.length, 2);
    assert.equal(review.claimRows.length, 1);
    assert.deepEqual(review.claimRows[0].claim, {
      fact: "Council approved the water contract.",
      url: "https://city.test/agenda",
      kind: "record",
    });
    assert.equal(review.claimRows[0].captures[0].versionId, f.cited.id);
    assert.equal(review.claimRows[0].captures[0].available, true);
  });

  it("loads an editor-authored manual claim separately with its exact captured record", async () => {
    const f = await fixture();
    const [draft] = await f.sql.query<{ research_json: string }>(
      "select research_json from drafts where id=$1",
      [f.draft.id],
    );
    const memo = JSON.parse(draft.research_json);
    memo.manualClaims = {
      version: 1,
      rows: [
        {
          id: "2ff6c441-33fa-474f-a6f7-0cf9295910ef",
          fact: "The council meeting begins at 6 p.m.",
          kind: "record",
          references: [
            {
              versionId: f.cited.id,
              url: "https://city.test/agenda",
              relation: "corroborating",
            },
          ],
        },
      ],
    };
    await f.sql.query("update drafts set research_json=$1 where id=$2", [
      JSON.stringify(memo),
      f.draft.id,
    ]);

    const review = await loadFindingEvidenceReview(f.sql, room, leadId) as unknown as {
      manualClaimRows?: Array<{ key: string; claim: { fact: string }; captures: Array<{ versionId: number | null; available: boolean }> }>;
    };
    assert.equal(review.manualClaimRows?.length, 1);
    assert.equal(review.manualClaimRows?.[0].key, "manual-claim:2ff6c441-33fa-474f-a6f7-0cf9295910ef");
    assert.equal(review.manualClaimRows?.[0].claim.fact, "The council meeting begins at 6 p.m.");
    assert.deepEqual(
      review.manualClaimRows?.[0].captures.map(({ versionId, available }) => ({ versionId, available })),
      [{ versionId: f.cited.id, available: true }],
    );
  });

  it("round-trips a manual claim with explicit owned records and rejects a stale or foreign selection", async () => {
    const f = await fixture();
    const initial = await loadFindingEvidenceReview(f.sql, room, leadId);
    const saved = requireReview(await persistManualClaim(
      { newsroomId: room },
      {
        leadId,
        draftId: f.draft.id,
        evidenceToken: initial.evidenceToken,
        action: "upsert",
        id: null,
        fact: "The council meeting begins at 6 p.m.",
        kind: "record",
        references: [
          { versionId: f.cited.id, relation: "corroborating" },
          { versionId: f.mismatch.id, relation: "contrary" },
        ],
      },
    ));
    assert.equal(saved.manualClaimRows.length, 1);
    const manual = saved.manualClaimRows[0];
    assert.equal(manual.captures[0].versionId, f.cited.id);
    assert.equal(manual.captures[0].relation, "corroborating");
    assert.equal(manual.captures[0].available, true);
    const capture = await loadFindingEvidenceCapture(f.sql, room, leadId, f.draft.id, f.cited.id);
    assert.equal(capture.ok, true);
    const judged = requireReview(await persistFindingEvidenceJudgment(
      { newsroomId: room },
      {
        leadId,
        draftId: f.draft.id,
        findingKey: manual.key,
        judgment: "supports",
        reason: "The selected agenda is the editor's stated corroborating record.",
        contraryVersionId: null,
        evidenceToken: saved.evidenceToken,
      },
    ));
    assert.equal(judged.manualClaimRows[0].judgment.value, "supports");
    const edited = requireReview(await persistManualClaim(
      { newsroomId: room },
      {
        leadId,
        draftId: f.draft.id,
        evidenceToken: judged.evidenceToken,
        action: "upsert",
        id: manual.claim.id,
        fact: "The council meeting begins at 6:30 p.m.",
        kind: "record",
        references: [
          { versionId: f.cited.id, relation: "corroborating" },
          { versionId: f.mismatch.id, relation: "contrary" },
        ],
      },
    ));
    assert.equal(edited.manualClaimRows[0].judgment.value, "unreviewed");
    const relationEdited = requireReview(await persistManualClaim(
      { newsroomId: room },
      {
        leadId,
        draftId: f.draft.id,
        evidenceToken: edited.evidenceToken,
        action: "upsert",
        id: manual.claim.id,
        fact: "The council meeting begins at 6:30 p.m.",
        kind: "record",
        references: [
          { versionId: f.cited.id, relation: "context" },
          { versionId: f.mismatch.id, relation: "contrary" },
        ],
      },
    ));
    assert.equal(relationEdited.manualClaimRows[0].captures[0].relation, "context");
    assert.equal(relationEdited.manualClaimRows[0].judgment.value, "unreviewed");
    await assert.rejects(
      () => persistManualClaim(
        { newsroomId: room },
        {
          leadId,
          draftId: f.draft.id,
          evidenceToken: initial.evidenceToken,
          action: "upsert",
          id: null,
          fact: "Stale claim.",
          kind: "record",
          references: [{ versionId: f.cited.id, relation: "context" }],
        },
      ),
      /changed/,
    );
    const current = await loadFindingEvidenceReview(f.sql, room, leadId);
    await assert.rejects(
      () => persistManualClaim(
        { newsroomId: room },
        {
          leadId,
          draftId: f.draft.id,
          evidenceToken: current.evidenceToken,
          action: "upsert",
          id: null,
          fact: "Foreign record must not attach.",
          kind: "record",
          references: [{ versionId: f.foreign.id, relation: "context" }],
        },
      ),
      /must still belong to this newsroom/,
    );
    await assert.rejects(
      () => persistManualClaim(
        { newsroomId: room },
        {
          leadId,
          draftId: f.draft.id,
          evidenceToken: relationEdited.evidenceToken,
          action: "upsert",
          id: null,
          fact: "Malformed relationship must not persist.",
          kind: "record",
          references: [{ versionId: f.cited.id, relation: "poisoned" as never }],
        },
      ),
      /valid relationship/,
    );
  });

  it("preserves unrelated judgments while a material manual-claim edit invalidates only that claim", async () => {
    const f = await fixture();
    const firstId = "2ff6c441-33fa-474f-a6f7-0cf9295910ef";
    const secondId = "3ff6c441-33fa-474f-a6f7-0cf9295910ef";
    let review = await loadFindingEvidenceReview(f.sql, room, leadId);
    review = requireReview(await persistManualClaim(
      { newsroomId: room },
      {
        leadId,
        draftId: f.draft.id,
        evidenceToken: review.evidenceToken,
        action: "upsert",
        id: firstId,
        fact: "The council meeting begins at 6 p.m.",
        kind: "record",
        references: [{ versionId: f.cited.id, relation: "corroborating" }],
      },
    ));
    review = requireReview(await persistManualClaim(
      { newsroomId: room },
      {
        leadId,
        draftId: f.draft.id,
        evidenceToken: review.evidenceToken,
        action: "upsert",
        id: secondId,
        fact: "The library reading room opens at 9 a.m.",
        kind: "record",
        references: [{ versionId: f.cited.id, relation: "corroborating" }],
      },
    ));
    review = requireReview(await persistFindingEvidenceJudgment(
      { newsroomId: room },
      {
        leadId,
        draftId: f.draft.id,
        findingKey: "finding:0",
        judgment: "supports",
        reason: "The cited passage states the action.",
        contraryVersionId: null,
        evidenceToken: review.evidenceToken,
      },
    ));
    review = requireReview(await persistFindingEvidenceJudgment(
      { newsroomId: room },
      {
        leadId,
        draftId: f.draft.id,
        findingKey: review.claimRows[0].key,
        judgment: "supports",
        reason: "The exact draft provenance is readable.",
        contraryVersionId: null,
        evidenceToken: review.evidenceToken,
      },
    ));
    review = requireReview(await persistFindingEvidenceJudgment(
      { newsroomId: room },
      {
        leadId,
        draftId: f.draft.id,
        findingKey: `manual-claim:${secondId}`,
        judgment: "supports",
        reason: "The editor selected this readable corroborating record.",
        contraryVersionId: null,
        evidenceToken: review.evidenceToken,
      },
    ));

    const updated = requireReview(await persistManualClaim(
      { newsroomId: room },
      {
        leadId,
        draftId: f.draft.id,
        evidenceToken: review.evidenceToken,
        action: "upsert",
        id: firstId,
        fact: "The council meeting begins at 6:30 p.m.",
        kind: "record",
        references: [{ versionId: f.cited.id, relation: "context" }],
      },
    ));
    assert.equal(updated.rows[0].judgment.value, "supports");
    assert.equal(updated.claimRows[0].judgment.value, "supports");
    assert.equal(
      updated.manualClaimRows.find((row) => row.claim.id === firstId)?.judgment.value,
      "unreviewed",
    );
    assert.equal(
      updated.manualClaimRows.find((row) => row.claim.id === secondId)?.judgment.value,
      "supports",
    );
  });

  it("warns then saves and reloads a seventeenth manual claim", async () => {
    const f = await fixture();
    const [draft] = await f.sql.query<{ research_json: string }>(
      "select research_json from drafts where id=$1",
      [f.draft.id],
    );
    const memo = JSON.parse(draft.research_json);
    memo.manualClaims = {
      version: 1,
      rows: Array.from({ length: 16 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        fact: `Manual fixture claim ${index + 1}`,
        kind: "record",
        references: [{ versionId: f.cited.id, url: "https://city.test/agenda", relation: "context" }],
      })),
    };
    await f.sql.query("update drafts set research_json=$1 where id=$2", [JSON.stringify(memo), f.draft.id]);
    const review = await loadFindingEvidenceReview(f.sql, room, leadId);
    const input = {leadId, draftId: f.draft.id, evidenceToken: review.evidenceToken,
      action: "upsert" as const, id: null, fact: "Seventeenth manual claim", kind: "record" as const,
      references: [{versionId: f.cited.id, relation: "context" as const}]};
    const first = await persistManualClaim({newsroomId: room, userId: "editor"}, input);
    assert.ok("warning" in first);
    if (!("warning" in first)) throw new Error("Expected count warning");
    const result = await persistManualClaim({newsroomId: room, userId: "editor"}, {...input, override: [first.warning.key]});
    assert.ok("manualClaimRows" in result);
    if ("manualClaimRows" in result) assert.equal(result.manualClaimRows.length, 17);
    assert.equal((await loadFindingEvidenceReview(f.sql, room, leadId)).manualClaimRows.length, 17);
    const audit = await f.sql.query("select id from audit_events where newsroom_id=$1 and action='override' and user_id='editor'", [room]);
    assert.equal(audit.length, 1);

  });

  it("does not expose or retain a judgment for a claim whose named provenance points to another URL", async () => {
    const f = await fixture();
    const loaded = await loadFindingEvidenceReview(f.sql, room, leadId);
    const claim = loaded.claimRows[0];
    const saved = requireReview(await persistFindingEvidenceJudgment(
      { newsroomId: room },
      {
        leadId,
        draftId: f.draft.id,
        findingKey: claim.key,
        judgment: "supports",
        reason: "The exact cited record names the approval.",
        contraryVersionId: null,
        evidenceToken: loaded.evidenceToken,
      },
    ));
    assert.equal(saved.claimRows[0].judgment.value, "supports");
    await f.sql.query(
      "update artifact_versions set url='https://city.test/repointed' where id=$1",
      [f.cited.id],
    );
    const reloaded = await loadFindingEvidenceReview(f.sql, room, leadId);
    const capture = reloaded.claimRows[0].captures[0];
    assert.deepEqual(
      { available: capture.available, url: capture.url, title: capture.title, viewHref: capture.viewHref },
      { available: false, url: null, title: null, viewHref: null },
    );
    assert.equal(reloaded.claimRows[0].judgment.value, "unreviewed");
    await assert.rejects(
      () =>
        persistFindingEvidenceJudgment(
          { newsroomId: room },
          {
            leadId,
            draftId: f.draft.id,
            findingKey: claim.key,
            judgment: "supports",
            reason: "A stale tab must not retain the repointed record.",
            contraryVersionId: null,
            evidenceToken: saved.evidenceToken,
          },
        ),
      /changed/,
    );
  });

  it("does not expose a foreign artifact named in claim provenance", async () => {
    const f = await fixture();
    await f.sql.query(
      "update drafts set provenance_json=$1 where id=$2",
      [
        JSON.stringify([
          {
            url: "https://city.test/agenda",
            version_id: f.foreign.id,
            capture_event_id: null,
          },
        ]),
        f.draft.id,
      ],
    );
    const review = await loadFindingEvidenceReview(f.sql, room, leadId);
    const capture = review.claimRows[0].captures[0];
    assert.deepEqual(
      { available: capture.available, url: capture.url, title: capture.title, viewHref: capture.viewHref },
      { available: false, url: null, title: null, viewHref: null },
    );
    assert.doesNotMatch(JSON.stringify(review.claimRows), /FOREIGN PRIVATE TEXT|other\.test\/private/);
    /* Audit item 14: a support with no readable capture warns rather than
       refusing; the foreign record still never satisfies it. */
    const warned = await persistFindingEvidenceJudgment(
      { newsroomId: room, userId: "editor" },
          {
            leadId,
            draftId: f.draft.id,
            findingKey: review.claimRows[0].key,
            judgment: "supports",
            reason: "Foreign material must not satisfy claim support.",
            contraryVersionId: null,
            evidenceToken: review.evidenceToken,
          },
    );
    assert.ok("warning" in warned);
    assert.equal(
      (warned as { warning: { key: string } }).warning.key,
      "evidence:supports-without-capture",
    );
  });

  it("separates owned passage facts, missing references, mismatch, and newer notification", async () => {
    const f = await fixture();
    const review = await loadFindingEvidenceReview(f.sql, room, leadId);
    assert.equal(review.rows.length, 2);
    assert.deepEqual(review.canonicalDraft, {
      headline: "Headline",
      dek: "Dek",
      body: "Body",
      topic: "council",
    });
    const first = review.rows[0];
    const cited = first.captures.find((capture) => capture.versionId === f.cited.id)!;
    assert.equal(cited.available, true);
    assert.equal(cited.excerptState, "found");
    assert.equal(cited.viewHref, `/evidence/${f.cited.id}`);
    assert.equal(cited.url, "https://city.test/agenda");
    assert.equal(cited.newerCapture?.versionId, f.newer.id);
    const foreign = first.captures.find((capture) => capture.versionId === f.foreign.id)!;
    assert.deepEqual(
      {
        available: foreign.available,
        url: foreign.url,
        title: foreign.title,
        viewHref: foreign.viewHref,
      },
      { available: false, url: null, title: null, viewHref: null },
    );
    assert.equal(first.captures.find((capture) => capture.versionId === 999999)?.available, false);
    assert.equal(review.rows[1].captures[0].excerptState, "not-found");
  });

  it("returns an honest empty review for a legacy draft without findings", async () => {
    const sql = await getSql();
    await sql.query(
      `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,
       provenance_json,found_note,unanswered,research_json)
       values('editor',$1,$2,'Legacy','','Body','council','[]','[]','','[]','{}')`,
      [room, leadId],
    );
    assert.deepEqual((await loadFindingEvidenceReview(sql, room, leadId)).rows, []);
  });

  it("refuses malformed JSON-looking findings instead of presenting syntax as legacy prose", async () => {
    const sql = await getSql();
    await sql.query(
      `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,
       provenance_json,found_note,unanswered,research_json)
       values('editor',$1,$2,'Incomplete findings','','Body','council','[]','[]',$3,'[]','{}')`,
      [room, leadId, '[{"text":"The council approved the contract","source_urls":["https://city.test'],
    );
    await assert.rejects(
      () => loadFindingEvidenceReview(sql, room, leadId),
      /Stored findings are incomplete or unreadable/,
    );
  });

  it("does not expose a foreign capture or a foreign version repointed from an owned capture", async () => {
    const f = await fixture();
    const [foreignCapture] = await f.sql.query<{ id: number }>(
      `insert into capture_events(user_id,newsroom_id,source_url,fetch_outcome,version_id)
       values('other',$1,'https://other.test/private','fetched',$2) returning id`,
      [otherRoom, f.foreign.id],
    );
    await f.sql.query("update capture_events set version_id=$1 where id=$2", [
      f.foreign.id,
      f.capture.id,
    ]);
    const [draft] = await f.sql.query<{ found_note: string }>(
      "select found_note from drafts where id=$1",
      [f.draft.id],
    );
    const findings = JSON.parse(draft.found_note);
    findings[0].capture_event_ids.push(foreignCapture.id);
    await f.sql.query("update drafts set found_note=$1 where id=$2", [
      JSON.stringify(findings),
      f.draft.id,
    ]);

    const review = await loadFindingEvidenceReview(f.sql, room, leadId);
    const ownedRepointed = review.rows[0].captures.find(
      (capture) => capture.captureEventId === f.capture.id,
    );
    const foreign = review.rows[0].captures.find(
      (capture) => capture.captureEventId === foreignCapture.id,
    );
    assert.deepEqual(
      {
        available: ownedRepointed?.available,
        title: ownedRepointed?.title,
        viewHref: ownedRepointed?.viewHref,
      },
      { available: false, title: null, viewHref: null },
    );
    assert.deepEqual(
      {
        available: foreign?.available,
        url: foreign?.url,
        title: foreign?.title,
        viewHref: foreign?.viewHref,
      },
      { available: false, url: null, title: null, viewHref: null },
    );
    assert.doesNotMatch(JSON.stringify(review), /FOREIGN PRIVATE TEXT|other\.test\/private/);
  });

  it("opens only cited or displayed newer captured text from the current newsroom draft", async () => {
    const f = await fixture();
    const cited = await loadFindingEvidenceCapture(f.sql, room, leadId, f.draft.id, f.cited.id);
    assert.equal(cited.ok, true);
    if (cited.ok) assert.match(cited.capture.fullText, /approved the water contract/);
    const newer = await loadFindingEvidenceCapture(f.sql, room, leadId, f.draft.id, f.newer.id);
    assert.equal(newer.ok, true);
    if (newer.ok) assert.match(newer.capture.fullText, /notice was updated/);
    assert.deepEqual(
      await loadFindingEvidenceCapture(f.sql, room, leadId, f.draft.id, f.foreign.id),
      { ok: false, code: "not-found", error: "That captured version is not available for this draft." },
    );
    await assert.rejects(
      () => loadFindingEvidenceCapture(f.sql, otherRoom, leadId, f.draft.id, f.cited.id),
      /Draft not found/,
    );
  });

  it("hands the recorded takedown reason to the owner, and to nobody else", async () => {

    const f = await fixture();
    /* The row as a real takedown leaves it: text purged, marked, with the note. */
    await f.sql.query(
      "update artifact_versions set full_text='',taken_down_at=now(),taken_down_reason=$1 where id=$2",
      ["Publisher asked: the excerpt quoted their subscriber-only story.", f.cited.id],
    );

    const asOwner = await loadFindingEvidenceCapture(
      f.sql, room, leadId, f.draft.id, f.cited.id, "owner",
    );
    assert.equal(asOwner.ok, true);
    if (asOwner.ok) {
      assert.equal(asOwner.capture.takenDown, true);
      assert.ok(asOwner.capture.takenDownAt, "the owner is told when it came down");
      assert.match(asOwner.capture.takenDownReason ?? "", /subscriber-only/);
      assert.equal(asOwner.capture.fullText, "", "a taken-down capture reads as empty");
    }

    const asEditor = await loadFindingEvidenceCapture(
      f.sql, room, leadId, f.draft.id, f.cited.id, "editor",
    );
    assert.equal(asEditor.ok, true);
    if (asEditor.ok) {
      assert.equal(asEditor.capture.takenDown, true, "an editor still sees that it came down");
      assert.equal(asEditor.capture.takenDownReason, null, "and never the owner's note");
      assert.equal(asEditor.capture.takenDownAt, null);
    }

    /* And the default, for a caller that does not say who is asking. */
    const unnamed = await loadFindingEvidenceCapture(f.sql, room, leadId, f.draft.id, f.cited.id);
    if (unnamed.ok) assert.equal(unnamed.capture.takenDownReason, null);
  });

  it("returns a judgment to unreviewed once the capture it bound to is taken down", async () => {
    /*
      Unit U11b2: the manual says a takedown leaves the judgments that bound to
      the captured text unreviewed, and this is the code that claim points at.

      A judgment binds to `md5(full_text)` of the versions it cited
      (`findingReferenceBinding`), and `resolveFinding` throws it back to
      `unreviewed` when the binding no longer matches. The purge empties
      `full_text`, so the binding moves -- proved here with the real action
      rather than with a hand-edited row, because the claim is about what a
      takedown does.
    */
    const f = await fixture();
    const loaded = await loadFindingEvidenceReview(f.sql, room, leadId);
    const finding = loaded.rows.find((row) => row.captures.some((c) => c.versionId === f.cited.id))!;
    const saved = requireReview(await persistFindingEvidenceJudgment(
      { newsroomId: room },
      {
        leadId,
        draftId: f.draft.id,
        findingKey: finding.key,
        judgment: "supports",
        reason: "The cited capture names the approval.",
        contraryVersionId: null,
        evidenceToken: loaded.evidenceToken,
      },
    ));
    assert.equal(saved.rows[0]!.judgment.value, "supports", "the judgment is recorded first");

    const result = await takeDownCapture(
      { userId: "takedown-owner", newsroomId: room, role: "owner" },
      { versionId: f.cited.id, reason: "Publisher asked; the excerpt quoted their article." },
    );
    assert.equal(result.ok, true);

    const after = await loadFindingEvidenceReview(f.sql, room, leadId);
    assert.equal(
      after.rows[0]!.judgment.value,
      "unreviewed",
      "the judgment bound to text that is no longer there",
    );
    assert.equal(after.rows[0]!.captures.find((c) => c.versionId === f.cited.id)!.takenDown, true);
  });
});

describe("finding judgment compare-and-swap", () => {
  it("keeps claim judgments in their own namespace and rejects a stale claim identity", async () => {
    const f = await fixture();
    const loaded = await loadFindingEvidenceReview(f.sql, room, leadId);
    const claim = loaded.claimRows[0];
    const saved = requireReview(await persistFindingEvidenceJudgment(
      { newsroomId: room },
      {
        leadId,
        draftId: f.draft.id,
        findingKey: claim.key,
        judgment: "supports",
        reason: "The cited captured record names the approval.",
        contraryVersionId: null,
        evidenceToken: loaded.evidenceToken,
      },
    ));
    assert.equal(saved.claimRows[0].judgment.value, "supports");
    assert.equal(saved.rows[0].judgment.value, "unreviewed");
    const memo = JSON.parse(
      (await f.sql.query<{ research_json: string }>("select research_json from drafts where id=$1", [f.draft.id]))[0]
        .research_json,
    );
    assert.equal(memo.claimEvidenceReview.judgments[claim.key].value, "supports");
    assert.equal(memo.findingEvidenceReview, undefined);
    memo.reportedClaims.rows[0].fact = "A changed claim identity.";
    await f.sql.query("update drafts set research_json=$1 where id=$2", [JSON.stringify(memo), f.draft.id]);
    await assert.rejects(
      () =>
        persistFindingEvidenceJudgment(
          { newsroomId: room },
          {
            leadId,
            draftId: f.draft.id,
            findingKey: claim.key,
            judgment: "needs-reporting",
            reason: "Old tab",
            contraryVersionId: null,
            evidenceToken: saved.evidenceToken,
          },
        ),
      /changed/,
    );
  });

  it("allows sequential judgments with refreshed full tokens and prevents stale overwrites", async () => {
    const f = await fixture();
    const initial = await loadFindingEvidenceReview(f.sql, room, leadId);
    const first = await persistFindingEvidenceJudgment(
      { newsroomId: room },
      {
        leadId,
        draftId: f.draft.id,
        findingKey: "finding:0",
        judgment: "supports",
        reason: "The cited passage states the action.",
        contraryVersionId: null,
        evidenceToken: initial.evidenceToken,
      },
    );
    assert.ok("rows" in first);
    assert.equal(first.rows[0].judgment.value, "supports");
    assert.equal(first.contentToken, initial.contentToken);
    assert.notEqual(first.evidenceToken, initial.evidenceToken);
    await assert.rejects(
      () =>
        persistFindingEvidenceJudgment(
          { newsroomId: room },
          {
            leadId,
            draftId: f.draft.id,
            findingKey: "finding:1",
            judgment: "needs-reporting",
            reason: "Check the deadline.",
            contraryVersionId: null,
            evidenceToken: initial.evidenceToken,
          },
        ),
      /changed/,
    );
    const second = requireReview(await persistFindingEvidenceJudgment(
      { newsroomId: room },
      {
        leadId,
        draftId: f.draft.id,
        findingKey: "finding:1",
        judgment: "needs-reporting",
        reason: "Check the deadline.",
        contraryVersionId: null,
        evidenceToken: first.evidenceToken,
      },
    ));
    assert.equal(second.rows[0].judgment.value, "supports");
    assert.equal(second.rows[1].judgment.value, "needs-reporting");
  });

  it("requires contrary evidence cited by the same finding and owned by the newsroom", async () => {
    const f = await fixture();
    const review = await loadFindingEvidenceReview(f.sql, room, leadId);
    const base = {
      leadId,
      draftId: f.draft.id,
      findingKey: "finding:0",
      judgment: "contradicts" as const,
      evidenceToken: review.evidenceToken,
    };
    const explanationWarning = await persistFindingEvidenceJudgment(
      { newsroomId: room, userId: "editor" },
      { ...base, reason: "", contraryVersionId: f.cited.id },
    );
    assert.ok("warning" in explanationWarning);
    assert.equal((explanationWarning as { warning: {key:string} }).warning.key, "evidence:contradicts-without-reason");
    assert.equal((await loadFindingEvidenceReview(f.sql, room, leadId)).rows[0].judgment.value,
      "unreviewed", "a reason warning does not save before explicit consent");
    /*
      Audit item 13: a contrary capture that is not cited (or a foreign record)
      is now a WARNING, not a refusal. The override records `noCapture` with the
      editor's own note; nothing else about the newsroom boundary changes.
    */
    for (const contraryVersionId of [f.mismatch.id, f.foreign.id]) {
      const warned = await persistFindingEvidenceJudgment(
        { newsroomId: room, userId: "editor" },
        { ...base, reason: "Contrary", contraryVersionId },
    );
      assert.ok("warning" in warned);
      assert.equal(
        (warned as { warning: { key: string } }).warning.key,
        "evidence:contradicts-without-capture",
    );
    }
    const saved = requireReview(await persistFindingEvidenceJudgment(
      { newsroomId: room },
      {
        ...base,
        reason: "The cited passage supplies contrary evidence.",
        contraryVersionId: f.cited.id,
      },
    ));
    assert.ok("rows" in saved, "a cited readable capture still saves normally");
    assert.deepEqual((saved as { rows: Array<{ judgment: unknown }> }).rows[0].judgment, {
      value: "contradicts",
      reason: "The cited passage supplies contrary evidence.",
      contraryVersionId: f.cited.id,
    });
  });

  it("refuses body edits and replacement drafts after review was loaded", async () => {
    const f = await fixture();
    const loaded = await loadFindingEvidenceReview(f.sql, room, leadId);
    await f.sql.query("update drafts set body='Edited body' where id=$1", [f.draft.id]);
    await assert.rejects(
      () =>
        persistFindingEvidenceJudgment(
          { newsroomId: room },
          {
            leadId,
            draftId: f.draft.id,
            findingKey: "finding:0",
            judgment: "supports",
            reason: "Old tab",
            contraryVersionId: null,
            evidenceToken: loaded.evidenceToken,
          },
        ),
      /changed/,
    );
    await f.sql.query(
      `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,
       provenance_json,found_note,unanswered,research_json,updated_at)
       select user_id,newsroom_id,lead_id,'Replacement',dek,body,topic,source_urls,
       provenance_json,found_note,unanswered,'{}',now()+interval '1 minute' from drafts where id=$1`,
      [f.draft.id],
    );
    await assert.rejects(
      () =>
        persistFindingEvidenceJudgment(
          { newsroomId: room },
          {
            leadId,
            draftId: f.draft.id,
            findingKey: "finding:0",
            judgment: "supports",
            reason: "Old draft",
            contraryVersionId: null,
            evidenceToken: loaded.evidenceToken,
          },
        ),
      /changed/,
    );
  });

  it("invalidates judgments when evidence fields or non-judgment research change", async () => {
    const f = await fixture();
    const loaded = await loadFindingEvidenceReview(f.sql, room, leadId);
    await f.sql.query(
      "update drafts set source_urls='[\"https://city.test/new-source\"]' where id=$1",
      [f.draft.id],
    );
    const changedSources = await loadFindingEvidenceReview(f.sql, room, leadId);
    assert.notEqual(changedSources.contentToken, loaded.contentToken);
    await assert.rejects(
      () =>
        persistFindingEvidenceJudgment(
          { newsroomId: room },
          {
            leadId,
            draftId: f.draft.id,
            findingKey: "finding:0",
            judgment: "supports",
            reason: "Stale evidence",
            contraryVersionId: null,
            evidenceToken: loaded.evidenceToken,
          },
        ),
      /changed/,
    );
    await f.sql.query("update drafts set research_json=$1 where id=$2", [
      JSON.stringify({ researchScope: "supplied" }),
      f.draft.id,
    ]);
    const changedResearch = await loadFindingEvidenceReview(f.sql, room, leadId);
    assert.notEqual(changedResearch.contentToken, changedSources.contentToken);
  });

  it("rejects noncanonical finding keys and malformed judgments", async () => {
    const f = await fixture();
    const review = await loadFindingEvidenceReview(f.sql, room, leadId);
    const base = {
      leadId,
      draftId: f.draft.id,
      reason: "Review",
      contraryVersionId: null,
      evidenceToken: review.evidenceToken,
    };
    await assert.rejects(
      () =>
        persistFindingEvidenceJudgment(
          { newsroomId: room },
          { ...base, findingKey: "finding:00", judgment: "supports" },
        ),
      /no longer/,
    );
    await assert.rejects(
      () =>
        persistFindingEvidenceJudgment(
          { newsroomId: room },
          { ...base, findingKey: "finding:0", judgment: "" as never },
        ),
      /valid evidence judgment/,
    );
  });

  it("rejects stale saves after cited text changes or a capture is repointed", async () => {
    const f = await fixture();
    const loaded = await loadFindingEvidenceReview(f.sql, room, leadId);
    await f.sql.query("update artifact_versions set full_text='Redacted after load' where id=$1", [
      f.cited.id,
    ]);
    await assert.rejects(
      () =>
        persistFindingEvidenceJudgment(
          { newsroomId: room },
          {
            leadId,
            draftId: f.draft.id,
            findingKey: "finding:0",
            judgment: "supports",
            reason: "Stale capture",
            contraryVersionId: null,
            evidenceToken: loaded.evidenceToken,
          },
        ),
      /changed/,
    );
    const afterTextChange = await loadFindingEvidenceReview(f.sql, room, leadId);
    await f.sql.query("update capture_events set version_id=$1 where id=$2", [
      f.mismatch.id,
      f.capture.id,
    ]);
    await assert.rejects(
      () =>
        persistFindingEvidenceJudgment(
          { newsroomId: room },
          {
            leadId,
            draftId: f.draft.id,
            findingKey: "finding:0",
            judgment: "does-not-support",
            reason: "Capture changed",
            contraryVersionId: null,
            evidenceToken: afterTextChange.evidenceToken,
          },
        ),
      /changed/,
    );
  });

  it("does not allow missing-only evidence to be marked supports", async () => {
    const f = await fixture();
    await f.sql.query("update drafts set found_note=$1 where id=$2", [
      JSON.stringify([
        {
          text: "Unsupported finding",
          source_urls: ["https://other.test/private"],
          artifact_version_ids: [f.foreign.id, 999999],
          capture_event_ids: [],
          locators: [],
          excerpt: "FOREIGN PRIVATE TEXT",
        },
      ]),
      f.draft.id,
    ]);
    const review = await loadFindingEvidenceReview(f.sql, room, leadId);
    /* Audit item 14: missing-only evidence warns; the foreign record still
       never grounds a support, and the warned call writes nothing. */
    const warned = await persistFindingEvidenceJudgment(
      { newsroomId: room, userId: "editor" },
          {
            leadId,
            draftId: f.draft.id,
            findingKey: "finding:0",
            judgment: "supports",
            reason: "Must refuse",
            contraryVersionId: null,
            evidenceToken: review.evidenceToken,
          },
    );
    assert.ok("warning" in warned);
    assert.equal(
      (warned as { warning: { key: string } }).warning.key,
      "evidence:supports-without-capture",
    );
  });

  it("fails corrupted stored support and contradiction judgments back to unreviewed", async () => {
    const f = await fixture();
    const review = await loadFindingEvidenceReview(f.sql, room, leadId);
    await f.sql.query("update drafts set research_json=$1 where id=$2", [
      JSON.stringify({
        findingEvidenceReview: {
          contentToken: review.contentToken,
          judgments: {
            "finding:0": {
              value: "contradicts",
              reason: "",
              contraryVersionId: f.cited.id,
            },
            "finding:1": {
              value: "supports",
              reason: "",
              contraryVersionId: null,
            },
          },
        },
      }),
      f.draft.id,
    ]);
    await f.sql.query("delete from artifact_versions where id=$1", [f.mismatch.id]);
    const reloaded = await loadFindingEvidenceReview(f.sql, room, leadId);
    assert.equal(reloaded.rows[0].judgment.value, "unreviewed");
    assert.equal(reloaded.rows[1].judgment.value, "unreviewed");
  });

  it("keeps review across a newer advisory capture but reopens when cited evidence changes", async () => {
    const f = await fixture();
    const initial = await loadFindingEvidenceReview(f.sql, room, leadId);
    const saved = requireReview(await persistFindingEvidenceJudgment(
      { newsroomId: room },
      {
        leadId,
        draftId: f.draft.id,
        findingKey: "finding:0",
        judgment: "supports",
        reason: "Reviewed cited version",
        contraryVersionId: null,
        evidenceToken: initial.evidenceToken,
      },
    ));
    await f.sql.query(
      `insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,captured_at)
       values('editor',$1,'https://city.test/agenda','newest','Newest','Later advisory text','2026-09-03')`,
      [room],
    );
    assert.equal(
      (await loadFindingEvidenceReview(f.sql, room, leadId)).rows[0].judgment.value,
      "supports",
    );
    await f.sql.query("update artifact_versions set full_text='Changed cited text' where id=$1", [
      f.cited.id,
    ]);
    assert.equal(
      (await loadFindingEvidenceReview(f.sql, room, leadId)).rows[0].judgment.value,
      "unreviewed",
    );
    assert.notEqual(
      (await loadFindingEvidenceReview(f.sql, room, leadId)).evidenceToken,
      saved.evidenceToken,
    );
  });

  it("reopens review when one cited reference disappears even if another survives", async () => {
    const f = await fixture();
    const [draft] = await f.sql.query<{ found_note: string }>(
      "select found_note from drafts where id=$1",
      [f.draft.id],
    );
    const findings = JSON.parse(draft.found_note);
    findings[0].artifact_version_ids.push(f.mismatch.id);
    await f.sql.query("update drafts set found_note=$1 where id=$2", [
      JSON.stringify(findings),
      f.draft.id,
    ]);
    const initial = await loadFindingEvidenceReview(f.sql, room, leadId);
    await persistFindingEvidenceJudgment(
      { newsroomId: room },
      {
        leadId,
        draftId: f.draft.id,
        findingKey: "finding:0",
        judgment: "supports",
        reason: "Reviewed both references",
        contraryVersionId: null,
        evidenceToken: initial.evidenceToken,
      },
    );
    await f.sql.query("delete from artifact_versions where id=$1", [f.cited.id]);
    const reloaded = await loadFindingEvidenceReview(f.sql, room, leadId);
    assert.ok(reloaded.rows[0].captures.some((capture) => capture.available));
    assert.equal(reloaded.rows[0].judgment.value, "unreviewed");
  });

  it("reopens review when a cited capture is repointed", async () => {
    const f = await fixture();
    const initial = await loadFindingEvidenceReview(f.sql, room, leadId);
    await persistFindingEvidenceJudgment(
      { newsroomId: room },
      {
        leadId,
        draftId: f.draft.id,
        findingKey: "finding:0",
        judgment: "does-not-support",
        reason: "Reviewed association",
        contraryVersionId: null,
        evidenceToken: initial.evidenceToken,
      },
    );
    await f.sql.query("update capture_events set version_id=$1 where id=$2", [
      f.mismatch.id,
      f.capture.id,
    ]);
    assert.equal(
      (await loadFindingEvidenceReview(f.sql, room, leadId)).rows[0].judgment.value,
      "unreviewed",
    );
  });

  it("reports an existing unreadable capture and refuses it as support", async () => {
    const f = await fixture();
    await f.sql.query("update artifact_versions set full_text='' where id=$1", [f.cited.id]);
    const review = await loadFindingEvidenceReview(f.sql, room, leadId);
    const cited = review.rows[0].captures.find((capture) => capture.versionId === f.cited.id)!;
    assert.equal(cited.available, true);
    assert.equal(cited.readable, false);
    /* Audit item 14: an existing but unreadable capture warns rather than
       refusing; the editor may still record their own judgment with a note. */
    const warned = await persistFindingEvidenceJudgment(
      { newsroomId: room, userId: "editor" },
          {
            leadId,
            draftId: f.draft.id,
            findingKey: "finding:0",
            judgment: "supports",
            reason: "Unreadable",
            contraryVersionId: null,
            evidenceToken: review.evidenceToken,
          },
    );
    assert.ok("warning" in warned);
    assert.equal(
      (warned as { warning: { key: string } }).warning.key,
      "evidence:supports-without-capture",
    );
  });
});

function requireReview(value: FindingEvidenceReview | OverrideWarning): FindingEvidenceReview {
  assert.ok("rows" in value, "expected a saved review");
  return value;
}
