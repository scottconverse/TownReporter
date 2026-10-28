import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectDupPairs,
  collectSameStoryPromptData,
  dupCheckPromptUser,
  leadPairKey,
  parseDupCheckReply,
  parseSameStoryReply,
  printedPairKey,
  runDupCheck,
  runSameStoryCheck,
  DUP_CHECK_MAX_PAIRS,
  type DupCheckChat,
  type DupCheckOutcome,
  type DupCheckPair,
} from "./dup-check.ts";
import { printedDupChip, printedDuplicateLine } from "./desk-copy.ts";
import { queuePrintedMatches } from "./queue-rows.ts";

/*
 * Unit U28 (2026-09-30): the desk's one batched question about the pairs the
 * word rules only rate borderline.
 *
 * The owner's ask was "double check. worth it." and the pair that earned it is
 * the one U26's own doc comment records: "U.S. Supreme Court to Hear Boulder
 * County Climate Suit Oct. 5" chipped as already printed as "Boulder County
 * Proclaims Hispanic and Latinx Heritage Month, Listing Longmont's Oct. 24 Day
 * of the Dead Celebration".
 *
 * Every test below fakes the model with a closure (`DupCheckChat`), so nothing
 * here reaches a provider and no run costs anything. What is being pinned:
 *
 *   - one call for many pairs, and a hard cap of forty (the cost control);
 *   - a "yes" keeps the chip and adds the model's sentence; a "no" removes it;
 *   - a call that failed, or an answer nobody can read, changes NOTHING --
 *     the word rule stands, with no chip cleared and no chip claimed;
 *   - the owner's Boulder pair gets no chip.
 *
 * The filing half (a "no" removing the `possible_duplicate_of` LINK) is proved
 * against a scratch PGlite in lead-filing-dup-check.test.ts, where the rows
 * are real, and against a real Postgres in dup-check.postgres.test.ts.
 */

/** The live paper's own place -- the same fixture lead-match's and desk-copy's
 * own tests use, and the same one `getPaperPlace` returns for it. */
const PLACE = { city: "Longmont", state: "Colorado", county: "Boulder" };

/** A candidate the word rule flags against a published story: two shared real
 * names AND the same section is `nearDuplicate`'s second way in (desk-copy.ts).
 * "Bohn Farm" is a name; "well water" against "rezoning" is the part the words
 * cannot tell apart. */
const BOHN_LEAD = {
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

/** A fake model that answers every pair the same way. `calls` records each
 * user prompt, which is how "one call for many pairs" is checked. */
function answering(same: boolean, why: string): { chat: DupCheckChat; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    chat: async (_system, user) => {
      calls.push(user);
      const pairs = JSON.parse(user) as { id: number }[];
      return {
        ok: true as const,
        text: JSON.stringify(pairs.map((p) => ({ id: p.id, same, why }))),
        model: "deepseek-v4.1-flash:cloud",
      };
    },
  };
}

