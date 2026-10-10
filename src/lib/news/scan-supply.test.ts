// guards: accepted watches after position 200 must reach the editor instead of starving behind saved picks.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from '../db.ts';
import { dailyScanPlan } from './daily-scan-plan.server.ts';
import { sourceBatches } from './scan-supply.ts';
it('reads the entire accepted pool in stale-first batches within the budget', async () => {
  const sql = await getSql(), room = 99201;
  await sql.query("insert into newsrooms(id,name) values($1,'Supply')", [room]);
  const pool = await sql.query<{id:number}>("insert into sources(user_id,newsroom_id,url,title,kind,tier,status,last_ok_at) select 'supply',$1,'https://example.test/'||n,'Watch '||n,'news','B','accepted',case when n<=201 then '2026-10-08'::timestamptz end from generate_series(1,214) n returning id", [room]);
  const fixed = [pool[1].id,pool[0].id];
  const plan = await dailyScanPlan(sql, room, {source_cap:12,every_day_source_count:2,selected_source_ids:fixed}, true);
  assert.equal(plan.sources.length, 214);
  assert.deepEqual(plan.sources.slice(0,15).map(s=>s.id), [...pool.slice(201).map(s=>s.id),...fixed]);
  const attempted: number[] = [];
  const fetcher = async (id: number) => { attempted.push(id); if (id===fixed[0]) throw Error('403'); };
  for (const batch of sourceBatches(plan.sources, ()=>0, 100)) for (const s of batch) await fetcher(s.id).catch(()=>{});
  assert.equal(new Set(attempted).size, 214);
  assert.deepEqual([...sourceBatches(plan.sources, ()=>100, 100)], []);
});
