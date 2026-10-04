import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { fileScanLeads, type SqlTag } from "./lead-filing.ts";
import {
  findMatchingLead,
  isIndexPageUrl,
  isMultiItemDocumentUrl,
  matchStrength,
} from "./lead-match.ts";

/*
 * Unit AK item 1 and AK2 item 2 (2026-09-26): one story found twice in one
 * scan run becomes ONE lead.
 *
 * The real case: on 2026-09-25 leads 207 and 212 were both filed -- same city
 * page, created in the same second -- and 212 went on to be published as
 * article 73 while 207 sat on the Queue with a "≈ PRINTED" badge, unfixable
 * and unexplained. WHY, from the code:
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
 *   - But the only branch that honoured that promise was the STRONG one
 *     (lead-filing.ts:111-123, `continue`). A pair the matcher flags at the
 *     "possible" tier fell through to the INSERT at :133, so both leads were
 *     filed.
 *
 * AK item 1 fixed that for "strong" pairs only -- and the REAL 207/212 pair is
 * NOT strong. The coordinator measured the production rows on 2026-09-26:
 *
 *   207 "Longmont Senior Center to begin free evening meal program Oct. 2"
 *   212 "Longmont Senior Center to offer free evening meals beginning Oct. 2"
 *       both https://longmontcolorado.gov/news/free-evening-meals-at-the-senior-center/
 *
 * Those two headlines share only free/evening/meal as content tokens -- 0.43
 * Jaccard, far under the 0.85 "strong" bar -- so AK's merge never fired for
 * them. Test 1 below uses the REAL 212 headline; on HEAD e296cebc it fails
 * with `2 !== 1`. AK2 item 2 adds the missing evidence: both cite one article
 * page, and a shared article page addresses one story (see
 * sameStoryForMerge and isMultiItemDocumentUrl in ./lead-match.ts).
 *
 * The exception matters as much as the rule: a shared AGENDA, PACKET or
 * MINUTES document -- a PDF, a PrimeGov/Legistar/CivicClerk meeting page --
 * holds every item on a meeting, so it is not evidence of one story and a
 * "possible" pair citing one still files two linked leads. Tests 3 and 4 below
 * pin that with the QA-1 fixtures themselves (which cite exactly such a URL),
 * and the tests after them pin the URL classifier on real shapes.
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
  last_resurfaced_scan_run_id integer,
  dup_kind text, kill_reason text, kill_reason_url text, killed_at timestamptz,
  -- Migration 0113 (U28): fileScanLeads writes the duplicate check's verdict
  -- on every row it files, asked or not -- see lead-filing-blank-headline's
  -- own note on the same columns.
  dup_ai_same boolean, dup_ai_why text, dup_ai_target text,
  dup_ai_printed_same boolean, dup_ai_printed_why text, dup_ai_printed_slug text,
  dup_ai_model text, dup_ai_checked_at timestamptz
)`;

test("the 207/212 case: the same story twice in one scan run is filed once, with the source URLs merged", async () => {
  const db = new PGlite();
  try {
    await db.exec(CREATE_LEADS);
    // The exact article URL both production rows 207 and 212 carried.
    const cityPage = "https://longmontcolorado.gov/news/free-evening-meals-at-the-senior-center/";
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
          // The REAL wording of lead 212, from the production rows the
          // coordinator measured on 2026-09-26 -- not a reconstruction. It
          // shares the article URL with lead 207 above and is a "possible",
          // not a "strong", match by matchStrength's rule.
          headline: "Longmont Senior Center to offer free evening meals beginning Oct. 2",
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

/*
 * Unit AK2 item 2 (2026-09-26): the decision is the URL, not the wording.
 *
 * The two tests below use the REAL 207/212 headline pair -- the same pair
 * test 1 proves merges -- and change only the URL they cite. On an article
 * page they are one story; on an agenda/packet/minutes document they are not,
 * because such a document holds every item on a meeting.
 */

test("the real 207/212 pair citing a shared MEETING document instead of the article stays two leads", async () => {
  const db = new PGlite();
  try {
    await db.exec(CREATE_LEADS);
    // A real PrimeGov meeting page, the same one QA-1's negatives cite: it
    // holds every item on that night's agenda, so two sightings of it are not
    // two sightings of one story.
    const meetingDoc = "https://longmont.primegov.com/portal/meeting/12345";
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      958,
      [
        {
          headline: "Longmont Senior Center to begin free evening meal program Oct. 2",
          why: "A new city service.",
          topic: "council",
          source_urls: [meetingDoc],
        },
        {
          headline: "Longmont Senior Center to offer free evening meals beginning Oct. 2",
          why: "A new city service for older residents.",
          topic: "council",
          source_urls: [meetingDoc],
        },
      ],
      [],
    );
    assert.equal(result.leadsCreated, 2, "a meeting document is not evidence of one story");
    assert.equal(result.mergedSameScan, 0);
    assert.equal(result.possibleMatched, 1, "the pair is still linked for the editor, as today");
    const rows = (
      await db.query<{ id: number; possible_duplicate_of: number | null }>(
        "select id, possible_duplicate_of from leads order by id",
      )
    ).rows;
    assert.deepEqual(rows, [
      { id: 1, possible_duplicate_of: null },
      { id: 2, possible_duplicate_of: 1 },
    ]);
  } finally {
    await db.close();
  }
});

