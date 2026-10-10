import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/*
  EDITOR HUMAN OVERRIDE FOR REPORTED STORIES (PR233).

  `performPublish` has, until now, refused four things an editor could not get
  past: an unconfirmed section, a stale evidence review, an unread evidence
  review, and an unreviewed claim the accept button did not cover. The one
  override that existed (`acceptUnreviewedClaims`) is bound to a single warning
  and does not generalise.

  This file drives the real `performPublish` through a real (PGlite) schema, the
  way `publish-refusals.behavior.test.ts` does, and pins the whole matrix:

    - every current warning refuses with a NEW sentence while unacknowledged;
    - acknowledging the current keys lets the story print, with exactly one
      `publish-override` audit row per acknowledged key;
    - a warning that only appears inside the publish transaction refuses even
      when the client believed it had acknowledged everything (no stale
      preflight approval);
    - the true impossibilities (empty headline, empty body after the reporter's
      notebook is stripped, missing lead, no draft, a running/queued evidence
      check) refuse even when acknowledged;
    - a held or killed lead publishes atomically once acknowledged;
    - a clean story prints with no override rows;
    - a refusal writes no audit row, no article and no status change;
    - a nonexistent submitted key is not audited;
    - publishing twice does not duplicate audit rows;
    - `performOverrideNamedOutlet` accepts an unknown named outlet too.

  No source-text pins: every assertion is about what `performPublish` did.
*/

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performPublish: typeof import("./desk.ts").performPublish;
let performOverrideNamedOutlet: typeof import("./desk.ts").performOverrideNamedOutlet;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performPublish, performOverrideNamedOutlet } =
    await vite.ssrLoadModule("/src/lib/news/desk.ts"));
});

after(async () => vite.close());

const NEWSROOM = 98441;
const USER = "publish-override-editor";

type AnyResult = { ok: true; slug: string } | { ok: false; error: string };
function refusalOf(result: AnyResult) {
  return "error" in result ? result.error : "";
}

/** What the server returned about warnings, if it returned any. */
function warningsOf(result: unknown): { key: string; sentence: string }[] | undefined {
  if (result && typeof result === "object" && "warnings" in result) {
    const warnings = (result as { warnings?: unknown }).warnings;
    if (Array.isArray(warnings)) {
      return warnings as { key: string; sentence: string }[];
    }
  }
  return undefined;
}

async function wipe() {
  const sql = await getSql();
  await sql.query("delete from meeting_article_transcript_links where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from meeting_draft_transcript_links where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from beat_memory where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from articles where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from audit_events where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from desk_jobs where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from drafts where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from leads where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from newsroom_members where newsroom_id=$1", [NEWSROOM]);
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [
    USER,
    NEWSROOM,
  ]);
}

type FixtureInput = {
  headline?: string;
  dek?: string;
  body?: string;
  topic?: string;
  status?: string;
  notes?: unknown;
  research?: unknown;
  unchecked?: boolean;
  evidenceCheckJob?: "queued" | "running" | null;
};

/**
 * One lead with one draft. Every knob is a fact a real editor could have
 * produced; the fixture writes no more than that.
 */
async function fixture(input: FixtureInput = {}) {
  const sql = await getSql();
  await wipe();
  const topic = input.topic ?? "council";
  const notes = input.notes ?? { todo: [] };
  const status = input.status ?? "new";
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json,topic_unchosen) values($1,$2,'Council approves the plan','Why',$3,$4,'[]','',1,$5,false) returning id",
    [USER, NEWSROOM, topic, status, JSON.stringify(notes)],
  );
  const headline = input.headline ?? "Council approves the plan";
  const dek = input.dek ?? "The plan passed.";
  const body = input.body ?? "The council approved the plan on Tuesday night.";
  const research = JSON.stringify(input.research ?? {});
  const [draft] = await sql.query<{ id: number }>(
    "insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json) values($1,$2,$3,$4,$5,$6,$7,'[]','','[]','news','[]','[]',$8) returning id",
    [USER, NEWSROOM, lead.id, headline, dek, body, topic, research],
  );
  if (!input.unchecked) {
    const { evidenceReviewToken } = await vite.ssrLoadModule("/src/lib/news/draft-evidence.ts");
    const { topicConfirmationFingerprint } = await vite.ssrLoadModule("/src/lib/news/notes.ts");
    const [stored] = await sql.query("select * from drafts where id=$1", [draft.id]);
    await sql.query("update drafts set research_json=$1 where id=$2", [JSON.stringify({
      ...JSON.parse(research), evidenceReviewVersion: topicConfirmationFingerprint(evidenceReviewToken(stored)),
    }), draft.id]);
  }
  if (input.evidenceCheckJob) {
    await sql.query(
      "insert into desk_jobs(newsroom_id,user_id,kind,subject_id,status) values($1,$2,'reconcile',$3,$4)",
      [NEWSROOM, USER, draft.id, input.evidenceCheckJob],
    );
  }
  return { leadId: lead.id, draftId: draft.id };
}

