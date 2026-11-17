import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/*
  feat-bulk-desk (Nov 16 2026): the server half of the Drafts screen's
  "Kill N selected" press and its one Undo.

  Scott's order: "I want to be able to ALSO kill stories in bulk (drafted or
  not drafted) the same way." Two things have to be true and neither can be
  proven without a database:

    1. Every lead in the list is killed, one reason is written on all of them,
       and a lead the desk refuses does not stop the rest.
    2. The one Undo puts every killed lead back where it was -- `new` stays
       new, `held` goes back on hold, and a lead the desk had drafted comes
       back `drafted` with its draft still there.

  Loaded through Vite and the real (PGlite) schema, exactly as
  `publish-all-drafts.test.ts` loads the publish loop.
*/

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performBulkKillForEditor: typeof import("./lead-lifecycle.ts").performBulkKillForEditor;
let performBulkKillUndoForEditor: typeof import("./lead-lifecycle.ts").performBulkKillUndoForEditor;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performBulkKillForEditor, performBulkKillUndoForEditor } = await vite.ssrLoadModule(
    "/src/lib/news/lead-lifecycle.ts",
  ));
});

after(async () => vite.close());

const NEWSROOM = 98472;
const USER = "bulk-kill-editor";
const context = { userId: USER, newsroomId: NEWSROOM };

let seq = 0;

async function addLead(status: "new" | "held" | "drafted", withDraft = false) {
  const sql = await getSql();
  seq += 1;
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json,topic_unchosen) values($1,$2,$3,'Why','council',$4,'[]','',1,'{}',false) returning id",
    [USER, NEWSROOM, `Bulk kill fixture ${seq}`, status],
  );
  if (withDraft) {
    await sql.query(
      "insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json) values($1,$2,$3,$4,'Dek','The council met on Tuesday.','council','[]','','[]','news','[]','[]','{}')",
      [USER, NEWSROOM, lead.id, `Bulk kill fixture ${seq}`],
    );
  }
  return lead.id;
}

async function reset() {
  const sql = await getSql();
  await sql.query("delete from drafts where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from leads where newsroom_id=$1", [NEWSROOM]);
}

async function statusOf(id: number) {
  const sql = await getSql();
  const [row] = await sql.query<{ status: string; kill_reason: string | null }>(
    "select status, kill_reason from leads where id=$1",
    [id],
  );
  return row;
}

it("kills every selected lead with the one reason, and one Undo puts them all back", async () => {
  await reset();
  const open = await addLead("new");
  const held = await addLead("held");
  const drafted = await addLead("drafted", true);

  /*
    A drafted lead (and one with a written draft) refuses with its
    written-draft warning unless the press carries the key -- the same pair of
    keys the single kill raises. The dialog's one press is that consent.
  */
  const killed = await performBulkKillForEditor(await getSql(), context, {
    ids: [open, held, drafted],
    killReason: "Not our story",
    overrideById: { [drafted]: ["lead-status-drafted"] },
  });
  assert.equal(killed.length, 3, "one answer per lead");
  assert.deepEqual(killed.map((r) => r.ok), [true, true, true], JSON.stringify(killed));

  for (const id of [open, held, drafted]) {
    const row = await statusOf(id);
    assert.equal(row?.status, "killed");
    assert.equal(row?.kill_reason, "Not our story", "the one reason is written on every lead");
  }

  const undone = await performBulkKillUndoForEditor(await getSql(), context, [open, held, drafted]);
  assert.equal(undone.length, 3);
  assert.deepEqual(undone.map((r) => r.ok), [true, true, true], JSON.stringify(undone));
  assert.equal((await statusOf(open))?.status, "new");
  assert.equal((await statusOf(held))?.status, "held");
  assert.equal((await statusOf(drafted))?.status, "drafted", "a drafted lead goes back to drafted");

  const sql = await getSql();
  const drafts = await sql.query("select id from drafts where lead_id=$1 and newsroom_id=$2", [drafted, NEWSROOM]);
  assert.equal(drafts.length, 1, "the draft is still there after the round trip");
});

it("keeps killing after a lead the desk refuses, and names it", async () => {
  await reset();
  const first = await addLead("new");
  const second = await addLead("new");

  const results = await performBulkKillForEditor(await getSql(), context, {
    ids: [2_000_000_001, first, second],
  });
  assert.equal(results.length, 3);
  assert.equal(results[0]?.ok, false);
  assert.match(results[0]?.error ?? "", /no longer on the desk/i);
  assert.equal(results[1]?.ok, true);
  assert.equal(results[2]?.ok, true);
  assert.equal((await statusOf(first))?.status, "killed");
  assert.equal((await statusOf(second))?.status, "killed");
});

it("a drafted lead without the override is refused and stays where it was", async () => {
  await reset();
  const drafted = await addLead("drafted", true);
  const results = await performBulkKillForEditor(await getSql(), context, { ids: [drafted] });
  assert.equal(results[0]?.ok, false);
  assert.equal(results[0]?.warnings?.[0]?.key, "lead-status-drafted");
  assert.equal((await statusOf(drafted))?.status, "drafted");
});
