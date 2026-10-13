// Guards: cancelling the unreachable-writer warning releases the story's redraft press immediately.
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";
import { chromium } from "playwright";
import { screenModuleUrl } from "./screen-render-harness.mjs";

test("cancelling an unreachable custom-writer warning restores Redraft without a job", async (t) => {
  const root = resolve(import.meta.dirname, "..");
  const screen = await screenModuleUrl(
    "src/routes/desk.story.$leadId.tsx",
    {
      ActionButton: `({children,disabled,onAct,phase,workingLabel})=>h("button",{disabled,onClick:onAct},phase==="working"?workingLabel:children)`,
      RedraftDialog: `({open,onOpenChange,modelChoice,onModelChange,onStart,busy})=>open?h("div",{role:"dialog","aria-label":"Redraft"},h("label",{},"Writing model",h("select",{"aria-label":"Writing model",value:modelChoice,onChange:e=>onModelChange(e.target.value)},h("option",{value:"auto"},"Automatic"),h("option",{value:"custom:offline"},"Saved offline connection"))),h("button",{type:"button",disabled:busy,onClick:()=>onStart("Make the lead clearer")},"Start redraft"),h("button",{type:"button",onClick:()=>onOpenChange(false)},"Cancel")):null`,
      draftLead: `args=>window.runDraft(args)`,
      acceptedClaimsPublishState: `()=>({blockers:[],readiness:{state:"ready",reason:""}})`,
      liveClaimsOwnReadiness: `()=>false`,
      readinessWithAcceptedClaims: `readiness=>readiness`,
      readinessWithUncheckedStory: `readiness=>readiness`,
      savedStoryReadiness: `()=>null`,
      useMutation: `options=>{const [isPending,setPending]=globalThis.fixtureReact.useState(false);return {isPending,mutate:async input=>{setPending(true);try{await options.onMutate?.(input);const answer=await options.mutationFn(input);await options.onSuccess?.(answer,input);return answer;}catch(error){await options.onError?.(error,input);return undefined;}finally{setPending(false);}}};}`,
      useQueryClient: `()=>({invalidateQueries:()=>window.invalidationPromise})`,
    },
  );
  const entry = `import * as React from ${JSON.stringify(import.meta.resolve("react"))};
    import {createRoot} from ${JSON.stringify(import.meta.resolve("react-dom/client"))};
    import {Route} from ${JSON.stringify(screen)};
    import {createWarningConsentChannel,withEditorWarningAction} from "@/components/editor-warning-consent";
    import {warningPressLabel} from "@/components/editor-warning";
    globalThis.fixtureReact=React;
    const h=React.createElement;
    window.serverCalls=[];window.jobRows=[];
    window.invalidationPromise=new Promise(resolve=>{window.releaseInvalidation=resolve;});
    const channel=createWarningConsentChannel();
    window.runDraft=args=>withEditorWarningAction(override=>{
      const data={...args.data,...(override?{override}: {})};
      window.serverCalls.push(data);
      if(!data.override?.includes("writer-not-ready"))return Promise.resolve({ok:false,warning:{key:"writer-not-ready",sentence:"The saved custom connection is unreachable. If you draft anyway, the desk will use the next ready writing model."},error:"The saved custom connection is unreachable."});
      const job={id:1,leadId:data.leadId};window.jobRows.push(job);
      return Promise.resolve({ok:true,leadId:data.leadId,jobId:job.id});
    },{action:"Draft this story"},request=>channel.request(request));
    function ConsentHost(){
      const [state,setState]=React.useState(()=>channel.get());
      React.useEffect(()=>{const unsubscribe=channel.subscribe(()=>setState(channel.get()));return ()=>{unsubscribe();channel.cancelAll();};},[]);
      if(!state)return null;
      return h("div",{role:"alertdialog","aria-label":"Before you continue"},
        h("p",{role:"alert"},state.request.sentence),
        h("button",{type:"button",onClick:()=>channel.resolve(true)},warningPressLabel(state.request.action,state.request.kind,state.request.model)),
        h("button",{type:"button",onClick:()=>channel.resolve(false)},"Cancel"));
    }
    window.screenData={
      lead:{lead:{id:22,headline:"Service changes",topic:"transportation",status:"drafted",source_urls:"[]",notes_json:"{}"},draft:{id:8,headline:"Service changes",dek:"Feedback is open",body:"Residents can comment on service changes.",topic:"transportation",research_json:null},job:null,sources:[],memory:[],namedOutlets:[],outletOverrides:[],unreviewedClaimsAcceptedCount:0},
      "provider-availability":{"custom:offline":true},
      "custom-ai-connections":[{id:"offline",name:"Saved offline connection",enabled:true,modelId:"offline-model",hasApiKey:true}]
    };
    const root=createRoot(document.getElementById("root"));
    root.render(React.createElement(React.Fragment,null,
      React.createElement(Route.component,{key:"story"}),
      React.createElement(ConsentHost)));
  `;
  const bundle = await rolldown({
    cwd: root,
    input: "story-redraft-cancel-fixture",
    transform: { jsx: "react-jsx", define: { "import.meta.env": "{}", "process.env.NODE_ENV": JSON.stringify("production") } },
    plugins: [{
      name: "isolated-story-redraft-cancel",
      resolveId(id, importer) {
        if (id === "story-redraft-cancel-fixture" || id.startsWith("data:")) return id;
        if (id.startsWith("file:")) return fileURLToPath(id);
        if (id.startsWith("@/")) {
          const base = resolve(root, "src", id.slice(2));
          return extname(base) ? (existsSync(base) ? base : undefined) : [".tsx", ".ts", ".jsx", ".js"].map((ext) => base + ext).find(existsSync);
        }
        if (id.startsWith(".") && importer && !importer.startsWith("data:")) {
          const base = resolve(dirname(importer), id);
          return extname(base) ? (existsSync(base) ? base : undefined) : [".tsx", ".ts", ".jsx", ".js"].map((ext) => base + ext).find(existsSync);
        }
      },
      load(id) {
        if (id === "story-redraft-cancel-fixture") return entry;
        if (id.startsWith("data:")) return Buffer.from(id.split(",")[1], "base64").toString();
        if (id.startsWith("file:")) return readFileSync(fileURLToPath(id), "utf8");
      },
    }],
  });
  t.after(() => bundle.close());
  const { output } = await bundle.generate({ format: "iife" });
  const generatedLines = output[0].code.split("\n");
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => {
    const line = Number(error.stack?.match(/<anonymous>:(\d+):/)?.[1]);
    errors.push(`${error.stack ?? error.message}\n${generatedLines[line - 1] ?? ""}`);
  });
  await page.route("**/*", (route) => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: output[0].code });

  try {
    const redraft = page.getByRole("button", { name: "Redraft", exact: true });
    await redraft.waitFor({ timeout: 5000 }).catch(async () => assert.fail(JSON.stringify({ errors, body: await page.locator("body").innerText() })));
    await redraft.click();
    await page.getByLabel("Writing model", { exact: true }).selectOption("custom:offline");
    await page.getByRole("button", { name: "Start redraft", exact: true }).click();

    const warning = page.getByRole("alertdialog");
    await warning.waitFor({ timeout: 5000 }).catch(() => assert.fail(JSON.stringify(errors)));
    assert.match(await warning.innerText(), /saved custom connection is unreachable/i);
    assert.ok(await warning.getByRole("button", { name: /Draft.*anyway/ }).count());
    assert.equal(await page.getByRole("button", { name: "Redrafting…", exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => window.jobRows.length), 0);

    await warning.getByRole("button", { name: "Cancel", exact: true }).click();
    await redraft.waitFor({ timeout: 1500 });
    assert.equal(await redraft.isEnabled(), true);
    assert.equal(await page.getByRole("button", { name: "Redrafting…", exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.jobRows.length), 0, "Cancel created no job row");
    assert.equal(await page.evaluate(() => window.serverCalls.length), 1, "Cancel did not retry the draft request");
  } finally {
    await page.evaluate(() => window.releaseInvalidation?.()).catch(() => {});
  }
});
