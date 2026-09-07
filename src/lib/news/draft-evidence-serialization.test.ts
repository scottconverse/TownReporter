import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import type { DeskJob } from "./jobs.ts";
import type { ReportedDraftResult } from "./desk-model-run.ts";

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performDraftWork: typeof import("./desk.ts").performDraftWork;
let performPublish: typeof import("./desk.ts").performPublish;
let parseFindings: typeof import("./findings.ts").parseFindings;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performDraftWork, performPublish } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
  ({ parseFindings } = await vite.ssrLoadModule("/src/lib/news/findings.ts"));
});

after(async () => vite.close());

it("keeps bounded multi-source evidence as valid JSON through draft and publication", async () => {
  const sql = await getSql();
  const newsroomId = 98401;
  const userId = "serialization-editor";
  await sql.query("delete from articles where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from audit_events where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from desk_jobs where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from drafts where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from leads where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from newsroom_members where newsroom_id=$1", [newsroomId]);
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [
    userId,
    newsroomId,
  ]);
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Budget hearing','Why','council','new','[]','',1,'{}') returning id",
    [userId, newsroomId],
  );
  const [jobRow] = await sql.query<{ id: number }>(
    "insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,lane,status,stage,claim_token) values($1,$2,'draft',$3,'claude-frontier','editor','default','running','Drafting','serialization-claim') returning id",
    [userId, newsroomId, lead.id],
  );
  const urls = Array.from(
    { length: 12 },
    (_, index) => `https://records.example.gov/department-${index}/packet-${202600 + index}`,
  );
  const provenance = urls.map((url, index) => ({
    title: `Department ${index} budget packet ${"detailed public record ".repeat(18)}`,
    organization: `City department ${index} ${"division ".repeat(10)}`,
    document_date: "2026-09-07",
    url,
    captured_at: "2026-09-07T12:00:00Z",
    version_id: 1000 + index,
    version_count: 1,
    capture_event_id: 2000 + index,
    disappeared: false,
    role: "primary",
  }));
  const findings = parseFindings(
    Array.from({ length: 6 }, (_, index) => ({
      text: `Finding ${index}: ${"The adopted packet identifies a funded capital project, responsible department, vote date, and dollar amount. ".repeat(12)}`.slice(
        0,
        1200,
      ),
      source_urls: [urls[index]!, urls[index + 6]!],
      capture_event_ids: [2000 + index, 2006 + index],
      artifact_version_ids: [1000 + index, 1006 + index],
      locators: Array.from(
        { length: 12 },
        (_, locator) =>
          `Page ${locator + 1}, table ${index + 1}, row ${locator + 3}: ${"specific locator detail ".repeat(6)}`,
      ),
      excerpt: "The council appropriated funds and assigned implementation responsibility. "
        .repeat(12)
        .slice(0, 800),
    })),
  );
  const unanswered = Array.from(
    { length: 12 },
    (_, index) =>
      `Question ${index}: ${"Which official can confirm the implementation date and affected residents? ".repeat(8)}`,
  );
  const reported = {
    headline: "Budget hearing",
    dek: "Council packet details projects.",
    body: "The council considered the budget.",
    topic: "council",
    source_urls: urls,
    integrity_notes: "Verify vote totals.",
    memory_entities: [],
    form: "news",
    provenance,
    found_note: JSON.stringify(findings),
    findings,
    unanswered,
    claims: [],
    research_memo: {},
  } as ReportedDraftResult;
  assert.ok(findings.every((finding) => finding.text.length <= 1200));
  assert.ok(findings.every((finding) => finding.excerpt.length <= 800));
  assert.ok(findings.every((finding) => finding.locators.length === 12));
  assert.ok(JSON.stringify(provenance).length > 8000);
  assert.ok(JSON.stringify(findings).length > 8000);
  assert.ok(JSON.stringify(unanswered).length > 2000);
  const job = {
    id: jobRow.id,
    newsroom_id: newsroomId,
    user_id: userId,
    kind: "draft",
    subject_id: lead.id,
    model_choice: "claude-frontier",
    model_choice_source: "editor",
    lane: "default",
    status: "running",
    stage: "Drafting",
    failover_note: "",
    error: null,
    created_at: "",
    updated_at: "",
    started_at: null,
    finished_at: null,
    claim_token: "serialization-claim",
  } as DeskJob;

  await performDraftWork(job, {
    reportAndDraft: async () => reported,
    setJobStage: async () => undefined,
  });
  const [draft] = await sql.query<{
    provenance_json: string;
    found_note: string;
    unanswered: string;
  }>("select provenance_json,found_note,unanswered from drafts where lead_id=$1", [lead.id]);
  assert.deepEqual(JSON.parse(draft.provenance_json), provenance);
  assert.deepEqual(JSON.parse(draft.found_note), findings);
  assert.deepEqual(JSON.parse(draft.unanswered), unanswered);

  const published = await performPublish({ userId, newsroomId }, lead.id);
  assert.equal(published.ok, true);
  const [article] = await sql.query<{
    provenance_json: string;
    found_note: string;
    unanswered: string;
  }>("select provenance_json,found_note,unanswered from articles where lead_id=$1", [lead.id]);
  assert.deepEqual(JSON.parse(article.provenance_json), provenance);
  assert.deepEqual(JSON.parse(article.found_note), findings);
  assert.deepEqual(JSON.parse(article.unanswered), unanswered);
});
