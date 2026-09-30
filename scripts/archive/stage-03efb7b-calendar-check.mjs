// One real-source check in the explicitly named copied database, never production.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const expected = 'townreporter_stage_03efb7b_20260911';
assert.equal(new URL(process.env.DATABASE_URL).pathname, `/${expected}`);
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
let db, sql, changed = false;
try {
  db = await vite.ssrLoadModule('/src/lib/db.ts');
  sql = await db.getSql();
  assert.equal((await sql.query('select current_database() as name'))[0].name, expected);
  assert.equal(Number((await sql.query('select count(*) n from routine_notice_automations where enabled=true'))[0].n), 0);
  const owners = await sql.query("select user_id from newsroom_members where newsroom_id=1 and role='owner'");
  assert.equal(owners.length, 1);
  const approvals = await sql.query('select a.source_id,a.source_url,a.format_key,p.revision,p.paused from routine_notice_approvals a join routine_notice_policies p using(newsroom_id) where a.newsroom_id=1 and a.source_id=2875');
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].paused, true);
  await sql.query('update routine_notice_policies set paused=false where newsroom_id=1');
  changed = true;
  const checks = await vite.ssrLoadModule('/src/lib/news/routine-notice-checks.server.ts');
  const a = approvals[0];
  const result = await checks.checkRoutineNoticeSourceForOwner({userId: owners[0].user_id, newsroomId: 1}, {
    requestId: randomUUID(), sourceId: a.source_id, sourceUrl: a.source_url,
    formatKey: a.format_key, expectedPolicyRevision: a.revision,
  });
  await writeFile('artifacts/stage-03efb7b-calendar-result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({database: expected, state:result.check.state, counts:result.check.counts, capture:result.check.capture, refusals:result.check.refusals}));
} finally {
  if (changed) await sql.query('update routine_notice_policies set paused=true where newsroom_id=1');
  if (db) await db.closePoolForTests();
  await vite.close();
}