async function articleCount(leadId: number) {
  const sql = await getSql();
  const [row] = await sql.query<{ count: number }>(
    "select count(*)::int as count from articles where lead_id=$1",
    [leadId],
  );
  return Number(row.count);
}

async function leadStatus(leadId: number) {
  const sql = await getSql();
  const [row] = await sql.query<{ status: string }>("select status from leads where id=$1", [
    leadId,
  ]);
  return row?.status;
}

type OverrideRow = { detail: string; subject_id: number | null; user_id: string };
async function overrideRows(leadId: number): Promise<OverrideRow[]> {
  const sql = await getSql();
  return sql.query<OverrideRow>(
    "select detail, subject_id, user_id from audit_events where newsroom_id=$1 and action='override' and subject_kind='drafts' and subject_id in (select id from drafts where lead_id=$2 and newsroom_id=$1) order by id",
    [NEWSROOM, leadId],
  );
}

function keys(rows: OverrideRow[]): string[] {
  return rows.map((r) => JSON.parse(r.detail).key).sort();
}

async function draftIdOf(leadId: number) {
  const sql = await getSql();
  const [row] = await sql.query<{ id: number }>(
    "select id from drafts where lead_id=$1 order by id desc limit 1",
    [leadId],
  );
  return row.id;
}

/* ------------------------------------------------------------------------ */
/* The clean story                                                            */
/* ------------------------------------------------------------------------ */

it("prints a clean story with no override rows", async () => {
  const { leadId } = await fixture({ notes: { todo: [] } });
  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId, "council");
  assert.equal(published.ok, true, `a clean story must print: ${refusalOf(published)}`);
  assert.equal(await articleCount(leadId), 1, "the print has to reach the paper");
  assert.equal((await overrideRows(leadId)).length, 0, "a clean print writes no override rows");
});

it("publishes edited reported evidence when its stale warning is acknowledged, and audits it", async () => {
  const { leadId } = await fixture({ research: { evidenceReview: { required: true } } });
  const ctx = { userId: USER, newsroomId: NEWSROOM };
  const refused = await performPublish(ctx, leadId, "council");
  assert.equal(refused.ok, false);
  assert.deepEqual(
    warningsOf(refused)?.map((warning) => warning.key),
    ["evidence-stale"],
  );
  assert.equal(await articleCount(leadId), 0);
  assert.equal((await overrideRows(leadId)).length, 0);
  const published = await performPublish(ctx, leadId, "council", undefined, {}, ["evidence-stale"]);
  assert.equal(published.ok, true, refusalOf(published));
  assert.equal(await articleCount(leadId), 1);
  assert.deepEqual(keys(await overrideRows(leadId)), ["evidence-stale"]);
});

/* ------------------------------------------------------------------------ */
/* REFUSAL + ACKNOWLEDGED PUBLICATION, every warning key                      */
/* ------------------------------------------------------------------------ */

/**
 * A warning is proven twice: once refused while unacknowledged (carrying the
 * warning's key and leaving nothing behind), and once published with the key
 * acknowledged (carrying one audit row for that key). This is the whole point
 * of the feature, so it is the shape every warning test below takes.
 */
async function provesWarning(matrix: {
  setup: () => Promise<{ leadId: number }>;
  key: string;
  publish: (leadId: number, acknowledged: string[]) => Promise<AnyResult>;
  /** Refusal also has to carry the old plain sentence when one exists. */
  refusalMatches?: RegExp;
}) {
  const refusedRun = await matrix.setup();
  const refused = await matrix.publish(refusedRun.leadId, []);
  assert.equal(refused.ok, false, `${matrix.key}: an unacknowledged warning must refuse`);
  const warnings = warningsOf(refused);
  assert.ok(warnings, `${matrix.key}: a warning refusal must list the warnings`);
  assert.ok(
    warnings.some((w) => w.key === matrix.key),
    `${matrix.key}: the warning key must be current: ${JSON.stringify(warnings)}`,
  );
  if (matrix.refusalMatches) {
    assert.match(
      refusalOf(refused),
      matrix.refusalMatches,
      `${matrix.key}: the old sentence survives`,
    );
  }
  assert.equal(
    await articleCount(refusedRun.leadId),
    0,
    `${matrix.key}: a refusal writes no article`,
  );

  const ackRun = await matrix.setup();
  const published = await matrix.publish(ackRun.leadId, [matrix.key]);
  assert.equal(
    published.ok,
    true,
    `${matrix.key}: acknowledging the warning must print: ${refusalOf(published)}`,
  );
  assert.equal(
    await articleCount(ackRun.leadId),
    1,
    `${matrix.key}: the print must reach the paper`,
  );
  const rows = await overrideRows(ackRun.leadId);
  assert.deepEqual(keys(rows), [matrix.key], `${matrix.key}: exactly one audit row for the key`);
  const draftId = await draftIdOf(ackRun.leadId);
  assert.match(rows[0].detail, /"target":\{"kind":"drafts","id":\d+\}/, "the audit detail names the draft");
  assert.equal(rows[0].user_id, USER, "the audit row names the editor");
  const parsed = JSON.parse(rows[0].detail) as { key: string; target: { kind: string; id: number } };
  assert.equal(parsed.key, matrix.key);
  assert.deepEqual(parsed.target, { kind: "drafts", id: draftId });
}

