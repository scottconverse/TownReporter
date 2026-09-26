import { it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { saveDraftForEditor } from "./draft-edit.server.ts";
import { evidenceNeedsReview, evidenceReviewToken, publicEvidenceWasRemoved } from "./draft-evidence.ts";
import { parseStyleRecord } from "./draft-audit-record.ts";
import type { DraftRow } from "./types.ts";

it("real saves persist invalidation, reject stale review, preserve removed evidence, and isolate newsrooms", async () => {
  const sql = await getSql();
  await sql.query(`create table drafts (id serial primary key, newsroom_id integer, user_id text, lead_id integer,
    headline text, dek text, body text, topic text, source_urls text default '[]', provenance_json text default '[]',
    found_note text default '', unanswered text default '[]', research_json text default '{}',
    headline_source text default 'model', updated_at timestamptz default now())`);
  await sql.query(`create table leads (id integer primary key, newsroom_id integer)`);
  await sql.query(`insert into leads values (7001,91)`);
  await sql.query(`insert into drafts (newsroom_id,user_id,lead_id,headline,dek,body,topic,source_urls,found_note)
    values (91,'editor',7001,'Vendor news','','Vendor funding announced.','community','["https://vendor.example/release"]','Vendor funding announced.')`);
  const ctx = { userId: "editor", newsroomId: 91 };
  const edit = { leadId: 7001, headline: "Library hours", dek: "Hours change", body: "The library opens at noon Tuesday.", topic: "community" };
  const [initial] = await sql<DraftRow>`select * from drafts where lead_id = 7001`;
  await saveDraftForEditor(ctx, edit);
  const [saved] = await sql<DraftRow>`select * from drafts where lead_id = 7001`;
  assert.equal(saved.body, edit.body);
  assert.equal(evidenceNeedsReview(saved, saved.body), true);
  await assert.rejects(saveDraftForEditor(ctx, { ...edit, evidenceDecision: "keep", evidenceToken: evidenceReviewToken(initial) }), /changed/);
  await saveDraftForEditor(ctx, { ...edit, evidenceDecision: "remove", evidenceToken: evidenceReviewToken(saved) });
  const [removed] = await sql<DraftRow>`select * from drafts where lead_id = 7001`;
  assert.equal(evidenceNeedsReview(removed, removed.body), false);
  assert.equal(publicEvidenceWasRemoved(removed), true);
  assert.equal(removed.source_urls, "[]");
  assert.match(removed.research_json ?? "", /vendor\.example/);
  await assert.rejects(saveDraftForEditor({ ...ctx, newsroomId: 92 }, edit), /Lead not found/);
  const [count] = await sql<{n:number}>`select count(*)::int as n from drafts`;
  assert.equal(count.n, 1);
});

it("measures the saved draft into research_json beside the desk's other keys, and does not move the token twice", async () => {
  const sql = await getSql();
  await sql.query(`create table if not exists drafts (id serial primary key, newsroom_id integer, user_id text, lead_id integer,
    headline text, dek text, body text, topic text, source_urls text default '[]', provenance_json text default '[]',
    found_note text default '', unanswered text default '[]', research_json text default '{}',
    headline_source text default 'model', updated_at timestamptz default now())`);
  await sql.query(`create table if not exists leads (id integer primary key, newsroom_id integer)`);
  await sql.query(`insert into leads values (7002,91) on conflict do nothing`);
  /*
    A row that already carries two of the other writers' keys. The audit adds
    one and must not disturb them: the name check and the manual claims are the
    editor's and the desk's own findings, not this unit's to rewrite.
  */
  await sql.query(`insert into drafts (newsroom_id,user_id,lead_id,headline,dek,body,topic,research_json)
    values (91,'editor',7002,'Vendor news','','Vendor funding announced.','community',
      '{"nameCheck":{"version":1,"rows":[]},"manualClaims":[{"fact":"the fee"}]}')`);
  const ctx = { userId: "editor", newsroomId: 91 };
  const edit = {
    leadId: 7002,
    headline: "Water fee rises",
    dek: "The council voted 5-2.",
    body: "The council voted 5-2.\n\nExperts say the fee will rise.\n\nThe rate starts in January.",
    topic: "community",
  };
  await saveDraftForEditor(ctx, edit);
  const [saved] = await sql<DraftRow>`select * from drafts where lead_id = 7002`;
  const research = JSON.parse(saved.research_json ?? "{}") as Record<string, unknown>;
  assert.deepEqual(research.nameCheck, { version: 1, rows: [] });
  assert.deepEqual(research.manualClaims, [{ fact: "the fee" }]);

  const record = parseStyleRecord(research.styleAudit);
  assert.equal(record?.status, "open");
  assert.equal(record?.rounds, 0);
  assert.equal(record?.repairCalls, 0);
  assert.equal(record?.checkedAt, undefined);
  assert.ok(record?.findings.some((finding) => finding.code === "unnamed-attribution"));
  assert.deepEqual(record?.measurementsAfter, record?.measurementsBefore);

  /*
    The same words saved again must write the same bytes. `evidenceReviewToken`
    hashes `research_json`, so an audit that stamped a clock on every save would
    invalidate the editor's evidence review on a save that changed nothing.
  */
  await saveDraftForEditor(ctx, edit);
  const [again] = await sql<DraftRow>`select * from drafts where lead_id = 7002`;
  assert.equal(again.research_json, saved.research_json);
  assert.equal(evidenceReviewToken(again), evidenceReviewToken(saved));

  // And a save that does change the words re-measures them.
  await saveDraftForEditor(ctx, { ...edit, body: edit.body.replace("\n\nExperts say the fee will rise.", "") });
  const [fixed] = await sql<DraftRow>`select * from drafts where lead_id = 7002`;
  assert.equal(parseStyleRecord(JSON.parse(fixed.research_json ?? "{}").styleAudit)?.fixCount, 0);
  assert.deepEqual(JSON.parse(fixed.research_json ?? "{}").manualClaims, [{ fact: "the fee" }]);
});
