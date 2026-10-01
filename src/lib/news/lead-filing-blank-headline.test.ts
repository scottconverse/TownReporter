import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { fileScanLeads, type SqlTag } from "./lead-filing.ts";

/*
 * A lead the model wrote out of control characters is not a lead.
 *
 * The loop used to test the headline it was HANDED -- `lead.headline?.trim()`
 * -- and only that. A headline made of C0 bytes alone is not empty, so it
 * passed; `storableText` (./storable-text.ts) then stripped every byte of it,
 * leaving `""`, and the INSERT at the bottom of the loop filed a lead with no
 * headline at all. It counted toward `leadsCreated`, so the run's receipt said
 * it had found something, and the Queue showed a row an editor could open and
 * find nothing in.
 *
 * SCAN-001's close relative: that fix stopped one NUL from failing the whole
 * scan transaction, and it sanitised the headline correctly -- but nothing ever
 * looked at what was left afterwards.
 *
 * The second lead in the batch is the control: whatever the skip does to the
 * unusable candidate, it must not cost the run a lead that was fine.
 */

const CONTROL_ONLY = "\u0000\u0007";

function makeSql(db: PGlite): SqlTag {
  return async <T>(parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.reduce((out, part, i) => out + (i ? `$${i}` : "") + part, "");
    return (await db.query<T>(query, values)).rows;
  };
}

test("a headline that cleans to nothing is skipped, not filed as a blank lead", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table leads (
      id serial primary key, user_id text, newsroom_id integer, scan_run_id integer,
      headline text, why text, topic text, source_urls text, evidence text,
      newsworthiness integer, status text, possible_duplicate_of integer,
      topic_unchosen boolean not null default false,
      resurfaced_count integer default 0, last_resurfaced_at timestamptz,
      last_resurfaced_scan_run_id integer, dup_kind text,
      -- Migration 0113 (U28): fileScanLeads writes the duplicate check's
      -- verdict on every row it files, asked or not, so a table built without
      -- these fails the insert with a missing-column error for dup_ai_same
      -- -- a missing migration, not a filing bug.
      dup_ai_same boolean, dup_ai_why text, dup_ai_target text,
      dup_ai_printed_same boolean, dup_ai_printed_why text, dup_ai_printed_slug text,
      dup_ai_model text, dup_ai_checked_at timestamptz
    )`);
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      960,
      [
        {
          // Two characters, both control bytes: `trim()` keeps it, so it used
          // to reach the insert and become "".
          headline: CONTROL_ONLY,
          why: "The city said something about the vote.",
          topic: "council",
          source_urls: ["https://example.test/blank-headline-agenda"],
        },
        {
          headline: "Council schedules the water contract vote",
          why: "The vote is Tuesday.",
          topic: "council",
          source_urls: ["https://example.test/water-contract-agenda"],
        },
      ],
      [],
    );

    assert.equal(result.leadsCreated, 1, "the usable lead is the one the run found");
    assert.equal(result.mergedSameScan, 0);
    assert.equal(result.resurfacedOpen, 0);
    assert.equal(result.resurfacedKilled, 0);
    assert.equal(result.possibleMatched, 0);
    assert.equal(result.firstDiscardedHeadline, undefined);

    const rows = (
      await db.query<{ headline: string; source_urls: string }>(
        "select headline, source_urls from leads order by id",
      )
    ).rows;
    assert.deepEqual(
      rows.map((row) => row.headline),
      ["Council schedules the water contract vote"],
      "no blank-headline row was filed",
    );
    assert.equal(
      rows.some((row) => row.source_urls.includes("blank-headline-agenda")),
      false,
      "the skipped candidate contributed no row, not even an empty one",
    );
  } finally {
    await db.close();
  }
});

test("a headline that cleans to nothing is skipped the same way an absent one is", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table leads (
      id serial primary key, user_id text, newsroom_id integer, scan_run_id integer,
      headline text, why text, topic text, source_urls text, evidence text,
      newsworthiness integer, status text, possible_duplicate_of integer,
      topic_unchosen boolean not null default false,
      resurfaced_count integer default 0, last_resurfaced_at timestamptz,
      last_resurfaced_scan_run_id integer, dup_kind text,
      -- Migration 0113 (U28): fileScanLeads writes the duplicate check's
      -- verdict on every row it files, asked or not, so a table built without
      -- these fails the insert with a missing-column error for dup_ai_same
      -- -- a missing migration, not a filing bug.
      dup_ai_same boolean, dup_ai_why text, dup_ai_target text,
      dup_ai_printed_same boolean, dup_ai_printed_why text, dup_ai_printed_slug text,
      dup_ai_model text, dup_ai_checked_at timestamptz
    )`);
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      961,
      [
        { headline: CONTROL_ONLY, topic: "council" },
        { headline: "   ", topic: "council" },
        { topic: "council" },
      ],
      [],
    );
    assert.equal(result.leadsCreated, 0, "nothing usable was found, so nothing is counted");
    const rows = (await db.query("select id from leads")).rows;
    assert.equal(rows.length, 0, "and no row is filed for any of them");
  } finally {
    await db.close();
  }
});
