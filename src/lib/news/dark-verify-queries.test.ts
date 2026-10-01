import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureDarkSchema } from "./dark.ts";
import { ensureInvestigateSchema } from "./investigate.ts";
import { junkQueryReason } from "./extract.ts";
import { adversarialQueries, adversarialSourceRefusalReason, adversarialSubject } from "./dark-gates.ts";
import { verifyRunSignals } from "./dark-verify.ts";
import type { WebHit } from "./search-web.ts";

/**
 * Unit DD1, item 2 — the verification lane still searched on pasted signal
 * names.
 *
 * The stand-in walkthrough of 2026-09-30 (`A2c-REPORT.md` §3.4, B1) found the
 * five verification-signal blocks emitting twenty queries, every one a signal
 * name pasted whole in front of boilerplate:
 *
 *   "Silence from city, county, and state on a childcare closure Longmont
 *    routine OR scheduled OR \"normal process\" OR explanation…"
 *   "Alleged unpaid rent, taxes, and wages at Kid City USA Longmont Longmont
 *    news OR reported OR \"according to\"…"
 *
 * and every one of them returning a single junk source -- `en.wikipedia.org`,
 * `www.merriam-webster.com`, `www.youtubekids.com`, `cottage.sanjuan.edu`.
 * U25 fixed the hop planner's own queries; this lane builds its queries in
 * `adversarialQueries`, which nobody had touched.
 */

const PLACE = { city: "Longmont", state: "Colorado", county: "Boulder" };

/** The five signals the live round filed, as the walkthrough quoted them. */
const SILENCE = {
  name: "Silence from city, county, and state on a childcare closure",
  observation: "No licensing action has been published about the Kid City USA closure.",
};
const RENT = {
  name: "Alleged unpaid rent, taxes, and wages at Kid City USA Longmont",
  observation: "The Reddit thread says staff were not paid.",
};

describe("DD1 item 2 — verification queries are built from the signal's subject", () => {
  it("does not paste the whole signal name in as the query", () => {
    for (const signal of [SILENCE, RENT]) {
      for (const q of adversarialQueries(signal, PLACE, ["longmontcolorado.gov"])) {
        assert.doesNotMatch(
          q.query,
          new RegExp(signal.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
          `the whole signal name was pasted into a search: ${q.query}`,
        );
      }
    }
  });

  it("keeps the subject the signal is actually about", () => {
    assert.match(adversarialSubject(SILENCE), /childcare closure/);
    assert.match(adversarialSubject(RENT), /Kid City USA/);
    const queries = adversarialQueries(RENT, PLACE, ["longmontcolorado.gov"]);
    assert.ok(
      queries.some((q) => /Kid City USA/.test(q.query)),
      `the subject was lost entirely: ${queries.map((q) => q.query).join(" | ")}`,
    );
  });

  it("drops the desk's own framing rather than searching on it", () => {
    const subject = adversarialSubject(SILENCE);
    assert.doesNotMatch(subject, /\bsilence\b/i);
    assert.doesNotMatch(subject, /\bcity, county, and state\b/i);
    assert.equal(
      adversarialQueries(SILENCE, PLACE, []).length,
      4,
      "every kind of search is still tried",
    );
  });

  it("emits queries the app's own junk filter accepts", () => {
    for (const signal of [SILENCE, RENT]) {
      for (const q of adversarialQueries(signal, PLACE, ["longmontcolorado.gov"])) {
        assert.equal(junkQueryReason(q.query), null, `a junk query was planned: ${q.query}`);
      }
    }
  });

  it("still covers all four kinds, all location-scoped", () => {
    const qs = adversarialQueries(RENT, PLACE, ["longmontcolorado.gov"]);
    assert.deepEqual(
      qs.map((q) => q.kind).sort(),
      ["counter", "official", "ordinary", "press"],
    );
    for (const q of qs) assert.match(q.query, /Longmont|Boulder County/);
  });

  it("does not reach for a dictionary idiom to satisfy the 'ordinary' kind", () => {
    // "according to" is what pulled merriam-webster back as an answer.
    for (const signal of [SILENCE, RENT]) {
      for (const q of adversarialQueries(signal, PLACE, [])) {
        assert.doesNotMatch(q.query, /according to/i, q.query);
        assert.doesNotMatch(q.query, /"normal process"/i, q.query);
      }
    }
  });
});

const JUNK_HITS: WebHit[] = [
  {
    title: "Childcare - Wikipedia",
    url: "https://en.wikipedia.org/wiki/Childcare",
    snippet: "Childcare, also known as day care, is the care and supervision of a child.",
  },
];

describe("DD1 item 2 — a page that cannot answer the query is not 'the source'", () => {
  it("refuses a reference work the way it already refuses a dictionary", () => {
    assert.match(
      String(adversarialSourceRefusalReason("https://en.wikipedia.org/wiki/Childcare")),
      /reference work/,
    );
    assert.equal(adversarialSourceRefusalReason("https://cdhs.colorado.gov/child-care-facility-search"), null);
    assert.equal(adversarialSourceRefusalReason("https://longmontleader.com/story"), null);
  });

  /*
    THE TEST THAT MATTERS. A signal filed by the live round, a search provider
    that answers every query with the junk the walkthrough measured -- and no
    URL written down as "the source that answered it".
  */
  it("records 'no independent source found' rather than a junk source", async () => {
    await ensureInvestigateSchema();
    await ensureDarkSchema();
    const sql = await getSql();
    const NEWSROOM = 910_662;
    await sql.query(`delete from dark_signals where newsroom_id = $1`, [NEWSROOM]);
    await sql.query(`delete from dark_runs where newsroom_id = $1`, [NEWSROOM]);
    const runs = await sql.query<{ id: number }>(
      `insert into dark_runs (user_id, newsroom_id, investigation_id) values ($1, $2, $3) returning id`,
      ["dd1-verify", NEWSROOM, 9],
    );
    await sql.query(
      `insert into dark_signals
         (user_id, newsroom_id, run_id, investigation_id, name, observation, posture, signal_type,
          strength, confidence, stage)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        "dd1-verify", NEWSROOM, runs[0]!.id, 9, SILENCE.name, SILENCE.observation,
        "Dog That Didn't Bark", "delayed-record", 9, 0.4, "black-desk",
      ],
    );

    const searches: string[] = [];
    const result = await verifyRunSignals({
      userId: "dd1-verify",
      newsroomId: NEWSROOM,
      runId: runs[0]!.id,
      investigationId: 9,
      place: PLACE,
      officialDomains: ["longmontcolorado.gov"],
      runBudget: undefined,
      deps: {
        search: async (query) => {
          searches.push(query);
          return JUNK_HITS;
        },
        model: async () => null,
      },
    });

    assert.ok(searches.length >= 4, `the four gates were not searched: ${searches.join(" | ")}`);
    for (const query of searches)
      assert.equal(junkQueryReason(query), null, `a junk query reached the provider: ${query}`);
    assert.ok(
      !searches.some((q) => q.includes(SILENCE.name)),
      `the signal name was still pasted in: ${searches.join(" | ")}`,
    );
    assert.ok(result.searches.length >= 4);
    for (const record of result.searches) {
      assert.equal(record.url, null, `a Wikipedia page was recorded as the source: ${record.url}`);
      assert.match(String(record.outcome), /no independent source found/);
    }
  });
});
