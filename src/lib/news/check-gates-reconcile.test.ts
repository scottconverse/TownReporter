import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import type { DeskJob } from "./jobs.ts";
import { NAME_INVENTORY_SYSTEM } from "./name-check-work.ts";
import {
  checkStageDone,
  deskRowChecks,
  evidenceChip,
  namesChip,
  publishBarNote,
  recordedChecks,
  storyStages,
  type CheckFacts,
} from "./check-gates.ts";

/**
 * U9c, end to end: the memo a real evidence check leaves behind is the memo the
 * chips read.
 *
 * The PR #154 review (P2) found that a completed "Check draft against evidence"
 * run writes `evidenceReconciledAt` with no `evidenceReview.decision`, and that
 * the rule read only the decision -- so the workbench showed "○ Evidence check
 * not run" and left the Check stage open for a draft whose Checks tab said
 * "checked 8:02 a.m.".
 *
 * The unit cases next to the rule use the writer's object shape by hand. This
 * one does not: it runs the real worker (`performDraftReconcileWork`, the same
 * harness `draft-reconcile.adversarial.test.ts` uses, with the model seam
 * faked) against a scratch database, reads the `research_json` that worker
 * actually saved, and asks the chips what they make of it. If the producer
 * changes its keys, this fails -- which is the point.
 */
let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let ensureJobsSchema: typeof import("./jobs.ts").ensureJobsSchema;
let performDraftReconcileWork: typeof import("./draft-reconcile.server.ts").performDraftReconcileWork;
let sequence = 92000;

before(async () => {
  vite = await createServer({
    configFile: false,
    cacheDir: join(tmpdir(), `townreporter-check-gates-${process.pid}`),
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ ensureJobsSchema } = await vite.ssrLoadModule("/src/lib/news/jobs.ts"));
  const module = await vite.ssrLoadModule("/src/lib/news/draft-reconcile.server.ts");
  /* The fixture names no people; the separate name inventory answers with an
     empty, complete inventory the way a real "no names in this draft" pass
     would. Everything else goes to the test's own edit callback. */
  performDraftReconcileWork = (job, deps = {}) => module.performDraftReconcileWork(job, {
    ...deps,
    chat: deps.chat ? (system: string, ...args: Parameters<NonNullable<typeof deps.chat>> extends [string, ...infer Rest] ? Rest : never) =>
      system === NAME_INVENTORY_SYSTEM ? Promise.resolve({ ok: true, text: '{"complete":true,"people":[]}' }) : deps.chat!(system, ...args) : undefined,
  });
  await ensureJobsSchema();
  const sql = await getSql();
  await sql.query("create table if not exists newsrooms(id integer primary key,name text not null)");
  await sql.query("create table if not exists newsroom_members(user_id text,newsroom_id integer,role text)");
  await sql.query("create table if not exists leads(id serial primary key,user_id text,newsroom_id integer,status text,headline text,why text,topic text,source_urls text,evidence text,newsworthiness integer,created_at timestamptz default now())");
  await sql.query("create table if not exists drafts(id serial primary key,user_id text,newsroom_id integer,lead_id integer,headline text,dek text,body text,topic text,source_urls text default '[]',integrity_notes text,updated_at timestamptz default now(),provenance_json text,form text,found_note text,unanswered text,research_json text)");
  await sql.query("create table if not exists artifact_versions(id serial primary key,user_id text,newsroom_id integer,url text,content_hash text,title text default '',full_text text default '',fetch_status integer,fetch_outcome text,captured_at timestamptz default now())");
  await sql.query("create table if not exists newsroom_sections(newsroom_id integer,key text,name text,position integer,visible boolean,replacement_key text,primary key(newsroom_id,key))");
  const { ensureStoryDocuments } = await vite.ssrLoadModule("/src/lib/news/story-documents.server.ts");
  await ensureStoryDocuments(sql);
});

after(async () => vite?.close());