test("isMultiItemDocumentUrl: real document shapes are documents, real story shapes are not", () => {
  // Every positive below is a URL that exists in this repo's code or tests
  // (src/lib/news/primegov.ts, render-fetch.test.ts, ingest.test.ts,
  // __fixtures__/civic-scanner-v26-report-2026-09-25.json) or is the shared
  // source of the QA-1 negatives this rule must keep apart.
  for (const url of [
    // any PDF
    "https://assets.bouldercounty.gov/wp-content/uploads/2025/02/2022-048-rst-td3-transportation-extension-o.100pct.pdf",
    "https://civicclerk.example/agenda.pdf",
    "https://example.gov/packet.pdf",
    "https://archive.theboringparts.com/agenda/longmont/67966478.pdf",
    // PrimeGov documents and meetings
    "https://longmont.primegov.com/portal/meeting/12345",
    "https://longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=16823&compileOutputType=1",
    "https://longmont.primegov.com/Portal/Meeting?meetingTemplateId=16373",
    "https://primegov.example.com/longmont/agenda/2026-09-10",
    "https://primegov.example.com/longmont/meeting/executive-sessions",
    // Legistar
    "https://longmont.legistar.com/Calendar.aspx",
    // a path segment naming the container
    "https://longmontcolorado.gov/agendas/ordinance-o-2026-63/",
    "https://longmontcitycouncil.org/meetings/2026-09-15/",
    // This one is a real story page as far as isIndexPageUrl is concerned --
    // it is not a SECTION front -- but it is one council meeting's agenda,
    // which holds every item on it, so the MERGE rule treats it as a document.
    // Two different classifications for two different questions; see
    // isMultiItemDocumentUrl's doc comment.
    "https://longmontleader.com/agenda/sept-council",
    "https://bouldercounty.gov/agenda/sept-5",
    "https://civic.example/DocumentCenter/View/1234/agenda",
    "https://www.longmontcolorado.gov/minutes.html",
  ]) {
    assert.equal(isMultiItemDocumentUrl(url), true, `${url} holds many items`);
  }

  // The real 207/212 article page, and story-page shapes from the same
  // sources: a headline slug that merely CONTAINS a document word is a story.
  for (const url of [
    "https://longmontcolorado.gov/news/free-evening-meals-at-the-senior-center/",
    "https://www.timescall.com/2026/08/12/longmont-council-ranked-choice-voting/",
    "https://www.dailycamera.com/2026/09/25/longmont-council-minutes-released/",
    "https://www.longmontleader.com/local-news/why-longmont-cant-simply-ban-noisy-airplanes-at-vance-brand-airport-123",
  ]) {
    assert.equal(isMultiItemDocumentUrl(url), false, `${url} addresses one story`);
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
    // second story, which is why AK2's extra evidence is a shared page that
    // addresses ONE story, never prose (see sameStoryForMerge). The URL they
    // share is a MEETING page, the many-item shape, so the pair is kept as two
    // rows and the second is linked to the first.
    const source_urls = ["https://longmont.primegov.com/portal/meeting/12345"];
    const east = "SVVSD approves $850,000 broadband expansion for rural east county schools";
    const west = "SVVSD approves $850,000 broadband expansion for rural west county schools";
    // Why this pair cannot merge: the only URL they share is not an article.
    assert.equal(isMultiItemDocumentUrl(source_urls[0]!), true);
    assert.equal(isIndexPageUrl(source_urls[0]!), false, "it is not an index page either");
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
    // the matcher accepts. Also 'possible', also not merged: the shared URL is
    // a meeting page, a many-item document, not an article.
    const source_urls = ["https://longmont.primegov.com/portal/meeting/12345"];
    assert.equal(isMultiItemDocumentUrl(source_urls[0]!), true);
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
    const url = "https://longmontcolorado.gov/news/free-evening-meals-at-the-senior-center/";
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
          // The REAL 212 headline (see the file header): this test only proves
          // anything about the live case if the merge fires for the real pair.
          headline: "Longmont Senior Center to offer free evening meals beginning Oct. 2",
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

/*
 * Unit AK item 2 (2026-09-26): a strong match against a KILLED lead is no
 * longer discarded when the new finding says something the killed lead never
 * said. The live case: leads 218 (held) and 209 (killed, a "juvenile
 * altercation") both cite the Daily Camera crime INDEX page -- a section page
 * (see isIndexPageUrl) -- which is weak evidence of "same story". When the
 * matcher is still sure, and the finding brings facts the killed lead did not
 * have, the desk now files it HELD with the old kill reason next to it instead
 * of dropping a development on the floor. A same-headline, same-facts repeat
 * keeps today's behaviour exactly: stamp the killed row, file nothing.
 *
 * The fact bar is newFactsIn (./lead-match.ts): at least one new concrete
 * ANCHOR (a date, a dollar amount, or a number), compared over the headline
 * plus `why` and `evidence` on both sides (round 2, item 1 -- the headline was
 * excluded until a repeat of the killed 367, whose "Oct. 6" lived only in its
 * headline, was filed as a development). It was briefly "one new anchor or two
 * new content tokens"; the token half refiled a plain reword of a killed lead's
 * own words (the scan model rewrites `why` every time), which is what the
 * end-to-end test in lead-resurface.e2e.test.ts and the "reworded but
 * fact-free" case below both pin.
 */

test("killed lead + new facts: the finding is filed HELD, linked to the killed lead, which is still stamped", async () => {
  const db = new PGlite();
  try {
    await db.exec(CREATE_LEADS);
    // The shape of the 209/218 pair: both sightings are the crime index page,
    // not an article, so the shared URL is not what decides this.
    const crimeIndex = "https://www.dailycamera.com/crime/";
    const headline = "Police investigate a fight reported in northwest Longmont";
    await db.query(
      `insert into leads(id,newsroom_id,headline,why,evidence,status,source_urls,resurfaced_count)
       values(7,1,$1,$2,$3,'killed',$4,0)`,
      [
        headline,
        "Police said they were called about a fight and reported no arrests.",
        "Daily Camera crime index, Sept. 19.",
        JSON.stringify([crimeIndex]),
      ],
    );
    const sql = makeSql(db);
    const existing = [
      {
        id: 7,
        status: "killed",
        headline,
        source_urls: [crimeIndex],
        why: "Police said they were called about a fight and reported no arrests.",
        evidence: "Daily Camera crime index, Sept. 19.",
      },
    ];
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      955,
      [
        {
          headline,
          // New facts: a 17-year-old (num:17) and a Sept. 25 briefing
          // (date:09-25) the killed lead never carried -- its own evidence is
          // "Daily Camera crime index, Sept. 19." A named place alone would
          // not clear the bar (see newFactsIn in ./lead-match.ts).
          why: "Police arrested a 17-year-old after the Loomiller Park fight, the department said.",
          evidence: "Department briefing, Sept. 25.",
          topic: "council",
          source_urls: [crimeIndex],
        },
      ],
      existing,
    );
    assert.equal(result.leadsCreated, 1, "a development on a killed story is filed, not discarded");
    assert.equal(result.developingFiled, 1);
    assert.equal(result.resurfacedKilled, 0, "a filed development is not a silent stamp");
    assert.equal(result.possibleMatched, 0, "this is a strong match, not the 'possible' tier");
    const rows = (
      await db.query<{
        id: number;
        status: string;
        possible_duplicate_of: number | null;
        dup_kind: string | null;
      }>(
        // The explicit id above does not advance the serial, so the new row's
        // id is 1 here -- the killed row is identified by its own id instead.
        "select id, status, possible_duplicate_of, dup_kind from leads order by id",
      )
    ).rows;
    assert.deepEqual(
      rows.filter((r) => r.id === 7),
      [{ id: 7, status: "killed", possible_duplicate_of: null, dup_kind: null }],
    );
    const filed = rows.filter((r) => r.id !== 7);
    assert.equal(filed.length, 1, "exactly one finding is filed against the killed lead");
    assert.equal(filed[0]!.status, "held", "filed held for review, not new");
    assert.equal(filed[0]!.possible_duplicate_of, 7, "linked to the lead it matches");
    assert.equal(filed[0]!.dup_kind, "developing");
    const stamped = (
      await db.query<{ resurfaced_count: number; last_resurfaced_scan_run_id: number }>(
        "select resurfaced_count, last_resurfaced_scan_run_id from leads where id = 7",
      )
    ).rows;
    assert.equal(stamped[0]!.resurfaced_count, 1, "the killed row's came-back count stays true");
    assert.equal(stamped[0]!.last_resurfaced_scan_run_id, 955);
  } finally {
    await db.close();
  }
});

test("killed lead + the same facts: today's behaviour, stamped only, nothing filed", async () => {
  const db = new PGlite();
  try {
    await db.exec(CREATE_LEADS);
    const crimeIndex = "https://www.dailycamera.com/crime/";
    const headline = "Police investigate a fight reported in northwest Longmont";
    const why = "Police said they were called about a fight and reported no arrests.";
    const evidence = "Daily Camera crime index, Sept. 19.";
    await db.query(
      `insert into leads(id,newsroom_id,headline,why,evidence,status,source_urls,resurfaced_count)
       values(7,1,$1,$2,$3,'killed',$4,0)`,
      [headline, why, evidence, JSON.stringify([crimeIndex])],
    );
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      956,
      [{ headline, why, evidence, topic: "council", source_urls: [crimeIndex] }],
      [{ id: 7, status: "killed", headline, source_urls: [crimeIndex], why, evidence }],
    );
    assert.equal(result.leadsCreated, 0, "the same story with nothing new stays discarded");
    assert.equal(result.developingFiled, 0);
    assert.equal(result.resurfacedKilled, 1);
    assert.equal(result.firstDiscardedHeadline, headline, "the discard is still named in the summary");
    const rows = (await db.query<{ id: number }>("select id from leads order by id")).rows;
    assert.deepEqual(rows, [{ id: 7 }]);
    const stamped = (
      await db.query<{ resurfaced_count: number }>("select resurfaced_count from leads where id = 7")
    ).rows;
    assert.equal(stamped[0]!.resurfaced_count, 1);
  } finally {
    await db.close();
  }
});

test("killed lead + a reworded but fact-free finding: not a development", async () => {
  const db = new PGlite();
  try {
    await db.exec(CREATE_LEADS);
    const crimeIndex = "https://www.dailycamera.com/crime/";
    const headline = "Police investigate a fight reported in northwest Longmont";
    await db.query(
      `insert into leads(id,newsroom_id,headline,why,evidence,status,source_urls,resurfaced_count)
       values(7,1,$1,$2,$3,'killed',$4,0)`,
      [
        headline,
        "Police said they were called about a fight and reported no arrests.",
        "Daily Camera crime index, Sept. 19.",
        JSON.stringify([crimeIndex]),
      ],
    );
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      957,
      [
        {
          headline,
          // Same fact, different words. "officials" replaces "police" and
          // nothing concrete is added -- a reworded duplicate, which is the
          // noise a one-new-word bar would refile every time.
          why: "Officials said they were called about a fight and reported no arrests.",
          evidence: "Daily Camera crime index, Sept. 19.",
          topic: "council",
          source_urls: [crimeIndex],
        },
      ],
      [
        {
          id: 7,
          status: "killed",
          headline,
          source_urls: [crimeIndex],
          why: "Police said they were called about a fight and reported no arrests.",
          evidence: "Daily Camera crime index, Sept. 19.",
        },
      ],
    );
    assert.equal(result.leadsCreated, 0);
    assert.equal(result.developingFiled, 0, "a reworded duplicate is not new facts");
    assert.equal(result.resurfacedKilled, 1);
  } finally {
    await db.close();
  }
});