describe("U28: the duplicate check reads the words the desk could not", () => {
  it("asks about a borderline lead pair and a borderline printed pair, in one call, keyed to the candidate", () => {
    // The real pair from lead-match.ts's own doc comment: a same-source
    // rewrite whose content-token Jaccard is far below matchStrength's 0.85
    // "strong" bar, so the desk files it and links it rather than folding it.
    const existing = [
      {
        id: 41,
        status: "drafted",
        headline:
          "Longmont council has two closed-door executive sessions on the books for late September",
        source_urls: ["https://longmontleader.com/agenda/sept-council"],
        why: "Two closed sessions are scheduled.",
      },
    ];
    const candidates = [
      {
        headline:
          "Council books two executive sessions in eight days -- Sept. 22 and Sept. 29 -- with packets already posted",
        why: "Both packets are public.",
        topic: "council",
        source_urls: ["https://longmontleader.com/agenda/sept-council"],
      },
      BOHN_LEAD,
    ];

    const { pairs, skipped } = collectDupPairs({
      candidates,
      existing,
      printed: BOHN_PRINTED,
      place: PLACE,
    });

    assert.equal(skipped, 0);
    assert.equal(pairs.length, 2);
    assert.deepEqual(
      pairs.map((p) => [p.candidate, p.kind, p.target]),
      [
        [0, "lead", existing[0]!.headline],
        [1, "printed", "bohn-farm-water-tests"],
      ],
    );
    // Both sides of a pair carry a headline and a one-line why/dek: the
    // question is unanswerable from a headline alone.
    assert.equal(pairs[0]!.why, "Both packets are public.");
    assert.equal(pairs[0]!.otherWhy, "Two closed sessions are scheduled.");
    assert.equal(pairs[1]!.otherWhy, BOHN_PRINTED[0]!.dek);
    // The keys are the desk's identity for the pair, and they are what the
    // filing loop looks a verdict up by.
    assert.equal(pairs[0]!.key, leadPairKey(0, existing[0]!.headline));
    assert.equal(pairs[1]!.key, printedPairKey(1, "bohn-farm-water-tests"));
  });

  it("never asks about a pair the matcher rates 'strong': those are folded or stamped, never linked", () => {
    const existing = [
      {
        id: 7,
        status: "killed",
        headline: "Longmont library board discusses branch hours",
        source_urls: ["https://longmontcolorado.gov/library-board"],
      },
    ];
    const { pairs } = collectDupPairs({
      candidates: [
        {
          headline: "Longmont library board discusses branch hours",
          why: "Same story again.",
          source_urls: ["https://longmontcolorado.gov/library-board"],
        },
      ],
      existing,
      printed: [],
      place: PLACE,
    });
    assert.deepEqual(pairs, [], "a strong match gets no chip, so there is nothing to ask about");
  });

  it("makes ONE call for many pairs, and puts both sides of every pair in it", async () => {
    const candidates = [
      BOHN_LEAD,
      { ...BOHN_LEAD, headline: "Bohn Farm rezoning returns to the planning board", why: "Second reading." },
      { ...BOHN_LEAD, headline: "Bohn Farm rezoning draws a crowd at the planning board", why: "Many speakers." },
    ];
    const { pairs } = collectDupPairs({ candidates, existing: [], printed: BOHN_PRINTED, place: PLACE });
    assert.equal(pairs.length, 3);

    const { chat, calls } = answering(false, "different stories about one farm");
    const outcome = await runDupCheck({ pairs, chat });

    assert.equal(calls.length, 1, "one scan, one call -- never one call per pair");
    assert.equal(outcome.asked, 3);
    const sent = JSON.parse(calls[0]!) as { id: number; a: { headline: string }; b: { headline: string } }[];
    assert.equal(sent.length, 3);
    assert.deepEqual(
      sent.map((p) => p.a.headline),
      candidates.map((c) => c.headline),
    );
    assert.ok(
      sent.every((p) => p.b.headline === BOHN_PRINTED[0]!.headline),
      "every entry carries the other side's headline",
    );
    assert.equal(outcome.failure, null);
  });

  it("stops at the cap and leaves the rest on the word rule, saying how many it dropped", async () => {
    const candidates = Array.from({ length: DUP_CHECK_MAX_PAIRS + 5 }, (_, i) => ({
      ...BOHN_LEAD,
      headline: `Bohn Farm rezoning hearing number ${i} at the planning board`,
    }));
    const { pairs, skipped } = collectDupPairs({
      candidates,
      existing: [],
      printed: BOHN_PRINTED,
      place: PLACE,
    });

    assert.equal(pairs.length, DUP_CHECK_MAX_PAIRS);
    assert.equal(skipped, 5, "past the cap the desk stops asking, and counts what it dropped");

    const { chat, calls } = answering(false, "different hearings");
    const outcome = await runDupCheck({ pairs, skipped, chat });
    assert.equal(calls.length, 1);
    assert.equal(outcome.asked, DUP_CHECK_MAX_PAIRS);
    assert.equal(outcome.skipped, 5);
    // The five past the cap have no verdict at all -- which is what leaves
    // them on the word rule rather than silently cleared.
    for (let i = DUP_CHECK_MAX_PAIRS; i < candidates.length; i += 1) {
      assert.equal(outcome.decisions.get(i), undefined);
    }
  });

  it("a 'yes' keeps the chip and adds the model's own sentence", async () => {
    const { pairs } = collectDupPairs({
      candidates: [BOHN_LEAD],
      existing: [],
      printed: BOHN_PRINTED,
      place: PLACE,
    });
    const { chat } = answering(true, "same rezoning vote, same planning board date");
    const outcome = await runDupCheck({ pairs, chat });

    const decision = outcome.decisions.get(0)!;
    assert.equal(decision.printed?.slug, "bohn-farm-water-tests");
    assert.equal(decision.printed?.verdict.same, true);
    assert.equal(outcome.model, "deepseek-v4.1-flash:cloud");

    // Applied to a row the way lead-filing.ts writes it (migration 0113).
    const chip = printedDupChip(
      {
        headline: BOHN_LEAD.headline,
        topic: BOHN_LEAD.topic,
        dup_ai_printed_same: true,
        dup_ai_printed_why: decision.printed!.verdict.why,
        dup_ai_printed_slug: decision.printed!.slug,
      },
      BOHN_PRINTED,
      PLACE,
    );
    assert.ok(chip, "the chip the word rule earned is kept");
    assert.equal(
      printedDuplicateLine(chip.headline, chip.aiWhy),
      "Looks already printed: Bohn Farm well water tests find nitrates near the creek — AI: same rezoning vote, same planning board date",
    );
  });

  it("a 'no' removes the chip -- and takes the lead out of the ≈ Printed tab with it", async () => {
    const { pairs } = collectDupPairs({
      candidates: [BOHN_LEAD],
      existing: [],
      printed: BOHN_PRINTED,
      place: PLACE,
    });
    const { chat } = answering(false, "one is a rezoning, the other is water testing");
    const outcome = await runDupCheck({ pairs, chat });

    const decision = outcome.decisions.get(0)!;
    assert.equal(decision.printed?.verdict.same, false);

    const row = {
      id: 9,
      status: "new",
      headline: BOHN_LEAD.headline,
      why: BOHN_LEAD.why,
      topic: BOHN_LEAD.topic,
      newsworthiness: 5,
      created_at: "2026-09-30T09:00:00Z",
      dup_ai_printed_same: false,
      dup_ai_printed_why: decision.printed!.verdict.why,
      dup_ai_printed_slug: decision.printed!.slug,
    };
    assert.equal(printedDupChip(row, BOHN_PRINTED, PLACE), null, "no chip");
    assert.deepEqual(queuePrintedMatches([row], BOHN_PRINTED, PLACE), [], "and not in the tab either");
    // The control: without the verdict the same row IS chipped, so the test
    // above is measuring the verdict and not a pair the words never flagged.
    assert.ok(printedDupChip({ ...row, dup_ai_printed_same: null }, BOHN_PRINTED, PLACE));
  });

  it("a verdict about a DIFFERENT published story cannot gate this chip", async () => {
    const row = {
      headline: BOHN_LEAD.headline,
      topic: BOHN_LEAD.topic,
      dup_ai_printed_same: false,
      dup_ai_printed_why: "not the same story",
      dup_ai_printed_slug: "some-other-story",
    };
    assert.ok(
      printedDupChip(row, BOHN_PRINTED, PLACE),
      "the published list changes between reads; a verdict is only about the article it was asked about",
    );
  });

  it("a call that fails changes nothing: no verdict, and the word rule still shows the chip", async () => {
    const { pairs } = collectDupPairs({
      candidates: [BOHN_LEAD],
      existing: [],
      printed: BOHN_PRINTED,
      place: PLACE,
    });
    const failing: DupCheckChat = async () => ({ ok: false, error: "timed out after 90000ms" });
    const outcome = await runDupCheck({ pairs, chat: failing });

    assert.equal(outcome.decisions.size, 0, "no verdict may be invented from a failure");
    assert.equal(outcome.asked, 1, "the desk did ask -- the answer is what never came");
    assert.match(String(outcome.failure), /timed out/);

    // What the row keeps: nulls, which is NOT "the model said no".
    const chip = printedDupChip(
      { headline: BOHN_LEAD.headline, topic: BOHN_LEAD.topic },
      BOHN_PRINTED,
      PLACE,
    );
    assert.ok(chip, "the word rule stands exactly as it did before this unit");
    assert.equal(chip.aiWhy ?? null, null);
    assert.equal(
      printedDuplicateLine(chip.headline, chip.aiWhy),
      "Looks already printed: Bohn Farm well water tests find nitrates near the creek",
    );
  });

  it("a reply nobody can read is a failure, not a 'no'", async () => {
    const { pairs } = collectDupPairs({
      candidates: [BOHN_LEAD],
      existing: [],
      printed: BOHN_PRINTED,
      place: PLACE,
    });
    for (const text of ["I'm sorry, I can't help with that.", "", "[]", '[{"id":1}]']) {
      const outcome = await runDupCheck({ pairs, chat: async () => ({ ok: true, text }) });
      assert.equal(outcome.decisions.size, 0, `no verdict may be invented from: ${JSON.stringify(text)}`);
      assert.ok(outcome.failure, "and the desk is told the check did not decide anything");
    }
  });

  it("reads a stuttering model's answer anyway, and never guesses at a missing yes/no", () => {
    const pairs: DupCheckPair[] = [
      { key: "k1", id: 1, candidate: 0, kind: "printed", headline: "A", why: "", otherHeadline: "B", otherWhy: "", target: "slug-1" },
      { key: "k2", id: 2, candidate: 0, kind: "printed", headline: "C", why: "", otherHeadline: "D", otherWhy: "", target: "slug-2" },
      { key: "k3", id: 3, candidate: 1, kind: "printed", headline: "E", why: "", otherHeadline: "F", otherWhy: "", target: "slug-3" },
    ];
    const verdicts = parseDupCheckReply(
      'Here you go:\n```json\n[{"id":1,"same":"yes","why":"same vote"},{"id":2,"same":"no"},{"id":3,"why":"forgot the answer"}]\n```',
      pairs,
    );
    assert.equal(verdicts.get("k1")?.same, true);
    assert.equal(verdicts.get("k1")?.why, "same vote");
    assert.equal(verdicts.get("k2")?.same, false);
    assert.equal(verdicts.get("k3"), undefined, "an entry with no yes/no is not a verdict");
  });

  it("matches a reply by position when the model drops the ids it was given", () => {
    const pairs: DupCheckPair[] = [
      { key: "k1", id: 1, candidate: 0, kind: "lead", headline: "A", why: "", otherHeadline: "B", otherWhy: "", target: "B" },
      { key: "k2", id: 2, candidate: 1, kind: "lead", headline: "C", why: "", otherHeadline: "D", otherWhy: "", target: "D" },
    ];
    const verdicts = parseDupCheckReply(
      JSON.stringify([
        { same: false, why: "different items" },
        { same: true, why: "same item reworded" },
      ]),
      pairs,
    );
    assert.equal(verdicts.get("k1")?.same, false);
    assert.equal(verdicts.get("k2")?.same, true);
  });

  it("an id that was never sent decides nothing", () => {
    const pairs: DupCheckPair[] = [
      { key: "k1", id: 1, candidate: 0, kind: "lead", headline: "A", why: "", otherHeadline: "B", otherWhy: "", target: "B" },
    ];
    const verdicts = parseDupCheckReply('[{"id":99,"same":true,"why":"who?"}]', pairs);
    assert.equal(verdicts.size, 0);
  });

  /*
   * The owner's pair, which is why this unit exists.
   *
   * U26 (desk-copy.ts / lead-match.ts) already refuses it: "Boulder" and
   * "County" are the newsroom's own place and civic furniture, so the two
   * headlines share no distinguishing word and `nearDuplicate` never chips
   * them. That is the FIRST assertion below, and U28 must not be able to
   * regress it by asking a model something the words already answered.
   *
   * The second half is the point of the unit: if a pair of this shape DOES
   * clear the word rule -- and the Bohn Farm pair above is exactly that shape,
   * two same-section same-region stories sharing two real names and nothing
   * else -- the desk's own model is what settles it, and a "no" removes the
   * chip instead of leaving the owner's false positive on the Queue.
   */
  it("the owner's Boulder climate-suit pair gets no chip -- and a flagged pair like it is cleared by the check", async () => {
    const climateLead = {
      headline: "U.S. Supreme Court to Hear Boulder County Climate Suit Oct. 5",
      why: "The court takes up the county's suit.",
      topic: "council",
    };
    const heritageArticle = [
      {
        slug: "boulder-county-heritage-month",
        headline:
          "Boulder County Proclaims Hispanic and Latinx Heritage Month, Listing Longmont's Oct. 24 Day of the Dead Celebration",
        dek: "The proclamation names the county's October observances.",
        topic: "council",
        published_at: "2026-09-20T10:00:00Z",
      },
    ];

    // The word rule refuses it outright: no chip, nothing to ask about.
    assert.equal(printedDupChip(climateLead, heritageArticle, PLACE), null);
    const collected = collectDupPairs({
      candidates: [climateLead],
      existing: [],
      printed: heritageArticle,
      place: PLACE,
    });
    assert.deepEqual(collected.pairs, [], "the check is not even asked about a pair the words already refuse");

    // The same SHAPE, flagged by the words (two real names, one section) and
    // settled by the model: a "no" takes the chip away.
    const { pairs } = collectDupPairs({
      candidates: [BOHN_LEAD],
      existing: [],
      printed: BOHN_PRINTED,
      place: PLACE,
    });
    const { chat } = answering(false, "one is a rezoning, the other is a water test");
    const outcome: DupCheckOutcome = await runDupCheck({ pairs, chat });
    const settled = outcome.decisions.get(0)!.printed!;
    assert.equal(
      printedDupChip(
        {
          headline: BOHN_LEAD.headline,
          topic: BOHN_LEAD.topic,
          dup_ai_printed_same: settled.verdict.same,
          dup_ai_printed_why: settled.verdict.why,
          dup_ai_printed_slug: settled.slug,
        },
        BOHN_PRINTED,
        PLACE,
      ),
      null,
    );
  });

  it("makes no call at all when nothing is borderline", async () => {
    const { pairs, skipped } = collectDupPairs({
      candidates: [{ headline: "Council approves the water contract", why: "It passed.", topic: "council" }],
      existing: [],
      printed: BOHN_PRINTED,
      place: PLACE,
    });
    assert.deepEqual(pairs, []);
    assert.equal(skipped, 0);

    let called = 0;
    const outcome = await runDupCheck({
      pairs,
      chat: async () => {
        called += 1;
        return { ok: true, text: "[]" };
      },
    });
    assert.equal(called, 0, "the cost of this feature is one call per scan THAT NEEDS ONE");
    assert.equal(outcome.asked, 0);
    assert.equal(outcome.failure, null);
  });

  it("tells the model, in words, that same topic/place/meeting is not the same story", () => {
    const prompt = dupCheckPromptUser([
      { key: "k", id: 1, candidate: 0, kind: "lead", headline: "A", why: "a-why", otherHeadline: "B", otherWhy: "b-why", target: "B" },
    ]);
    assert.deepEqual(JSON.parse(prompt), [
      { id: 1, a: { headline: "A", why: "a-why" }, b: { headline: "B", why: "b-why" } },
    ]);
  });
});