async function fixture() {
  const sql = await getSql();
  const newsroomId = sequence++;
  const userId = `check-gates-editor-${newsroomId}`;
  const url = `https://records.example/check-gates-${newsroomId}`;
  await sql.query("insert into newsrooms(id,name) values($1,$2)", [newsroomId, `Room ${newsroomId}`]);
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'editor')", [userId, newsroomId]);
  await sql.query("insert into section_config(newsroom_id) values($1) on conflict do nothing", [newsroomId]);
  await sql.query("insert into newsroom_sections(newsroom_id,key,name,position,visible,replacement_key) values($1,'council','Council',1,true,null)", [newsroomId]);
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,status,headline,why,topic,source_urls,evidence,newsworthiness) values($1,$2,'drafted','Council record','Why','council',$3,'',1) returning id",
    [userId, newsroomId, JSON.stringify([url])],
  );
  /*
    `research_json` is '{}' -- the draft has never been through a review and has
    no `evidenceReview` key at all, which is exactly the shape the review
    finding described: the check runs, and the only record it leaves is its
    stamp.
  */
  const [draft] = await sql.query<{ id: number }>(
    "insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,found_note,unanswered,research_json) values($1,$2,$3,'Original headline','Original dek','Original body','council',$4,'','{}','{}','[]','{}') returning id",
    [userId, newsroomId, lead.id, JSON.stringify([url])],
  );
  const [capture] = await sql.query<{ id: number }>(
    "insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text) values($1,$2,$3,'exact','Council record','SUPPORTED RECORD') returning id",
    [userId, newsroomId, url],
  );
  await sql.query("update drafts set provenance_json=$1 where id=$2", [JSON.stringify([{ url, version_id: capture.id, role: "record" }]), draft.id]);
  const [job] = await sql.query<DeskJob>(
    "insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,lane,status,stage,claim_token) values($1,$2,'reconcile',$3,'local-model','editor','default','running','Queued',$4) returning *",
    [userId, newsroomId, draft.id, `check-gates-claim-${newsroomId}`],
  );
  return { sql, newsroomId, leadId: lead.id, draftId: draft.id, job };
}

const reply = JSON.stringify({
  headline: "Reconciled headline",
  dek: "Reconciled dek",
  body: "Reconciled body supported by the saved record.",
  topic: "council",
  source_urls: [],
  integrity_notes: "",
  reporting_trail: [],
  found: {},
  unanswered: [],
  claims: [],
});

/** The checked draft's own `research_json`, exactly as the worker saved it. */
async function checkedResearch(f: Awaited<ReturnType<typeof fixture>>) {
  const [saved] = await f.sql.query<{ id: number; research_json: string }>(
    "select id,research_json from drafts where newsroom_id=$1 and lead_id=$2 order by id desc limit 1",
    [f.newsroomId, f.leadId],
  );
  assert.notEqual(saved.id, f.draftId, "the check saved a new draft version");
  return JSON.parse(saved.research_json) as Record<string, unknown>;
}

test("the memo a completed check writes counts as an evidence check, on both screens", async () => {
  const f = await fixture();
  await performDraftReconcileWork(f.job, { stage: async () => {}, chat: async () => ({ ok: true, text: reply }) });
  const research = await checkedResearch(f);

  /* The worker's own record: the stamp is there, and no decision is. */
  assert.equal(typeof research.evidenceReconciledAt, "string");
  assert.equal("evidenceReview" in research, false);

  const facts: CheckFacts = {
    hasDraft: true,
    ...recordedChecks(JSON.stringify(research)),
    /* No resolved review is passed on this row, so there is no count. */
    evidenceToReview: 0,
    evidenceOutstanding: false,
    namedOutlets: 0,
    namesOutstanding: false,
  };
  assert.equal(facts.evidenceChecked, true, "the check ran, so the record says so");
  assert.deepEqual(evidenceChip(facts), { text: "✓ Evidence checked", tone: "ok", done: true });
  assert.deepEqual(namesChip(facts), { text: "✓ Names checked", tone: "ok", done: true });
  assert.equal(checkStageDone(facts), true);
  assert.deepEqual(storyStages(facts, false).map((stage) => stage.label), [
    "✓ Lead",
    "✓ Draft",
    "✓ Check",
    "4 Publish",
  ]);
  assert.equal(publishBarNote(facts), "All checks done.");

  /* The desk home row reads the query's projection of that same stamp. */
  const row = deskRowChecks({
    evidence_required: false,
    evidence_decision: null,
    evidence_checked_at: String(research.evidenceReconciledAt),
    names_checked_at: String((research.nameCheck as { checkedAt?: unknown } | undefined)?.checkedAt ?? ""),
    names_unresolved: recordedChecks(JSON.stringify(research)).namesUnresolved,
    name_check_complete: recordedChecks(JSON.stringify(research)).nameCheckComplete,
  });
  assert.deepEqual(evidenceChip(row), { text: "✓ Evidence checked", tone: "ok", done: true });
  assert.deepEqual(namesChip(row), { text: "✓ Names checked", tone: "ok", done: true });
});

test("the same memo still yields the warning while something is outstanding", async () => {
  const f = await fixture();
  await performDraftReconcileWork(f.job, { stage: async () => {}, chat: async () => ({ ok: true, text: reply }) });
  const research = await checkedResearch(f);

  /* What the page adds on top: the story moved on since the check, a claim of
     absence is unticked, a check is running, or a decision is still saving. */
  const facts: CheckFacts = {
    hasDraft: true,
    ...recordedChecks(JSON.stringify(research)),
    evidenceToReview: 0,
    evidenceOutstanding: true,
    namedOutlets: 0,
    namesOutstanding: false,
  };
  assert.deepEqual(evidenceChip(facts), { text: "! Evidence to check", tone: "warn", done: false });
  assert.equal(checkStageDone(facts), false, "a check that no longer covers the text is not done");
  assert.doesNotMatch(publishBarNote(facts), /All checks done\./);
});
