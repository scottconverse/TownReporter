import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { fileScanLeads, type SqlTag } from "./lead-filing.ts";
import { collectDupPairs, runDupCheck, type DupCheckChat, type DupCheckOutcome } from "./dup-check.ts";
import { printedDupChip } from "./desk-copy.ts";

/*
 * Unit U28 (2026-09-30): what the desk's duplicate check does to the ROW.
 *
 * dup-check.test.ts proves the question and the answer; this proves the two
 * things `fileScanLeads` does with one, against a real (scratch PGlite) table
 * so the stored columns are the columns a Queue read gets back:
 *
 *   - a "no" on the matcher's "possible" tier means NO LINK. The candidate
 *     files as a plain new lead -- `possible_duplicate_of` and `dup_kind` stay
 *     null, so there is no "Possible duplicate · compare" chip -- and the row
 *     keeps the verdict and the model's sentence so the desk can still say why.
 *     The first test below IS the mutation witness: make lead-filing.ts ignore
 *     the verdict and it fails on `possible_duplicate_of`.
 *   - a "yes" keeps the link and records the reason the chip shows.
 *   - a check that did not run (failed, timed out, unreadable) leaves every
 *     column null and the row exactly as the word rule filed it before this
 *     unit existed. Null is not "no", and the tests say so out loud.
 *
 * The scratch table carries migration 0113's columns for the reason
 * lead-filing-blank-headline.test.ts's own note gives: a table built without
 * them fails the insert with a missing-column error, which is a missing
 * migration rather than a filing bug.
 */

const PLACE = { city: "Longmont", state: "Colorado", county: "Boulder" };

function makeSql(db: PGlite): SqlTag {
  return async <T>(parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.reduce((out, part, i) => out + (i ? `$${i}` : "") + part, "");
    return (await db.query<T>(query, values)).rows;
  };
}

async function scratch(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`create table leads (
    id serial primary key, user_id text, newsroom_id integer, scan_run_id integer,
    headline text, why text, topic text, source_urls text, evidence text,
    newsworthiness integer, status text, possible_duplicate_of integer,
    topic_unchosen boolean not null default false,
    resurfaced_count integer default 0, last_resurfaced_at timestamptz,
    last_resurfaced_scan_run_id integer, dup_kind text,
    dup_ai_same boolean, dup_ai_why text, dup_ai_target text,
    dup_ai_printed_same boolean, dup_ai_printed_why text, dup_ai_printed_slug text,
    dup_ai_model text, dup_ai_checked_at timestamptz
  )`);
  return db;
}

/**
 * The real pair from lead-match.ts's own doc comment: one PrimeGov page, two
 * headlines, "possible" rather than "strong" because their content-token
 * Jaccard is nowhere near matchStrength's 0.85 bar. The desk files the second
 * as its own lead and links it -- which is exactly the pair the owner's
 * duplicate check gets to settle.
 */
const EXISTING_HEADLINE =
  "Longmont council has two closed-door executive sessions on the books for late September";
const CANDIDATE = {
  headline:
    "Council books two executive sessions in eight days -- Sept. 22 and Sept. 29 -- with packets already posted",
  why: "Both packets are public.",
  topic: "council",
  source_urls: ["https://longmontleader.com/agenda/sept-council"],
};

/** A candidate the word rule flags against a PUBLISHED story: two shared real
 * names and the same section (see nearDuplicate in desk-copy.ts). */
const BOHN_CANDIDATE = {
  headline: "Bohn Farm rezoning heads to the planning board in October",
  why: "The board takes it up Tuesday.",
  topic: "council",
  source_urls: ["https://longmontleader.com/bohn-farm-rezoning"],
};
const BOHN_PRINTED = [
  {
    slug: "bohn-farm-water-tests",
    headline: "Bohn Farm well water tests find nitrates near the creek",
    dek: "Testing found the creek downstream of the farm over the limit.",
    topic: "council",
    published_at: "2026-09-01T10:00:00Z",
  },
];

const answering = (same: boolean, why: string): DupCheckChat =>
  async (_system, user) =>
    ({
      ok: true as const,
      text: JSON.stringify((JSON.parse(user) as { id: number }[]).map((p) => ({ id: p.id, same, why }))),
      model: "deepseek-v4.1-flash:cloud",
    });

const failing: DupCheckChat = async () => ({ ok: false, error: "timed out after 90000ms" });

