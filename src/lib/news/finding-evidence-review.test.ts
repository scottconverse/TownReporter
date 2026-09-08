import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { getSql } from "../db.ts";
import {
  loadFindingEvidenceCapture,
  loadFindingEvidenceReview,
  persistFindingEvidenceJudgment,
} from "./finding-evidence-review.ts";

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
  await sql.query(`create table if not exists artifact_versions(
    id serial primary key,user_id text,newsroom_id integer not null,url text,content_hash text,
    title text,full_text text,fetch_status integer,fetch_outcome text,content_type text,
    captured_at timestamptz default now())`);
  await sql.query(`create table if not exists capture_events(
    id serial primary key,user_id text,newsroom_id integer not null,investigation_id integer,
    source_url text,observed_at timestamptz default now(),http_status integer,fetch_outcome text,
    redirect_chain text,version_id integer,disappearance boolean,soft_404 boolean,trigger_kind text,
    monitor_id integer,headers_json text,content_hash text,content_type text,extraction_method text)`);
  await sql.query("delete from capture_events where newsroom_id in ($1,$2)", [room, otherRoom]);
  await sql.query("delete from artifact_versions where newsroom_id in ($1,$2)", [room, otherRoom]);
  await sql.query("delete from drafts where newsroom_id in ($1,$2)", [room, otherRoom]);
  await sql.query("delete from leads where newsroom_id in ($1,$2)", [room, otherRoom]);
  await sql.query("insert into leads(id,newsroom_id,status) values($1,$2,'drafted')", [
    leadId,
    room,
  ]);
}
beforeEach(reset);

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
     values('editor',$1,$2,'Headline','Dek','Body','council','[]','[]',$3,'[]','{}') returning id`,
    [room, leadId, JSON.stringify(findings)],
  );
  return { sql, cited, newer, mismatch, foreign, capture, draft };
}

describe("finding evidence resolution", () => {
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
});

describe("finding judgment compare-and-swap", () => {
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
    const second = await persistFindingEvidenceJudgment(
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
    );
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
    await assert.rejects(
      () =>
        persistFindingEvidenceJudgment(
          { newsroomId: room },
          { ...base, reason: "", contraryVersionId: f.cited.id },
        ),
      /reason/,
    );
    await assert.rejects(
      () =>
        persistFindingEvidenceJudgment(
          { newsroomId: room },
          { ...base, reason: "Contrary", contraryVersionId: f.mismatch.id },
        ),
      /cited by this finding/,
    );
    await assert.rejects(
      () =>
        persistFindingEvidenceJudgment(
          { newsroomId: room },
          { ...base, reason: "Contrary", contraryVersionId: f.foreign.id },
        ),
      /readable captured version/,
    );
    const saved = await persistFindingEvidenceJudgment(
      { newsroomId: room },
      {
        ...base,
        reason: "The cited passage supplies contrary evidence.",
        contraryVersionId: f.cited.id,
      },
    );
    assert.deepEqual(saved.rows[0].judgment, {
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
    await assert.rejects(
      () =>
        persistFindingEvidenceJudgment(
          { newsroomId: room },
          {
            leadId,
            draftId: f.draft.id,
            findingKey: "finding:0",
            judgment: "supports",
            reason: "Must refuse",
            contraryVersionId: null,
            evidenceToken: review.evidenceToken,
          },
        ),
      /readable captured record/,
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
    const saved = await persistFindingEvidenceJudgment(
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
    );
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
    await assert.rejects(
      () =>
        persistFindingEvidenceJudgment(
          { newsroomId: room },
          {
            leadId,
            draftId: f.draft.id,
            findingKey: "finding:0",
            judgment: "supports",
            reason: "Unreadable",
            contraryVersionId: null,
            evidenceToken: review.evidenceToken,
          },
        ),
      /readable captured record/,
    );
  });
});
