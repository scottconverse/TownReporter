import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { grokChat } from "./ai.ts";
import { auditDraft, findingsWithIds, type DraftAuditResult } from "./draft-audit.ts";
import { repairInstructions } from "./draft-audit-repair.ts";
import {
  DRAFT_STYLE_TIMEOUT_MS,
  draftFromReply,
  fixDraftStyleForEditor,
  styleRepairCall,
  type DraftStyleChat,
} from "./draft-audit.server.ts";

const request = { findings: [{ paragraph: 1, sentence: 2, message: "Nobody is named." }], body: "Experts say the fee will rise." };

/** A chat that records what it was handed and answers with `text`. */
function recordingChat(text: string, ok = true) {
  const seen: Array<{ system: string; user: string; maxTokens: number | undefined; choice: unknown; timeoutMs: number | undefined }> = [];
  const chat: DraftStyleChat = async (system, user, maxTokens, choice, options) => {
    seen.push({ system, user, maxTokens, choice, timeoutMs: options?.timeoutMs });
    return ok ? { ok: true, text } : { ok: false, error: text };
  };
  return { chat, seen };
}

describe("reading a model's rewrite out of its reply", () => {
  it("takes a bare draft as it stands", () => {
    const body = "The council voted on the water fee.\n\nThe rate starts in January.";
    assert.equal(draftFromReply(body), body);
  });

  it("takes the draft out of a fenced block", () => {
    assert.equal(
      draftFromReply("```\nThe council voted on the water fee.\n```"),
      "The council voted on the water fee.",
    );
  });

  it("takes the draft out of a fenced block that names a language", () => {
    assert.equal(draftFromReply("```markdown\nThe rate starts in January.\n```"), "The rate starts in January.");
  });

  it("drops a one-line label and keeps the draft under it", () => {
    const reply = "Here is the corrected draft:\n\nThe council voted on the water fee.";
    assert.equal(draftFromReply(reply), "The council voted on the water fee.");
  });

  it("keeps a first line that only looks like a label, because a blank line is what makes it one", () => {
    const reply = "The manager put it plainly:\nThe fee rises in January.";
    assert.equal(draftFromReply(reply), reply);
  });

  it("answers empty for an empty reply", () => {
    assert.equal(draftFromReply(""), "");
    assert.equal(draftFromReply("   \n\n  "), "");
  });

  it("reads a reply that is nothing but a fenced block with no body as empty", () => {
    assert.equal(draftFromReply("```\n\n```"), "");
  });
});

describe("the repair call the loop drives", () => {
  it("asks the chat for a rewrite and hands back the text", async () => {
    const { chat, seen } = recordingChat("The council voted on the water fee.");
    const call = styleRepairCall({ chat });
    const answer = await call(request);
    assert.deepEqual(answer, { ok: true, body: "The council voted on the water fee." });
    assert.equal(seen.length, 1);
    assert.ok(seen[0]!.maxTokens && seen[0]!.maxTokens > 0);
    assert.equal(seen[0]!.timeoutMs, DRAFT_STYLE_TIMEOUT_MS);
  });

  it("sends the findings as the prompt's subject, not the whole draft as an instruction", async () => {
    const { chat, seen } = recordingChat("The council voted on the water fee.");
    await styleRepairCall({ chat })(request);
    assert.match(seen[0]!.user, /Nobody is named\./);
    assert.match(seen[0]!.user, /Experts say the fee will rise\./);
    assert.ok(seen[0]!.system.length > 0);
  });

  it("leaves the model choice to the fail-over around it", async () => {
    const { chat, seen } = recordingChat("The council voted.");
    await styleRepairCall({ chat })(request);
    assert.equal(seen[0]!.choice, undefined);
  });

  it("carries the provider's own words back when the call fails", async () => {
    const { chat } = recordingChat("The provider login has lapsed.", false);
    assert.deepEqual(await styleRepairCall({ chat })(request), {
      ok: false,
      error: "The provider login has lapsed.",
    });
  });

  it("still says something plain when a provider fails without a reason", async () => {
    const { chat } = recordingChat("", false);
    const answer = await styleRepairCall({ chat })(request);
    assert.equal(answer.ok, false);
    assert.ok(!answer.ok && answer.error.length > 0);
  });
});

/* ------------------------------------------------------------------ *
 * The tick boxes: which findings the press actually sends.
 * ------------------------------------------------------------------ */

/**
 * A draft with one problem of each kind the audit sorts by severity:
 *
 * - Paragraph 1 is clean.
 * - Paragraph 2 carries a `fix` finding ("Experts say ..." names nobody).
 * - Paragraph 3 carries a `review` finding ("Moreover," is filler used once).
 *
 * The two are the point: "Fix these with the model" sends the fix-level list on
 * its own, so a `review` finding only ever reaches the model if an editor ticks
 * it -- which is what these tests are about.
 */
const TICK_BODY = [
  "The council voted 5-2 on the water fee.",
  "Experts say the fee will rise.",
  "Moreover, the rate starts in January.",
].join("\n\n");
const TICK_HEADLINE = "Water fee rises";
const TICK_DEK = "Council members approved the increase Tuesday.";

const auditOf = (body: string): DraftAuditResult =>
  auditDraft({ headline: TICK_HEADLINE, dek: TICK_DEK, body, form: "" });

