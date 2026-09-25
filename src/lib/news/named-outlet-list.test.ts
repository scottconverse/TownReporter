import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { NAMED_OUTLETS, namedOutlet, unresolvedNamedOutlets } from "./outlet-credit.ts";

/*
  WHICH OUTLETS A NEWSROOM CHECKS (0.6.63, Unit P item 5).

  The named-outlet check shipped (0.6.62) against a constant list, and a
  newsroom that reads a different set of papers than the one it shipped with
  had no way to say so. The list is now a per-newsroom setting -- a nullable
  `named_outlets` column on the same paper_settings row every other shipped
  constant is overridden on -- and this file pins both halves of that:

  * the fold, which decides what counts as naming an outlet. A hyphen joins
    words into a name, so "the Longmont Times-Call reported" names it and the
    ordinary sentence "at times call the office" does not. The old fold
    flattened the hyphen to a space, and "times call" sits inside "at times
    call" as a whole run of words: a false positive that refused a story which
    named no outlet at all.

  * the gate, which has to judge the draft against THE NEWSROOM THAT IS
    PRINTING IT, and against the shipped list only when that newsroom has not
    said otherwise. This drives the real publish path (performPublish), the
    same way named-outlet-gate.test.ts does, because the desk button is a
    suggestion -- a stale tab or a scripted call routes straight past it.
*/

const GAZETTE = {
  name: "Riverside Gazette",
  aliases: ["Riverside Gazette", "the Gazette"],
  domains: ["riversidegazette.com"],
};

describe("the fold that decides whether a body names an outlet", () => {
  it("keeps a hyphen, so ordinary words around one are not a name", () => {
    assert.equal(
      unresolvedNamedOutlets({
        body: "Call the office at times call, but the meeting is Thursday.",
        sourceUrls: [],
      }).length,
      0,
      '"times call" inside "at times call" must not read as the Times-Call',
    );
    assert.deepEqual(
      unresolvedNamedOutlets({
        body: "The Longmont Times-Call reported the vote.",
        sourceUrls: [],
      }),
      ["Longmont Times-Call"],
      "the name as the outlet writes it is still a name",
    );
  });

  it("still folds a hyphen that is punctuation rather than a joiner", () => {
    assert.deepEqual(
      unresolvedNamedOutlets({
        body: "The Denver Post -- which owns the paper -- reported it, and the -Denver Post- follow-up repeated it.",
        sourceUrls: [],
      }),
      ["Denver Post"],
      "a typed dash and a hyphen at a word's edge are breaks, not parts of a name",
    );
  });

  it("matches an editor's override against the list the gate used", () => {
    const mine = [GAZETTE];
    assert.equal(namedOutlet("Riverside Gazette", mine)?.name, "Riverside Gazette");
    assert.equal(namedOutlet("the Gazette", mine)?.name, "Riverside Gazette");
    assert.equal(
      namedOutlet("Denver Post", mine),
      null,
      "an outlet this newsroom does not list cannot be overridden",
    );
    assert.equal(namedOutlet("Denver Post", NAMED_OUTLETS)?.name, "Denver Post");
  });

  it("reads an empty list as an answer and a malformed one as no answer", async () => {
    const { asNamedOutlets } = await import("./outlet-credit.ts");
    assert.deepEqual(asNamedOutlets([]), [], "an empty list is a real answer");
    assert.equal(asNamedOutlets(null), null, "nothing stored means fall back");
    assert.equal(asNamedOutlets({ name: "not a list" }), null);
    assert.equal(asNamedOutlets("{not json"), null);
    assert.deepEqual(asNamedOutlets([GAZETTE, { aliases: ["no name"] }]), [GAZETTE], "an entry with no name is dropped");
    assert.deepEqual(
      asNamedOutlets([{ name: "Riverside Gazette" }]),
      [{ name: "Riverside Gazette", aliases: ["Riverside Gazette"], domains: [] }],
      "an outlet listed by its name alone is named by that name",
    );
  });
});

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performPublish: typeof import("./desk.ts").performPublish;
let performConfirmDraftTopic: typeof import("./desk.ts").performConfirmDraftTopic;
let performNamedOutletReport: typeof import("./desk.ts").performNamedOutletReport;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performPublish, performConfirmDraftTopic, performNamedOutletReport } =
    await vite.ssrLoadModule("/src/lib/news/desk.ts"));
});

after(async () => vite.close());

/** This file's editor, one per newsroom (newsroom_members is keyed by user). */
const editor = (newsroomId: number) => `outlet-list-editor-${newsroomId}`;

