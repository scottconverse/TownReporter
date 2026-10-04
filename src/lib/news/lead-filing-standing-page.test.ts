import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { fileScanLeads, type SqlTag } from "./lead-filing.ts";

/*
 * The scan stopped filing pages that merely EXIST.
 *
 * Run 66's Queue held "Longmont Leader Obituaries Page Lists Recent Death
 * Notices", "Longmont Community Foundation Projects Index Lists Local Funds"
 * and "Recovery Cafe Longmont Lists Weekday Hours and October Recovery
 * Circles" -- three standing pages, filed as three leads. A page that only
 * describes what exists has no event, so it is not news (news values; see
 * ./lead-newsworthiness.ts for the method behind each rule).
 *
 * This test drives the real filing loop with the real headlines and URLs from
 * the editor's 30-day export. It pins three things at once:
 *
 *   - the three standing pages are dropped, counted, and leave no row and no
 *     duplicate chip;
 *   - the two published leads in the same batch still file, INCLUDING one whose
 *     title reads like a listing ("... Lists Regular Hours") -- the cheap layer
 *     must not treat a bare "Lists"/"Hours" word as proof of a page, or it eats
 *     the editor's published work;
 *   - the model's explicit `is_event: false` drops a candidate the URL patterns
 *     could not settle, and an absent answer files as it always did.
 *
 * Remove any one rule from lead-newsworthiness.ts and the matching page below
 * files again, so the leadsCreated count moves off 3 and this test fails.
 */

function makeSql(db: PGlite): SqlTag {
  return async <T>(parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.reduce((out, part, i) => out + (i ? `$${i}` : "") + part, "");
    return (await db.query<T>(query, values)).rows;
  };
}

async function makeLeadsTable(db: PGlite) {
  await db.exec(`create table leads (
    id serial primary key, user_id text, newsroom_id integer, scan_run_id integer,
    headline text, why text, topic text, source_urls text, evidence text,
    newsworthiness integer, status text, possible_duplicate_of integer,
    topic_unchosen boolean not null default false,
    resurfaced_count integer default 0, last_resurfaced_at timestamptz,
    last_resurfaced_scan_run_id integer, dup_kind text,
    -- Migration 0113 (U28): fileScanLeads writes the duplicate check's verdict
    -- on every row it files, asked or not.
    dup_ai_same boolean, dup_ai_why text, dup_ai_target text,
    dup_ai_printed_same boolean, dup_ai_printed_why text, dup_ai_printed_slug text,
    dup_ai_model text, dup_ai_checked_at timestamptz
  )`);
}

