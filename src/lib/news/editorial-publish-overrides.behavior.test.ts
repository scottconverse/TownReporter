import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/*
  HUMAN OVERRIDE AT PUBLISH FOR THE STANDALONE EDITORIAL.

  The reported workbench gained a general override (`performPublish`,
  `publish-overrides.behavior.test.ts`): the desk names every reason Publish is
  off, the editor reads them, and prints anyway on the record. `performPublishEditorial`
  -- the lead-less piece -- kept the older shape, where `assertOpinionEvidenceReady`
  THREW and the only way past it was to have nothing wrong. This file drives the
  real `performPublishEditorial` through a real (PGlite) schema and pins the
  same matrix for the editorial:

    - every current warning refuses, carrying the whole list `{key,sentence}` and
      naming the keys that were not acknowledged;
    - a press that acknowledged only a stale key refuses again, naming the
      current one (no stale preflight approval);
    - the true impossibilities (empty headline, empty body, missing draft)
      refuse however many keys are acknowledged;
    - a clean editorial prints with no override rows and the ordinary sentence;
    - exactly one `publish-override` audit row per acknowledged warning, keyed by
      draft and naming the editor, with the entity on the row;
    - a refusal writes no article and no audit row;
    - a retry of the same print does not duplicate override rows.

  No source-text pins: every assertion is about what `performPublishEditorial`
  did to the database.
*/

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performPublishEditorial: typeof import("./opinion.ts").performPublishEditorial;
let cleanEditorialPublishRequest: typeof import("./opinion.ts").cleanEditorialPublishRequest;
let opinionPublishWarnings: typeof import("./opinion-draft.server.ts").opinionPublishWarnings;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performPublishEditorial } = await vite.ssrLoadModule("/src/lib/news/opinion.ts"));
  ({ cleanEditorialPublishRequest } = await vite.ssrLoadModule("/src/lib/news/opinion.ts"));
  ({ opinionPublishWarnings } = await vite.ssrLoadModule("/src/lib/news/opinion-draft.server.ts"));
});

after(async () => vite.close());

let sequence = 77100;

/** A sourced claims appendix that passes `editorialSourcesError`. */
const GOOD_APPENDIX = [
  "",
  "CLAIMS AND SOURCES",
  "- The council adopted the budget. https://records.example/budget",
].join("\n");

type AnyResult = { ok: true; slug: string } | { ok: false; error: string };
function refusalOf(result: AnyResult) {
  return "error" in result ? result.error : "";
}
/** What the server returned about warnings, if it returned any. */
function warningsOf(result: unknown): { key: string; sentence: string }[] | undefined {
  if (result && typeof result === "object" && "warnings" in result) {
    const warnings = (result as { warnings?: unknown }).warnings;
    if (Array.isArray(warnings)) return warnings as { key: string; sentence: string }[];
  }
  return undefined;
}
/** The keys the server said were NOT acknowledged. */
function unacknowledgedOf(result: unknown): string[] | undefined {
  if (result && typeof result === "object" && "unacknowledged" in result) {
    const keys = (result as { unacknowledged?: unknown }).unacknowledged;
    if (Array.isArray(keys)) return keys as string[];
  }
  return undefined;
}

/**
 * A standalone editorial draft (no lead, form = 'editorial').
 *
 * `body` carries a passing claims appendix by default so the APPENDIX warning
 * is not one the fixture already raises: the default fixture raises a missing
 * dek and stale retained evidence, and each test adds or removes exactly the
 * warning it is about.
 */