it("refuses an empty dek, then prints it acknowledged with one audit row", async () => {
  await provesWarning({
    key: "dek",
    setup: () => fixture({ dek: "", notes: { todo: [] } }),
    publish: (leadId, acknowledged) =>
      performPublish(
        { userId: USER, newsroomId: NEWSROOM },
        leadId,
        "council",
        undefined,
        {},
        acknowledged,
      ),
    refusalMatches: /Add a dek, the one-line summary under the headline, before you publish\./,
  });
});

it("refuses an unchecked claim of absence, then prints it acknowledged", async () => {
  const gate = { t: "Claim of absence: no survey page.", done: false, src: "gate", q: "checked" };
  await provesWarning({
    key: "claims",
    setup: () => fixture({ notes: { todo: [gate] } }),
    publish: (leadId, acknowledged) =>
      performPublish(
        { userId: USER, newsroomId: NEWSROOM },
        leadId,
        "council",
        undefined,
        {},
        acknowledged,
      ),
    refusalMatches: /Confirm the claim of absence first/,
  });
});

it("refuses a section mismatch, then prints it acknowledged", async () => {
  await provesWarning({
    key: "section",
    setup: () => fixture({ notes: { todo: [] } }),
    publish: (leadId, acknowledged) =>
      performPublish(
        { userId: USER, newsroomId: NEWSROOM },
        leadId,
        "budget",
        undefined,
        {},
        acknowledged,
      ),
    refusalMatches: /and the button said/,
  });
});

it("refuses an unconfirmed section, then prints it acknowledged", async () => {
  await provesWarning({
    key: "section",
    setup: () => fixture({ notes: { todo: [] } }),
    publish: (leadId, acknowledged) =>
      performPublish(
        { userId: USER, newsroomId: NEWSROOM },
        leadId,
        undefined,
        undefined,
        {},
        acknowledged,
      ),
  });
});

it("refuses a named-uncovered outlet, then prints it acknowledged", async () => {
  await provesWarning({
    key: "outlet:Denver Post",
    setup: () => fixture({ notes: { todo: [] }, body: "The Denver Post reported the plan first." }),
    publish: (leadId, acknowledged) =>
      performPublish(
        { userId: USER, newsroomId: NEWSROOM },
        leadId,
        "council",
        undefined,
        {},
        acknowledged,
      ),
    refusalMatches: /Denver Post/,
  });
});

it("refuses an unread evidence review, then prints it acknowledged (with a working review)", async () => {
  // The unread review is only unread because the LOAD failed; once acknowledged
  // the server recomputes with a default loader (the real one) and prints.
  const setup = () => fixture({ notes: { todo: [] } });
  const failing = async (leadId: number, acknowledged: string[]) =>
    performPublish(
      { userId: USER, newsroomId: NEWSROOM },
      leadId,
      "council",
      undefined,
      {
        loadReview: async () => {
          throw new Error("database unreachable");
        },
      },
      acknowledged,
    );
  const refusedRun = await setup();
  const refused = await failing(refusedRun.leadId, []);
  assert.equal(refused.ok, false);
  assert.match(refusalOf(refused), /could not read this draft's evidence review/);
  const warnings = warningsOf(refused);
  assert.ok(warnings);
  assert.ok(
    warnings.some((w) => w.key === "evidence-loading"),
    JSON.stringify(warnings),
  );
  assert.equal(await articleCount(refusedRun.leadId), 0);

  // Acknowledged, with the review readable again, the story prints and the
  // load warning is audited once.
  const ackRun = await fixture({ notes: { todo: [] } });
  const published = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    ackRun.leadId,
    "council",
    undefined,
    {
      loadReview: async () => {
        throw new Error("database unreachable");
      },
    },
    ["evidence-loading"],
  );
  assert.equal(published.ok, true, `an acknowledged load warning prints: ${refusalOf(published)}`);
  assert.deepEqual(keys(await overrideRows(ackRun.leadId)), ["evidence-loading"]);
});

