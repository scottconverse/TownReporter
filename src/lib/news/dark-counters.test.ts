import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { captureBatchStats } from "./html-text.ts";
import {
  DIG_CAPTURE_COUNT_SQL,
  captureCounterLine,
  digCaptureCounts,
  digCaptureCountsFromRows,
  digRailCounterLine,
} from "./dark-counters.ts";

/**
 * Unit DD1, item 6 — the dig's own counters disagreed.
 *
 * The stand-in walkthrough of 2026-09-30 (`A2c-REPORT.md` C3) read the same
 * screen at the same instant and got two accounts of the same file:
 *
 *   rail row:   "Stopped — more to read · 54 records on file"
 *   file line:  "Stopped — more to read · 38 readable / 53 captured"
 *
 * and, later in the same session, 66 on file against 44 / 60.
 *
 * The fixture below is that file: 53 captured pages, 15 of them blocked or
 * opened empty, plus the editor's own pasted tip -- which is an `editor://`
 * row and not a capture at all.
 */

const NEWSROOM = 910_661;
const PASTE_URL = "editor://paste/72";

const READABLE =
  "The Colorado Shines program detail for Kid City USA Longmont, licence 1770463, at 1941 Terry Street.";
const BLOCKED = "Access denied. The site blocked this request.";
const EMPTY = "";

type Fixture = {
  url: string;
  text: string;
  status: number | null;
  outcome: string | null;
};

const FIXTURE: Fixture[] = [
  ...Array.from({ length: 38 }, (_, i) => ({
    url: `https://example.gov/readable-${i}`,
    text: READABLE,
    status: 200,
    outcome: "fetched",
  })),
  ...Array.from({ length: 12 }, (_, i) => ({
    url: `https://example.gov/blocked-${i}`,
    text: BLOCKED,
    status: 403,
    outcome: "fetch-failed",
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    url: `https://example.gov/empty-${i}`,
    text: EMPTY,
    status: 200,
    outcome: "fetched",
  })),
  { url: PASTE_URL, text: "The tip the editor pasted to open this file.", status: null, outcome: null },
];

async function seed(): Promise<number> {
  const sql = await getSql();
  await sql.query(
    `create table if not exists investigations (
       id serial primary key,
       user_id text not null default 'dd1',
       newsroom_id integer not null default 1,
       title text not null default '',
       status text not null default 'open',
       summary text not null default '',
       hops integer not null default 0,
       budget integer not null default 5,
       pause_reason text,
       created_at timestamptz not null default now(),
       updated_at timestamptz not null default now()
     )`,
  );
  await sql.query(
    `create table if not exists artifacts (
       id serial primary key,
       user_id text not null default 'dd1',
       newsroom_id integer not null default 1,
       investigation_id integer,
       url text not null,
       title text not null default '',
       content_hash text not null default '',
       full_text text not null default '',
       classification text not null default 'discovered',
       fetch_status integer,
       fetch_outcome text,
       extraction_method text,
       created_at timestamptz not null default now()
     )`,
  );
  const rows = await sql.query<{ id: number }>(
    `insert into investigations (user_id, title, newsroom_id) values ($1, $2, $3) returning id`,
    ["dd1-counters", "Kid City USA Longmont closing", NEWSROOM],
  );
  const investigationId = rows[0]!.id;
  for (const [i, row] of FIXTURE.entries()) {
    await sql.query(
      `insert into artifacts
         (user_id, newsroom_id, investigation_id, url, title, content_hash, full_text, fetch_status, fetch_outcome)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        "dd1-counters",
        NEWSROOM,
        investigationId,
        row.url,
        `Fixture ${i}`,
        `hash-${i}`,
        row.text,
        row.status,
        row.outcome,
      ],
    );
  }
  return investigationId;
}

describe("DD1 item 6 — the dig's capture counts reconcile", () => {
  it("counts the same file the same way from either surface", () => {
    const counts = digCaptureCounts({ captures: 53, readable: 38 });
    assert.equal(counts.readable + counts.unreadable, counts.captures, "the parts must add up");

    // The rail names a total; the file's line uses the SAME total as its
    // denominator. A reader who sees both sees one fact, not two.
    assert.equal(digRailCounterLine(counts.captures), "53 captures on file");
    assert.equal(captureCounterLine(counts), "38 readable / 53 captured");
    assert.ok(captureCounterLine(counts).includes(String(counts.captures)));
  });

  it("does not call a file whose captures all read 'N readable / N captured'", () => {
    assert.equal(captureCounterLine(digCaptureCounts({ captures: 2, readable: 2 })), "2 captured");
    assert.equal(captureCounterLine(digCaptureCounts({ captures: 1, readable: 1 })), "1 captured");
  });

  it("reads plainly on a file with nothing on it yet", () => {
    assert.equal(digRailCounterLine(0), "nothing captured yet");
    assert.equal(captureCounterLine(digCaptureCounts({ captures: 0, readable: 0 })), "nothing captured yet");
  });

  it("never reports more readable captures than captures", () => {
    const counts = digCaptureCounts({ captures: 3, readable: 99 });
    assert.equal(counts.readable, 3);
    assert.equal(counts.unreadable, 0);
    assert.equal(captureCounterLine(counts), "3 captured");
  });

  /*
    THE TEST THAT MATTERS. The counting SQL and `captureBatchStats` -- the
    JavaScript verdict the rest of the Dark Desk grades captures with -- must
    agree row for row. If they drift, the rail and the file disagree again, or
    the file's own line disagrees with every other Dark Desk surface that calls
    a capture readable.
  */
  it("agrees with the desk's own readability verdict, row for row", async () => {
    const investigationId = await seed();
    const sql = await getSql();
    const counted = await sql.query<{ captures: number; readable: number }>(DIG_CAPTURE_COUNT_SQL, [
      NEWSROOM,
      investigationId,
    ]);
    const counts = digCaptureCounts(counted[0]);

    const capturesOnly = FIXTURE.filter((row) => !row.url.startsWith("editor://"));
    const batch = captureBatchStats(
      capturesOnly.map((row) => ({
        text: row.text,
        status: row.status,
        outcome: row.outcome,
      })),
    );

    assert.equal(counts.captures, batch.total, "the SQL total and the JS total disagree");
    assert.equal(counts.readable, batch.ok, "the SQL readable count and the JS verdict disagree");
    assert.equal(counts.captures, 53, "the pasted tip was counted as a capture");
    assert.equal(counts.readable, 38);
  });
});

/*
  The counting query can fail. What the page shows then must still be a fact
  about the file rather than a zero: a file with fifty captures on it reading
  "nothing captured yet" is the same class of lie as the two counters that
  disagreed.
*/
describe("DD1 item 6 — the fallback is a page of real rows, never a zero", () => {
  it("counts the rows it has when the counting query could not run", () => {
    const rows = [
      { url: "https://example.gov/a", excerpt: READABLE, fetch_status: 200, fetch_outcome: "fetched" },
      { url: "https://example.gov/b", excerpt: BLOCKED, fetch_status: 403, fetch_outcome: "fetch-failed" },
      { url: PASTE_URL, excerpt: "The editor's tip." },
    ];
    const counts = digCaptureCountsFromRows(rows);
    assert.equal(counts.captures, 2);
    assert.equal(counts.readable, 1);
    assert.equal(counts.readable + counts.unreadable, counts.captures);
    assert.equal(captureCounterLine(counts), "1 readable / 2 captured");
  });
});
