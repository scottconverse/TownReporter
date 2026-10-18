import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import type { ChatResultMetadata } from "./ai-result-metadata.ts";
import { createToolUsage, jobToolRecorder, toolTimeGuidance } from "./tool-usage.ts";
import { runDraftReply } from "./draft-reply.ts";
import { runPinnedCallWithFailover } from "./desk-model-run.ts";
import { runScanChatWithFailover } from "./scan-model-run.ts";

const metadata = (name: string): ChatResultMetadata => ({ provider: "fixture", model: name, durationMs: 1, timedOut: false,
  toolExecutions: { [name]: 1 }, toolRounds: 1, toolResultChars: 12,
  toolRoundDetails: [{ round: 1, timeMs: 1, tools: [{ name, arguments: "{}", timeMs: 1, resultChars: 12 }] }] });

it("ENG-4 tracks unlimited rounds, retains last 60 details, and counts a thrown execution", async () => {
  const usage = createToolUsage();
  for (let i = 0; i < 62; i++) {
    const round = usage.round(i);
    await usage.execute(round, "test", { query: "x".repeat(300) }, async () => "result", Date.now()+10000, 10000);
  }
  const last = usage.round(62);
  await assert.rejects(usage.execute(last, "failed", {}, async () => { throw new Error("failed"); }, Date.now()+10000, 10000));
  const got = usage.snapshot();
  assert.deepEqual(got.toolExecutions, { test: 62, failed: 1 });
  assert.equal(got.toolRounds, 63);
  assert.equal(got.toolRoundDetails?.length, 60);
  assert.equal(got.toolRoundDetails?.[0].round, 4);
  assert.equal(got.toolRoundDetails?.at(-1)?.tools[0].resultChars, 0);
  assert.equal(got.toolRoundDetails?.[0].tools[0].arguments.length, 200);
  assert.ok((got.toolResultChars ?? 0) > 62 * "result".length);
  assert.match(toolTimeGuidance("error", Date.now()-1, 10000), /about 0 seconds\.\nWrite your final answer now\.$/);
});

it("ENG-4 SQL recorder helper stores draft stages, writer retry, failover and checkpoint counts in result_json", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("create table desk_jobs(id int, newsroom_id int, kind text, status text, claim_token text, result_json text); insert into desk_jobs values(7,1,'draft','running','lease','{\"modelEffort\":\"none\"}'),(8,1,'scan','running','lease','{}')");
    const sql = (async (parts: TemplateStringsArray, ...values: unknown[]) =>
      (await pg.query(parts.reduce((s,p,i) => s + (i ? '$'+i : '') + p, ''), values)).rows) as Sql;
    const receipt = async (id: number) => JSON.parse((await pg.query<{result_json:string}>("select result_json from desk_jobs where id=$1", [id])).rows[0].result_json);
    const record = jobToolRecorder(sql, { id: 7, newsroom_id: 1, claim_token: "lease" });
    await record({ ok: true, text: "research", meta: metadata("research") });
    let calls = 0;
    const result = await runPinnedCallWithFailover({
      snapshot: { modelChoice: "deepseek-flash" }, source: "auto", ladder: ["deepseek-flash", "qwen-local"],
      run: async snapshot => {
        if (snapshot.modelChoice === "deepseek-flash") return record({ok:false as const,error:"The call timed out after 150s, 0 bytes out",meta:metadata("failed_rung")});
        return runDraftReply(async () => record({ ok: true, text: ++calls === 1 ? "unreadable" : JSON.stringify({headline:"Headline",body:"A complete brief ends here.",topic:"about",source_urls:[]}), meta: metadata("writer") }), 0, { requireReadable:true });
      },
      probe: async () => ({ok:true,label:"Local",choice:"qwen-local"}),
      resolve: async choice => ({modelChoice:choice}), onSwitch: async () => {},
    });
    assert.equal(result.result.ok, true);
    // The same merge used by the writer checkpoint and completion receipt.
    await pg.query("update desk_jobs set result_json=(result_json::jsonb || $1::jsonb)::text where id=7", [JSON.stringify({checkpointDraftId:44,actualModelId:"writer"})]);
    let got = await receipt(7);
    assert.deepEqual(got.toolExecutions, {research:1,failed_rung:1,writer:2});
    assert.equal(got.toolRounds,4);
    assert.equal(got.toolResultChars,48);
    assert.deepEqual(got.toolRoundDetails.map((d: {round:number})=>d.round),[1,2,3,4]);
    assert.equal(got.checkpointDraftId,44);
    assert.equal(got.actualModelId,"writer");
    assert.equal(got.modelEffort,"none");
    const editMeta=metadata("edit");
    editMeta.toolRoundDetails![0].tools[0].arguments="model text with NUL: " + String.fromCharCode(0);
    await record({ok:false,error:"Later check failed",meta:editMeta});
    got = await receipt(7);
    assert.equal(got.toolExecutions.edit,1);
    assert.equal(got.toolRoundDetails.at(-1).tools[0].arguments,"model text with NUL: ");
    assert.equal(got.checkpointDraftId,44);
    // A superseded claim cannot change the receipt.
    await pg.exec("update desk_jobs set claim_token='new' where id=7");
    await record({ok:true,text:"stale",meta:metadata("stale")});
    assert.equal((await receipt(7)).toolExecutions.stale,undefined);

    const scanRecord = jobToolRecorder(sql,{id:8,newsroom_id:1,claim_token:"lease"});
    let scanCalls=0;
    const scan=await runScanChatWithFailover({
      job:{id:8,model_choice:"deepseek-flash",model_choice_source:"auto"},system:"scan",user:"evidence",maxTokens:500,timeoutMs:()=>10000,
      grokChat:async()=>scanRecord(++scanCalls===1
        ? {ok:false as const,error:"The call timed out after 150s, 0 bytes out",meta:metadata("scan_failed")}
        : {ok:true as const,text:scanCalls===2?"bad":'{"leads":[]}',meta:metadata("scan")}),
      read:text=>text.startsWith("{"),probe:async()=>({ok:true,label:"Local",choice:"qwen-local"}),setModelChoice:async()=>{},setStage:async()=>{},
    });
    assert.equal(scan.ok,true);
    const scanReceipt=await receipt(8);
    assert.deepEqual(scanReceipt.toolExecutions,{scan_failed:1,scan:2});
    assert.equal(scanReceipt.toolRounds,3);
  } finally { await pg.close(); }
});

it("ENG-4 draft source wires the SQL recorder around raw writer and forced calls", () => {
  const source = readFileSync(new URL("./desk.ts", import.meta.url), "utf8");
  const draft = source.slice(source.indexOf("export const performDraftWork ="));
  assert.ok(draft.includes("const recordTools = jobToolRecorder(sql, job);"), "performDraftWork must create its job SQL recorder");
  assert.ok(/storyChat: typeof grokChat = async \(\.\.\.args\) => recordTools\(await rawStoryChat\(\.\.\.args\)\)/.test(draft), "raw draft calls must enter the recorder before retry helpers");
  assert.ok(/recordTools\(await runForcedChat\(/.test(draft), "forced draft calls must enter the same recorder");
});

it("ENG-4 scan source wires the recorder around raw calls before retry helpers", () => {
  const source = readFileSync(new URL("./desk.ts", import.meta.url), "utf8");
  assert.ok(/runChat: typeof grokChat = async \(\.\.\.args\) => recordTools\(await rawChat\(\.\.\.args\)\)/.test(source), "raw scan calls must enter the recorder before retry helpers");
});
