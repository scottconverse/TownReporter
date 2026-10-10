// guards: research follow-ups could discard the editor's chosen thinking effort before the model runs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";
import { followUpModelEffort, followUpTargets } from "../src/lib/news/follow-up-copy.ts";
import { getSql } from "../src/lib/db.ts";
import { applyMigrationsToTestPglite } from "../src/lib/test-support/pglite-migrations.ts";
import { performCreateAiFollowUp, performReadFollowUp } from "../src/lib/news/follow-ups.ts";
import { performFollowUpRun } from "../src/lib/news/follow-up-agents.ts";
import { enqueueJob } from "../src/lib/news/jobs.ts";
const window = installDom(), React = await import("react");
const { createRoot } = await import("react-dom/client");
globalThis.effortReact = React;
const dialog = stubUrl(`const React=globalThis.effortReact; export const Dialog=p=>React.createElement('div',null,p.children,React.createElement('button',{onClick:p.onPrimary},p.primaryLabel)); export const ChoiceCard=()=>null;`);
const picker = stubUrl(`const React=globalThis.effortReact; export const ModelPicker=p=>p.onEffortChange?React.createElement('button',{onClick:()=>p.onEffortChange('high')},'Choose high effort'):null;`);
const { FollowUpDialog } = await import(await moduleUrl("src/components/follow-up-dialog.tsx", {
  "@/components/dialog": dialog, "@/components/model-picker": picker,
  "@/lib/news/follow-up-copy": new URL("../src/lib/news/follow-up-copy.ts", import.meta.url).href,
  "@/lib/news/follow-up-dialog-validation": new URL("../src/lib/news/follow-up-dialog-validation.ts", import.meta.url).href,
}));
test("saves the follow-up effort chosen in its dialog and runs the judge with it", async () => {
  await applyMigrationsToTestPglite();
  const context = { userId: "effort-editor", newsroomId: 89916 };
  let saved;
  const root = createRoot(document.getElementById("root"));
  await React.act(async () => root.render(React.createElement(FollowUpDialog, { leads: [], onClose() {},
    initial: { what: "Has the budget been posted?", agentKind: "search", modelChoice: "codex-balanced", targets: "https://example.org/budget" },
    onSubmit: input => { saved = performCreateAiFollowUp(context, input); } })));
  const click = async text => { const button = [...document.querySelectorAll("button")].find(node => node.textContent === text);
    assert.ok(button); await React.act(async () => button.dispatchEvent(new window.Event("click", { bubbles: true }))); };
  await click("Choose high effort");
  await click("Start follow-up");
  const created = await saved;
  assert.equal(created.ok, true);
  const row = await performReadFollowUp(context, created.id);
  assert.equal(followUpModelEffort(row.targets_json), "high");
  assert.deepEqual(followUpTargets(row.targets_json), ["https://example.org/budget"]);
  const job = await enqueueJob({ ...context, kind: "follow-up", subjectId: created.id, modelChoice: "codex-balanced", kick: false });
  let effort;
  await performFollowUpRun(job, { agents: {
    search: async () => ({ state: "ok", hits: [{ url: "https://example.org/budget", title: "Budget", snippet: "Posted" }], provider: "stub" }),
    judge: async input => { effort = input.modelEffort; return { ok: true, answers: false, url: "", title: "", summary: "" }; },
  } });
  assert.equal(effort, "high");
  const sql = await getSql(); await sql.query("delete from desk_jobs where id=$1", [job.id]);
  await React.act(async () => root.unmount());
});




