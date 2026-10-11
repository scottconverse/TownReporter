import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { installDom } from "./dom-harness.mjs";
import { screenModule } from "./screen-render-harness.mjs";
const screen = await screenModule(
  process.env.WALK4_ROUTE || "src/routes/desk.story.$leadId.tsx",
  {
    useQueryClient: `()=>({invalidateQueries:async()=>{}})`,
    useMutation: `options=>({isPending:false,mutate:async input=>{try{const result=await options.mutationFn(input);await options.onSuccess?.(result,input);}catch(error){globalThis.publishError=error.message;options.onError?.(error);}}})`,
    ActionButton: `({children,onAct,disabled})=>h('button',{disabled,onClick:onAct},children)`,
    PublishConfirmation: `({onConfirm})=>h('div',{},h('p',{},'This draft is killed. This press restores it and publishes it in the same press.'),h('button',{onClick:onConfirm},'Restore and publish anyway'))`,
    publishConfirmation: `()=>({enabled:true,warnings:[{key:'lead-killed',sentence:'This draft is killed.'}],hard:[],confirmLabel:'Restore and publish anyway',acknowledgedWarningKeys:['lead-killed']})`,
    saveDraft: `async()=>{globalThis.draftSaves++;throw Error('Restore this lead before changing its draft.');}`,
    publishLead: `async request=>{globalThis.publishRequests.push(request.data);return {ok:true,slug:'restored-story'};}`,
    saveReportingNotes: `async()=>({ok:true})`,
    stripReporterNotebook: `body=>body`,
    showsPublishPrep: `()=>true`,
  },
  [
    "@/lib/news/desk-drafts",
    "@/lib/news/check-gates",
    "@/lib/news/desk-copy",
    "@/lib/news/story-readiness",
    "@/components/story-readiness-chip",
  ],
);

test("walk 4: the warned publish reaches the atomic server even when cached lifecycle status is stale", async () => {
  // Another desk control killed this lead; this tab still has its earlier status.
  globalThis.screenData = {
    lead: {
      lead: {
        id: 22,
        headline: "Council votes",
        topic: "government",
        status: "drafted",
        source_urls: "[]",
      },
      draft: {
        id: 8,
        headline: "Council votes",
        dek: "A plan",
        body: "Council approved the plan.",
        topic: "government",
      },
      namedOutlets: [],
      outletOverrides: [],
    },
    sources: [],
    memory: [],
  };
  globalThis.draftSaves = 0;
  globalThis.publishRequests = [];
  globalThis.publishError = "";
  const { document, Event } = installDom();
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(h(screen.Route.component)));
    const click = async (pattern) => {
      const button = [...document.querySelectorAll("button")].find((b) =>
        pattern.test(b.textContent),
      );
      assert.ok(button, pattern.toString());
      await act(async () => button.dispatchEvent(new Event("click", { bubbles: true })));
    };
    await click(/^Publish in/);
    assert.match(
      document.body.textContent,
      /This press restores it and publishes it in the same press/,
    );
    await click(/^Restore and publish anyway$/);
    assert.equal(globalThis.publishError, "");
    assert.equal(globalThis.draftSaves, 0);
    assert.equal(globalThis.publishRequests.length, 1);
    assert.deepEqual(globalThis.publishRequests[0].acknowledgedWarningKeys, ["lead-killed"]);
    // Editing a killed draft must also travel to the atomic publish endpoint.
    await act(async () => root.render(h(screen.Route.component, { key: "edited" })));
    globalThis.publishRequests = [];
    const bodyBox = [...document.querySelectorAll("textarea")].find(box => box.value === "Council approved the plan.");
    assert.ok(bodyBox);
    const props = bodyBox[Object.keys(bodyBox).find(key => key.startsWith("__reactProps$"))];
    await act(async () => props.onChange({ target: { value: "Council approved the updated plan." } }));
    await click(/^Publish in/);
    await click(/^Restore and publish anyway$/);
    assert.equal(globalThis.publishError, "");
    assert.equal(globalThis.draftSaves, 0);
    assert.equal(globalThis.publishRequests.length, 1);
    assert.equal(globalThis.publishRequests[0].draftFields.body, "Council approved the updated plan.");
  } finally {
    await act(async () => root.unmount());
  }
});
