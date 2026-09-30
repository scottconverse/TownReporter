import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "pg";
import {
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  withDatabase,
} from "../test-support/pg-admin.ts";

/*
  migrations/0108_welcome_article_copy.sql, on a real PostgreSQL.

  WHY THIS IS NOT A PGLITE TEST. The file is a data migration whose whole
  promise is that it rewrites sentences an install already has and leaves
  everything else alone -- including, crucially, `published_at` and an owner's
  own edits. PGlite would run the same SQL, but this is the one migration in
  the unit that touches persisted reader-facing text, and the deploy path
  (`scripts/migrate.mjs`, node-postgres) is the thing that has to survive it.
  The suite's convention for that is a `*.postgres.test.ts` beside the other
  integration proofs, run by `scripts/run-postgres-integration.mjs`.

  WHAT IT PROVES, in the order the cases below run:

    1. A row still holding migrations/0002_newsroom.sql's text -- read out of
       that file rather than retyped, so it cannot drift -- loses the four
       sentences the unit named and keeps the sentence the owner wrote.
    2. A second application of the file changes nothing at all: the row's
       whole `to_jsonb` is compared, not just the two columns it edits.
    3. A row holding the text an install ACTUALLY has (written by
       0009_reporting.sql and amended by 0040) is corrected too. The unit's
       brief named the 0002 text; no live database holds it, so this case is
       the one with a real effect. See the migration's own header.
    4. A row an owner rewrote from scratch is not touched, sentence or date.

  Every case re-seeds the row before it runs, so the cases do not depend on
  each other's order. `published_at`, `headline`, `status` and the absence of
  a `corrections` row are asserted in each: the migration corrects copy that
  was never true on this install, and re-dating the article or filing a
  correction for it would say something happened that did not.
*/

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : { ok: false as const, reason: "set TEST_POSTGRES_ADMIN_URL; CI runs this proof" };
const skip = probe.ok ? false : probe.reason;

const MIGRATION_108 = "0108_welcome_article_copy.sql";
const WELCOME_SLUG = "welcome-to-townreporter";
const dbName = `townreporter_welcome_copy_${process.pid}_${Date.now()}`;

/** The template's clauses, as they stand in src/lib/news/welcome-article.ts. */
const TEMPLATE_DEK_CLAUSE =
  "prints a reported story only when an editor signs it; owner-activated routine notices are the one exception";
const TEMPLATE_EXCEPTION =
  "The one exception is the routine notices the owner may separately activate -- approved library, recreation, community-event, registration, waste-collection and public-meeting notices, printed from fixed templates and approved sources.";

let client: Client;
let created = false;

/** Every migration below 0108, in apply order, as node-postgres would send them. */
function migrationsBefore108(): string[] {
  return readdirSync(resolve(process.cwd(), "migrations"))
    .filter((value) => /^\d+.*\.sql$/.test(value) && value !== MIGRATION_108)
    .sort();
}

/**
 * The 0002 seed's own dek and body, read out of the file. A retyped copy of
 * this text is a copy that can drift from the migration it claims to be.
 */
function seed0002(): { dek: string; body: string } {
  const sql = readFileSync(resolve(process.cwd(), "migrations", "0002_newsroom.sql"), "utf8");
  const dek = /'TownReporter watches official records[^']*'/.exec(sql)?.[0];
  const body = /\$welcome\$([\s\S]*?)\$welcome\$/.exec(sql)?.[1];
  assert.ok(dek, "0002_newsroom.sql no longer seeds the welcome article the way this test reads it");
  assert.ok(body, "0002_newsroom.sql no longer seeds the welcome article the way this test reads it");
  return { dek: dek.slice(1, -1), body };
}

type Row = {
  headline: string;
  dek: string;
  body: string;
  status: string;
  published_at: string;
  row: unknown;
};

async function readRow(): Promise<Row> {
  const { rows } = await client.query<Row>(
    `select headline, dek, body, status, published_at::text as published_at, to_jsonb(articles) as row
     from articles where slug = $1`,
    [WELCOME_SLUG],
  );
  assert.equal(rows.length, 1, "the welcome article must exist for this proof to mean anything");
  return rows[0]!;
}

