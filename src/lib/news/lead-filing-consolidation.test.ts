import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { fileScanLeads, type SqlTag } from "./lead-filing.ts";

/*
 * Unit AK item 1 (2026-09-26): one story found twice in one scan run becomes
 * ONE lead.
 *
 * The real case: on 2026-09-25 leads 207 and 212 ("Longmont Senior Center to
 * begin free evening meal program Oct. 2") were both filed -- same city page,
 * created in the same second -- and 212 went on to be published as article
 * 73 while 207 sat on the Queue with a "≈ PRINTED" badge, unfixable and
 * unexplained. WHY, from the code:
 *
 *   - The scan's own batch merge (scan-batches.ts:109) de-duplicates leads by
 *     `lead.headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()` --
 *     byte-identical words only. Two differently-worded headlines for the
 *     same story both survive it.
 *   - desk.ts:1246 calls fileScanLeads ONCE per scan run with one `existing`
 *     array loaded once at :1218, and lead-filing.ts:65-67 promises that
 *     array is "mutated in place with each newly-inserted lead so two
 *     AI-returned leads that are the same story within one scan don't both
 *     get inserted".
 *   - But the only branch that honours that promise is the STRONG one
 *     (lead-filing.ts:111-123, `continue`). A pair the matcher flags at the
 *     "possible" tier falls through to the INSERT at :133, so both leads are
 *     filed: the doc comment is true today only for strong matches.
 *
 * (The exact 207 and 212 headline strings are not available to me -- the
 * live database is not mine to read -- so the pair below is reconstructed
 * from the wording the brief quotes, which is the shape the code fails on.)
 *
 * The merge bar is matchStrength === "strong" and nothing looser -- see
 * sameStoryForMerge's doc comment in ./lead-match.ts for why every lexical bar
 * below it merges pairs QA-1 proved are different stories. Tests 3 and 4 below
 * pin that with the QA-1 fixtures themselves.
 */

function makeSql(db: PGlite): SqlTag {
  return async <T>(parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.reduce((out, part, i) => out + (i ? `$${i}` : "") + part, "");
    return (await db.query<T>(query, values)).rows;
  };
}

const CREATE_LEADS = `create table leads (
  id serial primary key, user_id text, newsroom_id integer, scan_run_id integer,
  headline text, why text, topic text, source_urls text, evidence text,
  newsworthiness integer, status text, possible_duplicate_of integer,
  topic_unchosen boolean not null default false,
  resurfaced_count integer default 0, last_resurfaced_at timestamptz,
  last_resurfaced_scan_run_id integer
)`;

test("the 207/212 case: the same story twice in one scan run is filed once, with the source URLs merged", async () => {
  const db = new PGlite();
  try {
    await db.exec(CREATE_LEADS);
    const cityPage = "https://longmontcolorado.gov/news/2026-senior-center-evening-meals";
    const recPage = "https://longmontcolorado.gov/recreation/senior-center";
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      950,
      [
        {
          headline: "Longmont Senior Center to begin free evening meal program Oct. 2",
          why: "A free evening meal five nights a week is a new city service for older residents.",
          evidence: "The city said the program starts Oct. 2 at the Senior Center.",
          topic: "council",
          source_urls: [cityPage],
        },
        {
          // The wording the scan's second batch produced for the same story.
          headline: "Longmont Senior Center to begin a free evening meal program on Oct. 2",
          why: "The city is starting a free evening meal program for older residents.",
          evidence: "Meals will be served five nights a week from Oct. 2, the city said.",
          topic: "council",
          source_urls: [cityPage, recPage],
        },
      ],
      [],
    );
    assert.equal(result.leadsCreated, 1, "one story found twice in one run is one lead");
    assert.equal(result.mergedSameScan, 1, "the second sighting must be counted, not hidden");
    const rows = (
      await db.query<{
        id: number;
        headline: string;
        source_urls: string;
        possible_duplicate_of: number | null;
        status: string;
      }>("select id, headline, source_urls, possible_duplicate_of, status from leads order by id")
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0]!.headline,
      "Longmont Senior Center to begin free evening meal program Oct. 2",
      "the first sighting is the one kept",
    );
    assert.deepEqual(
      JSON.parse(rows[0]!.source_urls).sort(),
      [cityPage, recPage].sort(),
      "both source URLs survive on the single lead -- merging must not drop evidence",
    );
    assert.equal(rows[0]!.possible_duplicate_of, null, "a merged lead is not a duplicate of itself");
    assert.equal(rows[0]!.status, "new");
  } finally {
    await db.close();
  }
});

test("two different stories that only share a section-page URL are still filed as two leads", async () => {
  const db = new PGlite();
  try {
    await db.exec(CREATE_LEADS);
    const cityIndex = "https://longmontcolorado.gov/news/";
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      951,
      [
        {
          headline: "Longmont Senior Center to begin free evening meal program Oct. 2",
          why: "A new city service.",
          topic: "council",
          source_urls: [cityIndex],
        },
        {
          headline: "Longmont police seek a man in a hit-and-run on Main Street",
          why: "Police asked the public for help.",
          topic: "council",
          source_urls: [cityIndex],
        },
      ],
      [],
    );
    assert.equal(result.leadsCreated, 2, "an index page is not evidence of one story");
    assert.equal(result.mergedSameScan, 0);
  } finally {
    await db.close();
  }
});

