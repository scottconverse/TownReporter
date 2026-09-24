import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/*
  A story that names another newsroom's reporting has to show the reader where
  that reporting is. The Sources list is the only place it can: a reader who
  wants to check "the Denver Post reported" either finds it there or has to
  take the paper's word for it.

  These drive the real publish path. There is a desk button for the override,
  and a disabled button is a suggestion -- a stale tab, a second window or a
  scripted call routes straight past it, which is the same reason the
  claims-of-absence gate lives on the server (see notes.ts).

  Printing also requires a confirmed section (topic-confirmation-gate.test.ts),
  so every fixture here takes that step; a fixture that could not confirm would
  mean the section gate broke, hence the assertion.
*/

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performPublish: typeof import("./desk.ts").performPublish;
let performConfirmDraftTopic: typeof import("./desk.ts").performConfirmDraftTopic;
let performOverrideNamedOutlet: typeof import("./desk.ts").performOverrideNamedOutlet;
let performNamedOutletReport: typeof import("./desk.ts").performNamedOutletReport;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performPublish, performConfirmDraftTopic, performOverrideNamedOutlet, performNamedOutletReport } =
    await vite.ssrLoadModule("/src/lib/news/desk.ts"));
});

after(async () => vite.close());

const NEWSROOM = 98421;
const USER = "outlet-check-editor";

async function fixture(
  body: string,
  sourceUrls: string[] = [],
  provenance: unknown[] = [],
) {
  const sql = await getSql();
  await sql.query("delete from articles where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from audit_events where newsroom_id=$1", [NEWSROOM]);
  /*
    named_outlet_overrides is not cleared here: it is append-only by trigger
    (migrations/0086), and the rows a previous test recorded cannot reach this
    one -- an override is scoped to a draft id, and every fixture inserts a
    fresh draft. Deleting them would be the one thing the table exists to stop.
  */
  await sql.query("delete from drafts where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from leads where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from newsroom_members where newsroom_id=$1", [NEWSROOM]);
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [
    USER,
    NEWSROOM,
  ]);
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Skate park opens','Why','council','new','[]','',1,'{}') returning id",
    [USER, NEWSROOM],
  );
  const [draft] = await sql.query<{ id: number }>(
    "insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json) values($1,$2,$3,'Skate park opens','The park opened.','The park opened Saturday.','council','[]','', $4,'news','[]','[]','{}') returning id",
    [USER, NEWSROOM, lead.id, JSON.stringify(provenance)],
  );
  await sql.query("update drafts set body=$1, source_urls=$2 where id=$3", [
    body,
    JSON.stringify(sourceUrls),
    draft.id,
  ]);
  const confirmed = await performConfirmDraftTopic({ userId: USER, newsroomId: NEWSROOM }, lead.id);
  assert.equal(confirmed.ok, true, "fixture: the section should confirm");
  return { leadId: lead.id, draftId: draft.id };
}

async function override(leadId: number, outlet: string) {
  return performOverrideNamedOutlet({ userId: USER, newsroomId: NEWSROOM }, leadId, outlet);
}

it("refuses to print a draft that names an outlet which is not in its Sources", async () => {
  const { leadId } = await fixture(
    "The city approved the skate park after *the Denver Post* reported that the grant was in doubt.",
  );
  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(published.ok, false, "a named, uncovered outlet must not print");
  assert.match(
    "error" in published ? published.error : "",
    /Denver Post/,
    "the refusal must name the outlet the editor has to deal with",
  );
  const sql = await getSql();
  const [{ count }] = await sql.query<{ count: number }>(
    "select count(*)::int as count from articles where lead_id=$1",
    [leadId],
  );
  assert.equal(Number(count), 0, "a refused publish must not leave an article behind");
});