/*
 * Round 2 item 1 (2026-10-04): the real dev-scan pair. The word rule rated the
 * pair "possible"; the desk's check then READ BOTH and answered "same story",
 * and the finding states no date, amount or number the killed row did not. The
 * live run filed it anyway -- one story on the desk twice. Both rows below are
 * copied from leads-30d.csv (336 and the dev run's 419).
 */
const HHSS_PAGE =
  "https://longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=17299&compileOutputType=1";
const HHSS_KILLED_HEADLINE = "Housing and Human Services Advisory Board Cancels Oct. 8 Meeting";
const HHSS_CANDIDATE = {
  headline: "Longmont Housing and Human Services Board Schedules October Funding Hearings",
  why: "October funding hearings are scheduled.",
  topic: "council",
  source_urls: [HHSS_PAGE],
};

type FiledRow = {
  id: number;
  status: string;
  possible_duplicate_of: number | null;
  dup_kind: string | null;
  resurfaced_count: number;
  last_resurfaced_scan_run_id: number | null;
  dup_ai_same: boolean | null;
  dup_ai_why: string | null;
  dup_ai_target: string | null;
  dup_ai_printed_same: boolean | null;
  dup_ai_printed_why: string | null;
  dup_ai_printed_slug: string | null;
  dup_ai_model: string | null;
  dup_ai_checked_at: string | null;
};

async function filedRows(sql: SqlTag): Promise<FiledRow[]> {
  return sql<FiledRow>`select id, status, possible_duplicate_of, dup_kind,
    resurfaced_count, last_resurfaced_scan_run_id,
    dup_ai_same, dup_ai_why, dup_ai_target,
    dup_ai_printed_same, dup_ai_printed_why, dup_ai_printed_slug,
    dup_ai_model, dup_ai_checked_at from leads order by id`;
}