async function fixture(
  opts: { dek?: string; body?: string; topic?: string; clean?: boolean } = {},
) {
  const sql = await getSql();
  const newsroomId = sequence++;
  const userId = `editorial-override-${newsroomId}`;
  await sql.query("delete from articles where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from audit_events where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from editorial_extras where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from editorial_requests where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from drafts where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from newsroom_members where newsroom_id=$1", [newsroomId]);
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [
    userId,
    newsroomId,
  ]);

  const clean = opts.clean ?? false;
  const appendix = GOOD_APPENDIX;
  const body = opts.body ?? `The council adopted the budget after a short debate.\n${appendix}`;
  // An editorial is filed with `dek: ""` (editorial.server.ts), so the default
  // fixture leaves it empty: that is the ordinary missing-dek warning.
  const dek = "dek" in opts ? (opts.dek as string) : "";
  const topic = opts.topic ?? "opinion";
  /*
    `clean: false` (the default) means the body no longer matches the retained
    evidence on the row: `evidenceNeedsReview` reads a stored review that says
    review is required, and the body has been edited since. The clean fixture is
    written the other way, so `opinionPublishWarnings` is empty.
  */
  const research = clean
    ? "{}"
    : JSON.stringify({ evidenceReview: { required: true, original: { body: "Original body." } } });
  const sourceUrls = clean ? "[]" : JSON.stringify(["https://records.example/budget"]);

  const [draft] = await sql.query<{ id: number }>(
    `insert into drafts
      (user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,found_note,unanswered,research_json,form)
      values($1,$2,null,'The council votes',$3,$4,$5,$6,'','[]','','[]',$7,'editorial') returning id`,
    [userId, newsroomId, dek, body, topic, sourceUrls, research],
  );
  return { sql, newsroomId, userId, draftId: draft.id };
}

function overrideAudits(sql: Awaited<ReturnType<typeof getSql>>, newsroomId: number) {
  return sql.query<{
    detail: string;
    user_id: string;
    created_at: string;
    subject_kind: string | null;
    subject_id: number | null;
  }>(
    "select detail, user_id, created_at, subject_kind, subject_id from audit_events where newsroom_id=$1 and action='override' order by id",
    [newsroomId],
  );
}

function publishedArticles(sql: Awaited<ReturnType<typeof getSql>>, newsroomId: number) {
  return sql.query<{ id: number; slug: string; origin_draft_id: number }>(
    "select id, slug, origin_draft_id from articles where newsroom_id=$1",
    [newsroomId],
  );
}

/** The warnings `opinionPublishWarnings` computes for the row, by key. */
async function currentWarningKeys(f: Awaited<ReturnType<typeof fixture>>): Promise<string[]> {
  const [row] = await f.sql.query<Record<string, unknown>>("select * from drafts where id=$1", [
    f.draftId,
  ]);
  return opinionPublishWarnings(row as never).map((w: { key: string }) => w.key);
}

it("refuses a warning, then prints on the acknowledged press and records one override row per warning", async () => {
  const f = await fixture();
  const ctx = { userId: f.userId, newsroomId: f.newsroomId };

  const keys = await currentWarningKeys(f);
  assert.deepEqual(
    keys.sort(),
    ["dek", "evidence-stale"],
    "fixture: exactly the two warnings under test",
  );

  const refused = await performPublishEditorial(ctx, f.draftId);
  assert.equal(refused.ok, false, "an unacknowledged warning must not print");
  assert.deepEqual(
    (warningsOf(refused) ?? []).map((w) => w.key).sort(),
    ["dek", "evidence-stale"],
    "the refusal carries EVERY current warning",
  );
  for (const w of warningsOf(refused) ?? []) {
    assert.ok(w.sentence.trim(), "each warning carries the sentence the editor acts on");
  }
  assert.deepEqual(
    (unacknowledgedOf(refused) ?? []).sort(),
    ["dek", "evidence-stale"],
    "and it says which of them were not acknowledged",
  );
  assert.match(refusalOf(refused), /dek/i, "the error names the unacknowledged keys");
  assert.equal((await publishedArticles(f.sql, f.newsroomId)).length, 0, "refusal printed nothing");
  assert.equal((await overrideAudits(f.sql, f.newsroomId)).length, 0, "and wrote no override row");

  const printed = await performPublishEditorial(ctx, f.draftId, ["dek", "evidence-stale"]);
  assert.equal(printed.ok, true, refusalOf(printed));
  assert.ok(printed.ok && printed.slug, "the override printed the piece");

  const audits = await overrideAudits(f.sql, f.newsroomId);
  assert.equal(audits.length, 2, "one override row per warning printed over");
  const parsed = audits.map(
    (a) => JSON.parse(a.detail) as { key: string; target: {kind: string; id: number} },
  );
  assert.deepEqual(
    parsed.map((p) => p.key).sort(),
    ["dek", "evidence-stale"],
    "each row names its warning key",
  );
  for (const [i, a] of audits.entries()) {
    assert.equal(a.user_id, f.userId, "the row is attributable to the editor");
    assert.ok(a.created_at, "and dated");
    assert.equal(a.subject_kind, "drafts", "the entity is the draft");
    assert.equal(a.subject_id, f.draftId);
    assert.deepEqual(parsed[i].target, { kind: "drafts", id: f.draftId }, "the detail names the exact target");
  }

  const articles = await publishedArticles(f.sql, f.newsroomId);
  assert.equal(articles.length, 1, "exactly one article printed");
  assert.equal(articles[0].origin_draft_id, f.draftId, "and it came from this draft");
});