it("refuses a saved readiness memo, then prints it acknowledged (no active check)", async () => {
  const research = {
    storyReadiness: {
      version: 1,
      state: "to-check",
      openCount: 2,
      totalCount: 3,
      reason: "2 facts need checking.",
    },
  };
  await provesWarning({
    key: "readiness",
    setup: () => fixture({ notes: { todo: [] }, research }),
    publish: (leadId, acknowledged) =>
      performPublish(
        { userId: USER, newsroomId: NEWSROOM },
        leadId,
        "council",
        undefined,
        {},
        acknowledged,
      ),
  });

  // A saved readiness of "checking" is likewise a warning (not a hard
  // reconciler): it refuses unacknowledged and prints acknowledged.
  await provesWarning({
    key: "readiness",
    setup: () =>
      fixture({
        notes: { todo: [] },
        research: {
          storyReadiness: {
            version: 1,
            state: "checking",
            openCount: 0,
            totalCount: 0,
            reason: "Checking facts.",
          },
        },
      }),
    publish: (leadId, acknowledged) =>
      performPublish(
        { userId: USER, newsroomId: NEWSROOM },
        leadId,
        "council",
        undefined,
        {},
        acknowledged,
      ),
  });

  await provesWarning({
    key: "readiness",
    setup: () =>
      fixture({
        notes: { todo: [] },
        research: {
          storyReadiness: {
            version: 1,
            state: "not-ready",
            openCount: 4,
            totalCount: 5,
            reason: "4 facts need checking.",
          },
        },
      }),
    publish: (leadId, acknowledged) =>
      performPublish(
        { userId: USER, newsroomId: NEWSROOM },
        leadId,
        "council",
        undefined,
        {},
        acknowledged,
      ),
  });
});

it("refuses a stale meeting citation, then prints it acknowledged, preserving the original snapshot", async () => {
  // A draft that claims meeting evidence but has no current link: the guard's
  // missing-link case. Acknowledged, the story prints; there is no link to
  // snapshot, so no fabricated link is written and the warning is audited.
  const setup = () =>
    fixture({ notes: { todo: [] }, research: { meetingEvidence: { used: true } } });
  const refusedRun = await setup();
  const refused = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    refusedRun.leadId,
    "council",
  );
  assert.equal(refused.ok, false, "a stale meeting citation must refuse unacknowledged");
  assert.ok(
    warningsOf(refused)?.some((w) => w.key === "meeting-citation-stale"),
    JSON.stringify(warningsOf(refused)),
  );
  assert.equal(await articleCount(refusedRun.leadId), 0, "the publish must not happen");

  const ackRun = await setup();
  const published = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    ackRun.leadId,
    "council",
    undefined,
    {},
    ["meeting-citation-stale"],
  );
  assert.equal(
    published.ok,
    true,
    `an acknowledged stale citation prints: ${refusalOf(published)}`,
  );
  assert.equal(await articleCount(ackRun.leadId), 1);
  assert.deepEqual(keys(await overrideRows(ackRun.leadId)), ["meeting-citation-stale"]);
});

/* ------------------------------------------------------------------------ */
/* A warning that appears only inside the publish transaction                */
/* ------------------------------------------------------------------------ */

it("refuses a stale meeting citation the client claimed to have acknowledged by a different key", async () => {
  const { leadId } = await fixture({
    notes: { todo: [] },
    research: { meetingEvidence: { used: true } },
  });
  // The client acknowledges a stale-evidence key but NOT the in-transaction
  // meeting warning that only the publish fence can see.
  const refused = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    {},
    ["dek", "claims", "section", "readiness", "evidence-stale"],
  );
  assert.equal(
    refused.ok,
    false,
    "a stale meeting citation must refuse when not itself acknowledged",
  );
  assert.ok(
    warningsOf(refused)?.some((w) => w.key === "meeting-citation-stale"),
    JSON.stringify(warningsOf(refused)),
  );
  assert.equal(await articleCount(leadId), 0);
  assert.equal((await overrideRows(leadId)).length, 0, "a refused publish writes no audit row");
});

/* ------------------------------------------------------------------------ */
/* The true impossibilities refuse even when acknowledged                    */
/* ------------------------------------------------------------------------ */

const ALL_KEYS = [
  "headline",
  "body",
  "dek",
  "claims",
  "section",
  "readiness",
  "evidence-stale",
  "evidence-loading",
  "meeting-citation-stale",
];

it("refuses an empty headline even when acknowledged", async () => {
  const { leadId } = await fixture({ headline: "", notes: { todo: [] } });
  const refused = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    {},
    ALL_KEYS,
  );
  assert.equal(refused.ok, false, "an empty headline is a true impossibility");
  assert.equal(await articleCount(leadId), 0);
  assert.equal(await leadStatus(leadId), "new", "a hard refusal leaves the status alone");
  assert.equal((await overrideRows(leadId)).length, 0, "a hard refusal writes no audit row");
});

