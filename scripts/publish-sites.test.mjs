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
 *   1. `insert into articles`. A new article row is the only way a story
 *      appears, and three of the four sites use this form. It is matched
 *      case-insensitively and across newlines because `desk.ts` and
 *      `opinion.ts` split the statement over a dozen lines and
 *      `routine-notice-worker.server.ts` writes it as a one-line string.
 *   2. `update articles ... status = 'published'`. No site in the tree does
 *      this today, and that is the point of matching it: the obvious cheap
 *      way to add a fifth publish path later is to promote a row that is
 *      already there.
 *
 * The scan is deliberately text-level, like `newsroom-scoped-inserts.test.mjs`
 * beside it: a statement inside a comment or a string would be flagged, which
 * is the safe direction to be wrong in. For the second form the scan reads
 * only the statement's SET list -- the text between `set` and `where` -- so a
 * read that merely mentions the word, `... where status = 'published'`, is
 * not mistaken for a write. A sub-select inside a SET list would confuse it,
 * and there is none in the tree.
 */

/** The four files allowed to write a published article, and nothing else. */
const ALLOWED = [
  "src/lib/news/desk.ts",
  "src/lib/news/opinion.ts",
  "src/lib/news/routine-notice-worker.server.ts",
  "src/lib/news/welcome-article.ts",
];

/*
  A SECOND FORM THE LITERAL SCAN CANNOT SEE, named so it is not a hole.

  `trash-store.ts`'s `reinsert()` builds `insert into ${table} (...)` from a
  snapshot the trash took, so a restored article is inserted by a statement
  whose table name is a variable -- `insert\s+into\s+articles` never matches
  it, and no regex for a literal table name ever will. It is not a publish
  path in the sense above: the row coming back is the same row that was
  deleted, `status`, `published_at` and all, and `trash.ts` restores it only
  when an editor presses Restore on the Trash screen. But it can write a
  published article, so it is listed here rather than left for a reader of
  this test to discover. Any OTHER file that inserts into a variable table
  name fails the second assertion below.
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

const INSERT_INTO_ARTICLES = /insert\s+into\s+articles\b/gi;
const UPDATE_ARTICLES = /update\s+articles\b/gi;
const DYNAMIC_TABLE_INSERT = /insert\s+into\s+\$\{/i;
const SETS_PUBLISHED = /status\s*=\s*'published'/i;
const SET_KEYWORD = /\bset\b/i;
const WHERE_KEYWORD = /\bwhere\b/i;
/** Only used for a SET list with no `where` at all, which is malformed SQL. */
const UNBOUNDED_SET_WINDOW = 400;

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/**
 * The publish statements in one file's source, with the line each starts on.
 * `kind` is `insert` for a new article row, `promote` for an update that sets
 * a row's status to published.
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
    if (SETS_PUBLISHED.test(assignments)) {
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

/* The scanner's own behavior, so a future edit to the regexes cannot make the
   test above pass by matching nothing at all. */
test("the scanner recognizes the forms the four sites use", () => {
  assert.equal(publishSitesIn("select 1").length, 0);
  assert.equal(
    publishSitesIn("insert into articles (user_id, slug) values ('masthead', 'w')").length,
    1,
  );
  assert.equal(
    publishSitesIn(`
      insert into articles (
        user_id, newsroom_id, slug, status, published_at
      )
      values (
        $1, $2, $3, 'published', now()
      ) returning id
    `).length,
    1,
  );
  assert.equal(
    publishSitesIn("insert into article_body_history (a) values (1)").length,
    0,
    "a table whose name merely starts with 'articles' is not the articles table",
  );
  assert.equal(publishSitesIn("insert into articles_archive (a) values (1)").length, 0);

  const promote = "update articles set status = 'published' where id = $1";
  assert.deepEqual(publishSitesIn(promote), [{ kind: "promote", line: 1 }]);
  assert.equal(
    publishSitesIn("update articles set headline = $1 where id = $2").length,
    0,
    "an edit that leaves the status alone is not a publish",
  );
  assert.equal(
    publishSitesIn(`update articles set headline = $1 where id = $2
      and status = 'published'`).length,
    0,
    "reading 'published' in the where clause is not writing it",
  );
});
