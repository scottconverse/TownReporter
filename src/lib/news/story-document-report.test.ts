import assert from 'node:assert/strict';
import {it} from 'node:test';
import {reportAndDraft,REPORT_EDIT_SYSTEM} from './report.ts';
it('keeps privately uploaded evidence available through research, writing and final reconciliation',async()=>{
  const marker='packet.pdf page 15: The council approved $731,250 for the water project.';const stages=[];
  const result=await reportAndDraft({userId:'documents-test',newsroomId:1,lead:{id:1,headline:'Water project funding',why:'Decision in supplied packet',topic:'council',status:'new',source_urls:'[]',evidence:'',newsworthiness:1,created_at:'2026-09-12'},urls:[],memory:[],researchScope:'supplied',modelChoice:'claude-frontier',documentEvidence:marker},{paper:async()=>({name:'Test paper',city:'Test city',state:''}),ingest:async()=>{throw Error('No URL should be required');},capture:async()=>({version_id:1,capture_event_id:1}),hydrate:async()=>[],chat:async(system,user)=>{
    stages.push(system===REPORT_EDIT_SYSTEM?'edit':system.includes('"fetch_urls"')?'research':'write');
    assert.ok(user.includes(marker),'every pass needs the file evidence to avoid deleting supported facts');
    return {ok:true,text:JSON.stringify(system.includes('"fetch_urls"')?{news:'Water project funding',form:'brief'}:{headline:'Council approves water project',dek:'Funding approved.',body:'The council approved $731,250 for the water project (packet.pdf, page 15).',topic:'council',source_urls:[],integrity_notes:'Private uploaded record.',unanswered:[]})};
  }});
  assert.ok(!('error' in result));assert.match(result.body,/731,250/);assert.deepEqual(stages,['research','write','edit']);
});