it("refuses an empty body after the reporter's notebook is stripped, even when acknowledged", async () => {
  /*
    The body is ONLY the paper's own backlog, so `stripReporterNotebook` cuts it
    to nothing -- and a story with no body is a true impossibility, not a
    warning, whatever the editor acknowledged. These lines match the stripper's
    own rules (a "next checks" line and a "still to pull" trailer).
  */
  const notebookOnly =
    "Next checks are: call the town clerk.\n\nStill to pull the Aug. 25 minutes.";
  const { leadId } = await fixture({ body: notebookOnly, notes: { todo: [] } });
  const refused = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    {},
    ALL_KEYS,
  );
  assert.equal(
    refused.ok,
    false,
    "a body that is only the reporter's notebook has nothing to print",
  );
  assert.equal(await articleCount(leadId), 0);
});

it("refuses a missing lead even when acknowledged", async () => {
  await wipe();
  const refused = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    999999,
    undefined,
    undefined,
    {},
    ALL_KEYS,
  );
  assert.equal(refused.ok, false, "there is no lead to print");
});

it("refuses a running evidence check even when acknowledged", async () => {
  const { leadId } = await fixture({ notes: { todo: [] }, evidenceCheckJob: "running" });
  const refused = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    {},
    ALL_KEYS,
  );
  assert.equal(refused.ok, false, "an active evidence check is a true impossibility");
  assert.equal(await articleCount(leadId), 0);
});

it("refuses a queued evidence check even when acknowledged", async () => {
  const { leadId } = await fixture({ notes: { todo: [] }, evidenceCheckJob: "queued" });
  const refused = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    {},
    ALL_KEYS,
  );
  assert.equal(refused.ok, false, "a queued evidence check is a true impossibility");
  assert.equal(await articleCount(leadId), 0);
});

/* ------------------------------------------------------------------------ */
/* Held and killed leads publish atomically                                  */
/* ------------------------------------------------------------------------ */

it("publishes a held lead once acknowledged, in one transaction, then audits the override", async () => {
  const { leadId } = await fixture({ notes: { todo: [] }, status: "held" });
  const refused = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId, "council");
  assert.equal(refused.ok, false, "a held lead must not print without acknowledgement");
  assert.ok(
    warningsOf(refused)?.some((w) => w.key === "lead-held"),
    `the held warning must be current: ${JSON.stringify(warningsOf(refused))}`,
  );
  assert.equal(await leadStatus(leadId), "held", "a refusal must not change the status");

  const published = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    {},
    ["lead-held"],
  );
  assert.equal(published.ok, true, `an acknowledged held lead prints: ${refusalOf(published)}`);
  assert.equal(await articleCount(leadId), 1, "the held lead printed");
  assert.equal(
    await leadStatus(leadId),
    "published",
    "the lead status moved to published in the same transaction",
  );
  assert.deepEqual(keys(await overrideRows(leadId)), ["lead-held"], "one held override row");
});

it("publishes a killed lead once acknowledged, in one transaction, then audits the override", async () => {
  const { leadId } = await fixture({ notes: { todo: [] }, status: "killed" });
  const refused = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId, "council");
  assert.equal(refused.ok, false, "a killed lead must not print without acknowledgement");
  assert.ok(
    warningsOf(refused)?.some((w) => w.key === "lead-killed"),
    JSON.stringify(warningsOf(refused)),
  );
  assert.equal(await leadStatus(leadId), "killed", "a refusal must not change the status");

  const published = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    {},
    ["lead-killed"],
  );
  assert.equal(published.ok, true, `an acknowledged killed lead prints: ${refusalOf(published)}`);
  assert.equal(await articleCount(leadId), 1);
  assert.equal(
    await leadStatus(leadId),
    "published",
    "the killed lead status moved to published atomically",
  );
});

/* ------------------------------------------------------------------------ */
/* Audit discipline                                                          */
/* ------------------------------------------------------------------------ */

it("does not audit a submitted key that is not a current warning", async () => {
  const { leadId } = await fixture({ notes: { todo: [] } });
  const published = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    {},
    ["some-key-nobody-has"],
  );
  assert.equal(published.ok, true, "an unknown acknowledged key does not block a clean print");
  assert.equal(
    (await overrideRows(leadId)).length,
    0,
    "a nonexistent submitted key must not be audited",
  );
});

