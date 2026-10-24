import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WAIT_STEP_HOLD_MS, waitForModel } from "./jobs.ts";

/*
  D268: THE TICKER MUST NOT TALK OVER THE AGENT.

  A draft's model call now runs an agent that writes its own step words as it
  works ("Fetching the council packet"). The stall ticker used to write
  `Waiting on <model> · 42s` on its first tick and every tick after, so within
  twelve seconds the editor saw the model's name instead of the work. The rule
  these tests pin: while the worker's own step is younger than
  `WAIT_STEP_HOLD_MS`, a tick is a beat and nothing else; past that, the ticker
  says `Waiting on <model>` with no elapsed seconds.

  Fakes only: a fake clock, a fake `report`, a fake Cancel poll. No database,
  no model, no CLI.
*/

/** A run that stays open long enough for a few ticks, then finishes. */
function slowRun<T>(value: T, ms: number): () => Promise<T> {
  return () => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
}

type ProgressCall = {
  stageIndex?: number | null;
  pct?: number | null;
  step?: string | null;
};

describe("waitForModel keeps the worker's own step on the card", () => {
  it("writes a beat only while the worker's step is fresh", async () => {
    const calls: ProgressCall[] = [];
    const wroteAt = Date.now();
    const result = await waitForModel({
      jobId: 7,
      label: "DeepSeek v4.1 Flash 1017",
      tickMs: 5,
      run: slowRun("done", 60),
      now: () => wroteAt + 5_000,
      report: async (_jobId, progress) => {
        calls.push(progress);
      },
      cancelPoll: async () => false,
      // Five seconds ago: well inside the hold window.
      lastStepAt: () => wroteAt,
    });

    assert.equal(result, "done");
    assert.ok(calls.length >= 2, `expected a tick beyond the first beat, got ${calls.length}`);
    for (const call of calls) {
      assert.deepEqual(call, {}, "a fresh worker step must get a beat, not a step");
    }
    assert.equal(
      calls.some((call) => typeof call.step === "string"),
      false,
      "the ticker must not write any step while the worker's own step is fresh",
    );
  });

  it("says Waiting on <label> with no seconds once the step is old or absent", async () => {
    const stale: ProgressCall[] = [];
    const wroteAt = Date.now();
    await waitForModel({
      jobId: 8,
      label: "DeepSeek v4.1 Flash 1017",
      tickMs: 5,
      run: slowRun("done", 40),
      now: () => wroteAt + WAIT_STEP_HOLD_MS + 10_000,
      report: async (_jobId, progress) => {
        stale.push(progress);
      },
      cancelPoll: async () => false,
      lastStepAt: () => wroteAt,
    });
    assert.ok(stale.length >= 1);
    for (const call of stale) {
      assert.equal(call.step, "Waiting on DeepSeek v4.1 Flash 1017");
      assert.equal(String(call.step).includes(" · "), false, "no elapsed seconds in the step");
    }

    const absent: ProgressCall[] = [];
    await waitForModel({
      jobId: 9,
      label: () => "Codex Sol",
      tickMs: 5,
      run: slowRun("done", 20),
      report: async (_jobId, progress) => {
        absent.push(progress);
      },
      cancelPoll: async () => false,
      lastStepAt: () => undefined,
    });
    assert.ok(absent.length >= 1);
    assert.equal(absent[0].step, "Waiting on Codex Sol");
    assert.equal(String(absent[0].step).includes(" · "), false);
  });
});
