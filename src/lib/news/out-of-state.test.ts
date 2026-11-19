import assert from "node:assert/strict";
import { test } from "node:test";
import { OUT_OF_STATE_WARNING, looksOutOfState, namesAnotherState } from "./out-of-state.ts";

/*
  F01 (live walk 2026-11-19): a Plymouth Superior Court story about Duxbury,
  Mass. was filed under "Nearby" on the Longmont, Colorado paper. This check
  names the problem for the editor. It WARNS and never blocks: no assertion
  here is about a status, a gate or a refused press, because there is none.
*/

const LONGMONT = { city: "Longmont", state: "Colorado" };
const NEARBY = ["Boulder", "Erie", "Lafayette", "Louisville", "Superior"];

test("F01: the Clancy retrial story (Duxbury, Mass.) is flagged", () => {
  const story = {
    headline: "Judge Sets Lindsay Clancy Retrial for March 29, 2027",
    body: "The retrial was set in Plymouth Superior Court in Duxbury, Mass. over the objections of her defense.",
  };
  assert.equal(looksOutOfState(story, LONGMONT, NEARBY), true);
});

test("F01: a story about this paper's own town is not flagged", () => {
  const story = {
    headline: "Longmont council approves budget",
    body: "The vote was 5-2 at the Longmont Civic Center.",
  };
  assert.equal(looksOutOfState(story, LONGMONT, NEARBY), false);
});

test("F01: naming Colorado or a Nearby town keeps a story local", () => {
  const story = {
    headline: "Boulder students win a national robotics contest",
    body: "The team from Boulder, Colo. beat a field that included a school in Erie, Pennsylvania.",
  };
  // "Colo." is this paper's own state, so the Erie dateline does not flag it.
  assert.equal(looksOutOfState(story, LONGMONT, NEARBY), false);
});

test("F01: a story that names no state at all is not flagged", () => {
  assert.equal(
    looksOutOfState(
      { headline: "Superior Town Board meets", body: "The board met in Superior." },
      LONGMONT,
      NEARBY,
    ),
    false,
  );
});

test("F01: an AP abbreviation after a town is another state; a bare word is not", () => {
  assert.equal(namesAnotherState("The case was heard in Louisville, Ky.", "Colorado"), true);
  assert.equal(namesAnotherState("The plan covers Erie, Pennsylvania.", "Colorado"), true);
  assert.equal(namesAnotherState("A shop in Lafayette, La. closed.", "Colorado"), true);
  // No comma, no state: an ordinary word or a nearby town on its own.
  assert.equal(namesAnotherState("The Superior court ruled.", "Colorado"), false);
  assert.equal(namesAnotherState("Players from Louisville and Erie.", "Colorado"), false);
});

test("F01: the one sentence the desk shows, unchanged", () => {
  assert.equal(OUT_OF_STATE_WARNING, "This story may be about another state, not Colorado");
});