it("writes one override audit row per acknowledged current warning, no duplicates", async () => {
  const { leadId } = await fixture({
    dek: "",
    body: "The Denver Post reported the plan first.",
    notes: { todo: [] },
  });
  const published = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    {},
    ["dek", "outlet:Denver Post"],
  );
  assert.equal(
    published.ok,
    true,
    `both warnings acknowledged should print: ${refusalOf(published)}`,
  );
  assert.deepEqual(keys(await overrideRows(leadId)), ["dek", "outlet:Denver Post"]);
});

it("does not duplicate audit rows when publishing the same lead twice", async () => {
  const { leadId } = await fixture({ dek: "", notes: { todo: [] } });
  const first = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    {},
    ["dek"],
  );
  assert.equal(first.ok, true, refusalOf(first));
  const before = (await overrideRows(leadId)).length;
  assert.equal(before, 1, "the first publish audited the dek once");
  const second = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    {},
    ["dek"],
  );
  assert.equal(second.ok, true, "a republish is idempotent");
  assert.equal(
    (await overrideRows(leadId)).length,
    before,
    "publishing twice must not duplicate override audit rows",
  );
  assert.equal(await articleCount(leadId), 1, "no second article");
});

/* ------------------------------------------------------------------------ */
/* A warning that only appears inside the publish transaction (new under fence) */
/* ------------------------------------------------------------------------ */

it("refuses a warning introduced under the fence and lets a retry acknowledged print", async () => {
  /*
    The client believed it had acknowledged everything. Between the client's
    look and the publish fence, a rewrite emptied the dek -- a WARNING the client
    never saw. The server recomputes against the LOCKED CURRENT draft, so it must
    come back with the NEW dek warning (fresh list), not a bare "draft changed"
    and not a silent print.

    `deps.loadReview` is the seam that runs inside the fence: its FIRST call
    (the one the fence makes) rewrites the draft to have an empty dek, so the
    recomputation sees the change. The retry then acknowledges `dek`.
  */
  const { leadId, draftId } = await fixture({ notes: { todo: [] } });
  let mutated = false;
  const refused = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    {
      loadReview: async () => {
        if (!mutated) {
          mutated = true;
          const sql = await getSql();
          await sql.query("update drafts set dek='' where id=$1", [draftId]);
        }
        return { rows: [], claimRows: [], manualClaimRows: [], evidenceToken: "" };
      },
    },
    [], // acknowledged nothing
  );
  assert.equal(refused.ok, false, "a warning that appeared under the fence must refuse");
  assert.ok(
    warningsOf(refused)?.some((w) => w.key === "dek"),
    `the new dek warning must be in the fresh list: ${JSON.stringify(warningsOf(refused))}`,
  );
  assert.equal(await articleCount(leadId), 0, "the refused publish wrote no article");

  // Retry, now acknowledging the dek the fence surfaced.
  const published = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    {
      loadReview: async () => ({ rows: [], claimRows: [], manualClaimRows: [], evidenceToken: "" }),
    },
    ["dek", "unchecked"],
  );
  assert.equal(published.ok, true, `the acknowledged retry prints: ${refusalOf(published)}`);
  assert.deepEqual(
    keys(await overrideRows(leadId)),
    ["dek", "unchecked"],
    "both new warnings are audited",
  );
});

/* ------------------------------------------------------------------------ */
/* Section mismatch even when a stored confirmation exists                   */
/* ------------------------------------------------------------------------ */

it("refuses a section mismatch even when the stored confirmation matches the draft", async () => {
  const { leadId } = await fixture({ notes: { todo: [] } });
  const { performConfirmDraftTopic } = await vite.ssrLoadModule("/src/lib/news/desk.ts");
  const confirmed = await performConfirmDraftTopic({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(confirmed.ok, true);
  const refused = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId, "budget");
  assert.equal(
    refused.ok,
    false,
    "a stored confirmation cannot cover a different section on the button",
  );
  assert.ok(warningsOf(refused)?.some((w) => w.key === "section"));
  const published = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "budget",
    undefined,
    {},
    ["section"],
  );
  assert.equal(published.ok, true, refusalOf(published));
  assert.deepEqual(keys(await overrideRows(leadId)), ["section"]);
});

/* ------------------------------------------------------------------------ */
/* The claims-unreviewed warning (the server's own recomputation)            */
/* ------------------------------------------------------------------------ */

it("refuses unreviewed claims from a readable review, then audits the acknowledgement", async () => {
  const { leadId } = await fixture({ notes: { todo: [] } });
  const review = {
    rows: [
      { judgment: { value: "unreviewed" }, captures: [] },
      { judgment: { value: "unreviewed" }, captures: [] },
    ] as never,
    claimRows: [],
    manualClaimRows: [],
    evidenceToken: "",
    civicReporting: true,
  };
  const refused = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    { loadReview: async () => review },
    [],
  );
  assert.equal(refused.ok, false, "unreviewed claims the accept button did not cover must refuse");
  assert.ok(
    warningsOf(refused)?.some((w) => w.key === "claims-unreviewed"),
    `claims-unreviewed must be a current warning: ${JSON.stringify(warningsOf(refused))}`,
  );
  assert.equal(await articleCount(leadId), 0);

  const published = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    { loadReview: async () => review },
    ["claims-unreviewed"],
  );
  assert.equal(published.ok, true, `the acknowledged print succeeds: ${refusalOf(published)}`);
  assert.deepEqual(keys(await overrideRows(leadId)), ["claims-unreviewed"]);
});

