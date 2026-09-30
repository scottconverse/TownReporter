import test from "node:test";
import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every place that can put a story on the paper, pinned to a list.
 *
 * WHY. An audit of the human publish gate established the four sites below by
 * hand: `desk.ts` `performPublish` (a lead's draft becomes a story),
 * `opinion.ts` `performPublishEditorial` (an editorial), and the two in
 * `routine-notice-worker.server.ts` and `welcome-article.ts` that the routine
 * notices and the first-run setup write. Nothing enforced that list, so a
 * fifth path could be added -- a new server function, a job, a repair script
 * -- and the gate an audit had just finished proving would quietly be one
 * site wider than the audit said. This test is the fence: the set of files
 * that write a published article is exactly these four, and a fifth fails
 * here until someone adds it deliberately, with a reason.
 *
 * WHAT COUNTS AS A PUBLISH SITE. Two statement forms, both read off the real
 * code rather than invented:
 *
 *   1. An insert into `articles`, however the table is spelled --
 *      `articles`, `"articles"`, `public.articles`, `"public"."articles"`.
 *      A new article row is the only way a story appears, and three of the
 *      four sites use this form. It is matched case-insensitively and across
 *      newlines because `desk.ts` and `opinion.ts` split the statement over a
 *      dozen lines and `routine-notice-worker.server.ts` writes it as a
 *      one-line string. An upsert is this same statement -- `insert ... on
 *      conflict do update set ...` -- so one pattern covers both, and the
 *      `articles.status` column defaults to `'published'`, so an insert that
 *      never mentions the status is still a publish.
 *   2. An update of `articles` whose SET list touches `status`, whatever the
 *      value looks like: `'published'`, `$1`, `${next}`, `excluded.status`.
 *      No site in the tree does this today, and that is the point of matching
 *      it. The obvious cheap way to add a fifth publish path later is to
 *      promote a row that is already there, and the narrow version of this
 *      rule -- a literal `status = 'published'` -- would have missed every
 *      spelling of that except the first.
 *
 * The scan is deliberately text-level, like `newsroom-scoped-inserts.test.mjs`
 * beside it: a statement inside a comment or a string would be flagged, which
 * is the safe direction to be wrong in. For the second form the scan reads
 * only the statement's SET list -- the text between `set` and `where` -- so a
 * read that merely mentions the column, `... where status = 'published'`, is
 * not mistaken for a write, and neither is an edit that leaves the status
 * alone. A sub-select inside a SET list would confuse it, and there is none in
 * the tree.
 *
 * The matcher is proven by its own case list below, not only by this tree, so
 * a future edit that narrows it back fails a test instead of going quietly
 * blind to whatever spelling this tree does not happen to use.
 */

/** The four files allowed to write a published article, and nothing else. */
const ALLOWED = [
  "src/lib/news/desk.ts",
  "src/lib/news/opinion.ts",
  "src/lib/news/routine-notice-worker.server.ts",
  "src/lib/news/welcome-article.ts",
];

/*
  A THIRD FORM THE LITERAL SCAN CANNOT SEE, named so it is not a hole.

  `trash-store.ts`'s `reinsert()` builds `insert into ${table} (...)` from a
  snapshot the trash took, so a restored article is inserted by a statement
  whose table name is a variable -- no regex for a table name, however it is
  spelled, can match that, and none ever will. It is not a publish path in the
  sense above: the row coming back is the same row that was deleted, `status`,
  `published_at` and all, and `trash.ts` restores it only when an editor
  presses Restore on the Trash screen. But it can write a published article,
  so it is listed here rather than left for a reader of this test to discover.
  Any OTHER file that inserts into a variable table name fails the second
  assertion below.
*/
const ALLOWED_DYNAMIC_TABLE_INSERTS = ["src/lib/news/trash-store.ts"];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every non-test TypeScript source file under src (the whole app, not just
 * src/lib), as repo-relative paths with forward slashes -- `globSync` returns
 * backslashes on Windows, and the ALLOWED list has to read the same on both.
 */
function sourceFiles() {
  return globSync(["src/**/*.ts", "src/**/*.tsx"], { cwd: ROOT })
    .filter((f) => !f.includes(".test."))
    .map((f) => f.split("\\").join("/"));
}

/*
  Naming the table, not the word `articles`.

  A regex for the bare word was the first version of this test and it was
  evadable: `insert into public.articles` and `insert into "articles"` are the
  same write spelled two other ways, and both walked straight past it. The
  table is recognized as an identifier -- optionally schema-qualified,
  optionally quoted on either part -- whose LAST segment is `articles`, so
  `public.articles`, `"public"."articles"`, `"articles"` and the bare name all
  land, while `article_body_history` and `articles_archive` do not (the
  lookahead refuses a name that merely starts with `articles`).
*/
const IDENTIFIER = String.raw`(?:"[A-Za-z_][A-Za-z0-9_]*"|[A-Za-z_][A-Za-z0-9_]*)`;
const ARTICLES_TABLE = String.raw`(?:${IDENTIFIER}\s*\.\s*)?(?:"articles"|articles(?![A-Za-z0-9_]))`;
const INSERT_INTO_ARTICLES = new RegExp(String.raw`\binsert\s+into\s+${ARTICLES_TABLE}`, "gi");
const UPDATE_ARTICLES = new RegExp(String.raw`\bupdate\s+${ARTICLES_TABLE}`, "gi");
const DYNAMIC_TABLE_INSERT = /insert\s+into\s+\$\{/i;
/**
 * A SET-list assignment to `status`, whatever it is assigned. The character
 * class before the name is what keeps `updated_status = ...` out (it has no
 * whitespace, comma or paren before `status`); the optional quotes let the
 * column be spelled `"status"`.
 */
const SETS_STATUS = /[\s,(]"?status"?\s*=/i;
const SET_KEYWORD = /\bset\b/i;
const WHERE_KEYWORD = /\bwhere\b/i;
/** Only used for a SET list with no `where` at all, which is malformed SQL. */
const UNBOUNDED_SET_WINDOW = 400;

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/**
 * The publish statements in one file's source, with the line each starts on.
 * `kind` is `insert` for a new article row, `promote` for an update that
 * writes an article's `status`.
 *
 * The SET list is the text between `set` and the statement's own `where`, so a
 * read that merely names the column -- `... where status = 'published'` -- is
 * not mistaken for a write, and neither is an edit that leaves the status
 * alone. The rule inside that region is the column, not the value: a status
 * write is a publish-gate act whatever it is set to and whatever shape the
 * value has, so `$1`, `${next}` and `excluded.status` are all caught by the
 * same `status =`. A sub-select inside a SET list would confuse the `where`
 * search, and there is none in the tree.
 */
function publishSitesIn(text) {
  const sites = [];
  for (const match of text.matchAll(INSERT_INTO_ARTICLES)) {
    sites.push({ kind: "insert", line: lineOf(text, match.index) });
  }
  for (const match of text.matchAll(UPDATE_ARTICLES)) {
    const statement = text.slice(match.index);
    const set = SET_KEYWORD.exec(statement);
    if (!set) continue;
    const setList = statement.slice(set.index + set[0].length);
    const where = WHERE_KEYWORD.exec(setList);
    const assignments = where ? setList.slice(0, where.index) : setList.slice(0, UNBOUNDED_SET_WINDOW);
    if (SETS_STATUS.test(assignments)) {
      sites.push({ kind: "promote", line: lineOf(text, match.index) });
    }
  }
  return sites;
}

test("only the four audited files write a published article", () => {
  const found = new Map();
  for (const file of sourceFiles()) {
    const sites = publishSitesIn(readFileSync(join(ROOT, file), "utf8"));
    if (sites.length) found.set(file, sites);
  }
  const detail = [...found]
    .map(([file, sites]) => `${file}: ${sites.map((s) => `${s.kind} at line ${s.line}`).join(", ")}`)
    .join("\n");

  assert.deepEqual(
    [...found.keys()].sort(),
    [...ALLOWED].sort(),
    `the set of files that publish an article changed.\n` +
      `A new publish site means a new way onto the paper, and the human ` +
      `publish gate has to be re-checked for it; add the file to ALLOWED ` +
      `with the gate it enforces, or remove the write.\n` +
      `found:\n${detail}\n`,
  );
});

test("the one insert with a variable table name is the trash restore, and stays the only one", () => {
  const offenders = [];
  for (const file of sourceFiles()) {
    const text = readFileSync(join(ROOT, file), "utf8");
    if (DYNAMIC_TABLE_INSERT.test(text) && !ALLOWED_DYNAMIC_TABLE_INSERTS.includes(file)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `insert(s) into a table name built at runtime outside the audited list. A ` +
      `table name this test cannot read means a publish this test cannot see; ` +
      `name the file in ALLOWED_DYNAMIC_TABLE_INSERTS with the reason it is ` +
      `safe, or make the table name a literal:\n${offenders.join("\n")}`,
  );
});

/*
  The scanner's own behavior, fed strings rather than the tree.

  The assertions above run against whatever `src/` happens to contain, so they
  cannot tell a matcher that sees a write from one that has stopped seeing
  anything at all -- a regex narrowed back to the bare word `articles` would
  keep them green as long as this tree keeps spelling the table that way, and
  go blind the first time a caller wrote `public.articles`. Every case below is
  a spelling somebody could use, so the matcher is proven here and not only
  against today's source.
*/
test("the scanner recognizes every spelling of a publish, and only a publish", () => {
  const INSERTS = [
    "insert into articles (user_id, slug) values ('masthead', 'w')",
    'insert into "articles" (user_id, slug) values (\'masthead\', \'w\')',
    "insert into public.articles (user_id, slug) values ('masthead', 'w')",
    'insert into public."articles" (user_id, slug) values (\'masthead\', \'w\')',
    'insert into "public"."articles" (user_id, slug) values (\'masthead\', \'w\')',
    // The upsert: the same insert, with a `do update` on the end. It is an
    // insert-into-articles either way, which is why one pattern covers both.
    `insert into public.articles (user_id, slug, status) values ($1, $2, 'published')
       on conflict (slug) do update set status = excluded.status`,
    `      insert into articles (
        user_id, newsroom_id, slug, status, published_at
      )
      values (
        $1, $2, $3, 'published', now()
      ) returning id`,
  ];
  for (const sql of INSERTS) {
    assert.deepEqual(
      publishSitesIn(sql).map((s) => s.kind),
      ["insert"],
      `must be read as a publish: ${sql}`,
    );
  }

  const PROMOTES = [
    "update articles set status = 'published' where id = $1",
    'update "articles" set status = $1 where id = $2',
    "update public.articles set status = $1 where id = $2",
    "update public.articles set status = ${next} where id = $1",
    "update articles set status = excluded.status from staging where staging.id = articles.id",
    `update articles
        set headline = $2,
            status = $3
      where id = $1 and newsroom_id = $4`,
    'update articles set "status" = $1 where id = $2',
  ];
  for (const sql of PROMOTES) {
    assert.deepEqual(
      publishSitesIn(sql).map((s) => s.kind),
      ["promote"],
      `must be read as a publish: ${sql}`,
    );
  }

  const NOT_A_PUBLISH = [
    "select 1",
    "insert into article_body_history (a) values (1)",
    "insert into articles_archive (a) values (1)",
    "insert into public.articles_archive (a) values (1)",
    "insert into correction_articles (a) values (1)",
    "select slug from articles where status = 'published' limit 1",
    "update articles set headline = $1 where id = $2",
    `update articles set headline = $1 where id = $2
      and status = 'published'`,
    "update articles set updated_status = $1 where id = $2",
    "update leads set status = 'published' where id = $1",
  ];
  for (const sql of NOT_A_PUBLISH) {
    assert.deepEqual(publishSitesIn(sql), [], `must NOT be read as a publish: ${sql}`);
  }
});

test("a publish is reported with the line it starts on", () => {
  const text = `const a = 1;\n\nupdate public.articles set status = $1 where id = $2;\n`;
  assert.deepEqual(publishSitesIn(text), [{ kind: "promote", line: 3 }]);
});