/*
 * The pair lead-resurface.e2e.test.ts filed as a development on the 0.6.69
 * branch (CI on PR #102, and the reason the token half of the bar was dropped).
 * The killed lead's own words are "Testing a resurfaced kill" with no evidence;
 * the scan's reworded repeat brings no anchor at all -- no date, no amount, no
 * number -- but a whole sentence of new words. Counting new words refiled it.
 */
test("killed lead + a reworded why with no new anchor: stamped, not refiled", async () => {
  const db = new PGlite();
  try {
    await db.exec(CREATE_LEADS);
    const headline = "Longmont council has two closed-door executive sessions on the books for late September";
    const url = "https://longmontleader.com/agenda/sept-council";
    await db.query(
      `insert into leads(id,newsroom_id,headline,why,evidence,status,source_urls,resurfaced_count)
       values(7,1,$1,$2,$3,'killed',$4,0)`,
      [headline, "Testing a resurfaced kill", "", JSON.stringify([url])],
    );
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      958,
      [
        {
          headline:
            "Two closed-door executive sessions are on the books for Longmont city council in late September",
          why: "Same closed-session story, reworded by the scan.",
          evidence: "",
          topic: "council",
          source_urls: [url],
        },
      ],
      [
        {
          id: 7,
          status: "killed",
          headline,
          source_urls: [url],
          why: "Testing a resurfaced kill",
          evidence: "",
        },
      ],
    );
    assert.equal(result.leadsCreated, 0, "no new row: this is the same story, reworded");
    assert.equal(
      result.developingFiled,
      0,
      "a reworded why is not a new fact -- only a new date, amount or number is",
    );
    assert.equal(result.resurfacedKilled, 1, "the kill's came-back count still moves");
    const rows = (await db.query<{ id: number }>("select id from leads order by id")).rows;
    assert.deepEqual(rows, [{ id: 7 }], "the killed row is the only lead");
  } finally {
    await db.close();
  }
});

