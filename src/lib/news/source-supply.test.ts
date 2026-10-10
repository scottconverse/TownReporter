// guards: re-adding a newsroom watch must not overwrite its editorial kind or tier.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from '../db.ts';
import { saveAcceptedNewsroomSource } from './source-seeds.server.ts';
import { parseSourceLines } from './source-lines.ts';
it('classifies new news and event watches and preserves existing editorial labels', async () => {
  const sql=await getSql(), room=99202;
  await sql.query("insert into newsrooms(id,name) values($1,'Supply labels')",[room]);
  const rows=parseSourceLines('Courier | https://lhvc.com/\nEvents | https://lefthandbrewing.com/events\nAgency | https://weather.gov/\nUnknown | https://example.test/');
  assert.deepEqual(rows.map(r=>[r.kind,r.tier]),[['news','B'],['community','C'],['official','A'],['unclassified','C']]);
  const input={userId:'supply',newsroomId:room,url:rows[0].url,title:'Courier',kind:'news',tier:'B'};
  const first=await saveAcceptedNewsroomSource(input);
  const again=await saveAcceptedNewsroomSource({...input,kind:'unclassified',tier:'C'});
  assert.equal(again?.id,first?.id);
  assert.deepEqual([again?.kind,again?.tier],['news','B']);
  assert.deepEqual([first?.alreadyExisted,again?.alreadyExisted],[false,true]);
});
