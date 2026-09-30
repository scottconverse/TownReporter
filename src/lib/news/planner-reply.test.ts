import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseJsonBlockSalvage } from "./ai.ts";
import { PLANNER_OUTPUT_TOKENS, parsePlan } from "./investigate.ts";

/**
 * Unit U25, B2 — the planner's reply, as the model actually writes it.
 *
 * WHAT THESE ARE FOR. The Kid City USA dig of 2026-09-30 reported "Planner fell
 * back on 5 of 5 rounds: model replied but the plan had no next step" while the
 * model WAS returning plans. `dark_runs.usage_ledger_json` for that run records
 * `completion_tokens` of exactly 2,200 -- the planner's output cap at the time
 * -- on all five planning hops and both post-search selection calls. The
 * replies were cut off mid-object, and `parseJsonBlock` could not read a reply
 * whose closing brace never arrived.
 *
 * The fixtures below are that shape: a plan whose `searches` and `fetch_urls`
 * are complete and whose tail is missing, which is what a cap hit at the end of
 * a long JSON object looks like. `parseJsonBlockSalvage` recovers them.
 *
 * THE MUTATION THAT MATTERS. Deleting the string-closing branch in
 * `parseJsonBlockSalvage` (`read`'s `inString` arm) fails the third case, which
 * is the summary-truncation the planner hits when it writes prose last.
 */

/** A reply cut off inside a nested object, after the searches are written. */
const TRUNCATED_MID_OBJECT =
  '{"searches": ["\\"Kid City USA\\" Longmont child care license", "Colorado Department of Early Childhood 1941 Terry Street"],' +
  ' "fetch_urls": ["https://cdhs.colorado.gov/child-care-facility-search"],' +
  ' "entities": [{"name":"Kid City USA","kind":"company","why":"the licensee"}],' +
  ' "relationships": [{"from":"Kid City USA","to":"CDC","kind":';

/** A reply cut off inside the trailing summary string. */
const TRUNCATED_IN_STRING =
  '{"searches": ["Kid City USA closure Longmont"], "fetch_urls": [], "stop": false,' +
  ' "summary": "This hop looked for the license record and the franchise organ';

/** A reply with a reasoning preamble, fenced as most thinking models fence it. */
const REASONING_PREAMBLE_FENCED = `Let me think about what this hop should look for.

The pack has one Reddit thread and nothing from the state licensing authority, so
the licence number is the record that would settle it.

\`\`\`json
{
  "searches": ["\\"Kid City USA\\" Colorado child care license number"],
  "fetch_urls": ["https://cdhs.colorado.gov/"],
  "stop": false,
  "summary": "Went after the licence record."
}
\`\`\`

That should give the editor a checkable record.`;

describe("reading a truncated planner reply", () => {
  it("recovers the searches and fetches from a plan cut off mid-object", () => {
    const plan = parsePlan(parseJsonBlockSalvage<unknown>(TRUNCATED_MID_OBJECT));
    assert.equal(plan.searches.length, 2, `no searches survived: ${JSON.stringify(plan.searches)}`);
    assert.ok(
      plan.searches[0]!.includes("child care license"),
      `the first search was mangled: ${plan.searches[0]}`,
    );
    assert.deepEqual(plan.fetch_urls, ["https://cdhs.colorado.gov/child-care-facility-search"]);
    assert.equal(plan.entities.length, 1, "the entity written before the cut was lost");
  });

  it("closes a reply cut off inside its own summary", () => {
    const plan = parsePlan(parseJsonBlockSalvage<unknown>(TRUNCATED_IN_STRING));
    assert.deepEqual(plan.searches, ["Kid City USA closure Longmont"]);
    assert.equal(plan.stop, false);
    assert.match(plan.summary, /license record/, `the summary was lost: ${plan.summary}`);
  });

  it("strips a reasoning preamble and a code fence", () => {
    const plan = parsePlan(parseJsonBlockSalvage<unknown>(REASONING_PREAMBLE_FENCED));
    assert.deepEqual(plan.searches, ['"Kid City USA" Colorado child care license number']);
    assert.deepEqual(plan.fetch_urls, ["https://cdhs.colorado.gov/"]);
  });

  /**
   * The specific trap. `parseJsonBlock` takes `lastIndexOf("}")`, which is -1
   * on an unterminated object, so it falls through to `lastIndexOf("]")` and
   * hands the caller the INNER `searches` array as if it were the answer.
   * `parsePlan` then finds no `searches` key on an array and returns an empty
   * plan -- the reported failure, exactly.
   */
  it("does not mistake an inner array for the whole plan", () => {
    const strict = parseJsonBlockSalvage<unknown>(TRUNCATED_IN_STRING);
    assert.ok(!Array.isArray(strict), "the salvage handed back an inner array as the plan");
    const plan = parsePlan(strict);
    assert.equal(plan.searches.length, 1, "an object that opened as an object must read as one");
  });

  it("still refuses a reply with no JSON in it", () => {
    assert.equal(parseJsonBlockSalvage("I could not produce a plan for this hop."), null);
  });

  it("leaves a valid reply exactly as it was", () => {
    const good = '{"searches":["a"],"fetch_urls":[],"stop":true,"summary":"done"}';
    assert.deepEqual(parseJsonBlockSalvage<unknown>(good), JSON.parse(good));
  });
});

describe("the plan fields the model actually writes", () => {
  it("reads next steps under the names a model reaches for", () => {
    const plan = parsePlan({
      queries: ["Kid City USA license", { query: "1941 Terry Street parcel" }],
      fetch: ["https://cdhs.colorado.gov/"],
      editor_summary: "Went after the licence.",
    });
    assert.deepEqual(plan.searches, ["Kid City USA license", "1941 Terry Street parcel"]);
    assert.deepEqual(plan.fetch_urls, ["https://cdhs.colorado.gov/"]);
    assert.equal(plan.summary, "Went after the licence.");
  });

  it("unwraps a plan returned inside a one-element list", () => {
    const plan = parsePlan([{ searches: ["Kid City USA licence"], fetch_urls: [] }]);
    assert.deepEqual(plan.searches, ["Kid City USA licence"]);
  });
});

describe("the planner's output budget", () => {
  /**
   * The number is the point: 2,200 was the cap that produced the whole defect,
   * and a plan of the shape `DARK_PLANNER` asks for does not fit in it.
   */
  it("is sized for the eleven-field plan the prompt asks for", () => {
    assert.ok(
      PLANNER_OUTPUT_TOKENS >= 4_000,
      `the planner is back to a cap that truncates a real plan (${PLANNER_OUTPUT_TOKENS})`,
    );
  });
});