/*
  U26b (2026-09-30): the region words the matcher treats as the paper's own
  furniture arrive from the CALLER (`fileScanLeads`'s last argument -- see
  NewsroomPlace in ./lead-match.ts), not from the shipped Longmont constants.
  These two cases are the same pair filed twice, changing only that argument:
  a place and a month, two different county stories, one county page.

  With the paper's own place -- Longmont, Colorado, Boulder County -- "Boulder"
  and "Longmont" are the newsroom's furniture, so the pair has no shared
  evidence and the candidate is a plain new lead. With no place at all the
  same two words read as names and the pair is a "possible" duplicate, linked
  but still filed. That difference IS the parameter: desk.ts's performScanWork
  passes the first (via `getPaperPlace`), and a caller that says nothing about
  where its paper is gets the second rather than Longmont's answer.
*/
const U26B_COUNTY_PAGE = ["https://bouldercounty.gov/agendas/"];
const U26B_PLACE = { city: "Longmont", state: "Colorado", county: "Boulder" };
const U26B_EXISTING = {
  // Not 1: the row this insert creates takes id 1, and the two ids are
  // different things -- one is the lead already on the desk, the other is
  // the candidate this call files.
  id: 41,
  status: "new",
  headline: "Boulder County commissioners honor Longmont artists Oct. 24",
  source_urls: U26B_COUNTY_PAGE,
};
const U26B_CANDIDATE = {
  headline: "Boulder County commissioners open Longmont vaccine clinic Oct. 5",
  why: "A different item on the same county page.",
  evidence: "",
  topic: "council",
  source_urls: U26B_COUNTY_PAGE,
};

