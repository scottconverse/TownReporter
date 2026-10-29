// guards: FB16 story and Health show the queue reason and start the picked replacement model.
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve, extname } from "node:path";
import { existsSync } from "node:fs";
import { rolldown } from "rolldown";
import { chromium } from "playwright";
import { screenModuleUrl } from "./screen-render-harness.mjs";

test("FB16: story progress and Health expose the wait and shared model picker", async (t) => {
  const health = await screenModuleUrl("src/components/ops-panels.tsx", {
    DeskJobCard: "props=>h(globalThis.RealDeskJobCard,props)",
    useDeskJobs: "()=>({data:[globalThis.waitingDraft]})",
    useQuery:
      '()=>({data:{checks:[],host:"test",takenAt:Date.now()},isPending:false,isError:false})',
    useMutation: "()=>({mutate(){}})",
    useQueryClient: "()=>({invalidateQueries(){}})",
    overallState: '()=>"ok"',
    OPS_ACTIONS: "[]",
  });
  const stubs = {
    "@tanstack/react-query": `import React from 'react'; export function useQuery({queryKey}){return {data:queryKey[0]==='desk-jobs'?[window.waitingDraft]:queryKey[0]==='custom-ai-connections'?[]:undefined};} export function useMutation(options){const [data,setData]=React.useState(null); return {data,isPending:false,mutate:async value=>{const result=await options.mutationFn(value);setData(result);options.onSettled?.();}};} export function useQueryClient(){return {invalidateQueries(){}};}`,
    "@/lib/news/job-progress": "export const listDeskJobs=()=>[],cancelStoryJob=()=>{},previewStoryNextModel=()=>null;",
    "@/components/scoped-actions":
      'export async function retryStoryJob(args){window.lastRetry=args.data;return {ok:true,model:"Gemini"};}',
    "@/lib/news/provider-availability":
      "export const providerAvailability=()=>{},localModelCatalog=()=>{},refreshLocalModelCatalog=()=>{};",
    "@/lib/news/provider-settings":
      "export const getLocalModelChoice=()=>{},saveLocalModelFn=()=>{};",
    "@/lib/news/custom-ai-settings": "export const getCustomAiConnectionsFn=()=>[];",
    "@/lib/news/claim": "export const myDesk=()=>{};",
    "@/components/desk-chrome-utils": "export const announceToDesk=()=>{};",
    "./preflight.ts":
      'export const LOCAL_MODEL_UNCONFIGURED="Unavailable",localServerName=()=>"";export const looksLikeProviderAuthFailure=()=>false,providerAuthTarget=()=>"";',
  };
  const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {DeskJobCard,StoryJobProgress} from './src/components/JobCard.tsx';import {HealthPanel} from ${JSON.stringify(health)};
    window.RealDeskJobCard=DeskJobCard;
    window.waitingDraft={id:41,leadId:7,kind:'draft',status:'queued',title:'Drafting story',headline:'Road work',model:'Local model',step:'Waiting for the local model, which is busy with the 11:58 AM scan. Waited 2:00. The finish time is not known; you can run it on another model.',startedAt:null,beatAt:null,endedAt:null,pct:null,stages:null,canRetry:true};
    const root=createRoot(document.getElementById('root')); window.mount=surface=>root.render(React.createElement(surface==='health'?HealthPanel:StoryJobProgress,{key:surface,leadId:7}));window.mount('story');`;
  const bundle = await rolldown({
    input: "fixture",
    cwd: resolve(import.meta.dirname, ".."),
    transform: {
      jsx: "react-jsx",
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
    },
    plugins: [
      {
        name: "draft-queue-fixture",
        resolveId(id) {
          if (id === "fixture" || id.startsWith("data:")) return id;
          if (id in stubs) return "\0" + id;
          if (id.startsWith("@/")) {
            const p = resolve(import.meta.dirname, "../src", id.slice(2));
            return extname(id) ? p : [".tsx", ".ts"].map((e) => p + e).find(existsSync);
          }
        },
        load(id) {
          if (id === "fixture") return entry;
          if (id.startsWith("data:")) return Buffer.from(id.split(",")[1], "base64").toString();
          if (id.slice(1) in stubs) return stubs[id.slice(1)];
        },
      },
    ],
  });
  t.after(() => bundle.close());
  const { output } = await bundle.generate({ format: "iife" });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route("**/*", (r) => r.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: output[0].code });
  for (const surface of ["story", "health"]) {
    await page.evaluate((s) => window.mount(s), surface);
    await page.getByText(/Waiting for the local model/).waitFor();
    assert.match(await page.locator("body").innerText(), /11:58 AM scan.*Waited 2:00/);
    await page.getByRole("button", { name: "Run it on another model", exact: true }).click();
    const model = page.locator(".model-picker select").first();
    await model.selectOption("gemini-flash");
    await page.getByRole("button", { name: "Run this draft", exact: true }).click();
    await page.waitForFunction(() => window.lastRetry?.modelChoice === "gemini-flash");
    assert.deepEqual(await page.evaluate(() => window.lastRetry), {
      jobId: 41,
      modelChoice: "gemini-flash",
    });
    await page.evaluate(() => {
      window.lastRetry = null;
    });
  }
});
