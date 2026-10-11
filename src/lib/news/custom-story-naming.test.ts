import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { getSql, getPglite } from "../db.ts";
import { ensurePaperSettingsSchema } from "./paper-settings.ts";
import { runPinnedCallWithFailover } from "./desk-model-run.ts";
import { failoverReasonPhrase } from "./automatic-failover.ts";
import { grokChat } from "./ai.ts";
import { ensureCustomAiConnectionsSchema, encryptApiKey, resolveCustomAiChoice } from "./custom-ai-connections.server.ts";
import { forceSetupCodeSatisfiedForTests, clearSetupCodeOverrideForTests } from "./setup-code.server.ts";
import { commitStoryDraftForAuthenticatedEditor } from "./model-request-commit.server.ts";
import { enqueueJob, type DeskJob } from "./jobs.ts";
import { jobProgressView } from "./job-progress.ts";
import { modelChoiceLabel } from "./model-choice.ts";
import { lastDraftLine } from "./writer-bar.ts";

const id = "aaaaaaaa-1111-4111-8111-111111111111";
const choice = `custom:${id}` as const;
const connection = { name: "Gemini", modelId: "gemini-3.5-flash" };
const label = "Gemini (gemini-3.5-flash)";
before(async () => {
  forceSetupCodeSatisfiedForTests();
  await ensurePaperSettingsSchema();
  await ensureCustomAiConnectionsSchema();
  const sql = await getSql();
  await sql.query("insert into paper_settings(newsroom_id,onboarded) values(1,true) on conflict(newsroom_id) do update set onboarded=true");
  await sql.query("insert into custom_ai_connections(id,newsroom_id,name,base_url,model_id,enabled) values($1,1,'Gemini','https://example.test/v1','gemini-3.5-flash',true)", [id]);
});
after(async () => { clearSetupCodeOverrideForTests(); await (await getPglite()).close(); });

for (const [path, error] of [
  ["unreadable key", "The saved API key cannot be decrypted with this server's secret."],
  ["provider error", "Gemini (gemini-3.5-flash): Google says: quota exceeded (429)"],
  ["success", null],
] as const) test(`custom Story identity survives ${path}`, async () => {
  const sql = await getSql();
  const [lead] = await sql<{id:number}>`insert into leads(newsroom_id,user_id,headline,why) values(1,'naming-test','Naming regression','Why') returning id`;
  const result = await commitStoryDraftForAuthenticatedEditor({
    context:{userId:"naming-test",newsroomId:1}, leadId:lead.id, modelChoice:choice,
    override:["writer-not-ready"],
  }, {
    probeProvider: async picked => picked === choice && error
      ? {ok:false as const,error}
      : {ok:true as const,choice:picked === choice ? choice : "deepseek-flash",label:picked === choice ? label : "DeepSeek v4.1 Flash"},
    enqueueJob: opts => enqueueJob({...opts,kick:false}),
  });
  assert.equal(result.ok,true);
  if (!result.ok) assert.fail("Naming fixture must enqueue");
  const [job] = await sql<DeskJob>`select * from desk_jobs where id=${result.jobId}`;
  assert.equal(modelChoiceLabel(choice,"story",connection),label,"writer label");
  const receipt = JSON.parse(job.result_json ?? "{}");
  assert.equal(receipt.requestedCustomModelLabel,label,"identity survives preflight fallback");
  if (error) assert.equal(receipt.customModelLabel,undefined,"origin identity must not relabel the fallback writer");
  else assert.equal(receipt.customModelLabel,label);
  if (error) {
    const view = jobProgressView({...job,status:"running"},lead.id,null);
    assert.ok(view.step.includes(label),`Now: ${view.step}`);
    assert.ok(view.failoverNote.includes(label),view.failoverNote);
    assert.doesNotMatch(view.step + view.failoverNote,/Custom API connection/);
  } else {
    const view = jobProgressView({...job,status:"running",step_text:"Waiting on Custom API connection"},lead.id,null);
    assert.equal(view.model,label);
    assert.equal(view.step,`Waiting on ${label}`);
    assert.equal(view.failoverNote,"");
    assert.equal(lastDraftLine({modelLabel:view.model,when:"7:48 a.m."}),`Last draft: ${label}, 7:48 a.m.`);
  }
});


test("runtime provider-error hops keep the original connection identity", async () => {
  let stage = "", note = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({error:{message:"quota exceeded"}}),{status:429});
  try {
    const attempted = await runPinnedCallWithFailover({
      snapshot:{modelChoice:choice as string,modelLabel:label},source:"editor",ladder:["deepseek-flash"],
      run: snapshot => snapshot.modelChoice === choice
        ? grokChat("System","User",10,{choice,newsroomId:1},{resolveCustom:async()=>({...connection,baseUrl:"https://generativelanguage.googleapis.com/v1beta/openai",apiKey:"fixture-key"})})
        : Promise.resolve({ok:true as const,text:"Draft"}),
      probe:async()=>({ok:true as const,choice:"deepseek-flash" as const,label:"DeepSeek v4.1 Flash"}),
      resolve:async modelChoice=>({modelChoice,modelLabel:"DeepSeek v4.1 Flash"}),
      onSwitch:async hop=>{
        // The runtime can still emit a legacy generic stage; presentation must name it.
        stage = `Switched to ${hop.nextLabel}: ${failoverReasonPhrase("Custom API connection",hop.reason)}`;
        note = `${hop.error} -> ${hop.nextLabel}`;
      },
    });
    assert.equal(attempted.result.ok,true);
    const view = jobProgressView({kind:"draft",model_choice:"deepseek-flash",status:"running",step_text:stage,failover_note:note,result_json:JSON.stringify({customModelLabel:label})} as DeskJob,443,null);
    assert.ok(view.step.includes(label),view.step);
    assert.ok(view.failoverNote.includes(label),view.failoverNote);
    assert.doesNotMatch(view.step+view.failoverNote,/Custom API connection/);
  } finally { globalThis.fetch=originalFetch; }
});

test("the real unreadable-key resolver names Gemini before throwing", async () => {
  const previousSecret=process.env.BETTER_AUTH_SECRET;
  try {
    process.env.BETTER_AUTH_SECRET="naming-original-secret";
    const encrypted=encryptApiKey("fixture-private-key");
    const sql=await getSql();
    await sql.query("update custom_ai_connections set encrypted_api_key=$1 where id=$2",[encrypted,id]);
    process.env.BETTER_AUTH_SECRET="naming-restored-secret";
    await assert.rejects(resolveCustomAiChoice(1,id),error=>{
      assert.ok(error instanceof Error);
      assert.ok(error.message.startsWith(`${label}: The saved API key cannot be decrypted`));
      assert.doesNotMatch(error.message,/fixture-private-key|naming-original-secret/);
      return true;
    });
  } finally {
    if(previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET=previousSecret;
  }
});