test("U26b: with the newsroom's own place, a county page plus a month is not a duplicate", async () => {
  const db = new PGlite();
  try {
    await db.exec(CREATE_LEADS);
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      960,
      [U26B_CANDIDATE],
      [{ ...U26B_EXISTING }],
      U26B_PLACE,
    );
    assert.equal(result.leadsCreated, 1, "the candidate is filed");
    assert.equal(result.possibleMatched, 0, "the paper's own place and a month are not a shared subject");
    const rows = (
      await db.query<{ id: number; possible_duplicate_of: number | null; status: string }>(
        "select id, possible_duplicate_of, status from leads order by id",
      )
    ).rows;
    assert.deepEqual(rows, [{ id: 1, possible_duplicate_of: null, status: "new" }]);
  } finally {
    await db.close();
  }
});

test("U26b: with no place passed at all, nothing is furniture and the same pair links -- no newsroom's region is assumed", async () => {
  const db = new PGlite();
  try {
    await db.exec(CREATE_LEADS);
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      961,
      [U26B_CANDIDATE],
      [{ ...U26B_EXISTING }],
    );
    assert.equal(result.leadsCreated, 1, "a possible match is filed, never discarded");
    assert.equal(result.possibleMatched, 1, "with no place to call its own, both names are evidence");
    const rows = (
      await db.query<{ id: number; possible_duplicate_of: number | null; dup_kind: string | null }>(
        "select id, possible_duplicate_of, dup_kind from leads order by id",
      )
    ).rows;
    assert.deepEqual(rows, [{ id: 1, possible_duplicate_of: 41, dup_kind: "possible" }]);
  } finally {
    await db.close();
  }
});

/*
  Unit AN (2026-10-03): the live scan-66 repeats. On 2026-10-03 scan run 66
  filed 20 leads, nearly all of them the same stories the preceding scans had
  already filed, and only 4 carried a duplicate link at all. The owner named
  them by id from the 30-day export:

    416 / 422 / 430  North Pace Street Entrance ... Fox Creek Village reopens
                      -- three sightings of ONE story inside ONE scan run
    430              exact repeat (case and punctuation aside) of lead 412
    418              exact repeat of lead 349
    431              exact repeat of leads 316 and 238

  WHY none of them was caught: every one of those headlines is Title Case and
  made entirely of words four letters or longer that are capitalised, so
  `contentTokens` (./lead-match.ts) -- which strips proper nouns, the paper's
  own place, and civic furniture -- came back EMPTY for both sides of every
  one of those pairs. An empty token set makes jaccard() and containment()
  return 0 by definition, so all three of pairMatches' paths were unreachable
  even for a byte-identical headline against a shared article URL (418/349).
  The matcher's evidence gate was the same hole from the other side: it
  required >= 1 shared content token, which a names-only pair can never have.
  `distinguishingTokens` fixes both: when NEITHER headline has a content
  token, a headline is scored on its own non-stoplisted proper nouns instead,
  and the evidence gate accepts >= NAME_ONLY_MIN_SHARED (2) shared names.

  The four cases below are the real scan-66 headlines, URLs and statuses, run
  through the real filing path (fileScanLeads) against a real scratch
  database. Each one is RED on the pre-fix matcher: without the fix every pair
  is `null` and every candidate files as a new lead, so 416/422/430 become
  three rows, 418 and 431 become new rows again, and the true repeat in the
  last test never merges. The last test carries its own positive control (the
  true repeat that MUST merge) next to the different-story pairs that must
  not, which is what makes a negative case observable on the same run -- a
  negative alone reads identically before and after the fix.

  No test here passes a `dupCheck`: the desk's AI duplicate check is an
  argument, not a model call, so nothing in this file can reach a model.
*/

const SCAN66_PLACE = { city: "Longmont", state: "Colorado", county: "Boulder" };
// The real URLs the production rows carried (leads-30d.csv, source_urls).
const FOX_CREEK_STORY = "https://longmontcolorado.gov/news/north-pace-entrance-fox-creek-village-reopens/";
const CITY_FEED = "https://longmontcolorado.gov/news/?feed=rss2";
const CITY_NEWS_INDEX = "https://longmontcolorado.gov/news/";
const CALLAHAN_EVENT = "https://longmontcolorado.gov/event/callahan-house-video-release-party-at-tend-studio/";
const LPM_CATEGORY = "https://longmontpublicmedia.org/category/news/";
const LPM_WATCH = "https://longmontpublicmedia.org/watch/";

const FOX_412 = "North Pace Street Entrance at Fox Creek Village and King Soopers Reopens";
const FOX_416 =
  "North Pace Street Entrance to Fox Creek Village Reopens; South Entrance Remains Closed";
const FOX_422 =
  "North Pace Street Entrance at Fox Creek Village and King Soopers Reopens; South Entrance Still Closed";