/** Put the row into a known state without touching the columns the migration must not. */
async function seed(dek: string, body: string): Promise<void> {
  await client.query("update articles set dek = $1, body = $2 where slug = $3", [
    dek,
    body,
    WELCOME_SLUG,
  ]);
}

async function apply108(): Promise<void> {
  // The whole file at once, exactly as scripts/migrate.mjs sends it.
  await client.query(readFileSync(resolve(process.cwd(), "migrations", MIGRATION_108), "utf8"));
}

async function correctionCount(): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    "select count(*)::int as n from corrections c join articles a on a.id = c.article_id where a.slug = $1",
    [WELCOME_SLUG],
  );
  return rows[0]!.n;
}

let live: { dek: string; body: string };

if (probe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`create database ${dbName}`);
      created = true;
    } finally {
      await admin.end();
    }
    client = new Client({ connectionString: withDatabase(adminUrl, dbName) });
    await client.connect();
    for (const name of migrationsBefore108()) {
      await client.query(readFileSync(resolve(process.cwd(), "migrations", name), "utf8"));
    }
    // What an install that ran every migration but this one actually holds --
    // captured before any case rewrites the row.
    const row = await readRow();
    live = { dek: row.dek, body: row.body };
  });
  after(async () => {
    await client?.end();
    if (!created) return;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1", [dbName]);
      await admin.query(`drop database ${dbName}`);
    } finally {
      await admin.end();
    }
  });
}

test("the 0002 seed's sentences are rewritten and the owner's sentence is kept", { skip, timeout: 30_000 }, async () => {
  const { dek, body } = seed0002();
  const OWNERS_SENTENCE = "Reporting notes for our own readers stay right here.";
  await seed(dek, `${body}\n\n${OWNERS_SENTENCE}`);
  const before = await readRow();

  await apply108();
  const after1 = await readRow();

  assert.ok(
    !after1.dek.includes("and publishes only what an editor signs."),
    "the dek must no longer claim the paper publishes only what an editor signs",
  );
  assert.ok(
    after1.dek.includes(TEMPLATE_DEK_CLAUSE),
    `the dek must carry the template's clause, got: ${after1.dek}`,
  );
  assert.ok(!after1.body.includes("Grok"), "no sentence may still name a model vendor");
  assert.ok(
    !after1.body.includes("Nothing on this masthead goes live because a model felt confident."),
    "the body's overclaim must be gone",
  );
  assert.ok(
    after1.body.includes("Nothing reported goes live because a model felt confident."),
    "the body must carry the template's replacement sentence",
  );
  assert.ok(after1.body.includes(TEMPLATE_EXCEPTION), "and the template's exception sentence with it");
  assert.ok(
    after1.body.includes("points its writing model at official sources"),
    "the desk paragraph must name the paper's own model",
  );
  assert.ok(after1.body.includes("On Scan, the desk fetches"), "and so must the scan paragraph");
  assert.ok(after1.body.includes(OWNERS_SENTENCE), "an owner's own sentence must survive untouched");
  assert.equal(after1.headline, before.headline, "the headline is not this migration's business");
  assert.equal(after1.status, before.status, "nor is the status");
  assert.equal(after1.published_at, before.published_at, "nor is when the article was published");
  assert.equal(await correctionCount(), 0, "this is not a correction of a report; it files no correction row");

  // Case 2: the second application.
  await apply108();
  const after2 = await readRow();
  assert.deepEqual(after2.row, after1.row, "a replayed 0108 must change nothing at all");
});

