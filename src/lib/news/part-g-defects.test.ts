import { test, after } from "node:test";

import assert from "node:assert/strict";
import { getPglite } from "../db.ts";
after(async () => { await (await getPglite()).close(); });

import { grokChat } from "./ai.ts";
import { reportAndDraft, REPORT_RESEARCH_SYSTEM, REPORT_WRITE_SYSTEM } from "./report.ts";
import { jobProgressView } from "./job-progress.ts";
import { providerHttpError } from "./provider-error-detail.ts";
import { modelChoiceLabel } from "./model-choice.ts";

import { runDraftReply } from "./draft-reply.ts";
import { runPinnedCallWithFailover } from "./desk-model-run.ts";

import { writingModelLines } from "../desk/ops-rows.ts";

import { acceptedClaimsPublishState } from "./story-readiness.ts";

import { publishBlockers } from "./publish-blockers.ts";


test("part G: HTTP errors retain short provider words and redact credentials", async () => {

  const message = providerHttpError("Gemini (gemini-3.5-flash)", 429, {error:{message:"You exceeded your current quota secret-key\n" + "More details. ".repeat(40)}}, "secret-key");

  assert.match(message, /^Gemini \(gemini-3.5-flash\): Google says: You exceeded your current quota/);

  assert.match(message, /\(429\)$/);

  assert.doesNotMatch(message, /secret-key|API error|\n/);

  assert.ok(message.length < 260);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({error:{message:"You exceeded your current quota secret-key"}}),{status:429});
  try {
    const result = await grokChat("System","User",10,{choice:"custom:9ce9a944-f444-4a69-8927-7c7705c07a35",newsroomId:1},{resolveCustom:async()=>({name:"Gemini",modelId:"gemini-3.5-flash",apiKey:"secret-key",baseUrl:"https://generativelanguage.googleapis.com/v1beta/openai"})});
    assert.equal(result.ok,false);
    if(!result.ok) {assert.match(result.error,/Gemini.*Google says: You exceeded/);assert.doesNotMatch(result.error,/secret-key|API error/);}
  } finally {globalThis.fetch=originalFetch;}

});


test("part G: custom progress uses the configured name and model", () => {

  const label = modelChoiceLabel("custom:gemini", "story", {name:"Gemini",modelId:"gemini-3.5-flash"});
  assert.equal(label, "Gemini \u2014 gemini-3.5-flash");
  const view = jobProgressView({kind:"draft",model_choice:"custom:gemini",result_json:JSON.stringify({customModelLabel:label}),step_text:"Waiting on Custom API connection",status:"running"} as never,443,null);
  assert.equal(view.model,label);
  assert.equal(view.step,`Waiting on ${label}`);

});


test("part G: cut-off bodies retry once per model, hop through ready models and remain publishable with a warning", async () => {

  const calls: string[] = [], hops: string[] = [];

  const partial = JSON.stringify({headline:"Applications open",body:"Boulder County has opened applications for"});

  const complete = JSON.stringify({headline:"Applications open",body:"Boulder County has opened applications for its monthly cash assistance program. Families may apply through the county website."});

  for (const succeeds of [true, false]) {

    calls.length = 0; hops.length = 0;

    const result = await runPinnedCallWithFailover({

      snapshot:{modelChoice:"custom:gemini"},source:"editor",ladder:["deepseek-flash","codex-balanced"],

      run: snapshot => runDraftReply(async () => { calls.push(snapshot.modelChoice); return {ok:true,text:succeeds && snapshot.modelChoice === "codex-balanced" ? complete : partial}; }),

      probe: async choice => ({ok:true,choice:choice as "codex-balanced",label:choice ?? "model"}),

      resolve: async modelChoice => ({modelChoice}),

      onSwitch: async receipt => {hops.push(receipt.error);},

    });

    assert.deepEqual(calls, succeeds ? ["custom:gemini","custom:gemini","deepseek-flash","deepseek-flash","codex-balanced"] : ["custom:gemini","custom:gemini","deepseek-flash","deepseek-flash","codex-balanced","codex-balanced"]);

    assert.equal(hops.length,2);

    assert.ok(hops.every(note => /reply was cut off/.test(note)));

    assert.equal(result.result.ok,succeeds);

    if (!succeeds) assert.equal(result.result.partialText,partial);

  }

  const blockers = publishBlockers({headline:"Applications open",body:"Boulder County has opened applications for",dek:"Applications are open.",topic:"Health",leadExists:true,namedOutlets:[],unreviewedAccepted:true} as never);

  const gate = acceptedClaimsPublishState({blockers,openCount:0,acceptedCount:0,hasAiJudgments:false});

  assert.equal(gate.publishEnabled,true);

  assert.equal(gate.readiness.reason,"This draft looks cut off. Read it before you publish.");

  assert.notEqual(gate.readiness.state,"ready");
  let writerCalls = 0;
  const saved = await reportAndDraft({userId:"part-g-cutoff",modelChoice:"codex-balanced",researchScope:"supplied",lead:{id:443,headline:"Applications open",why:"Families can apply.",topic:"government"} as never,urls:[],memory:[]}, {
    budgetMs:16_000,ingest:async()=>{throw new Error("No external sources");},search:async()=>[],hydrate:async()=>[],capture:async()=>({version_id:1,capture_event_id:1}),
    chat:async system=>{
      if(system.startsWith(REPORT_RESEARCH_SYSTEM)) return {ok:true,text:JSON.stringify({form:"brief",questions:[],unknowns:[]})};
      if(system.startsWith(REPORT_WRITE_SYSTEM)) {writerCalls++;return {ok:true,text:partial};}
      return {ok:true,text:"{}"};
    },
  });
  assert.equal(writerCalls,2);
  assert.ok(!("error" in saved));
  if(!("error" in saved)) {assert.equal(saved.body,"Boulder County has opened applications for");assert.equal(saved.research_memo.storyReadiness?.reason,gate.readiness.reason);assert.notEqual(saved.research_memo.storyReadiness?.state,"ready");}

});


test("part G: Server health agrees with picker availability and names a cloud local model", () => {

  const lines = writingModelLines({times:[],statuses:[{provider:"codex",installed:false}] as never,catalog:{servers:[],defaultModel:null,checkedAt:0},availability:{"codex-balanced":true,"local-model":true},localModel:{id:"deepseek-v4.1-flash:cloud",baseUrl:"http://127.0.0.1:11434/v1"}});

  for (const name of ["Codex Sol 6.1 (balanced)","Local model"]) {

    const row = lines.find(line => line.name === name)!;

    assert.equal(row.chip?.source,"words");

    assert.equal((row.chip as {label:string}).label,"Ready");

    if(name === "Local model") { assert.match(row.note,/deepseek-v4.1-flash:cloud.*cloud/); assert.doesNotMatch(row.note,/on this computer/); }

  }

});

