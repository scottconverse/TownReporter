// guards: Queue's Hold dialog could move a published story or written draft to Held.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { performHoldLead } from "../src/lib/news/editor-dialog-actions.server.ts";
import { installDom, moduleUrl, transpileToUrl } from "./dom-harness.mjs";

const window = installDom();
// Radix focus locking needs these DOM interfaces in addition to the shared shim.
for (const key of ["MutationObserver", "HTMLInputElement", "HTMLSelectElement"]) globalThis[key] = window[key];
globalThis.NodeFilter = { FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3, SHOW_ELEMENT: 1 };
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const stub = body => transpileToUrl(body, "stub.tsx");
const chrome = stub(`import React from "react"; export const InkButton=({children,onClick,disabled})=><button onClick={onClick} disabled={disabled}>{children}</button>;`);
const bodies = await moduleUrl("src/components/dialogs/editor-dialog-bodies.ts");
let holdRequest;
globalThis.lifecycleHoldRequest = data => holdRequest(data);
// Only transport and unrelated controls are doubled; Hold's shell, body and server action run.
const { HoldLeadDialog } = await import(await moduleUrl("src/components/dialogs/editor-dialogs.tsx", {
  "@/components/dialog": await moduleUrl("src/components/dialog.tsx", { "./desk-chrome": chrome }),
  "@/components/model-picker": stub("export const ModelPicker=()=>null;"),
  "@/components/desk-chrome": chrome,
  "@/components/desk-chrome-utils": stub("export const announceToDesk=()=>{};"),
  "@/lib/news/dialog-press": await moduleUrl("src/lib/news/dialog-press.ts"),
  "@/lib/news/dark": stub("export const openDarkInvestigation=()=>{};"),
  "@/lib/news/desk": stub("export const addSource=()=>{},addSourcesBulk=()=>{},fileLead=()=>{},findPasteDuplicate=()=>{},listSources=()=>{},saveDraft=()=>{},suggestHeadlines=()=>{},writeStoryFromInput=()=>{};"),
  "@/lib/news/draft-reconcile-actions": stub("export const requestDraftReconciliationFn=()=>{};"),
  "@/lib/news/editor-dialog-actions": stub("export const holdLead=({data})=>globalThis.lifecycleHoldRequest(data); export const addLead=()=>{},chooseHeadline=()=>{},findSources=()=>{},sourceKillPattern=()=>{},weaveIntoStory=()=>{};"),
  "@/lib/news/editor-dialog-logic": await moduleUrl("src/lib/news/editor-dialog-logic.ts"),
  "@/lib/news/story-document-api": stub("export const uploadStoryDocument=()=>{};"),
  "@/lib/news/story-document-text": await moduleUrl("src/lib/news/story-document-text.ts"),
  "@/lib/use-sections": stub("export const useEditorSections=()=>({sections:[]});"),
  "@/lib/news/url-guard": await moduleUrl("src/lib/news/url-guard.ts"),
  "./editor-dialog-bodies": bodies,
  "./editor-dialog-forms": await moduleUrl("src/components/dialogs/editor-dialog-forms.ts"),
}));
const { MoreLeadMenu } = await import(bodies);

test("Queue Hold refuses published stories and written drafts but allows empty placeholders", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create table leads(id int, newsroom_id int, status text, headline text, notes_json text);
    create table drafts(lead_id int, newsroom_id int, body text, research_json text);
    create table articles(lead_id int, newsroom_id int, status text);
    insert into leads values (22,7,'new','Published story',null),(23,7,'new','Written draft',null),
      (24,7,'new','Imported story',null),(25,7,'new','Placeholder',null);
    insert into articles values (22,7,'published');
    insert into drafts values (22,7,'Published prose','{}'),(23,7,'Written prose','{}'),
      (24,7,'','{"importedText":true}'),(25,7,E' \\t\\n','{}');`);
  const sql = async (parts, ...values) => (await db.query(parts.reduce((s, p, i) => s + (i ? `$${i}` : "") + p, ""), values)).rows;
  holdRequest = data => performHoldLead({ userId: "editor", newsroomId: 7 }, data, { getSql: async () => sql, now: () => new Date() });
  function Queue({ id }) {
    const [more, setMore] = React.useState(false), [open, setOpen] = React.useState(false);
    return React.createElement(React.Fragment, null,
      React.createElement("button", { onClick: () => setMore(true) }, "More"),
      more && React.createElement(MoreLeadMenu, { onAction: action => { if (action === "hold") { setOpen(true); setMore(false); } } }),
      React.createElement(HoldLeadDialog, { open, leadId: id, onClose: () => setOpen(false), onDone: () => setOpen(false) }));
  }
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(async () => root.unmount()); delete globalThis.lifecycleHoldRequest; });
  const click = async name => {
    const button = [...document.querySelectorAll("button")].find(node => name.test(node.textContent));
    assert.ok(button, "the editor can reach " + name);
    await React.act(async () => button.dispatchEvent(new window.Event("click", { bubbles: true })));
  };
  for (const id of [22, 23, 24, 25]) {
    await React.act(async () => root.render(React.createElement(Queue, { id, key: id })));
    await click(/^More$/);
    await click(/Hold/);
    await click(/^Hold, no reason$/);
    assert.equal((await db.query("select status from leads where id=$1", [id])).rows[0].status, id === 25 ? "held" : "new");
    if (id !== 25) {
      assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", id === 22 ? /publish/i : /draft/i);
      await click(/^Cancel$/);
    } else assert.equal(document.querySelector('[role="dialog"]'), null);
  }
  assert.deepEqual((await db.query("select status, notes_json from leads order by id")).rows.map(r => [r.status, r.notes_json !== null]),
    [["new", false], ["new", false], ["new", false], ["held", true]]);
  assert.equal((await db.query("select status from articles")).rows[0].status, "published");
});