it("refuses a press that acknowledged a key that is not current, naming the current one", async () => {
  const f = await fixture({ clean: true, dek: "The 5-2 vote funds the plan." });
  // Only the appendix warning is raised here, so nothing else drifts.
  await f.sql.query("update drafts set body=$1 where id=$2", [
    "The council adopted the budget after a short debate.\n\nCLAIMS AND SOURCES\n\nClaims appendix omitted.",
    f.draftId,
  ]);
  const ctx = { userId: f.userId, newsroomId: f.newsroomId };

  assert.deepEqual(
    await currentWarningKeys(f),
    ["editorial-sources"],
    "fixture: only the appendix warning",
  );

  const stale = await performPublishEditorial(ctx, f.draftId, ["dek"]);
  assert.equal(
    stale.ok,
    false,
    "acknowledging a key that is not current does not clear the current one",
  );
  assert.deepEqual(
    (unacknowledgedOf(stale) ?? []).sort(),
    ["editorial-sources"],
    "the current, unacknowledged warning is named",
  );

  const printed = await performPublishEditorial(ctx, f.draftId, ["editorial-sources"]);
  assert.equal(printed.ok, true, refusalOf(printed));
  const audits = await overrideAudits(f.sql, f.newsroomId);
  assert.deepEqual(
    audits.map((a) => (JSON.parse(a.detail) as { key: string }).key),
    ["editorial-sources"],
  );
});

it("refuses an empty headline or body however many keys are acknowledged", async () => {
  const f = await fixture({ clean: true, dek: "The 5-2 vote funds the plan." });
  const ctx = { userId: f.userId, newsroomId: f.newsroomId };
  const everything = ["dek", "evidence-stale", "editorial-sources", "section", "headline", "body"];

  await f.sql.query("update drafts set headline='' where id=$1", [f.draftId]);
  const noHeadline = await performPublishEditorial(ctx, f.draftId, everything);
  assert.equal(noHeadline.ok, false, "an empty headline is a true impossibility");
  assert.match(refusalOf(noHeadline), /headline/i);

  await f.sql.query("update drafts set headline='The council votes', body='' where id=$1", [
    f.draftId,
  ]);
  const noBody = await performPublishEditorial(ctx, f.draftId, everything);
  assert.equal(noBody.ok, false, "an empty body is a true impossibility");
  assert.match(refusalOf(noBody), /body|headline and a body/i);

  assert.equal((await publishedArticles(f.sql, f.newsroomId)).length, 0);
});