describe("U28: the duplicate check settles the link the matcher only guessed at", () => {
  it("a 'no' files the candidate as a plain new lead: no possible_duplicate_of, no chip, and the reason kept", async () => {
    const db = await scratch();
    try {
      const sql = makeSql(db);
      const seeded = await sql<{ id: number }>`
        insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls, newsworthiness)
        values (${"u"}, ${1}, ${EXISTING_HEADLINE}, ${"Two closed sessions are scheduled."},
                ${"council"}, ${"new"},
                ${JSON.stringify(["https://longmontleader.com/agenda/sept-council"])}, 6)
        returning id
      `;
      const existing = [
        {
          id: seeded[0]!.id,
          status: "new",
          headline: EXISTING_HEADLINE,
          source_urls: ["https://longmontleader.com/agenda/sept-council"],
        },
      ];

      const { pairs } = collectDupPairs({
        candidates: [CANDIDATE],
        existing,
        printed: [],
        place: PLACE,
      });
      assert.equal(pairs.length, 1, "the matcher rates this pair 'possible', so the desk asks");
      assert.equal(pairs[0]!.kind, "lead");

      const outcome = await runDupCheck({
        pairs,
        chat: answering(false, "one is an executive session, the other is a permit hearing"),
      });

      const result = await fileScanLeads(
        sql,
        { userId: "u" },
        1,
        901,
        [CANDIDATE],
        existing,
        PLACE,
        outcome,
      );

      assert.equal(result.leadsCreated, 1);
      assert.equal(result.possibleMatched, 0, "the link the words earned was not made");
      assert.equal(result.dupCheckCleared, 1, "and the run's own record says so");

      const [filed] = (await filedRows(sql)).filter((r) => r.id !== seeded[0]!.id);
      assert.equal(filed!.possible_duplicate_of, null, "no link, so the Queue draws no chip");
      assert.equal(filed!.dup_kind, null);
      assert.equal(filed!.status, "new");
      // The verdict is still on the row: "why is this one not linked?" has an
      // answer without a log.
      assert.equal(filed!.dup_ai_same, false);
      assert.equal(filed!.dup_ai_why, "one is an executive session, the other is a permit hearing");
      assert.equal(filed!.dup_ai_target, EXISTING_HEADLINE);
      assert.equal(filed!.dup_ai_model, "deepseek-v4.1-flash:cloud");
      assert.ok(filed!.dup_ai_checked_at, "the check is stamped when it happened");
    } finally {
      await db.close();
    }
  });

  it("the control: with no verdict the same pair files linked, exactly as before this unit", async () => {
    const db = await scratch();
    try {
      const sql = makeSql(db);
      const seeded = await sql<{ id: number }>`
        insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls, newsworthiness)
        values (${"u"}, ${1}, ${EXISTING_HEADLINE}, ${"Two closed sessions are scheduled."},
                ${"council"}, ${"new"},
                ${JSON.stringify(["https://longmontleader.com/agenda/sept-council"])}, 6)
        returning id
      `;
      const existing = [
        {
          id: seeded[0]!.id,
          status: "new",
          headline: EXISTING_HEADLINE,
          source_urls: ["https://longmontleader.com/agenda/sept-council"],
        },
      ];

      const result = await fileScanLeads(
        sql,
        { userId: "u" },
        1,
        902,
        [CANDIDATE],
        existing,
        PLACE,
        null,
      );

      assert.equal(result.possibleMatched, 1);
      assert.equal(result.dupCheckCleared, 0);
      const [filed] = (await filedRows(sql)).filter((r) => r.id !== seeded[0]!.id);
      assert.equal(filed!.possible_duplicate_of, seeded[0]!.id);
      assert.equal(filed!.dup_kind, "possible");
      assert.equal(filed!.dup_ai_same, null, "the desk did not ask, which is not the same as 'no'");
      assert.equal(filed!.dup_ai_why, null);
    } finally {
      await db.close();
    }
  });

  it("a 'yes' keeps the link and records the reason the chip shows", async () => {
    const db = await scratch();
    try {
      const sql = makeSql(db);
      const seeded = await sql<{ id: number }>`
        insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls, newsworthiness)
        values (${"u"}, ${1}, ${EXISTING_HEADLINE}, ${"Two closed sessions are scheduled."},
                ${"council"}, ${"held"},
                ${JSON.stringify(["https://longmontleader.com/agenda/sept-council"])}, 6)
        returning id
      `;
      const existing = [
        {
          id: seeded[0]!.id,
          status: "held",
          headline: EXISTING_HEADLINE,
          source_urls: ["https://longmontleader.com/agenda/sept-council"],
        },
      ];
      const { pairs } = collectDupPairs({ candidates: [CANDIDATE], existing, printed: [], place: PLACE });
      const outcome = await runDupCheck({
        pairs,
        chat: answering(true, "same two executive sessions, same Sept. 22 and Sept. 29 dates"),
      });

      const result = await fileScanLeads(sql, { userId: "u" }, 1, 903, [CANDIDATE], existing, PLACE, outcome);

      assert.equal(result.possibleMatched, 1, "a yes leaves the word rule's link alone");
      assert.equal(result.dupCheckCleared, 0);
      const [filed] = (await filedRows(sql)).filter((r) => r.id !== seeded[0]!.id);
      assert.equal(filed!.possible_duplicate_of, seeded[0]!.id);
      assert.equal(filed!.dup_ai_same, true);
      assert.equal(filed!.dup_ai_why, "same two executive sessions, same Sept. 22 and Sept. 29 dates");
      assert.equal(filed!.dup_ai_target, EXISTING_HEADLINE);
    } finally {
      await db.close();
    }
  });

  it("a 'yes' with no new fact stamps the matched lead and files nothing (round 2 item 1)", async () => {
    // red without the round-2 branch in fileScanLeads (lead-filing.ts): with it
    // removed, this pair falls to the tier's default and a second HELD row is
    // filed -- one story on the desk twice, which is the defect item 1 names.
    const db = await scratch();
    try {
      const sql = makeSql(db);
      const seeded = await sql<{ id: number }>`
        insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls, newsworthiness)
        values (${"u"}, ${1}, ${HHSS_KILLED_HEADLINE}, ${"The board cancelled its Oct. 8 meeting."},
                ${"council"}, ${"killed"},
                ${JSON.stringify([HHSS_PAGE])}, 6)
        returning id
      `;
      const existing = [
        {
          id: seeded[0]!.id,
          status: "killed",
          headline: HHSS_KILLED_HEADLINE,
          source_urls: [HHSS_PAGE],
        },
      ];
      const { pairs } = collectDupPairs({ candidates: [HHSS_CANDIDATE], existing, printed: [], place: PLACE });
      assert.equal(pairs.length, 1, "the word rule rated the pair 'possible', so the desk asks about it");
      const outcome = await runDupCheck({
        pairs,
        chat: answering(true, "the same funding-hearing notice for the same board"),
      });

      const result = await fileScanLeads(sql, { userId: "u" }, 1, 905, [HHSS_CANDIDATE], existing, PLACE, outcome);

      assert.equal(result.leadsCreated, 0, "a resurfacing is a stamp, not a row");
      assert.equal(result.resurfacedKilled, 1, "and the run's own record calls it a resurfacing");
      assert.equal(result.possibleMatched, 0, "the link the word rule only guessed at is not made");
      assert.equal(result.dupCheckCleared, 0, "this is not the 'not the same' path either");
      const rows = await filedRows(sql);
      assert.equal(rows.length, 1, "the only row on the desk is the one that was already there");
      assert.equal(rows[0]!.id, seeded[0]!.id);
      assert.equal(rows[0]!.resurfaced_count, 1);
      assert.equal(rows[0]!.last_resurfaced_scan_run_id, 905, "and it records WHICH run saw it come back");
      assert.equal(rows[0]!.possible_duplicate_of, null, "nothing links the candidate -- there is no candidate");
    } finally {
      await db.close();
    }
  });

  it("a 'yes' WITH a new fact still files the developing lead (control for round 2 item 1)", async () => {
    // The other half of the rule: the same 'yes' verdict, but the candidate
    // states a date the killed row did not -- a genuinely changed fact -- so it
    // is a development worth its own row, not a resurfacing to be stamped. This
    // is the pair the first test in this file already uses (CANDIDATE carries
    // Sept. 22 and Sept. 29; EXISTING_HEADLINE says only "late September").
    const db = await scratch();
    try {
      const sql = makeSql(db);
      const seeded = await sql<{ id: number }>`
        insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls, newsworthiness)
        values (${"u"}, ${1}, ${EXISTING_HEADLINE}, ${"Two closed sessions are scheduled."},
                ${"council"}, ${"killed"},
                ${JSON.stringify(["https://longmontleader.com/agenda/sept-council"])}, 6)
        returning id
      `;
      const existing = [
        {
          id: seeded[0]!.id,
          status: "killed",
          headline: EXISTING_HEADLINE,
          source_urls: ["https://longmontleader.com/agenda/sept-council"],
        },
      ];
      const { pairs } = collectDupPairs({ candidates: [CANDIDATE], existing, printed: [], place: PLACE });
      const outcome = await runDupCheck({ pairs, chat: answering(true, "same sessions, but the dates are new") });

      const result = await fileScanLeads(sql, { userId: "u" }, 1, 906, [CANDIDATE], existing, PLACE, outcome);

      assert.equal(result.leadsCreated, 1, "a new fact earns a row");
      assert.equal(result.resurfacedKilled, 0);
      const [filed] = (await filedRows(sql)).filter((r) => r.id !== seeded[0]!.id);
      assert.equal(filed!.status, "held", "and it is held, linked to the lead it develops");
      assert.equal(filed!.possible_duplicate_of, seeded[0]!.id);
      assert.equal(filed!.dup_kind, "possible");
    } finally {
      await db.close();
    }
  });

  it("a check that could not run leaves the row exactly as the word rule filed it", async () => {
    const db = await scratch();
    try {
      const sql = makeSql(db);
      const seededRows = await sql<{ id: number }>`
        insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls, newsworthiness)
        values (${"u"}, ${1}, ${EXISTING_HEADLINE}, ${"Two closed sessions are scheduled."},
                ${"council"}, ${"killed"},
                ${JSON.stringify(["https://longmontleader.com/agenda/sept-council"])}, 6)
        returning id
      `;
      const existing = [
        {
          id: seededRows[0]!.id,
          status: "killed",
          headline: EXISTING_HEADLINE,
          source_urls: ["https://longmontleader.com/agenda/sept-council"],
        },
      ];
      const { pairs } = collectDupPairs({ candidates: [CANDIDATE], existing, printed: [], place: PLACE });
      const outcome = await runDupCheck({ pairs, chat: failing });
      assert.ok(outcome.failure);

      const result = await fileScanLeads(sql, { userId: "u" }, 1, 904, [CANDIDATE], existing, PLACE, outcome);

      assert.equal(result.possibleMatched, 1, "today's rule, unchanged");
      assert.equal(result.dupCheckCleared, 0);
      const [filed] = (await filedRows(sql)).filter((r) => r.id !== seededRows[0]!.id);
      assert.equal(filed!.possible_duplicate_of, seededRows[0]!.id);
      assert.equal(filed!.dup_kind, "possible");
      assert.equal(filed!.status, "held", "a possible repeat of a killed lead still starts held");
      assert.equal(filed!.dup_ai_same, null);
      assert.equal(filed!.dup_ai_checked_at, null);
    } finally {
      await db.close();
    }
  });

  it("the printed half persists too, so the Queue read can gate the chip with the reason", async () => {
    const db = await scratch();
    try {
      const sql = makeSql(db);
      const { pairs } = collectDupPairs({
        candidates: [BOHN_CANDIDATE],
        existing: [],
        printed: BOHN_PRINTED,
        place: PLACE,
      });
      assert.equal(pairs.length, 1);
      assert.equal(pairs[0]!.kind, "printed");

      const no = await runDupCheck({ pairs, chat: answering(false, "one is a rezoning, the other is a water test") });
      await fileScanLeads(sql, { userId: "u" }, 1, 905, [BOHN_CANDIDATE], [], PLACE, no);

      const [filed] = await filedRows(sql);
      assert.equal(filed!.dup_ai_printed_same, false);
      assert.equal(filed!.dup_ai_printed_slug, "bohn-farm-water-tests");
      assert.equal(filed!.dup_ai_why, null, "no lead pair was asked about, so that half stays null");

      // The Queue read end: the row the desk selected comes back gated.
      const row = {
        headline: BOHN_CANDIDATE.headline,
        topic: BOHN_CANDIDATE.topic,
        dup_ai_printed_same: filed!.dup_ai_printed_same,
        dup_ai_printed_why: filed!.dup_ai_printed_why,
        dup_ai_printed_slug: filed!.dup_ai_printed_slug,
      };
      assert.equal(printedDupChip(row, BOHN_PRINTED, PLACE), null, "no chip");
      assert.ok(
        printedDupChip({ ...row, dup_ai_printed_same: true }, BOHN_PRINTED, PLACE)?.aiWhy,
        "and a yes would show the sentence",
      );
    } finally {
      await db.close();
    }
  });
});