test("run 66's standing pages are dropped; the published leads beside them file", async () => {
  const db = new PGlite();
  try {
    await makeLeadsTable(db);
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      66,
      [
        // R1: an obituaries index page (run 66, lead 419).
        {
          headline:
            "Longmont Leader Obituaries Page Lists Recent Death Notices, Including Patrick Joseph Travis",
          why: "The obituaries page lists recent death notices.",
          topic: "obituaries",
          source_urls: ["https://www.longmontleader.com/obituaries"],
        },
        // R2/R3: the foundation's projects index (run 66, lead 425).
        {
          headline:
            "Longmont Community Foundation Projects Index Lists Local Funds and Nonprofits",
          why: "The projects page lists the foundation's funds.",
          topic: "nonprofit",
          source_urls: [
            "https://longmontfoundation.org/projects/lcf-projects/",
            "https://longmontfoundation.org/projects/lcf-projects/feed/",
          ],
        },
        // R4: the cafe's hours-and-events page (run 66, lead 426).
        {
          headline: "Recovery Cafe Longmont Lists Weekday Hours and October Recovery Circles",
          why: "The page lists the cafe's weekday hours and its circles.",
          topic: "community",
          source_urls: [
            "https://recoverycafelongmont.org/",
            "https://recoverycafelongmont.org/event/recovery-circle-301/",
            "https://recoverycafelongmont.org/event/yerba-mate-circle-94/",
          ],
        },
        // Published lead 211: the SAME event pages, but a dated event in the
        // title. This is news the editor printed; it must survive.
        {
          headline:
            "Recovery Cafe Longmont lists meditation, film and recovery-circle sessions for Sept. 25",
          why: "The sessions happen Sept. 25.",
          topic: "community",
          source_urls: [
            "https://recoverycafelongmont.org/event/transcendent-meditation-44/",
            "https://recoverycafelongmont.org/event/recovery-circle-296/",
          ],
        },
        // Published lead 314: reads like a listing, but the editor published it,
        // so no bare "Lists"/"Hours" token may drop it.
        {
          headline:
            "Longmont Public Library Lists Regular Hours and Shoutbomb Text Notification Signup",
          why: "The library's regular hours took effect.",
          topic: "library",
          source_urls: [
            "https://longmontcolorado.gov/library/",
            "https://longmontcolorado.gov/library/access-my-library-account/",
          ],
        },
        // The model looked at this one and said it is not an event. No cheap
        // rule matches it, so only the model's verdict can drop it.
        {
          headline: "About the Longmont Museum",
          why: "The page describes the museum.",
          topic: "arts",
          source_urls: ["https://longmontmuseum.org/about"],
          is_event: false,
          event: "the page describes the museum's history and hours",
        },
      ],
      [],
    );

    assert.equal(result.leadsCreated, 2, "the two published leads are what the run found");
    assert.equal(result.standingPageDropped, 3, "the three standing pages were dropped as pages");
    assert.equal(result.noEventDropped, 1, "the model's own verdict dropped the museum page");
    assert.equal(
      result.firstDroppedReason?.headline,
      "Longmont Leader Obituaries Page Lists Recent Death Notices, Including Patrick Joseph Travis",
      "the summary names the first page left out",
    );
    assert.match(result.firstDroppedReason!.reason, /obituar/i);

    const rows = (
      await db.query<{ headline: string; source_urls: string; possible_duplicate_of: number | null }>(
        "select headline, source_urls, possible_duplicate_of from leads order by id",
      )
    ).rows;
    assert.deepEqual(
      rows.map((row) => row.headline),
      [
        "Recovery Cafe Longmont lists meditation, film and recovery-circle sessions for Sept. 25",
        "Longmont Public Library Lists Regular Hours and Shoutbomb Text Notification Signup",
      ],
      "only the published news filed; no page row, no chip",
    );
    for (const dropped of ["obituaries", "lcf-projects", "recoverycafelongmont.org/event/recovery-circle-301"]) {
      assert.equal(
        rows.some((row) => row.source_urls.includes(dropped)),
        false,
        `a dropped page left a row: ${dropped}`,
      );
    }
    assert.equal(result.possibleMatched, 0, "a dropped page draws no duplicate chip");
    assert.equal(result.mergedSameScan, 0);
  } finally {
    await db.close();
  }
});

test("a reply that predates the field still files: an absent is_event is not a drop", async () => {
  const db = new PGlite();
  try {
    await makeLeadsTable(db);
    const sql = makeSql(db);
    const result = await fileScanLeads(
      sql,
      { userId: "test" },
      1,
      67,
      [
        {
          headline: "Council approves the 2027 budget on second reading",
          why: "The council voted Tuesday.",
          topic: "council",
          source_urls: ["https://longmontcolorado.gov/council/2026-10-01-budget/"],
          // no is_event/event/event_date -- an older model reply
        },
      ],
      [],
    );
    assert.equal(result.leadsCreated, 1, "an old-format reply is filed, not dropped");
    assert.equal(result.noEventDropped, 0);
    assert.equal(result.standingPageDropped, 0);
    assert.equal(result.firstDroppedReason, undefined);
  } finally {
    await db.close();
  }
});
