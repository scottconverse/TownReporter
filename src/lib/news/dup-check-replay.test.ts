import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  collectDupPairs,
  combineDupCheckOutcomes,
  DUP_CHECK_SYSTEM,
  runDupCheck,
  runSameStoryCheck,
  SAME_STORY_SYSTEM,
  type DupCheckChat,
} from "./dup-check.ts";

/*
 * Scan replay (Scott's Plan B, Nov 1 2026): the repeat-check stage of a real
 * scan, run again in milliseconds with no model and no network.
 *
 * Each file in __fixtures__/scan-replay holds the real rows one scan saw, and
 * the answers the scan's model gave. The chat below hands those answers back,
 * so the test checks OUR side: which pairs we ask about, how we read the
 * answers, and what the desk decides. It replaces an hour-long A/B scan for
 * changes to this stage.
 *
 * Covers the repeat check only. Reading sources and writing leads are not
 * replayed here.
 *
 * Dates in a file are moved forward by (now - recordedAt), so the 30-day
 * lookback sees the rows the way the scan saw them on the day.
 */

type Fixture = {
  name: string;
  recordedAt: string;
  place: string;
  candidates: { lead: number; headline: string; why: string; source_urls: string[] }[];
  existing: { id: number; status: string; headline: string; why: string; source_urls: string[]; created_at: string }[];
  printed: {
    slug: string;
    headline: string;
    dek: string | null;
    topic: string | null;
    published_at: string;
    lead_headline: string | null;
    lead_why: string | null;
    lead_topic: string | null;
    lead_source_urls: string[] | null;
    lead_created_at: string | null;
  }[];
  recorded: { pairCheck: { model: string; text: string }; sameStory: { model: string; text: string } };
  expect: {
    pairs: { candidate: number; kind: string; target: string }[];
    printedRepeats: { candidate: number; slug: string }[];
    notRepeats: number[];
  };
};

const folder = new URL("./__fixtures__/scan-replay/", import.meta.url);
const files = readdirSync(folder).filter((name) => name.endsWith(".json")).sort();

function shifted(value: string | null, by: number): string | null {
  if (!value) return value;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time + by).toISOString() : value;
}

function load(name: string): Fixture {
  const fixture = JSON.parse(readFileSync(new URL(name, folder), "utf8")) as Fixture;
  const by = Date.now() - Date.parse(fixture.recordedAt);
  return {
    ...fixture,
    existing: fixture.existing.map((lead) => ({ ...lead, created_at: shifted(lead.created_at, by) ?? lead.created_at })),
    printed: fixture.printed.map((story) => ({
      ...story,
      published_at: shifted(story.published_at, by) ?? story.published_at,
      lead_created_at: shifted(story.lead_created_at, by),
    })),
  };
}

/** Hands back the recorded answer for each question. Any other question fails
 * the test: a new model call in this stage needs a new recording. */
function replayChat(fixture: Fixture, asked: string[]): DupCheckChat {
  return async (system, user) => {
    asked.push(user);
    if (system === DUP_CHECK_SYSTEM) return { ok: true, ...fixture.recorded.pairCheck };
    if (system === SAME_STORY_SYSTEM) return { ok: true, ...fixture.recorded.sameStory };
    throw new Error(`${fixture.name}: no recorded answer for this question; record the scan again`);
  };
}

assert.ok(files.length > 0, "no scan replay fixtures found");

for (const file of files) {
  describe(`scan replay: ${file}`, () => {
    const fixture = load(file);
    const input = {
      candidates: fixture.candidates,
      existing: fixture.existing,
      printed: fixture.printed,
      place: fixture.place,
    } as unknown as Parameters<typeof collectDupPairs>[0];

    it("asks about the same pairs the recorded scan asked about", () => {
      const { pairs } = collectDupPairs(input);
      assert.deepEqual(
        pairs.map((pair) => ({ candidate: pair.candidate, kind: pair.kind, target: pair.target })),
        fixture.expect.pairs,
        "the pairs changed, so the recorded answer no longer fits: check the change, then record the scan again",
      );
    });

    it("reaches the recorded decisions from the recorded answers", async () => {
      const asked: string[] = [];
      const chat = replayChat(fixture, asked);
      const collected = collectDupPairs(input);
      const [pairCheck, sameStory] = await Promise.all([
        runDupCheck({ pairs: collected.pairs, skipped: collected.skipped, chat }),
        runSameStoryCheck({ ...input, chat }),
      ]);
      const outcome = combineDupCheckOutcomes(pairCheck, sameStory);
      assert.ok(outcome, "no outcome");
      assert.equal(outcome.failure, null);
      assert.equal(asked.length, 2, "the stage should ask exactly two questions");

      for (const repeat of fixture.expect.printedRepeats) {
        const decision = outcome.decisions.get(repeat.candidate);
        assert.equal(decision?.printed?.slug, repeat.slug, `candidate ${repeat.candidate} lost its printed match`);
        assert.equal(decision?.printed?.verdict.same, true, `candidate ${repeat.candidate} is no longer marked a repeat`);
      }
      for (const candidate of fixture.expect.notRepeats) {
        const decision = outcome.decisions.get(candidate);
        assert.notEqual(decision?.printed?.verdict.same, true, `candidate ${candidate} is wrongly marked as printed`);
        assert.notEqual(decision?.lead?.verdict.same, true, `candidate ${candidate} is wrongly marked as a lead repeat`);
        assert.equal(outcome.sameStory?.has(candidate) ?? false, false, `candidate ${candidate} is wrongly held as the same story`);
      }
    });
  });
}