it("returns a clean refusal for a draft that is not there, rather than throwing", async () => {
  const f = await fixture({ clean: true });
  const ctx = { userId: f.userId, newsroomId: f.newsroomId };

  const missing = await performPublishEditorial(ctx, 9_999_999, []);
  assert.equal(missing.ok, false);
  assert.ok(refusalOf(missing).trim(), "a missing draft is refused with a sentence");
  assert.equal((await publishedArticles(f.sql, f.newsroomId)).length, 0);

  const nullId = await performPublishEditorial(ctx, null);
  assert.equal(nullId.ok, false, "a null draft id is refused cleanly too");
});

it("prints a clean editorial with no override row", async () => {
  const f = await fixture({ clean: true, dek: "The 5-2 vote funds the plan." });
  const ctx = { userId: f.userId, newsroomId: f.newsroomId };

  assert.deepEqual(await currentWarningKeys(f), [], "fixture: nothing outstanding");

  const printed = await performPublishEditorial(ctx, f.draftId);
  assert.equal(printed.ok, true, refusalOf(printed));
  assert.equal(
    (await overrideAudits(f.sql, f.newsroomId)).length,
    0,
    "an ordinary print writes no override row",
  );
  assert.equal((await publishedArticles(f.sql, f.newsroomId)).length, 1);
});

it("accepts the new object form and does not duplicate override rows on retry", async () => {
  const f = await fixture();
  const ctx = { userId: f.userId, newsroomId: f.newsroomId };

  // The RPC validator normalises both shapes into `{draftId, acknowledgedWarningKeys}`.
  assert.deepEqual(cleanEditorialPublishRequest(f.draftId), {
    draftId: f.draftId,
    acknowledgedWarningKeys: [],
  });
  const req = cleanEditorialPublishRequest({
    draftId: f.draftId,
    acknowledgedWarningKeys: ["dek"],
  });
  assert.deepEqual(req, { draftId: f.draftId, acknowledgedWarningKeys: ["dek"] });

  const printed = await performPublishEditorial(ctx, req.draftId, req.acknowledgedWarningKeys);
  assert.equal(printed.ok, false, "acknowledging only one of two current warnings must refuse");

  const printedAll = await performPublishEditorial(ctx, req.draftId, ["dek", "evidence-stale"]);
  assert.equal(printedAll.ok, true, refusalOf(printedAll));
  assert.equal((await overrideAudits(f.sql, f.newsroomId)).length, 2);

  // A retry of the same print finds the piece already on the paper and must not
  // append a second set of override rows.
  const retry = await performPublishEditorial(ctx, f.draftId, ["dek", "evidence-stale"]);
  assert.equal(retry.ok, true, "the retry resolves to the printed piece");
  assert.equal((await publishedArticles(f.sql, f.newsroomId)).length, 1, "no second article");
  assert.equal((await overrideAudits(f.sql, f.newsroomId)).length, 2, "no duplicate override rows");
});

it("names a missing section as a warning the editor can act on", () => {
  /*
    The `drafts_resolve_section` trigger (migration 0045) refuses an insert or
    a topic update with an empty or unknown section, so a stored editorial row
    cannot be made section-less through the real path. The warning rule is
    still a rule, so it is pinned at the pure function over a synthetic row.
  */
  const draft = {
    id: 1,
    lead_id: null,
    headline: "The council votes",
    dek: "The 5-2 vote funds the plan.",
    body: "The council adopted the budget.\n\nCLAIMS AND SOURCES\n- https://records.example/budget",
    topic: "",
    source_urls: "[]",
    integrity_notes: null,
    updated_at: "",
    provenance_json: "[]",
    form: "editorial",
    found_note: "",
    unanswered: "[]",
    research_json: "{}",
  };
  assert.ok(
    opinionPublishWarnings(draft as never).some((w: { key: string }) => w.key === "section"),
    "an empty section is a warning the editor can act on",
  );
  assert.deepEqual(
    opinionPublishWarnings({ ...draft, topic: "opinion" } as never),
    [],
    "a chosen section clears it",
  );
});