describe("the direct same-story finder", () => {
  const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const existing = [
    { id: 41, status: "new", headline: "Newest desk lead", source_urls: [], created_at: recent, why: "Newest why." },
    { id: 42, status: "killed", headline: "Killed desk lead", source_urls: [], created_at: recent, why: "Killed why." },
    { id: 43, status: "held", headline: "Held desk lead", source_urls: [], created_at: recent, why: "Held why." },
    { id: 44, status: "drafted", headline: "Drafted desk lead", source_urls: [], created_at: recent, why: "Drafted why." },
    { id: 45, status: "published", headline: "Published is not a desk lead", source_urls: [], created_at: recent, why: "Not offered." },
    { id: 46, status: "new", headline: "Too old to offer", source_urls: [], created_at: old, why: "Old why." },
  ];
  const printed = [
    { slug: "newest-printed", headline: "Newest printed", dek: "Newest dek.", topic: "news", published_at: recent },
    { slug: "second-printed", headline: "Second printed", dek: "Second dek.", topic: "news", published_at: recent },
    { slug: "too-old-printed", headline: "Old printed", dek: "Old dek.", topic: "news", published_at: old },
  ];
  const candidates = [
    { headline: "First new item", why: "First why.", topic: "news", source_urls: [] },
    { headline: "Second new item", why: "Second why.", topic: "news", source_urls: [] },
  ];

  it("offers the batch, matchable recent leads and printed stories with stable short refs", () => {
    const data = collectSameStoryPromptData({
      candidates,
      existing,
      printed,
      maxLeads: 4,
      maxPrinted: 2,
    });
    assert.deepEqual(data.items.map((item) => [item.n, item.headline]), [
      [1, "First new item"],
      [2, "Second new item"],
    ]);
    assert.deepEqual(data.leads.map((lead) => lead.ref).sort(), ["L41", "L42", "L43", "L44"]);
    assert.ok(!data.leads.some((lead) => lead.id === 45), "published rows are not desk leads");
    assert.ok(!data.leads.some((lead) => lead.id === 46), "the prompt looks back only 30 days");
    assert.ok(data.leads.length <= 4, "the cap bounds the prompt");
    assert.deepEqual(data.printed.map((story) => story.ref), ["P1", "P2"]);
    assert.ok(!data.printed.some((story) => story.slug === "too-old-printed"));
  });

  it("takes the newest leads and printed stories before the cap", () => {
    const minute = 60 * 1000;
    const rows = [
      { id: 101, status: "new", headline: "Oldest lead", source_urls: [], created_at: new Date(Date.now() - 3 * minute).toISOString() },
      { id: 102, status: "new", headline: "Newest lead", source_urls: [], created_at: new Date(Date.now() - minute).toISOString() },
      { id: 103, status: "new", headline: "Middle lead", source_urls: [], created_at: new Date(Date.now() - 2 * minute).toISOString() },
    ];
    const stories = [
      { slug: "oldest-print", headline: "Oldest printed", dek: "Old.", published_at: new Date(Date.now() - 3 * minute).toISOString() },
      { slug: "newest-print", headline: "Newest printed", dek: "New.", published_at: new Date(Date.now() - minute).toISOString() },
      { slug: "middle-print", headline: "Middle printed", dek: "Middle.", published_at: new Date(Date.now() - 2 * minute).toISOString() },
    ];
    const data = collectSameStoryPromptData({
      candidates: [candidates[0]!],
      existing: rows,
      printed: stories,
      maxLeads: 2,
      maxPrinted: 2,
    });
    assert.deepEqual(data.leads.map((lead) => lead.id), [102, 103]);
    assert.deepEqual(data.printed.map((story) => story.slug), ["newest-print", "middle-print"]);
  });
  it("accepts only refs that were sent, and only an EARLIER N ref", () => {
    const data = collectSameStoryPromptData({
      candidates,
      existing: [existing[1]!],
      printed: [printed[0]!],
    });
    const parsed = parseSameStoryReply(JSON.stringify([
      { n: 1, same_as: "L42", why: "same arrest" },
      { n: 2, same_as: "N1", why: "same fundraiser" },
    ]), data);
    assert.deepEqual(parsed.get(0), { kind: "lead", leadId: 42, why: "same arrest" });
    assert.deepEqual(parsed.get(1), { kind: "new", candidate: 0, why: "same fundraiser" });

    const invalid = parseSameStoryReply(JSON.stringify([
      { n: 1, same_as: "N1", why: "itself" },
      { n: 2, same_as: "N3", why: "later item" },
      { n: 1, same_as: "L999", why: "unknown lead" },
      { n: 2, same_as: "P99", why: "unknown printed" },
      { n: 1, same_as: { ref: "L42" }, why: "unreadable ref" },
    ]), data);
    assert.equal(invalid.size, 0, "an unknown, later or malformed ref is never guessed");
  });

  it("makes one call, records the model, and never throws when the model fails", async () => {
    let calls = 0;
    const failed = await runSameStoryCheck({
      candidates,
      existing,
      printed,
      chat: async () => {
        calls += 1;
        return { ok: false, error: "timed out after 90000ms" };
      },
    });
    assert.equal(calls, 1, "one same-story call per batch");
    assert.equal(failed.sameStory?.size, 0);
    assert.match(String(failed.failure), /timed out/);

    const answered = await runSameStoryCheck({
      candidates,
      existing,
      printed,
      chat: async (_system, user) => {
        const data = JSON.parse(user) as { items: { n: number }[] };
        return {
          ok: true as const,
          text: JSON.stringify(data.items.map((item) => ({ n: item.n, same_as: null, why: "different story" }))),
          model: "deepseek-v4.1-flash:cloud",
        };
      },
    });
    assert.equal(answered.model, "deepseek-v4.1-flash:cloud");
    assert.equal(answered.sameStory?.size, 0, "null is a valid answer, not an entry to apply");
  });
});