/** Publish requires a confirmed section (topic-confirmation-gate.test.ts). */
async function fixture(newsroomId: number, body: string, sourceUrls: string[] = []) {
  const sql = await getSql();
  const USER = editor(newsroomId);
  await sql.query("delete from drafts where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from leads where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from newsroom_members where newsroom_id=$1", [newsroomId]);
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [
    USER,
    newsroomId,
  ]);
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Skate park opens','Why','council','new', $3,'',1,'{}') returning id",
    [USER, newsroomId, JSON.stringify(sourceUrls)],
  );
  const [draft] = await sql.query<{ id: number }>(
    "insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json) values($1,$2,$3,'Skate park opens','The park opened.', $4,'council',$5,'', '[]','news','[]','[]','{}') returning id",
    [USER, newsroomId, lead.id, body, JSON.stringify(sourceUrls)],
  );
  const confirmed = await performConfirmDraftTopic({ userId: USER, newsroomId }, lead.id);
  assert.equal(confirmed.ok, true, "fixture: the section should confirm");
  return { leadId: lead.id, draftId: draft.id };
}

/** The newsroom's own list, stored the way the settings path stores it. */
async function setOutlets(newsroomId: number, value: unknown) {
  const sql = await getSql();
  await sql.query("delete from paper_settings where newsroom_id=$1", [newsroomId]);
  if (value !== undefined) {
    await sql.query("insert into paper_settings(newsroom_id, named_outlets) values($1, $2)", [
      newsroomId,
      JSON.stringify(value),
    ]);
  }
}

describe("the gate judges the newsroom that is printing", { timeout: 60000 }, () => {
  it("checks the newsroom's own list instead of the shipped one", async () => {
    const newsroomId = 98430;
    await setOutlets(newsroomId, [GAZETTE]);
    const own = await fixture(newsroomId, "The Riverside Gazette reported the vote.");
    const refused = await performPublish({ userId: editor(newsroomId), newsroomId }, own.leadId);
    assert.equal(refused.ok, false, "an outlet this newsroom lists must block");
    assert.match("error" in refused ? refused.error : "", /Riverside Gazette/);

    // The same draft against the shipped list would have printed: the outlet
    // is not one Longmont's list knows. That is what makes this per-newsroom.
    const other = await fixture(newsroomId, "The Denver Post reported the vote.");
    const printed = await performPublish({ userId: editor(newsroomId), newsroomId }, other.leadId);
    assert.equal(
      printed.ok,
      true,
      "an outlet this newsroom does not list is not this newsroom's check to make",
    );
  });

  it("prints when the newsroom's list is empty, and falls back when it cannot be read", async () => {
    const empty = 98431;
    await setOutlets(empty, []);
    const cleared = await fixture(empty, "The Denver Post reported the vote.");
    const printed = await performPublish({ userId: editor(empty), newsroomId: empty }, cleared.leadId);
    assert.equal(printed.ok, true, "an empty list is this newsroom saying it credits no outlets");

    const shipped = 98432;
    await setOutlets(shipped, undefined);
    const fallback = await fixture(shipped, "The Denver Post reported the vote.");
    const refused = await performPublish(
      { userId: editor(shipped), newsroomId: shipped },
      fallback.leadId,
    );
    assert.equal(refused.ok, false, "a newsroom with nothing stored checks the shipped list");
    assert.match("error" in refused ? refused.error : "", /Denver Post/);

    const malformed = 98433;
    await setOutlets(malformed, { broken: true });
    const typo = await fixture(malformed, "The Denver Post reported the vote.");
    const stillRefused = await performPublish(
      { userId: editor(malformed), newsroomId: malformed },
      typo.leadId,
    );
    assert.equal(
      stillRefused.ok,
      false,
      "a malformed stored list must not quietly turn the check off",
    );
  });

  it("shows the desk the block the newsroom's own list would refuse on", async () => {
    const newsroomId = 98434;
    await setOutlets(newsroomId, [GAZETTE]);
    const { leadId } = await fixture(newsroomId, "The Gazette reported the vote.");
    const report = await performNamedOutletReport({ userId: editor(newsroomId), newsroomId }, leadId);
    assert.deepEqual(report.namedOutlets, ["Riverside Gazette"]);
  });

  it("does not refuse a story that only happens to contain the words", async () => {
    const newsroomId = 98435;
    await setOutlets(newsroomId, undefined);
    const { leadId } = await fixture(
      newsroomId,
      "Call the office at times call, and the camera at the corner was repainted.",
    );
    const published = await performPublish({ userId: editor(newsroomId), newsroomId }, leadId);
    assert.equal(
      published.ok,
      true,
      `"at times call" and "the camera" name no outlet: ${published.ok ? "" : published.error}`,
    );
  });
});