const FOX_430 = "North Pace Street Entrance at Fox Creek Village and King Soopers Reopens";
// Lead 412's own why/evidence, reused verbatim where a test needs the repeat
// to carry NO fact the killed lead did not already have.
const FOX_412_WHY = "The city said the north entrance had reopened.";
const FOX_412_EVIDENCE = "City news release.";
const CALLAHAN_418 = "Callahan House Video Release Party Set for Oct. 8 at Tend Studio";
const LPM_431 = "Longmont Public Media Raising $24,000 for New Community Podcast Studio";
// The killed leads' own words, reused verbatim so the repeats below carry no
// fact their killed rows did not already have.
const CALLAHAN_349_WHY = "The Callahan House video release party was announced for Oct. 8.";
const LPM_316_WHY = "Longmont Public Media is raising money for a podcast studio.";

test("scan 66: the three Fox Creek sightings in one run are one marked repeat plus one resurface, never three rows", async () => {
  const db = new PGlite();
  try {
    await db.exec(CREATE_LEADS);
    // Lead 412, killed by scan 65 before this run -- the exact wording 430
    // repeats. Its only source URL is the city news feed, an index page.
    await db.query(
      `insert into leads(id,newsroom_id,scan_run_id,headline,why,evidence,status,source_urls,resurfaced_count)
       values(412,1,65,$1,$2,$3,'killed',$4,0)`,
      [FOX_412, FOX_412_WHY, FOX_412_EVIDENCE, JSON.stringify([CITY_FEED])],
    );
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      66,
      [
        {
          headline: FOX_416,
          why: "The north entrance to Fox Creek Village is open again.",
          evidence: "City news release, Oct. 3.",
          topic: "council",
          source_urls: [FOX_CREEK_STORY],
        },
        {
          headline: FOX_422,
          why: "The reopening affects the Fox Creek Village entrance near King Soopers.",
          evidence: "City news release, Oct. 3.",
          topic: "council",
          source_urls: [CITY_FEED, FOX_CREEK_STORY],
        },
        {
          headline: FOX_430,
          // The killed lead 412's own words: this sighting says nothing 412
          // did not already say, so it is a resurface and not a development
          // (see newFactsIn -- a new date or amount in `why`/`evidence` is
          // what files the HELD case the last test in this block pins).
          why: FOX_412_WHY,
          evidence: FOX_412_EVIDENCE,
          topic: "council",
          source_urls: [CITY_NEWS_INDEX, CITY_FEED],
        },
      ],
      [{ id: 412, status: "killed", headline: FOX_412, source_urls: [CITY_FEED], why: FOX_412_WHY, evidence: FOX_412_EVIDENCE }],
      SCAN66_PLACE,
    );
    assert.equal(result.leadsCreated, 1, "three sightings of one story are ONE new lead, not three");
    assert.equal(result.mergedSameScan, 1, "422 is folded into 416 and counted, not silently dropped");
    assert.equal(result.resurfacedKilled, 1, "430 is the killed lead's story coming back, not a new lead");
    const rows = (
      await db.query<{ id: number; headline: string; source_urls: string; possible_duplicate_of: number | null; status: string }>(
        "select id, headline, source_urls, possible_duplicate_of, status from leads order by id",
      )
    ).rows;
    assert.equal(rows.length, 2, "the killed row and the one new lead -- 422 and 430 add no rows");
    const filed = rows.find((r) => r.id !== 412)!;
    assert.equal(filed.headline, FOX_416, "the first sighting of the story is the one kept");
    // Round 2 item 2 (2026-10-04): this is the real dev-scan 417 / scan-66 416
    // case. The same-story-as-412 sighting must reach the desk CARRYING A
    // MARKER -- before the fix it was filed as a bare open lead with
    // possible_duplicate_of null, which is what let 417 sit in the queue
    // looking new while 412 was the same story (REAL-SCAN-DEV.md section 3:
    // "the desk's matcher caught 8 of the 9 repeats in this run; 417 is the
    // miss"). Held + linked is the marker; it is still ONE row.
    assert.equal(filed.status, "held", "a repeat of a killed lead is filed held for the desk to look at");
    assert.equal(filed.possible_duplicate_of, 412, "and it says WHICH lead it repeats");
    assert.deepEqual(
      JSON.parse(filed.source_urls),
      [FOX_CREEK_STORY, CITY_FEED],
      "both sightings' URLs survive on the one lead -- merging must not drop evidence",
    );
    const killed = (
      await db.query<{ resurfaced_count: number; last_resurfaced_scan_run_id: number }>(
        "select resurfaced_count, last_resurfaced_scan_run_id from leads where id = 412",
      )
    ).rows;
    assert.equal(killed[0]!.resurfaced_count, 1, "the killed row's came-back count stays true");
    assert.equal(killed[0]!.last_resurfaced_scan_run_id, 66, "and says WHICH run saw it again");
  } finally {
    await db.close();
  }
});

