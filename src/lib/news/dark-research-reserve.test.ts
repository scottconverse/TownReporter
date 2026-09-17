/*
  The Dark Desk run clock bug, in miniature.

  Runs 1 and 2 of the 2026-09-16 isolated acceptance spent the whole wall
  clock in research and stopped "elapsed-time-limit" with zero eligible
  signals - see docs/proofs/dark-desk-run-budget-0651.md. Synthesis, the
  four-question review and the editor brief all draw on the same meter, so
  research has to stop while the provider's reserve is still on it.

  This asserts the loop-level contract only: research must not spend the
  reserve, and it must not call that stop an elapsed-time exhaustion.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureDarkSchema } from "./dark.ts";
import { createDarkRunBudget } from "./dark-run-budget.ts";
import { researchLoop, emptyPlan } from "./investigate.ts";

async function seed(userId: string, newsroomId: number) {
  await ensureDarkSchema();
  const sql = await getSql();
  const [inv] = await sql<{ id: number }>`
    insert into investigations(user_id,newsroom_id,title)
    values(${userId},${newsroomId},'Reserve probe') returning id`;
  await sql`
    insert into frontier_items(user_id,newsroom_id,investigation_id,label,kind)
    values(${userId},${newsroomId},${inv!.id},'Unresolved lead','topic')`;
  return inv!.id;
}

function run(over: { reserveMs: number; elapsed: number; now: { at: number } }) {
  return createDarkRunBudget(
    { elapsedMs: 10_000, modelCalls: 10, searches: 10, documentReads: 10 },
    { now: () => over.now.at },
  );
}

test("research leaves the provider reserve on the meter for the writing stages", async () => {
  const userId = "reserve-kept";
  const investigationId = await seed(userId, 93);
  const now = { at: 1_000 };
  const budget = run({ reserveMs: 2_000, elapsed: 9_000, now });

  let plannerCalls = 0;
  now.at += 9_000; // 1s left: more than nothing, less than the 2s reserve

  const out = await researchLoop({
    userId,
    newsroomId: 93,
    investigationId,
    hops: 5,
    researchReserveMs: 2_000,
    runBudget: budget,
    planner: async () => {
      plannerCalls += 1;
      return { ...emptyPlan(), searches: ["anything"] };
    },
    search: async () => [],
    fetch: async () => ({ ok: false, status: 404, text: "", title: "", extras: [] }),
    archives: async () => [],
  });

  assert.equal(plannerCalls, 0, "research must not start a hop inside the reserve");
  assert.ok(budget.remainingMs() > 0, "the reserve is still spendable by synthesis");
  assert.notEqual(out.stopReason, "elapsed-time-limit", "stopping at the reserve is not time exhaustion");
  assert.equal(budget.stopReason, null, "the meter itself was never exhausted");
});

test("without a reserve the loop spends the clock down as before", async () => {
  const userId = "reserve-absent";
  const investigationId = await seed(userId, 94);
  const now = { at: 1_000 };
  const budget = run({ reserveMs: 0, elapsed: 9_000, now });

  let plannerCalls = 0;
  now.at += 9_000; // same 1s left, but nothing is held back

  const out = await researchLoop({
    userId,
    newsroomId: 94,
    investigationId,
    hops: 1,
    runBudget: budget,
    planner: async () => {
      plannerCalls += 1;
      return { ...emptyPlan(), searches: ["anything"] };
    },
    search: async () => [],
    fetch: async () => ({ ok: false, status: 404, text: "", title: "", extras: [] }),
    archives: async () => [],
  });

  assert.equal(plannerCalls, 1, "with no reserve the hop still runs on the last second");
  assert.equal(out.stopReason, null);
});

/*
  The second research call is the one that overshot.

  The hop gate alone lets a hop start while barely above the reserve, and a hop
  costs two model calls. Run 5 of 2026-09-16 began hop 3 with 241 s left,
  finished it at 309 s, and left the writing stages only ~111 s of the 170 s
  they were supposed to keep. These two cases pin the post-search selector to
  the same reserve.
*/
function selectorFixture(advanceMs: number) {
  const now = { at: 1_000 };
  const budget = createDarkRunBudget(
    { elapsedMs: 10_000, modelCalls: 10, searches: 10, documentReads: 10 },
    { now: () => now.at },
  );
  let selectorCalls = 0;
  let advanced = false;
  return {
    budget,
    // Spend the hop's time exactly once, the way one planning call plus its
    // searches would, so the selector is judged against a known remainder.
    tick: () => {
      if (advanced) return;
      advanced = true;
      now.at += advanceMs;
    },
    calls: () => selectorCalls,
    bump: () => { selectorCalls += 1; },
  };
}

test("research does not spend the reserve on the post-search selector", async () => {
  const userId = "reserve-selector-held";
  const investigationId = await seed(userId, 97);
  const fixture = selectorFixture(8_500);
  const budget = fixture.budget;

  await researchLoop({
    userId,
    newsroomId: 97,
    investigationId,
    hops: 1,
    researchReserveMs: 2_000,
    runBudget: budget,
    planner: async () => ({ ...emptyPlan(), searches: ["longmont records"] }),
    search: async () => {
      // The hop's planning call and searches consume most of the clock, as a
      // long hop does in production: 1.5 s left against a 2 s reserve.
      fixture.tick();
      return [{ url: "https://example.gov/record", title: "Record", snippet: "text" }];
    },
    readSelector: async () => {
      fixture.bump();
      return { ...emptyPlan() };
    },
    fetch: async () => ({ ok: false, status: 404, text: "", title: "", extras: [] }),
    archives: async () => [],
  });

  assert.equal(fixture.calls(), 0, "the selector must not run inside the reserve");
  assert.equal(budget.remainingMs(), 1_500, "the writing stages keep their reserve");
});

test("with headroom the selector still runs", async () => {
  const userId = "reserve-selector-runs";
  const investigationId = await seed(userId, 98);
  const fixture = selectorFixture(1_000);
  const budget = fixture.budget;

  await researchLoop({
    userId,
    newsroomId: 98,
    investigationId,
    hops: 1,
    researchReserveMs: 2_000,
    runBudget: budget,
    planner: async () => ({ ...emptyPlan(), searches: ["longmont records"] }),
    search: async () => {
      fixture.tick();
      return [{ url: "https://example.gov/record", title: "Record", snippet: "text" }];
    },
    readSelector: async () => {
      fixture.bump();
      return { ...emptyPlan() };
    },
    fetch: async () => ({ ok: false, status: 404, text: "", title: "", extras: [] }),
    archives: async () => [],
  });

  assert.equal(fixture.calls(), 1, "a hop with real headroom still selects its reads");
});
