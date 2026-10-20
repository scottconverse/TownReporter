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
import { editorDraftError } from "./desk-copy.ts";
import { storyProviderFailure, runPinnedCallWithFailover } from "./desk-model-run.ts";

import { writingModelLines } from "../desk/ops-rows.ts";

import { acceptedClaimsPublishState } from "./story-readiness.ts";

import { publishBlockers } from "./publish-blockers.ts";


test("walk 4: Gemini reserves thinking room and exposes Google's output-limit finish reason", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "length",
            message: { content: '{"headline":"Applications open","body":"Applications' },
          },
        ],
      }),
    );
  };
  try {
    const result = await grokChat(
      "System",
      "User",
      2200,
      { choice: "custom:gemini", newsroomId: 1 },
      {
        resolveCustom: async () => ({
          name: "Gemini",
          modelId: "gemini-3.5-flash",
          apiKey: "secret-key",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        }),
      },
    );
    assert.ok(Number(requests[0].max_tokens) >= 16384);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /Google says:.*output token limit.*finish reason: length/);
      assert.match(result.partialText ?? "", /Applications/);
      const hops: string[] = [];
      await runPinnedCallWithFailover({
        snapshot: { modelChoice: "custom:gemini" },
        source: "editor",
        ladder: ["codex-balanced"],
        run: async (snapshot) =>
          snapshot.modelChoice === "custom:gemini" ? result : { ok: true, text: "complete" },
        probe: async () => ({ ok: true, choice: "codex-balanced", label: "Codex Sol 6.1" }),
        resolve: async (modelChoice) => ({ modelChoice }),
        onSwitch: async (receipt) => {
          hops.push(receipt.error);
        },
      });
      assert.match(hops[0], /Google says:.*finish reason: length/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("walk 4: unreadable fallback retries on its pinned model before one complete draft wins", async () => {
  const calls: { model: string; instruction?: string }[] = [];
  const partial = JSON.stringify({ headline: "Applications open", body: "Applications are" });
  const complete = JSON.stringify({
    headline: "Applications open",
    body: "Applications are open for county residents. Families may apply through the county website.",
  });
  const attempt = await runPinnedCallWithFailover({
    snapshot: { modelChoice: "custom:gemini" },
    source: "editor",
    ladder: ["deepseek-flash", "codex-balanced"],
    exhaustLadder: true,
    run: (snapshot) =>
      runDraftReply(
        async (instruction) => {
          calls.push({ model: snapshot.modelChoice, instruction });
          if (snapshot.modelChoice === "custom:gemini") return { ok: true, text: partial };
          if (snapshot.modelChoice === "deepseek-flash")
            return { ok: false, error: "Provider says: monthly usage limit (429)" };
          return {
            ok: true,
            text: instruction?.includes("JSON only")
              ? `Here is the draft:\n\n\u0060\u0060\u0060json\n${complete}\n\u0060\u0060\u0060`
              : "I will write that story.",
          };
        },
        0,
        { requireReadable: true },
      ),
    probe: async (choice) => ({
      ok: true,
      choice: choice as "codex-balanced",
      label: choice ?? "",
    }),
    resolve: async (modelChoice) => ({ modelChoice }),
    onSwitch: async () => {},
  });
  assert.equal(attempt.result.ok, true);
  if (attempt.result.ok)
    assert.equal(
      JSON.parse(attempt.result.text.match(/\{[\s\S]*\}/)![0]).body,
      JSON.parse(complete).body,
    );
  assert.deepEqual(
    calls.map((call) => call.model),
    ["custom:gemini", "custom:gemini", "deepseek-flash", "codex-balanced", "codex-balanced"],
  );
  assert.match(calls.at(-1)?.instruction ?? "", /JSON only/);
  // Quota-only chains also must reach a writer that can finish the assignment.
  const quotaChain = await runPinnedCallWithFailover({
    snapshot: { modelChoice: "custom:gemini" }, source: "editor",
    ladder: ["deepseek-flash", "codex-balanced"], exhaustLadder: true,
    run: async snapshot => snapshot.modelChoice === "codex-balanced"
      ? {ok:true,text:complete} : {ok:false,error:"Provider says: monthly usage limit (429)"},
    probe:async choice=>({ok:true,choice:choice as "codex-balanced",label:choice??""}),
    resolve:async modelChoice=>({modelChoice}),onSwitch:async()=>{},
  });
  assert.equal(quotaChain.result.ok, true);
});

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
    if(!result.ok) {assert.match(result.error,/Gemini.*Google says: You exceeded/);assert.doesNotMatch(result.error,/secret-key|API error/);assert.equal(editorDraftError(storyProviderFailure(result.error)),result.error);}
  } finally {globalThis.fetch=originalFetch;}

});