test("QA-1 NEG-7 (east county vs west county): a 'possible' pair inside one run stays two leads, linked", async () => {
  const db = new PGlite();
  try {
    await db.exec(CREATE_LEADS);
    // The exact fixture from ./lead-match.test.ts ("all 6 round-3 false merges
    // are 'possible', never 'strong'"), re-used here because it is the case
    // that makes the merge bar matter: two headlines that differ by ONE
    // content word, cite the same meeting page, and score 0.71 content-token
    // Jaccard -- above the 0.6 bar for the matcher's shared-URL prose path, and
    // below 0.85, so 'possible'. Merging on the prose path would swallow a real
    // second story, so the merge bar is the 'strong' tier instead (see
    // sameStoryForMerge). Both rows are kept, and the second is linked to the
    // first so the editor resolves it in one press.
    const source_urls = ["https://longmont.primegov.com/portal/meeting/12345"];
    const east = "SVVSD approves $850,000 broadband expansion for rural east county schools";
    const west = "SVVSD approves $850,000 broadband expansion for rural west county schools";
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      952,
      [
        { headline: east, why: "East county schools get fiber.", topic: "council", source_urls },
        { headline: west, why: "West county schools get fiber.", topic: "council", source_urls },
      ],
      [],
    );
    assert.equal(result.leadsCreated, 2, "two different stories must stay two leads");
    assert.equal(result.mergedSameScan, 0, "a 'possible' pair is never merged");
    assert.equal(result.possibleMatched, 1);
    const rows = (
      await db.query<{ id: number; headline: string; possible_duplicate_of: number | null }>(
        "select id, headline, possible_duplicate_of from leads order by id",
      )
    ).rows;
    assert.deepEqual(rows, [
      { id: 1, headline: east, possible_duplicate_of: null },
      { id: 2, headline: west, possible_duplicate_of: 1 },
    ]);
  } finally {
    await db.close();
  }
});

test("QA-1 NEG-8 (ambulance vs brush truck): an anchor-shaped 'possible' pair inside one run also stays two leads", async () => {
  const db = new PGlite();
  try {
    await db.exec(CREATE_LEADS);
    // The anchor path's shape: same portal URL, same date and dollar figure,
    // and a shared content word ("reviews"/"replacement") -- the loosest thing
    // the matcher accepts. Also 'possible', also not merged.
    const source_urls = ["https://longmont.primegov.com/portal/meeting/12345"];
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      953,
      [
        {
          headline: "Fire district board reviews $95,000 ambulance replacement bid, Sept. 19",
          why: "A needed ambulance.",
          topic: "council",
          source_urls,
        },
        {
          headline: "Fire district board reviews $95,000 brush truck replacement bid, Sept. 19",
          why: "A needed brush truck.",
          topic: "council",
          source_urls,
        },
      ],
      [],
    );
    assert.equal(result.leadsCreated, 2);
    assert.equal(result.mergedSameScan, 0);
    assert.equal(result.possibleMatched, 1);
  } finally {
    await db.close();
  }
});

test("a merged pair inside one run does not bump the resurfaced stamp of anything", async () => {
  const db = new PGlite();
  try {
    await db.exec(CREATE_LEADS);
    const url = "https://longmontcolorado.gov/news/2026-senior-center-evening-meals";
    await db.query(
      "insert into leads(id,newsroom_id,headline,status,source_urls,resurfaced_count) values(5,1,$1,'new','[]',0)",
      ["An unrelated lead on the desk"],
    );
    const sql = makeSql(db);
    const existing = [
      {
        id: 5,
        status: "new",
        headline: "An unrelated lead on the desk",
        source_urls: [],
      },
    ];
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      954,
      [
        {
          headline: "Longmont Senior Center to begin free evening meal program Oct. 2",
          why: "A new city service.",
          topic: "council",
          source_urls: [url],
        },
        {
          headline: "Longmont Senior Center to begin a free evening meal program on Oct. 2",
          why: "A new city service for older residents.",
          topic: "council",
          source_urls: [url],
        },
      ],
      existing,
    );
    assert.equal(result.leadsCreated, 1);
    assert.equal(result.mergedSameScan, 1);
    assert.equal(result.resurfacedOpen, 0);
    assert.equal(result.resurfacedKilled, 0);
    const stamped = (
      await db.query<{ resurfaced_count: number }>(
        "select resurfaced_count from leads where id = 5",
      )
    ).rows;
    assert.equal(stamped[0]!.resurfaced_count, 0);
    // `existing` is the caller's array and must reflect the single lead, so
    // desk.ts's later bookkeeping sees one new lead, not two.
    assert.equal(existing.length, 2);
  } finally {
    await db.close();
  }
});