/*
  L2 of the batch-7 pre-merge audit: the verdict is the verdict ABOUT THIS PAIR.

  `dup-check.ts` keys its answers by candidate index and records the headline it
  asked about, and the filing loop matches the candidate independently. The
  module header said the lookup was "by this candidate's position and the
  matched lead's headline"; only the position was actually used. The audit could
  not construct a reachable collision with the current ordering, which is the
  point: this is the line that makes the stated safety property true of the code
  rather than of the ordering, and the row below is what a stale answer would
  look like -- another pair's "no" silently clearing a link this candidate's own
  words had earned.
*/
describe("U28: a verdict about a different target is not this row's verdict", () => {
  it("files the word rule's link when the recorded target is not the lead we matched", async () => {
    const db = await scratch();
    try {
      const sql = makeSql(db);
      const seeded = await sql<{ id: number }>`
        insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls, newsworthiness)
        values (${"u"}, ${1}, ${EXISTING_HEADLINE}, ${"Two closed sessions are scheduled."},
                ${"council"}, ${"new"},
                ${JSON.stringify(["https://longmontleader.com/agenda/sept-council"])}, 6)
        returning id
      `;
      const existing = [
        {
          id: seeded[0]!.id,
          status: "new",
          headline: EXISTING_HEADLINE,
          source_urls: ["https://longmontleader.com/agenda/sept-council"],
        },
      ];

      // Hand-built, because `runDupCheck` cannot produce this: it records the
      // headline it was handed. A stale or mis-paired outcome is exactly what
      // the guard is for.
      const outcome: DupCheckOutcome = {
        decisions: new Map([
          [
            0,
            {
              lead: {
                headline: "A lead this run never matched",
                verdict: { same: false, why: "an executive session, not a permit hearing" },
              },
            },
          ],
        ]),
        model: "deepseek-v4.1-flash:cloud",
        failure: null,
        asked: 1,
        skipped: 0,
      };

      const result = await fileScanLeads(
        sql,
        { userId: "u" },
        1,
        906,
        [CANDIDATE],
        existing,
        PLACE,
        outcome,
      );

      assert.equal(result.dupCheckCleared, 0, "someone else's verdict cleared the link");
      assert.equal(result.possibleMatched, 1, "the word rule's link stands");
      const [filed] = (await filedRows(sql)).filter((r) => r.id !== seeded[0]!.id);
      assert.equal(filed!.possible_duplicate_of, seeded[0]!.id);
      assert.equal(filed!.dup_kind, "possible");
      assert.equal(filed!.dup_ai_same, null, "another pair's answer is not this row's");
      assert.equal(filed!.dup_ai_target, null);
      assert.equal(filed!.dup_ai_why, null);
      // The row was still filed by a check that ran, so the model is recorded:
      // "the desk asked" is true, "and it said this" is not.
      assert.equal(filed!.dup_ai_model, "deepseek-v4.1-flash:cloud");
    } finally {
      await db.close();
    }
  });
});