test("scan 66: lead 430's headline is an exact repeat of killed lead 412 -- stamped, not re-filed", async () => {
  const db = new PGlite();
  try {
    await db.exec(CREATE_LEADS);
    await db.query(
      `insert into leads(id,newsroom_id,scan_run_id,headline,why,evidence,status,source_urls,resurfaced_count)
       values(412,1,65,$1,$2,$3,'killed',$4,0)`,
      [FOX_412, FOX_412_WHY, FOX_412_EVIDENCE, JSON.stringify([CITY_FEED])],
    );
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      66,
      [
        {
          // Byte-identical to 412. Both sides cite only index pages, so there
          // is no shared URL for the matcher to lean on -- the identity has to
          // be read off the headline itself.
          headline: FOX_430,
          why: FOX_412_WHY,
          evidence: FOX_412_EVIDENCE,
          topic: "council",
          source_urls: [CITY_NEWS_INDEX, CITY_FEED],
        },
      ],
      [{ id: 412, status: "killed", headline: FOX_412, source_urls: [CITY_FEED], why: FOX_412_WHY, evidence: FOX_412_EVIDENCE }],
      SCAN66_PLACE,
    );
    assert.equal(result.leadsCreated, 0, "the same headline with nothing new is discarded, not re-filed");
    assert.equal(result.resurfacedKilled, 1);
    assert.equal(result.firstDiscardedHeadline, FOX_430, "the discard is named in the scan summary");
    const rows = (await db.query<{ id: number }>("select id from leads order by id")).rows;
    assert.deepEqual(rows, [{ id: 412 }], "the killed row is the only lead");
    const killed = (await db.query<{ resurfaced_count: number }>("select resurfaced_count from leads where id = 412")).rows;
    assert.equal(killed[0]!.resurfaced_count, 1, "the repeat still moves the came-back count");
  } finally {
    await db.close();
  }
});

test("scan 66: when the repeat of a killed lead does carry a new fact, it is filed HELD and linked -- not as an unflagged new lead", async () => {
  const db = new PGlite();
  try {
    await db.exec(CREATE_LEADS);
    await db.query(
      `insert into leads(id,newsroom_id,scan_run_id,headline,why,evidence,status,source_urls,resurfaced_count)
       values(412,1,65,$1,$2,$3,'killed',$4,0)`,
      [FOX_412, FOX_412_WHY, FOX_412_EVIDENCE, JSON.stringify([CITY_FEED])],
    );
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      66,
      [
        {
          headline: FOX_430,
          // The same story, but the scan read a dated release 412 never had
          // (date:10-03 -- 412's own evidence carries no date). Unit AK item
          // 2: a killed story that has developed comes back for review rather
          // than being discarded -- and, unlike what scan 66 actually did
          // with 418 and 431, it now says on the row WHAT it repeats.
          why: FOX_412_WHY,
          evidence: "City news release, Oct. 3.",
          topic: "council",
          source_urls: [CITY_NEWS_INDEX, CITY_FEED],
        },
      ],
      [{ id: 412, status: "killed", headline: FOX_412, source_urls: [CITY_FEED], why: FOX_412_WHY, evidence: FOX_412_EVIDENCE }],
      SCAN66_PLACE,
    );
    assert.equal(result.leadsCreated, 1);
    assert.equal(result.developingFiled, 1, "a new fact on a killed story is a development, not a discard");
    assert.equal(result.resurfacedKilled, 0, "a filed development is not a silent stamp");
    const filed = (
      await db.query<{ status: string; possible_duplicate_of: number | null; dup_kind: string | null }>(
        "select status, possible_duplicate_of, dup_kind from leads where id <> 412",
      )
    ).rows;
    assert.deepEqual(filed, [{ status: "held", possible_duplicate_of: 412, dup_kind: "developing" }]);
  } finally {
    await db.close();
  }
});

test("scan 66: leads 418 and 431 are exact repeats of killed leads -- both stamped, neither re-filed", async () => {
  const db = new PGlite();
  try {
    await db.exec(CREATE_LEADS);
    await db.query(
      `insert into leads(id,newsroom_id,scan_run_id,headline,why,evidence,status,source_urls,resurfaced_count)
       values(349,1,62,$1,$2,$3,'killed',$4,0), (316,1,56,$5,$6,$7,'killed',$8,0)`,
      [
        CALLAHAN_418,
        CALLAHAN_349_WHY,
        "City events calendar.",
        JSON.stringify([CALLAHAN_EVENT]),
        LPM_431,
        LPM_316_WHY,
        "Station news page.",
        JSON.stringify([LPM_CATEGORY]),
      ],
    );
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      66,
      [
        {
          headline: CALLAHAN_418,
          why: CALLAHAN_349_WHY,
          evidence: "City events calendar.",
          topic: "arts",
          source_urls: [CALLAHAN_EVENT],
        },
        {
          headline: LPM_431,
          why: LPM_316_WHY,
          evidence: "Station news page.",
          topic: "arts",
          source_urls: [LPM_CATEGORY, LPM_WATCH],
        },
      ],
      [
        { id: 349, status: "killed", headline: CALLAHAN_418, source_urls: [CALLAHAN_EVENT], why: CALLAHAN_349_WHY, evidence: "City events calendar." },
        { id: 316, status: "killed", headline: LPM_431, source_urls: [LPM_CATEGORY], why: LPM_316_WHY, evidence: "Station news page." },
      ],
      SCAN66_PLACE,
    );
    assert.equal(result.leadsCreated, 0, "both are stories the desk already killed, not fresh leads");
    assert.equal(result.resurfacedKilled, 2);
    const rows = (await db.query<{ id: number; status: string }>("select id, status from leads order by id")).rows;
    assert.deepEqual(rows, [{ id: 316, status: "killed" }, { id: 349, status: "killed" }]);
    const killed = (
      await db.query<{ id: number; resurfaced_count: number; last_resurfaced_scan_run_id: number }>(
        "select id, resurfaced_count, last_resurfaced_scan_run_id from leads order by id",
      )
    ).rows;
    assert.deepEqual(killed, [
      { id: 316, resurfaced_count: 1, last_resurfaced_scan_run_id: 66 },
      { id: 349, resurfaced_count: 1, last_resurfaced_scan_run_id: 66 },
    ]);
  } finally {
    await db.close();
  }
});