it("records an editor's override for one outlet, and prints once it is recorded", async () => {
  const { leadId, draftId } = await fixture(
    "The LPM board changed its schedule, the Longmont Leader reported, and the city confirmed it.",
  );
  const recorded = await override(leadId, "Longmont Leader");
  assert.equal(recorded.ok, true);
  const sql = await getSql();
  const [row] = await sql.query<{
    outlet: string;
    draft_id: number;
    lead_id: number;
    overridden_by: string;
    overridden_at: string;
  }>(
    "select outlet,draft_id,lead_id,overridden_by,overridden_at from named_outlet_overrides where newsroom_id=$1",
    [NEWSROOM],
  );
  assert.equal(row.outlet, "Longmont Leader", "the record must name the outlet");
  assert.equal(Number(row.draft_id), draftId, "the record must name the draft");
  assert.equal(Number(row.lead_id), leadId);
  assert.equal(row.overridden_by, USER, "the record must name the editor");
  assert.ok(row.overridden_at, "the record must carry a time");

  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(published.ok, true, "a recorded override clears that outlet");
});

it("prints when the outlet is in the Sources, and blocks only the outlet that is not", async () => {
  const covered = await fixture(
    "The Longmont Times-Call reported the vote, and the Colorado Sun followed with the budget detail.",
    [
      "https://www.timescall.com/2026/09/20/skate-park-vote/",
      "https://coloradosun.com/2026/09/21/skate-park-costs/",
    ],
    [
      {
        title: "Colorado Sun: what the skate park vote costs",
        url: "https://coloradosun.com/2026/09/21/skate-park-costs/",
      },
    ],
  );
  const printed = await performPublish({ userId: USER, newsroomId: NEWSROOM }, covered.leadId);
  assert.equal(
    printed.ok,
    true,
    `an outlet cited by URL (Times-Call) or by the title of its source (Colorado Sun) is covered: ${
      printed.ok ? "" : printed.error
    }`,
  );

  // Same sources, one more outlet named that they do not cover: the check must
  // judge each outlet on its own, and the refusal must not name the covered one.
  const partial = await fixture(
    "The Longmont Times-Call reported the vote. Yellow Scene reported the design.",
    ["https://www.timescall.com/2026/09/20/skate-park-vote/"],
  );
  const refused = await performPublish({ userId: USER, newsroomId: NEWSROOM }, partial.leadId);
  assert.equal(refused.ok, false, "the uncovered outlet must block");
  assert.match("error" in refused ? refused.error : "", /Yellow Scene/);
  assert.doesNotMatch("error" in refused ? refused.error : "", /Times-Call/);
});

it("does not mistake ordinary words for an outlet name", async () => {
  const { leadId } = await fixture(
    "The camera at the intersection is new, the council said, and 5 * 3 parking spaces were repainted.",
  );
  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(
    published.ok,
    true,
    '"the camera" is not "the Daily Camera", and an asterisk is not an emphasis mark here',
  );

  // The guard above only means something if the real name still matches: the
  // same words with the outlet in front of them are a claim about an outlet.
  const named = await fixture("The Boulder Daily Camera reported the repaving cost.");
  const refused = await performPublish({ userId: USER, newsroomId: NEWSROOM }, named.leadId);
  assert.equal(refused.ok, false, "the outlet's own name must still be caught");
  assert.match("error" in refused ? refused.error : "", /Boulder Daily Camera/);
});

it("shows the editor the block the server would refuse on, and the record it leaves", async () => {
  const { leadId } = await fixture("The Denver Post reported the grant was in doubt.");
  const before = await performNamedOutletReport({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.deepEqual(
    before.namedOutlets,
    ["Denver Post"],
    "the desk has to name the outlet the editor must deal with, or the refusal is a dead end",
  );
  assert.deepEqual(before.overrides, [], "no decision has been recorded yet");

  await override(leadId, "Denver Post");
  const after = await performNamedOutletReport({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.deepEqual(after.namedOutlets, [], "a recorded override clears the block on the desk too");
  assert.equal(after.overrides.length, 1);
  assert.equal(after.overrides[0].outlet, "Denver Post");
  assert.equal(after.overrides[0].overridden_by, USER);
  assert.ok(after.overrides[0].overridden_at, "the desk shows who decided, and when");
});

it("clears only the outlet that was overridden", async () => {
  const { leadId } = await fixture(
    "The Denver Post reported the grant, and Yellow Scene reported the design.",
  );
  await override(leadId, "Denver Post");
  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(published.ok, false, "one override must not clear a second outlet");
  assert.match("error" in published ? published.error : "", /Yellow Scene/);
  assert.doesNotMatch("error" in published ? published.error : "", /Denver Post/);
});
