import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { fileScanLeads, type SqlTag } from "./lead-filing.ts";

test("filing stamps the exact killed repeat instead of inserting behind a possible match", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table leads (
      id serial primary key, user_id text, newsroom_id integer, scan_run_id integer,
      headline text, why text, topic text, source_urls text, evidence text,
      newsworthiness integer, status text, possible_duplicate_of integer,
      resurfaced_count integer default 0, last_resurfaced_at timestamptz,
      last_resurfaced_scan_run_id integer
    )`);
    const source_urls = ["https://example.org/road-work"];
    const existing = [
      {
        id: 40,
        status: "killed",
        source_urls,
        headline: "All left turns at CO 119 and Hover to close for about a year during bridge work",
      },
      {
        id: 57,
        status: "killed",
        source_urls,
        headline:
          "Left turns at CO 119 and Hover Street set to close about a year for bridge construction",
      },
    ];
    for (const lead of existing) {
      await db.query(
        "insert into leads(id,newsroom_id,headline,status,why) values($1,1,$2,$3,'original decision')",
        [lead.id, lead.headline, lead.status],
      );
    }
    const sql: SqlTag = async <T>(parts: TemplateStringsArray, ...values: unknown[]) => {
      const query = parts.reduce((out, part, i) => out + (i ? `$${i}` : "") + part, "");
      return (await db.query<T>(query, values)).rows;
    };
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      901,
      [{ headline: existing[1]!.headline, source_urls }],
      existing,
    );
    assert.equal(result.leadsCreated, 0);
    assert.equal(result.resurfacedKilled, 1);
    assert.equal(result.possibleMatched, 0);
    const rows = (
      await db.query(
        "select id,status,why,resurfaced_count,last_resurfaced_scan_run_id from leads order by id",
      )
    ).rows;
    assert.deepEqual(rows, [
      {
        id: 40,
        status: "killed",
        why: "original decision",
        resurfaced_count: 0,
        last_resurfaced_scan_run_id: null,
      },
      {
        id: 57,
        status: "killed",
        why: "original decision",
        resurfaced_count: 1,
        last_resurfaced_scan_run_id: 901,
      },
    ]);
  } finally {
    await db.close();
  }
});

test("a possible repeat of a killed lead is held, while a possible open match stays new", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table leads (
      id serial primary key, user_id text, newsroom_id integer, scan_run_id integer,
      headline text, why text, topic text, source_urls text, evidence text,
      newsworthiness integer, status text, possible_duplicate_of integer,
      resurfaced_count integer default 0, last_resurfaced_at timestamptz,
      last_resurfaced_scan_run_id integer
    )`);
    for (const status of ["killed", "new"]) {
      await db.exec("truncate leads restart identity");
      const source_urls = ["https://example.org/agenda"];
      const existing = [
        {
          id: 1,
          status,
          source_urls,
          headline:
            "Boulder County commissioners hold closed-door executive session on staff pay raises, Sept. 5",
        },
      ];
      await db.query("insert into leads(newsroom_id,headline,status) values(1,$1,$2)", [
        existing[0]!.headline,
        status,
      ]);
      const sql: SqlTag = async <T>(parts: TemplateStringsArray, ...values: unknown[]) => {
        const query = parts.reduce((out, part, i) => out + (i ? `$${i}` : "") + part, "");
        return (await db.query<T>(query, values)).rows;
      };
      const result = await fileScanLeads(
        sql,
        { userId: "test" },
        1,
        902,
        [
          {
            headline:
              "Boulder County commissioners hold closed-door executive session on jail expansion, Sept. 5",
            source_urls,
          },
        ],
        existing,
      );
      assert.equal(result.leadsCreated, 1, "different developments must not be discarded");
      assert.equal(result.possibleMatched, 1);
      const rows = (
        await db.query(
          "select id,status,possible_duplicate_of,resurfaced_count from leads order by id",
        )
      ).rows;
      assert.deepEqual(rows, [
        { id: 1, status, possible_duplicate_of: null, resurfaced_count: 0 },
        {
          id: 2,
          status: status === "killed" ? "held" : "new",
          possible_duplicate_of: 1,
          resurfaced_count: 0,
        },
      ]);
    }
  } finally {
    await db.close();
  }
});
