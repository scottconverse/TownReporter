// guards: Queue's Hold dialog could move a published story or written draft to Held.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { performHoldLead } from "../src/lib/news/editor-dialog-actions.server.ts";
import { browserFixture } from "./lifecycle-browser-harness.mjs";

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
  const page = await browserFixture(t, `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {HoldLeadDialog} from './src/components/dialogs/editor-dialogs.tsx';
    import {MoreLeadMenu} from './src/components/dialogs/editor-dialog-bodies.ts';
    function Queue(){const [id,setId]=React.useState(22),[more,setMore]=React.useState(false),[open,setOpen]=React.useState(false);
      return <><select aria-label="Lead" value={id} onChange={e=>setId(Number(e.target.value))}>
        {[22,23,24,25].map(n=><option key={n}>{n}</option>)}</select>
        <button onClick={()=>setMore(true)}>More</button>{more&&<MoreLeadMenu onAction={a=>{if(a==='hold'){setOpen(true);setMore(false)}}}/>}
        <HoldLeadDialog open={open} leadId={id} onClose={()=>setOpen(false)} onDone={()=>setOpen(false)}/></>}
    createRoot(document.getElementById('root')).render(<Queue/>);`);
  await page.exposeFunction("holdRequest", data => performHoldLead({ userId: "editor", newsroomId: 7 }, data, { getSql: async () => sql, now: () => new Date() }));
  for (const id of [22, 23, 24, 25]) {
    await page.getByLabel("Lead", { exact: true }).selectOption(String(id));
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("button", { name: /Hold/ }).click();
    await page.getByRole("button", { name: "Hold, no reason", exact: true }).click();
    await page.waitForFunction(id => window.lastHold === id, id);
    assert.equal((await db.query("select status from leads where id=$1", [id])).rows[0].status, id === 25 ? "held" : "new");
    if (id !== 25) {
      await page.getByRole("alert").waitFor();
      assert.match(await page.getByRole("alert").innerText(), id === 22 ? /publish/i : /draft/i);
      await page.keyboard.press("Escape");
    } else await page.getByRole("dialog").waitFor({ state: "hidden" });
  }
  assert.deepEqual((await db.query("select status, notes_json from leads order by id")).rows.map(r => [r.status, r.notes_json !== null]),
    [["new", false], ["new", false], ["new", false], ["held", true]]);
  assert.equal((await db.query("select status from articles")).rows[0].status, "published");
});
