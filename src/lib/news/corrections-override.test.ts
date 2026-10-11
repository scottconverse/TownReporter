import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ROUTINE_EDITION_UPDATE_PREFIX, correctionIsAutomatic } from "./correction-origin.ts";
import {
  CORRECTION_ROUTINE_PREFIX_KEY,
  CORRECTION_SHORT_KEY,
  STORY_TEXT_TOO_LONG_KEY,
  performAddCorrection,
} from "./corrections.ts";
import { LIMITS } from "./request-input.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";

/*
  Audit items 8-11 on the correction write (src/lib/news/corrections.ts).

  Three of the desk's refusals become questions the editor may answer, and one
  stays a refusal:

    8.  A correction shorter than the house floor (8 characters) asks first.
    9.  A correction whose opening line is the machine's marker asks first, and
        -- when accepted -- is stored WITHOUT the marker, so a correction a
        person wrote is never read as an automatic one (correction-origin.ts
        decides the reader's label from the row's opening words).
    10. A story fix longer than the column asks first.
    11. A fix with blank/empty story text is STILL refused: the KEEP rule says
        an empty body is not something this desk will print, override or not.

  The shape of every "asks first" answer is the shared contract
  (src/lib/news/override.ts): `{ ok: false, warning: { key, sentence } }` on the
  first call, success on the second when the key is named in `override`, and one
  audited `override` row (editor, time, key, target) after the write succeeds.

  The database is the migrated PGlite the whole suite uses; this file asks for
  the migrations itself so the same cases run under the postgres-integration
  runner too (see corrections-newsroom-boundary.test.ts).
*/
await applyMigrationsToTestPglite();

const NEWSROOM = 840_001;
const EDITOR = "corrections-override-editor";
const PRINTED_BODY = "The council approved a $4,200 fee on Tuesday.";
const NOTE = "An earlier version of this story said the fee was $4,200. In fact, it is $2,400.";

/**
 * The room, its section and one published story. Copied from the boundary
 * test: 0045's trigger refuses a topic whose section the newsroom does not
 * have, so the room is written the way the desk writes it.
 */
async function ensureRoom(sql: Awaited<ReturnType<typeof getSql>>, newsroomId: number) {
  await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict (id) do nothing", [
    newsroomId,
    `Test room ${newsroomId}`,
  ]);
  await sql.query("insert into section_config(newsroom_id) values($1) on conflict do nothing", [
    newsroomId,
  ]);
  await sql.query(
    `insert into newsroom_sections(newsroom_id,key,name,position,visible)
     values($1,'council','Council',0,true) on conflict (newsroom_id,key) do nothing`,
    [newsroomId],
  );
}