test("the text an existing install actually holds is corrected too", { skip, timeout: 30_000 }, async () => {
  await seed(live.dek, live.body);
  const before = await readRow();
  assert.ok(
    before.body.includes("A human editor still decides what publishes."),
    "fixture check: the live row holds the sentence routine notices made false",
  );
  assert.ok(!before.body.includes(TEMPLATE_EXCEPTION), "fixture check: and not the exception yet");

  await apply108();
  const after1 = await readRow();

  assert.ok(
    !after1.body.includes("A human editor still decides what publishes."),
    "the live overclaim must be gone",
  );
  assert.ok(
    after1.body.includes("Nothing reported goes live because a model felt confident."),
    "replaced by the template's sentence",
  );
  assert.ok(after1.body.includes(TEMPLATE_EXCEPTION), "and the template's exception sentence");
  assert.ok(after1.dek.includes(TEMPLATE_DEK_CLAUSE), `the dek must carry the gate clause, got: ${after1.dek}`);
  assert.ok(
    after1.body.includes("Free to reprint in whole or part with credit to TownReporter"),
    "the rest of the body is left as it was",
  );
  assert.equal(after1.headline, before.headline);
  assert.equal(after1.published_at, before.published_at, "the publication date is not re-dated");
  assert.equal(await correctionCount(), 0);

  await apply108();
  const after2 = await readRow();
  assert.deepEqual(after2.row, after1.row, "a replayed 0108 must change nothing at all");
});

test("the text writeWelcomeArticle itself wrote before ENG-4 part 1 is corrected too", { skip, timeout: 30_000 }, async () => {
  /*
    The shape an owner who completed first-run setup before commit 0922f74f
    (2026-09-30) actually has: `writeWelcomeArticle`'s own output, city filled
    in, and the same two claims the 0002 seed made, in the same words. The
    sentences the migration looks for are here; the sentences it must NOT
    touch are here too -- this body names no vendor and says "the model", not
    "Grok", and it has always said so. Only the two paragraphs the migration
    can reach are reproduced; nothing in the file can match the rest.
  */
  const SETUP_DEK =
    "TownReporter watches official records, drafts under wire-service rules, and publishes only what an editor signs.";
  const SETUP_BODY = `TownReporter is a small non-profit newspaper for Longmont, Colorado. It is not a newsletter mill and it is not an autonomous news robot.

The public site is the paper: headlines, recaps, corrections, and a permanent record of what we chose to print. Behind it sits a desk. An editor-in-chief signs in, points its writing model at official sources, reviews every draft, and hits publish. Nothing on this masthead goes live because a model felt confident.

How a story gets here
The editor keeps a source list. On Scan, the model fetches those pages, compares them to the last snapshot, and files leads. On Draft, it writes a recap with attributed claims and named sources.`;
  await seed(SETUP_DEK, SETUP_BODY);
  const before = await readRow();

  await apply108();
  const after1 = await readRow();

  assert.ok(
    !after1.dek.includes("and publishes only what an editor signs."),
    "the setup-written dek carries the same claim as the seed and must be corrected",
  );
  assert.ok(after1.dek.includes(TEMPLATE_DEK_CLAUSE), `got: ${after1.dek}`);
  assert.ok(
    !after1.body.includes("Nothing on this masthead goes live because a model felt confident."),
    "and so must its body",
  );
  assert.ok(after1.body.includes(TEMPLATE_EXCEPTION), "with the template's exception sentence");
  assert.ok(
    after1.body.includes("On Scan, the model fetches"),
    "a sentence that names no vendor is not this migration's business and stays",
  );
  assert.ok(after1.body.includes("TownReporter is a small non-profit newspaper for Longmont, Colorado."));
  assert.equal(after1.published_at, before.published_at);
  assert.equal(await correctionCount(), 0);

  await apply108();
  const after2 = await readRow();
  assert.deepEqual(after2.row, after1.row, "a replayed 0108 must change nothing at all");
});

test("a welcome article an owner rewrote from scratch is not touched", { skip, timeout: 30_000 }, async () => {
  const OWNED_DEK = "Whatever we print, we stand behind.";
  const OWNED_BODY = "We write this paper ourselves. Nothing about this paragraph came from a migration.";
  await seed(OWNED_DEK, OWNED_BODY);
  const before = await readRow();

  await apply108();
  const after1 = await readRow();

  assert.equal(after1.dek, OWNED_DEK, "an owner's dek must not be rewritten");
  assert.equal(after1.body, OWNED_BODY, "nor an owner's body");
  assert.deepEqual(after1.row, before.row, "and nothing else about the row may move either");
});
