import assert from "node:assert/strict";
import { it } from "node:test";
import { getSql } from "../db.ts";
import { checkSourceForEditor, fileLeadForEditor, startPullForEditor } from "./desk-policy-actions.server.ts";

const context = { userId: "desk-policy-editor", newsroomId: 1 };
async function auditKey(key: string) {
  const sql = await getSql();
  const rows = await sql<{ detail: string; created_at: unknown }>`select detail,created_at from audit_events where user_id=${context.userId} and action='override'`;
  assert.ok(rows.some(row => JSON.parse(row.detail).key === key && JSON.parse(row.detail).target && row.created_at));
}
it("short lead headline and news reason each warn, then the approved filing executes and audits", async () => {
  let runs = 0;
  const input = { headline: "Tip", why: "", topic: "council" };
  const execute = async () => { runs++; return { ok: true as const, id: 14 }; };
  const first = await fileLeadForEditor(context, input, execute);
  assert.equal(first.ok, false); assert.equal(runs, 0);
  assert.equal("warning" in first && first.warning?.key, "lead-short-headline");
  const second = await fileLeadForEditor(context, { ...input, override: ["lead-short-headline"] }, execute);
  assert.equal(second.ok, false); assert.equal(runs, 0);
  assert.equal("warning" in second && second.warning?.key, "lead-short-why");
  assert.equal((await fileLeadForEditor(context, { ...input, override: ["lead-short-headline", "lead-short-why"] }, execute)).ok, true);
  assert.equal(runs, 1); await auditKey("lead-short-headline"); await auditKey("lead-short-why");
  assert.equal((await fileLeadForEditor(context, { ...input, headline: "", override: ["lead-short-headline", "lead-short-why"] }, execute)).ok, false);
  assert.equal((await fileLeadForEditor(context, { ...input, url: "http://127.0.0.1/", override: ["lead-short-headline", "lead-short-why"] }, execute)).ok, false);
  assert.equal(runs, 1);
});
it("paused source and cooldown each warn, then Check anyway runs without resuming the source", async () => {
  const sql = await getSql();
  const [source] = await sql<{ id: number }>`insert into sources(user_id,newsroom_id,url,title,kind,tier,status) values(${context.userId},1,'https://example.org/source','Paused source','page','A','paused') returning id`;
  let runs = 0;
  const execute = async () => { runs++; return { ok: true as const, line: "Read OK now." }; };
  const first = await checkSourceForEditor(context, source.id, undefined, execute);
  assert.equal((first as { warning?: { key: string } }).warning?.key, "source-paused"); assert.equal(runs, 0);
  assert.equal((await checkSourceForEditor(context, source.id, ["source-paused"], execute)).ok, true);
  const second = await checkSourceForEditor(context, source.id, ["source-paused"], execute);
  assert.equal((second as { warning?: { key: string } }).warning?.key, "source-check-cooldown"); assert.equal(runs, 1);
  assert.equal((await checkSourceForEditor(context, source.id, ["source-paused", "source-check-cooldown"], execute)).ok, true);
  assert.equal(runs, 2); await auditKey("source-paused"); await auditKey("source-check-cooldown");
  const [row] = await sql<{ status: string }>`select status from sources where id=${source.id}`;
  assert.equal(row.status, "paused");
  assert.equal((await checkSourceForEditor(context, 2147483000, ["source-paused", "source-check-cooldown"], execute)).ok, false);
  const [privateSource] = await sql<{ id: number }>`insert into sources(user_id,newsroom_id,url,title,kind,tier,status) values(${context.userId},1,'http://127.0.0.1/admin','Private','page','A','accepted') returning id`;
  assert.equal((await checkSourceForEditor(context, privateSource.id, ["source-paused", "source-check-cooldown"], execute)).ok, false);
  assert.equal(runs, 2);
});
it("a short Pull warns then enqueues with an audit, while missing leads, private URLs and open jobs stay hard", async () => {
  const sql = await getSql();
  const [lead] = await sql<{ id: number }>`insert into leads(user_id,newsroom_id,headline,why) values(${context.userId},1,'Pull fixture lead','News reason') returning id`;
  let runs = 0;
  const execute = async () => { runs++; return { ok: true as const, jobId: 18 }; };
  const input = { leadId: lead.id, query: "q" };
  const first = await startPullForEditor(context, input, execute);
  assert.equal("warning" in first && first.warning?.key, "pull-short-query"); assert.equal(runs, 0);
  assert.equal((await startPullForEditor(context, { ...input, override: ["pull-short-query"] }, execute)).ok, true);
  assert.equal(runs, 1); await auditKey("pull-short-query");
  assert.equal((await startPullForEditor(context, { ...input, leadId: 2147483000, override: ["pull-short-query"] }, execute)).ok, false);
  assert.equal((await startPullForEditor(context, { ...input, url: "http://localhost/admin", override: ["pull-short-query"] }, execute)).ok, false);
  await sql`insert into desk_jobs(user_id,newsroom_id,kind,subject_id,status,stage) values(${context.userId},1,'pull',${lead.id},'queued','Queued')`;
  assert.equal((await startPullForEditor(context, { ...input, override: ["pull-short-query"] }, execute)).ok, false);
  assert.equal(runs, 1);
});