/* ------------------------------------------------------------------------ */
/* The claims READ FAILING is a warning, not a wall                          */
/* ------------------------------------------------------------------------ */

it("warns (evidence-loading) when the claims read fails, and prints once acknowledged", async () => {
  const { leadId } = await fixture({ notes: { todo: [] } });
  const refused = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    {
      loadReview: async () => {
        throw new Error("review store offline");
      },
    },
    [],
  );
  assert.equal(refused.ok, false, "a failed claims read must refuse unacknowledged");
  assert.ok(
    warningsOf(refused)?.some((w) => w.key === "evidence-loading"),
    `evidence-loading must be a current warning: ${JSON.stringify(warningsOf(refused))}`,
  );

  const published = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    {
      loadReview: async () => {
        throw new Error("review store offline");
      },
    },
    ["evidence-loading"],
  );
  assert.equal(published.ok, true, `an acknowledged failed read prints: ${refusalOf(published)}`);
  assert.deepEqual(keys(await overrideRows(leadId)), ["evidence-loading"]);
});

/* ------------------------------------------------------------------------ */
/* The meeting citation: the ACTUAL stale guard, not a fabricated warning    */
/* ------------------------------------------------------------------------ */

it("refuses the real stale meeting-citation guard, then audits the acknowledgement", async () => {
  /*
    The guard fires when a draft claims meeting evidence but its retained tape
    link is gone or moved -- the `loadMeetingPublishEvidence` stale path, read
    INSIDE the fence. We build that state with the meeting tables directly, the
    way the capture path would leave it: a draft research_json that says meeting
    evidence was used, and NO current `meeting_draft_transcript_links` row.
  */
  const { leadId } = await fixture({
    notes: { todo: [] },
    research: { meetingEvidence: { used: true } },
  });
  const refused = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    {},
    [],
  );
  assert.equal(refused.ok, false, "the stale meeting citation must refuse");
  assert.ok(
    warningsOf(refused)?.some((w) => w.key === "meeting-citation-stale"),
    `meeting-citation-stale must be current: ${JSON.stringify(warningsOf(refused))}`,
  );
  assert.equal(await articleCount(leadId), 0);

  const published = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    {},
    ["meeting-citation-stale"],
  );
  assert.equal(
    published.ok,
    true,
    `the acknowledged stale citation prints: ${refusalOf(published)}`,
  );
  assert.deepEqual(keys(await overrideRows(leadId)), ["meeting-citation-stale"]);
});

/* ------------------------------------------------------------------------ */
/* Named outlet override: unknown names allowed                              */
/* ------------------------------------------------------------------------ */

it("allows overriding a named outlet that is not in the known list", async () => {
  const { leadId } = await fixture({
    notes: { todo: [] },
    body: "The Tiny Mountain Gazette reported the plan first.",
  });
  const overridden = await performOverrideNamedOutlet(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "  Tiny Mountain Gazette  ",
    { override: ["named-outlet:Tiny Mountain Gazette"] },
  );
  assert.equal(overridden.ok, true, "an explicitly named unknown outlet can be overridden");
  if (overridden.ok) {
    assert.equal(overridden.outlet, "Tiny Mountain Gazette", "the trimmed input name is used");
  }
  const sql = await getSql();
  const [audit] = await sql.query<{ count: number }>(
    "select count(*)::int as count from audit_events where newsroom_id=$1 and action='override'",
    [NEWSROOM],
  );
  assert.ok(Number(audit.count) >= 1, "the outlet override is audited");
});