test("part G: custom progress uses the configured name and model", () => {

  const label = modelChoiceLabel("custom:gemini", "story", {name:"Gemini",modelId:"gemini-3.5-flash"});
  assert.equal(label, "Gemini (gemini-3.5-flash)");
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
  const completed = jobProgressView({kind:"draft",model_choice:"codex-balanced",status:"completed",result_json:JSON.stringify({draftCutOff:true})} as never,443,374);
  assert.equal(completed.doneText,gate.readiness.reason);
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


test("part G: Server health names a cloud local model", () => {

  const lines = writingModelLines({times:[],statuses:[],catalog:{servers:[],defaultModel:null,checkedAt:0},availability:{"local-model":true},localModel:{id:"deepseek-v4.1-flash:cloud",baseUrl:"http://127.0.0.1:11434/v1"}});

  const row = lines.find(line => line.name === "Local model")!;

  assert.match(row.note,/deepseek-v4.1-flash:cloud.*cloud/); assert.doesNotMatch(row.note,/on this computer/);

});

/*
  B07/FB05/FB06 (Oct 11 walk): "switched on here" is not "Ready". The Server
  card printed Ready for a Codex the login read called missing and for an LM
  Studio with nothing in memory. Each row now wears the real read.
*/
test("B07/FB06: Server health does not call a missing Codex or an empty LM Studio Ready", () => {
  const lm = "http://127.0.0.1:1234/v1";
  const rung = {providerId:"qwen-local",label:"Local model",enabled:true,switchedOffByOperator:false,endpoint:lm,endpointWatched:true};
  const codexMissing = {provider:"codex",name:"Codex",installed:false,signedIn:false,disabledByOperator:false,lastTest:null};
  const read = (loaded: boolean) => writingModelLines({
    times:[rung] as never,
    statuses:[codexMissing] as never,
    catalog:{checkedAt:0,defaultModel:{baseUrl:lm,id:"qwen"},servers:[{kind:"lmstudio",baseUrl:lm,reachable:true,models:[{id:"qwen",label:"qwen",loaded}]}]} as never,
    availability:{"codex-balanced":true,"local-model":true,"qwen-local":true} as never,
  });
  const empty = read(false);
  const codex = empty.find(line => line.name === "Codex Sol 6.1 (balanced)")!;
  assert.equal(codex.chip?.source,"status");
  if (codex.chip?.source === "status") assert.equal(codex.chip.status.installed,false);
  const localRung = empty.find(line => line.chip?.source === "words" && line.chip.label === "No model loaded");
  assert.ok(localRung, "an LM Studio with nothing in memory reads No model loaded");
  assert.ok(!read(false).some(line => line.name === "Local model" && line.chip?.source === "words" && line.chip.label === "Ready" && line.chip.help.includes("loaded")));
  const full = read(true);
  assert.ok(full.some(line => line.chip?.source === "words" && line.chip.label === "Ready" && /qwen loaded/.test(line.chip.help)), "a loaded model reads Ready");
});


test("walk D1: DeepSeek v4.1 Flash 1017 gets the full writer room with thinking off", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "ok" } }] }));
  };
  try {
    await grokChat("System", "User", 2200, { choice: "custom:deepseek", newsroomId: 1 }, {
      resolveCustom: async () => ({
        name: "DeepSeek",
        modelId: "deepseek-v4.1-flash:cloud",
        apiKey: "not-needed",
        baseUrl: "http://127.0.0.1:11434/v1",
      }),
    });
    assert.ok(Number(requests[0].max_tokens) >= 32768);
    assert.equal(requests[0].reasoning_effort, "none");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("B07: the local row judges the desk's chosen local model, the one its note names", () => {
  const ollama = "http://127.0.0.1:11434/v1";
  const read = (servers: unknown[]) => writingModelLines({
    times: [], statuses: [], availability: {"local-model": true, "qwen-local": true} as never,
    catalog: {checkedAt: 0, defaultModel: null, servers} as never,
    localModel: {id: "deepseek-v4.1-flash:cloud", baseUrl: ollama},
  }).filter(line => line.name === "Local model" && line.chip?.source === "words");
  const up = read([{kind: "ollama", baseUrl: ollama, reachable: true, models: [{id: "deepseek-v4.1-flash:cloud", loaded: null, cloud: true}]}]);
  assert.ok(up.length && up.every(line => line.chip?.source === "words" && line.chip.label === "Ready"));
  const down = read([{kind: "ollama", baseUrl: ollama, reachable: false, models: []}]);
  assert.ok(down.length && down.every(line => line.chip?.source === "words" && line.chip.label === "Not answering"));
});
