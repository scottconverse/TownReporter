import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";

// Walk H FG2 / DHH-4: after "Draft anyway" starts the fallback model, the story page must
// (a) refresh the jobs list the progress card reads at once, and (b) put a Stop press in the
// writer bar that stops that job. Both are read off the real Story route in a DOM.
const stubs = {
  ActionButton: `({children,disabled,onAct,phase,workingLabel})=>h("button",{disabled,onClick:onAct},phase==="working"?workingLabel:children)`,
  InkButton: `({children,onClick,disabled})=>h("button",{type:"button",onClick,disabled},children)`,
  cancelStoryJob: `args=>{globalThis.stopCalls.push(args.data.jobId);return Promise.resolve({ok:true});}`,
  draftLead: `args=>{globalThis.draftCalls.push(args.data);return Promise.resolve({ok:true,leadId:args.data.leadId,jobId:902});}`,
  saveReportingNotes: `()=>Promise.resolve({ok:true})`,
  useMutation: `options=>({isPending:false,mutate:async input=>{
    await options.onMutate?.(input);
    try { const res=await options.mutationFn(input); await options.onSuccess?.(res); }
    catch(e){ await options.onError?.(e); }
    await options.onSettled?.();
  }})`,
  useQueryClient: `()=>({invalidateQueries:(arg)=>{globalThis.invalidated.push(arg.queryKey[0]);return Promise.resolve();}})`,
  jobProgressView: `(row)=>({failoverNote:row.failover_note??""})`,
};
const real = [
  "@/lib/news/model-choice", "@/lib/news/desk-drafts", "@/lib/news/check-gates",
  "@/lib/news/desk-copy", "@/lib/news/story-readiness", "@/components/story-readiness-chip",
];

async function mountStory(job) {
  const { act } = await import("react");
  const { installDom } = await import("./dom-harness.mjs");
  const { screenModule } = await import("./screen-render-harness.mjs");
  const screen = await screenModule("src/routes/desk.story.$leadId.tsx", stubs, real);
  globalThis.stopCalls = [];
  globalThis.draftCalls = [];
  globalThis.invalidated = [];
  globalThis.screenData = {
    lead: {
      lead: { id: 22, headline: "Council votes", topic: "government", status: "new", source_urls: "[]", notes_json: "{}" },
      draft: null,
      job,
      namedOutlets: [],
      outletOverrides: [],
    },
    "custom-ai-connections": [], "provider-availability": {}, sources: [], memory: [],
  };
  const { document } = installDom();
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(createElement(screen.Route.component)));
  const press = (name) =>
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === name);
  return { act, root, document, press };
}

test("pressing Draft refreshes the desk-jobs list so the Cancel card appears now, not on the 30 s poll", async () => {
  const { act, root, press } = await mountStory(null);
  try {
    const draft = press("Draft with AI");
    assert.ok(draft, "the writer bar offers Draft with AI");
    await act(async () => draft.click());
    assert.equal(globalThis.draftCalls.length, 1, "the press queued one draft");
    assert.ok(
      globalThis.invalidated.includes("desk-jobs"),
      `the jobs list the progress card reads was refreshed (refreshed: ${globalThis.invalidated.join(", ")})`,
    );
  } finally { await act(async () => root.unmount()); }
});

test("while the fallback model is writing, the writer bar has a Stop press that stops that job", async () => {
  const job = {
    id: 901, kind: "draft", subject_id: 22, model_choice: "deepseek-flash", model_choice_source: "editor",
    status: "running", updated_at: new Date().toISOString(), finished_at: null, step_text: "Writing the draft…",
    failover_note: "This draft moved to DeepSeek v4.1 Flash because Connections could not be read",
    result_json: JSON.stringify({ requestedRuntime: "gemini-key" }),
  };
  const { act, root, press } = await mountStory(job);
  try {
    // the existing words stay: which model writes and why
    const stop = press("Stop");
    assert.ok(stop, "a Stop press is in the writer bar while the job runs");
    await act(async () => stop.click());
    assert.deepEqual(globalThis.stopCalls, [901], "Stop cancels the running draft job");
  } finally { await act(async () => root.unmount()); }
});
