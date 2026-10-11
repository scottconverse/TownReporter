import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";
installDom();
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const sonnerUrl = stubUrl(`export const shown=[]; export const dismissed=[]; export const toast={success:record,error:record,warning:record,dismiss(id){dismissed.push(id)}}; function record(message,data){shown.push({message,data});return data.id ?? shown.length;}`);
const { shown, dismissed } = await import(sonnerUrl);
const toastUrl = await moduleUrl("src/components/desk-toast.ts", { sonner: sonnerUrl });
const { useDeskMutation } = await import(await moduleUrl("src/components/desk-action.ts", {
  "@/components/desk-toast": toastUrl,
  "@/lib/news/refused-answer": await moduleUrl("src/lib/news/refused-answer.ts"),
}));
for (const silent of [false, true]) test(`warning offers one exact override press, then ${silent ? "clears a silent success" : "replaces itself with success and Undo"}`, async () => {
  const calls=[]; let after=0, rollback=0, handle;
  const input={id:42,status:"killed",killReason:"Duplicate",restore:"drafted"};
  const sentence="This lead has a written draft. Changing its status will keep the saved draft.";
  function Probe(){ handle=useDeskMutation({
    mutationFn: async variables => { calls.push(variables); return variables.override?.includes("lead-status-drafted") ? {ok:true} : {ok:false,error:sentence,warning:{key:"lead-status-drafted",sentence}}; },
    warningAction: "Kill", pending:"Killing…", done:()=>silent ? "" : "Killed.",
    after:()=>{after++;}, optimistic:()=>"old", rollback:()=>{rollback++;},
    undo:()=>({label:"Undo",run(){}}),
  }); return null; }
  const client=new QueryClient({defaultOptions:{mutations:{retry:false,gcTime:0}}});
  const root=createRoot(document.getElementById("root"));
  try {
    await React.act(async()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(Probe))));
    await React.act(async()=>{await handle.mutateAsync(input);});
    assert.equal(after,0); assert.equal(rollback,1); assert.equal(calls.length,1);
    assert.equal(shown.at(-1).message,sentence);
    assert.match(shown.at(-1).data.className,/warn/);
    assert.equal(shown.at(-1).data.action.label,"Kill anyway");
    assert.equal(shown.at(-1).data.duration,Infinity);
    const id=shown.at(-1).data.id;
    await React.act(async()=>{shown.at(-1).data.action.onClick({preventDefault(){},currentTarget:{disabled:false}}); await new Promise(resolve=>setTimeout(resolve,20));});
    assert.deepEqual(calls,[input,{...input,override:["lead-status-drafted"]}]);
    assert.equal(after,1);
    if (silent) assert.equal(dismissed.at(-1),id);
    else {
      assert.equal(shown.at(-1).message,"Killed.");
      assert.equal(shown.at(-1).data.id,id); assert.equal(shown.at(-1).data.action.label,"Undo");
    }
  } finally {await React.act(async()=>root.unmount()); for(const m of client.getMutationCache().getAll())m.destroy();client.clear();}
});
