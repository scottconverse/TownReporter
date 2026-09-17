import { it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { saveDraftForEditor } from "./draft-edit.server.ts";
import { evidenceNeedsReview, evidenceReviewToken, publicEvidenceWasRemoved } from "./draft-evidence.ts";
import type { DraftRow } from "./types.ts";

it("real saves persist invalidation, reject stale review, preserve removed evidence, and isolate newsrooms", async () => {
  const sql = await getSql();
  await sql.query(`create table drafts (id serial primary key, newsroom_id integer, user_id text, lead_id integer,
    headline text, dek text, body text, topic text, source_urls text default '[]', provenance_json text default '[]',
    found_note text default '', unanswered text default '[]', research_json text default '{}', updated_at timestamptz default now())`);
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