it("retains the original citation snapshot when an editor publishes through a revised tape", async () => {
  const { leadId, draftId } = await fixture({
    notes: { todo: [] },
    research: { meetingEvidence: { used: true } },
  });
  const sql = await getSql();
  const video = `override-tape-${leadId}`;
  await sql.query(
    "insert into meeting_capture_records(newsroom_id,video_id,channel_url,title,published,status) values($1,$2,'https://youtube.com/@city','Council','2026-10-10','captured')",
    [NEWSROOM, video],
  );
  const oldHash = "a".repeat(64);
  const [oldArtifact] = await sql.query<{ id: number }>(
    "insert into meeting_transcript_artifacts(newsroom_id,video_id,storage_path,format,sha256,source_method,retention_mode,integrity_status,captured_at) values($1,$2,'missing-old.vtt','vtt',$3,'captions','transcript-only','valid',now()-interval '1 minute') returning id",
    [NEWSROOM, video, oldHash],
  );
  await sql.query(
    "insert into meeting_transcript_segments(artifact_id,segment_index,start_seconds,end_seconds,excerpt,caption_sha256) values($1,0,0,5,'Original words',$2)",
    [oldArtifact.id, oldHash],
  );
  const snapshot = JSON.stringify([
    { artifactId: oldArtifact.id, segmentIndex: 0, captionSha256: oldHash },
  ]);
  await sql.query(
    "insert into meeting_draft_transcript_links(newsroom_id,draft_id,artifact_id,citation_snapshot,is_current) values($1,$2,$3,$4,true)",
    [NEWSROOM, draftId, oldArtifact.id, snapshot],
  );
  await sql.query(
    "insert into meeting_transcript_artifacts(newsroom_id,video_id,storage_path,format,sha256,source_method,retention_mode,integrity_status) values($1,$2,'missing-new.vtt','vtt',$3,'captions','transcript-only','valid')",
    [NEWSROOM, video, "b".repeat(64)],
  );
  const refused = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId, "council");
  assert.equal(refused.ok, false);
  assert.ok(warningsOf(refused)?.some((warning) => warning.key === "meeting-citation-stale"));
  const published = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
    undefined,
    {},
    ["meeting-citation-stale"],
  );
  assert.equal(published.ok, true, refusalOf(published));
  const [link] = await sql.query<{
    artifact_id: number;
    artifact_sha256: string;
    citation_snapshot: string;
  }>(
    "select l.* from meeting_article_transcript_links l join articles a on a.id=l.article_id where a.lead_id=$1 and l.newsroom_id=$2",
    [leadId, NEWSROOM],
  );
  assert.equal(link.artifact_id, oldArtifact.id);
  assert.equal(link.artifact_sha256, oldHash);
  assert.equal(link.citation_snapshot, snapshot);
  assert.deepEqual(keys(await overrideRows(leadId)), ["meeting-citation-stale"]);
});

it("keeps long structured override records intact and rolls them back with the transaction", async () => {
  const { leadId, draftId } = await fixture({ notes: { todo: [] } });
  const { auditPublishOverrides } = await vite.ssrLoadModule(
    "/src/lib/news/publish-override.server.ts",
  );
  const { withTransaction } = await vite.ssrLoadModule("/src/lib/db.ts");
  const key = `outlet:${'A "quoted" outlet '.repeat(50)}`;
  const input = {
    newsroomId: NEWSROOM,
    userId: USER,
    leadId,
    draftId,
    warnings: [{ key, sentence: "An extensive warning. ".repeat(100) }],
  };
  await assert.rejects(
    withTransaction(async (tx: Awaited<ReturnType<typeof getSql>>) => {
      await auditPublishOverrides(tx, input);
      throw new Error("publication failed");
    }),
    /publication failed/,
  );
  assert.equal((await overrideRows(leadId)).length, 0);
  await withTransaction((tx: Awaited<ReturnType<typeof getSql>>) =>
    auditPublishOverrides(tx, { ...input, warnings: [...input.warnings, ...input.warnings] }),
  );
  const rows = await overrideRows(leadId);
  assert.equal(rows.length, 1);
  assert.deepEqual(JSON.parse(rows[0].detail), { key, target: { kind: "drafts", id: draftId } });
  const sql = await getSql();
  const [record] = await sql.query<{
    user_id: string;
    created_at: unknown;
    subject_kind: string;
    subject_id: number;
  }>(
    "select user_id,created_at,subject_kind,subject_id from audit_events where newsroom_id=$1 and action='override'",
    [NEWSROOM],
  );
  assert.equal(record.user_id, USER);
  assert.ok(record.created_at);
  assert.equal(record.subject_kind, "drafts");
  assert.equal(record.subject_id, draftId);
});

it("unchecked is a warning: either acknowledgement or Publish anyway prints and records the editor", async () => {
  const { leadId, draftId } = await fixture({ unchecked: true });
  const context = { userId: USER, newsroomId: NEWSROOM };
  const warned = await performPublish(context, leadId, "council");
  assert.equal(warned.ok, false);
  assert.deepEqual(warningsOf(warned)?.map(w => w.key), ["unchecked"]);
  assert.equal(await articleCount(leadId), 0);
  const printed = await performPublish(context, leadId, "council", undefined, {}, ["unchecked"]);
  assert.equal(printed.ok, true, refusalOf(printed));
  const rows = await overrideRows(leadId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, USER);
  assert.deepEqual(JSON.parse(rows[0].detail), { key: "unchecked", target: {kind: "drafts", id: draftId} });
});
