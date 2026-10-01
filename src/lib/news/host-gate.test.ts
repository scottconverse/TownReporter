/**
 * Per-host pacing, pinned (unit SH-B item 1).
 *
 * WHAT THESE TESTS ARE FOR. A scan reads many sources at once and one source is
 * many requests, most of them to the same host. Before this the desk made its
 * roughly fifty requests to one city's server with six in flight and no gap,
 * which is what a flood looks like from their side. The gate is the fix, and
 * the two properties that make it a fix rather than a slowdown are:
 *
 *  - two requests to the same host are separated by the gap, and are never in
 *    flight together;
 *  - two requests to *different* hosts are not separated at all.
 *
 * The clock is injected, so "the gap was observed" is asserted by reading the
 * times the gate asked to sleep rather than by waiting two real seconds.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHostGate, HOST_GAP_JITTER_MS, HOST_MIN_GAP_MS } from "./host-gate.ts";

/** A clock that only moves when the gate sleeps, plus a record of every sleep. */
function fakeClock(random = 0) {
  let t = 1_000;
  const slept: number[] = [];
  return {
    slept,
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    random: () => random,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

test("two requests to the same host are separated by the gap", async () => {
  const clock = fakeClock();
  const gate = createHostGate({ ...clock, jitterMs: 0 });

  await gate.run("example.gov", async () => "first");
  await gate.run("example.gov", async () => "second");

  assert.deepEqual(clock.slept, [HOST_MIN_GAP_MS]);
});

test("a gap that is added as jitter is part of the wait", async () => {
  const clock = fakeClock(1);
  const gate = createHostGate({ ...clock });

  await gate.run("example.gov", async () => "first");
  await gate.run("example.gov", async () => "second");

  assert.deepEqual(clock.slept, [HOST_MIN_GAP_MS + HOST_GAP_JITTER_MS]);
});

test("different hosts are not slowed at all", async () => {
  const clock = fakeClock();
  const gate = createHostGate({ ...clock });

  await gate.run("one.gov", async () => "a");
  await gate.run("two.gov", async () => "b");
  await gate.run("three.gov", async () => "c");

  assert.deepEqual(clock.slept, [], "no host waited on another host's request");
});

test("a host that has been left alone for longer than the gap is not held back", async () => {
  const clock = fakeClock();
  const gate = createHostGate({ ...clock });

  await gate.run("example.gov", async () => "first");
  clock.advance(HOST_MIN_GAP_MS * 5);
  await gate.run("example.gov", async () => "second");

  assert.deepEqual(clock.slept, []);
});

test("never more than one request in flight to one host", async () => {
  const clock = fakeClock();
  const gate = createHostGate({ ...clock });
  let inFlight = 0;
  let peak = 0;
  const send = async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setImmediate(r));
    inFlight -= 1;
    return "ok";
  };

  await Promise.all([
    gate.run("example.gov", send),
    gate.run("example.gov", send),
    gate.run("example.gov", send),
  ]);

  assert.equal(peak, 1);
});

test("order is reserved in call order, not in completion order", async () => {
  const clock = fakeClock();
  const gate = createHostGate({ ...clock });
  const seen: string[] = [];
  const slow = async (name: string, delay: number) => {
    await new Promise((r) => setTimeout(r, delay));
    seen.push(name);
    return name;
  };

  await Promise.all([
    gate.run("example.gov", () => slow("first", 20)),
    gate.run("example.gov", () => slow("second", 0)),
  ]);

  assert.deepEqual(seen, ["first", "second"]);
});

test("the schedule seam paces the host of the URL it is given", async () => {
  const clock = fakeClock();
  const gate = createHostGate({ ...clock, jitterMs: 0 });
  const send = async () => new Response("ok");

  await gate.schedule(send, new URL("https://Example.GOV/a"));
  await gate.schedule(send, new URL("https://example.gov/b"));
  await gate.schedule(send, new URL("https://other.gov/c"));

  assert.deepEqual(clock.slept, [HOST_MIN_GAP_MS], "case and path do not make a new host");
});
