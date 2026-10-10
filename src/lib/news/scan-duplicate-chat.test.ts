// guards: an automatic duplicate check must not charge or use a different model from the editor's scan pick.
import {it} from 'node:test';
import assert from 'node:assert/strict';
import {scanDuplicateChat} from './scan-duplicate-chat.ts';
it('automatic duplicate checks keep the scan model and effort',async()=>{
 const seen: unknown[]=[];
 const chat=scanDuplicateChat({modelChoice:'codex-frontier',reasoningEffort:'medium',newsroomId:4,timeoutMs:90000},async(_s,_u,_n,options)=>{
   seen.push([options?.choice,options?.reasoningEffort,options?.newsroomId]);
   return {ok:true,text:'[]',meta:{model:'stub-sol',provider:'stub',durationMs:0,timedOut:false}};
 });
 const got=await chat('system','pairs',100);
 assert.deepEqual(seen,[['codex-frontier','medium',4]]);
 assert.equal(got.ok && got.model,'stub-sol');
});