test("scan 66: one run merges the true Fox Creek repeat and still keeps three different stories apart on one index page", async () => {
  const db = new PGlite();
  try {
    await db.exec(CREATE_LEADS);
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      66,
      [
        {
          headline: FOX_416,
          why: "The north entrance to Fox Creek Village is open again.",
          evidence: "City news release, Oct. 3.",
          topic: "council",
          source_urls: [FOX_CREEK_STORY],
        },
        {
          // The positive control: the same story, reworded, in this same run.
          headline: FOX_422,
          why: "The reopening affects the Fox Creek Village entrance near King Soopers.",
          evidence: "City news release, Oct. 3.",
          topic: "council",
          source_urls: [CITY_FEED, FOX_CREEK_STORY],
        },
        {
          // A different story whose ONLY URL is the same generic city news
          // index page 422 cites. Both headlines are names-only, so this is
          // exactly the pair the fix could have over-merged.
          headline: "Longmont Library to Close All Day Oct. 6 for Staff Training",
          why: "The library will close for a staff training day.",
          evidence: "Library page, Oct. 3.",
          topic: "council",
          source_urls: [CITY_NEWS_INDEX],
        },
        {
          headline: "Longmont Museum Sets Oct. 17 Reopening After Nearly $10 Million Expansion",
          why: "The museum reopens after an expansion.",
          evidence: "Museum page, Oct. 3.",
          topic: "arts",
          source_urls: [CITY_NEWS_INDEX],
        },
        {
          // Shares TWO non-stoplisted names with the museum lead -- the venue
          // and the verb "Sets" -- which clears the names-only evidence bar.
          // It is told apart by the score bars: 2 shared tokens out of a
          // 10-token union is 0.2 Jaccard and 0.4 containment, under both.
          headline: "Longmont Museum Sets Fall Docent Training for Oct. 20",
          why: "The museum is training new docents.",
          evidence: "Museum page, Oct. 3.",
          topic: "arts",
          source_urls: [CITY_NEWS_INDEX],
        },
      ],
      [],
      SCAN66_PLACE,
    );
    assert.equal(result.mergedSameScan, 1, "only the true same-story pair merges");
    assert.equal(result.leadsCreated, 4, "416+422 is one lead; the other three stories stay three leads");
    const rows = (
      await db.query<{ headline: string; source_urls: string }>("select headline, source_urls from leads order by id")
    ).rows;
    assert.deepEqual(
      rows.map((r) => r.headline),
      [
        FOX_416,
        "Longmont Library to Close All Day Oct. 6 for Staff Training",
        "Longmont Museum Sets Oct. 17 Reopening After Nearly $10 Million Expansion",
        "Longmont Museum Sets Fall Docent Training for Oct. 20",
      ],
      "a shared generic index page is not evidence of one story, and neither is a shared venue name",
    );
    assert.deepEqual(
      JSON.parse(rows[0]!.source_urls),
      [FOX_CREEK_STORY, CITY_FEED],
      "the merged lead keeps the index URL the second sighting brought",
    );
  } finally {
    await db.close();
  }
});

test("the names-only fallback needs BOTH headlines to be nameless: a names-only repeat still matches, but never against a headline with subject vocabulary", async () => {
  // No database: this is the matcher's own gate, the thing that decides
  // whether the four cases above are reachable at all.
  const namesOnly = { headline: FOX_430, source_urls: [CITY_NEWS_INDEX, CITY_FEED] };
  const exactRepeat = { headline: FOX_412, source_urls: [CITY_FEED] };
  assert.equal(
    matchStrength(namesOnly, exactRepeat, SCAN66_PLACE),
    "strong",
    "a byte-identical names-only headline is the strongest evidence there is",
  );
  const withSubjects = {
    headline: "Council approves $180,000 police overtime contract at Sept. 12 meeting",
    source_urls: [CITY_FEED],
  };
  assert.equal(
    matchStrength(namesOnly, withSubjects, SCAN66_PLACE),
    null,
    "one nameless side is not a licence to score names: the pair has no shared subject at all",
  );
  assert.equal(findMatchingLead(namesOnly, [{ id: 1, status: "killed", ...withSubjects }], SCAN66_PLACE), null);
});