async function seedArticle(label: string) {
  const sql = await getSql();
  await ensureRoom(sql, NEWSROOM);
  const slug = `override-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [article] = await sql<{ id: number }>`
    insert into articles (newsroom_id, user_id, slug, headline, body, topic, status)
    values (${NEWSROOM}, ${EDITOR}, ${slug}, 'Own published story', ${PRINTED_BODY}, 'council', 'published')
    returning id
  `;
  return { slug, articleId: article!.id };
}

async function bodyOf(articleId: number): Promise<string> {
  const sql = await getSql();
  const [row] = await sql<{ body: string }>`
    select body from articles where id = ${articleId}
  `;
  return row!.body;
}

async function storedCorrections(articleId: number) {
  const sql = await getSql();
  return sql<{ body: string }>`
    select body from corrections where article_id = ${articleId} order by id asc
  `;
}

async function overrideRows(articleId: number) {
  const sql = await getSql();
  return sql<{
    user_id: string;
    detail: string;
    subject_kind: string | null;
    subject_id: number | null;
    created_at: string | null;
  }>`
    select user_id, detail, subject_kind, subject_id, created_at::text as created_at
    from audit_events
    where action = 'override' and subject_kind = 'articles' and subject_id = ${articleId}
    order by id asc
  `;
}

async function anyAuditRows(articleId: number) {
  const sql = await getSql();
  return sql<{ id: number }>`
    select id from audit_events where subject_id = ${articleId}
  `;
}

describe("corrections ask before the desk's old refusals, and audit the yes", () => {
  it("asks before posting a correction shorter than the floor, then posts it on the second call", async () => {
    const { slug, articleId } = await seedArticle("short");
    const short = "Oops";
    assert.ok(short.length < 8, "the case only means anything below the floor");

    const asked = await performAddCorrection(
      { userId: EDITOR, newsroomId: NEWSROOM },
      { articleSlug: slug, body: short },
    );
    assert.equal(asked.ok, false);
    assert.ok("warning" in asked, "the first call is a warning, not a refusal");
    if (asked.ok || !("warning" in asked)) throw new Error("expected a warning");
    assert.equal(asked.warning.key, CORRECTION_SHORT_KEY);
    assert.ok(asked.warning.sentence.length > 0, "the desk is given a sentence to draw");

    assert.deepEqual(await storedCorrections(articleId), [], "asking writes no correction");
    assert.deepEqual(await anyAuditRows(articleId), [], "asking records no audit row");

    const posted = await performAddCorrection(
      { userId: EDITOR, newsroomId: NEWSROOM },
      { articleSlug: slug, body: short, override: [CORRECTION_SHORT_KEY] },
    );
    assert.deepEqual(posted, { ok: true });

    const corrections = await storedCorrections(articleId);
    assert.equal(corrections.length, 1);
    assert.equal(corrections[0]!.body, short, "the editor's words are stored whole");

    const overrides = await overrideRows(articleId);
    assert.equal(overrides.length, 1, "the accepted warning is one audit row");
    assert.equal(overrides[0]!.user_id, EDITOR, "the row names the editor");
    assert.ok(overrides[0]!.created_at, "the row carries the time");
    const detail = JSON.parse(overrides[0]!.detail) as {
      key: string;
      target: { kind: string; id: number };
    };
    assert.equal(detail.key, CORRECTION_SHORT_KEY);
    assert.deepEqual(detail.target, { kind: "articles", id: articleId });
  });

  it("keeps the reader's attribution truthful when the machine's opening is accepted", async () => {
    const { slug, articleId } = await seedArticle("marker");
    const words = "The concert moved to Friday.";
    const body = `${ROUTINE_EDITION_UPDATE_PREFIX}\n\n${words}`;

    const asked = await performAddCorrection(
      { userId: EDITOR, newsroomId: NEWSROOM },
      { articleSlug: slug, body },
    );
    assert.equal(asked.ok, false);
    assert.ok("warning" in asked);
    if (asked.ok || !("warning" in asked)) throw new Error("expected a warning");
    assert.equal(asked.warning.key, CORRECTION_ROUTINE_PREFIX_KEY);
    assert.deepEqual(await storedCorrections(articleId), [], "asking writes no correction");

    const posted = await performAddCorrection(
      { userId: EDITOR, newsroomId: NEWSROOM },
      { articleSlug: slug, body, override: [CORRECTION_ROUTINE_PREFIX_KEY] },
    );
    assert.deepEqual(posted, { ok: true });

    const corrections = await storedCorrections(articleId);
    assert.equal(corrections.length, 1);
    const stored = corrections[0]!.body;
    assert.equal(
      correctionIsAutomatic(stored),
      false,
      "a correction a person wrote must not wear the machine's byline",
    );
    assert.ok(!stored.startsWith(ROUTINE_EDITION_UPDATE_PREFIX), "the marker is removed");
    assert.equal(stored, words, "the editor's own words are what is stored");

    const overrides = await overrideRows(articleId);
    assert.equal(overrides.length, 1);
    assert.equal(
      (JSON.parse(overrides[0]!.detail) as { key: string }).key,
      CORRECTION_ROUTINE_PREFIX_KEY,
    );
  });

  it("still posts a correction that merely mentions a routine update in its own words, with no warning", async () => {
    const { slug, articleId } = await seedArticle("mentions");
    const posted = await performAddCorrection(
      { userId: EDITOR, newsroomId: NEWSROOM },
      {
        articleSlug: slug,
        body: "A reader asked about the routine edition update: the concert start time was right.",
      },
    );
    assert.deepEqual(posted, { ok: true }, "the marker is the row's OPENING, not any mention");
    assert.deepEqual(
      await overrideRows(articleId),
      [],
      "no warning was triggered, so nothing is audited",
    );
  });

  it("asks before saving a story fix longer than the column, then saves it on the second call", async () => {
    const { slug, articleId } = await seedArticle("toolong");
    const tooLong = "x".repeat(LIMITS.storyText + 1);

    const asked = await performAddCorrection(
      { userId: EDITOR, newsroomId: NEWSROOM },
      { articleSlug: slug, body: NOTE, alsoFixBody: true, storyBody: tooLong },
    );
    assert.equal(asked.ok, false);
    assert.ok("warning" in asked);
    if (asked.ok || !("warning" in asked)) throw new Error("expected a warning");
    assert.equal(asked.warning.key, STORY_TEXT_TOO_LONG_KEY);
    assert.equal(await bodyOf(articleId), PRINTED_BODY, "asking changes no printed text");

    const posted = await performAddCorrection(
      { userId: EDITOR, newsroomId: NEWSROOM },
      {
        articleSlug: slug,
        body: NOTE,
        alsoFixBody: true,
        storyBody: tooLong,
        override: [STORY_TEXT_TOO_LONG_KEY],
      },
    );
    assert.deepEqual(posted, { ok: true });

    const sql = await getSql();
    const [row] = await sql<{ length: number }>`
      select length(body)::int as length from articles where id = ${articleId}
    `;
    assert.equal(row!.length, tooLong.length, "the accepted fix is saved as it was sent");
    const overrides = await overrideRows(articleId);
    assert.equal(overrides.length, 1);
    assert.equal(
      (JSON.parse(overrides[0]!.detail) as { key: string }).key,
      STORY_TEXT_TOO_LONG_KEY,
    );
  });

  it("still refuses a fix with blank story text, whatever the editor accepts", async () => {
    const { slug, articleId } = await seedArticle("blank");
    const refused = await performAddCorrection(
      { userId: EDITOR, newsroomId: NEWSROOM },
      { articleSlug: slug, body: NOTE, alsoFixBody: true, storyBody: "   " },
    );
    assert.equal(refused.ok, false);
    assert.ok(!("warning" in refused), "an empty body is a refusal, not a question");
    assert.ok("error" in refused && /cannot be blank/i.test(refused.error));

    const withEveryKey = await performAddCorrection(
      { userId: EDITOR, newsroomId: NEWSROOM },
      {
        articleSlug: slug,
        body: NOTE,
        alsoFixBody: true,
        storyBody: "   ",
        override: [CORRECTION_SHORT_KEY, CORRECTION_ROUTINE_PREFIX_KEY, STORY_TEXT_TOO_LONG_KEY],
      },
    );
    assert.equal(withEveryKey.ok, false, "the KEEP rule holds even with every key accepted");
    assert.equal(await bodyOf(articleId), PRINTED_BODY, "nothing was written");

    assert.deepEqual(await storedCorrections(articleId), [], "no note was published");
    assert.deepEqual(await overrideRows(articleId), [], "a refused write audits no override");
  });

  it("still refuses a correction against a story this newsroom does not have", async () => {
    await seedArticle("missing");
    const refused = await performAddCorrection(
      { userId: EDITOR, newsroomId: NEWSROOM },
      { articleSlug: `not-here-${Date.now()}`, body: NOTE },
    );
    assert.equal(refused.ok, false);
    assert.ok(!("warning" in refused), "a missing story is a refusal, not a question");
    assert.ok("error" in refused && /not available in this newsroom/i.test(refused.error));
  });
});