/** The id the page would send for the one finding with this code. */
function idFor(code: string, body = TICK_BODY): string {
  const row = findingsWithIds(auditOf(body)).find(({ finding }) => finding.code === code);
  assert.ok(row, `the audit must report a ${code} finding for this fixture`);
  return row.id;
}

/** The problem list the model was handed, out of the prompt's own sections. */
function problemsSent(user: string): string {
  const after = user.split("Problems the style check found:")[1] ?? "";
  return after.split("\n\nThe draft:")[0] ?? "";
}

/**
 * One saved draft on its own lead, and a chat that records what it was asked
 * and answers with the draft unchanged.
 *
 * The reply is deliberately the same text: this measures what the model was
 * TOLD, and an unchanged reply reaches the model exactly as any other reply
 * does. It keeps the fixture free of a rewrite the guard might refuse, so the
 * assertion can only be about the findings that were sent.
 */
async function savedDraft(leadId: number, body = TICK_BODY) {
  const sql = await getSql();
  await sql.query(`create table if not exists drafts (id serial primary key, newsroom_id integer, user_id text,
    lead_id integer, headline text, dek text, body text, topic text, form text default '',
    source_urls text default '[]', provenance_json text default '[]', found_note text default '',
    unanswered text default '[]', research_json text default '{}', headline_source text default 'model',
    updated_at timestamptz default now())`);
  await sql.query(`create table if not exists leads (id integer primary key, newsroom_id integer)`);
  await sql.query(`insert into leads values (${leadId}, 91) on conflict do nothing`);
  await sql.query(`insert into drafts (newsroom_id,user_id,lead_id,headline,dek,body,topic,research_json)
    values (91,'editor',${leadId},'${TICK_HEADLINE}','${TICK_DEK}','${body}','community','{}')`);
  const seen: Array<{ system: string; user: string }> = [];
  /*
    Typed as the seam itself rather than as `DraftStyleChat`: `fixDraftStyleForEditor`
    takes `typeof grokChat`, the same shape `import-stories.server.ts` injects, and
    the two differ in how the fourth argument is spelled.
  */
  const chat: typeof grokChat = async (system, user) => {
    seen.push({ system, user });
    return { ok: true, text: body };
  };
  const ctx = { userId: "editor", newsroomId: 91 };
  return { ctx, chat, seen, sql };
}

describe("the tick boxes decide what the model is asked to fix", () => {
  it("leaves a 'to read' finding out when it was never ticked", async () => {
    const { ctx, chat, seen } = await savedDraft(7101);
    await fixDraftStyleForEditor(
      ctx,
      {
        leadId: 7101,
        headline: TICK_HEADLINE,
        dek: TICK_DEK,
        body: TICK_BODY,
        topic: "community",
        findingIds: [idFor("unnamed-attribution")],
      },
      { chat },
    );
    assert.equal(seen.length, 1, "one press is one call");
    const sent = problemsSent(seen[0]!.user);
    assert.match(sent, /unnamed-attribution|asks the reader to trust somebody who is not named/);
    assert.doesNotMatch(
      sent,
      /is filler/,
      "the filler finding was not ticked, so the model must not be told about it",
    );
  });

  it("sends a 'to read' finding once the editor ticks it", async () => {
    const { ctx, chat, seen } = await savedDraft(7102);
    /*
      The control first: the desk's own list never carries this finding. Without
      that, "the model was told about the filler" would prove nothing about the
      tick -- the desk might have sent it anyway.
    */
    const deskList = repairInstructions(auditOf(TICK_BODY))
      .map((instruction) => instruction.message)
      .join("\n");
    assert.match(deskList, /asks the reader to trust somebody who is not named/);
    assert.doesNotMatch(deskList, /is filler/, "the desk's own list is fix-level only");
    await fixDraftStyleForEditor(
      ctx,
      {
        leadId: 7102,
        headline: TICK_HEADLINE,
        dek: TICK_DEK,
        body: TICK_BODY,
        topic: "community",
        findingIds: [idFor("filler")],
      },
      { chat },
    );
    const sent = problemsSent(seen[0]!.user);
    assert.match(sent, /is filler/, "the ticked 'to read' finding must reach the model");
    assert.doesNotMatch(
      sent,
      /asks the reader to trust somebody who is not named/,
      "the unticked fix-level finding must not ride along with it",
    );
  });

  it("refuses a finding id its own audit did not produce", async () => {
    const { ctx, chat, seen } = await savedDraft(7103);
    await assert.rejects(
      fixDraftStyleForEditor(
        ctx,
        {
          leadId: 7103,
          headline: TICK_HEADLINE,
          dek: TICK_DEK,
          body: TICK_BODY,
          topic: "community",
          findingIds: ["9.9.not-a-real-code#1"],
        },
        { chat },
      ),
      /not in the style check/,
    );
    assert.equal(seen.length, 0, "a refused press must not reach a provider");
  });

  it("refuses a press that names no finding at all", async () => {
    const { ctx, chat, seen } = await savedDraft(7104);
    await assert.rejects(
      fixDraftStyleForEditor(
        ctx,
        {
          leadId: 7104,
          headline: TICK_HEADLINE,
          dek: TICK_DEK,
          body: TICK_BODY,
          topic: "community",
          findingIds: [],
        },
        { chat },
      ),
      /Tick a finding/,
    );
    assert.equal(seen.length, 0);
  });
});
