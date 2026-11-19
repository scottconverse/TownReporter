import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { fileScanLeads, type SqlTag } from "./lead-filing.ts";

/*
 * G26-HP-2 (walk 2026-11-19): Queue leads showed "Source is a home or list
 * page, not the story page". The scan model cited only the list page it read.
 * Filing now adds the article link that page carried when its text plainly
 * names the lead's story, ahead of the list page; no clear match adds nothing.
 */

async function withLeadsTable(run: (sql: SqlTag, db: PGlite) => Promise<void>) {
  const db = new PGlite();
  try {
    await db.exec(`create table leads (
      id serial primary key, user_id text, newsroom_id integer, scan_run_id integer,
      headline text, why text, topic text, source_urls text, evidence text,
      newsworthiness integer, score_parts jsonb, status text, possible_duplicate_of integer,
      topic_unchosen boolean not null default false,
      resurfaced_count integer default 0, last_resurfaced_at timestamptz,
      last_resurfaced_scan_run_id integer, dup_kind text,
      dup_ai_same boolean, dup_ai_why text, dup_ai_target text,
      dup_ai_printed_same boolean, dup_ai_printed_why text, dup_ai_printed_slug text,
      dup_ai_model text, dup_ai_checked_at timestamptz,
      source_id integer
    )`);
    await db.exec(`create table source_observations (
      newsroom_id integer, source_id integer, kind text, note text,
      lead_id integer, scan_run_id integer, observed_by text
    )`);
    const sql: SqlTag = async <T>(parts: TemplateStringsArray, ...values: unknown[]) => {
      const query = parts.reduce((out, part, i) => out + (i ? `$${i}` : "") + part, "");
      return (await db.query<T>(query, values)).rows;
    };
    await run(sql, db);
  } finally {
    await db.close();
  }
}

const readSources = [
  {
    id: 7,
    url: "https://svvsd.org/news/",
    extras: [],
    storyLinks: [
      {
        url: "https://svvsd.org/news/lyons-school-ranking-2026/",
        title: "Lyons schools rank high in state report",
      },
      {
        url: "https://svvsd.org/news/bus-routes-change-monday/",
        title: "Bus routes change Monday for middle schools",
      },
    ],
  },
];

test("G26-HP-2: a lead citing only a list page gets the matching story URL, ahead of it", async () => {
  await withLeadsTable(async (sql, db) => {
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      901,
      [
        {
          headline: "Lyons schools rank high in state report",
          source_urls: ["https://svvsd.org/news/"],
          topic: "schools",
        },
      ],
      [],
      undefined,
      undefined,
      [],
      readSources,
    );
    assert.equal(result.leadsCreated, 1);
    const row = (
      await db.query<{ source_urls: string }>("select source_urls from leads")
    ).rows[0]!;
    assert.deepEqual(JSON.parse(row.source_urls), [
      "https://svvsd.org/news/lyons-school-ranking-2026/",
      "https://svvsd.org/news/",
    ]);
  });
});

test("G26-HP-2: a lead with no clear story match is filed exactly as the model wrote it", async () => {
  await withLeadsTable(async (sql, db) => {
    await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      902,
      [
        {
          headline: "Council approves water rate increase",
          source_urls: ["https://svvsd.org/news/"],
          topic: "council",
        },
      ],
      [],
      undefined,
      undefined,
      [],
      readSources,
    );
    const row = (
      await db.query<{ source_urls: string }>("select source_urls from leads")
    ).rows[0]!;
    assert.deepEqual(JSON.parse(row.source_urls), ["https://svvsd.org/news/"]);
  });
});
