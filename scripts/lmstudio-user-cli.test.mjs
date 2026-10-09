// guards: Health must not report LM Studio missing when its user-installed CLI is available outside PATH.
import assert from 'node:assert/strict';import {test} from 'node:test';import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {probeQwen} from '../ops/control/control-server.mjs';
test('Health finds the user-installed LM Studio CLI when PATH has no lms',async()=>{
 const home=mkdtempSync(join(tmpdir(),'lms-health-'));try{const dir=join(home,'.lmstudio','bin');mkdirSync(dir,{recursive:true});const exe=join(dir,'lms.exe');writeFileSync(exe,'fixture');let called;
 const result=await probeQwen({env:{PATH:home,USERPROFILE:home},run:async(command,args)=>{called=command;assert.deepEqual(args,['ps','--json']);return {code:0,output:['[{"modelKey":"local-test-model"}]']};}});
 assert.equal(called,exe);assert.equal(result.found,true);assert.deepEqual(result.loaded,['local-test-model']);
 }finally{rmSync(home,{recursive:true,force:true});}
});
