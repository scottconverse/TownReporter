import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const modPath = new URL("./desk-production-regression-logic.mjs", import.meta.url);

describe("desk production regression safety logic", () => {
  it("refuses to claim no-side-effects when snapshots cannot be collected", async () => {
    assert.equal(existsSync(modPath), true, "logic module must exist");
    const { assertNoSideEffects } = await import("./desk-production-regression-logic.mjs");
    assert.throws(
      () => assertNoSideEffects({ source: "unavailable", counts: null }, { source: "unavailable", counts: null }),
      /snapshot/i,
    );
    assert.throws(
      () => assertNoSideEffects({ source: "staging-db", counts: null }, { source: "staging-db", counts: null }),
      /snapshot/i,
    );
  });

  it("compares deterministic hashes, not just counts", async () => {
    const { assertNoSideEffects } = await import("./desk-production-regression-logic.mjs");
    const before = {
      source: "staging-db",
      counts: { articles: 1, leads: 2, scanRuns: 3, queueLeads: 1 },
      hashes: { articles: "aaa", leads: "bbb", scanRuns: "ccc", queueLeads: "ddd" },
    };
    const changedHash = {
      source: "staging-db",
      counts: { articles: 1, leads: 2, scanRuns: 3, queueLeads: 1 },
      hashes: { articles: "aaa", leads: "CHANGED", scanRuns: "ccc", queueLeads: "ddd" },
    };
    assert.throws(() => assertNoSideEffects(before, changedHash), /leads/);
    const changedCount = {
      source: "staging-db",
      counts: { articles: 1, leads: 3, scanRuns: 3, queueLeads: 1 },
      hashes: { articles: "aaa", leads: "bbb", scanRuns: "ccc", queueLeads: "ddd" },
    };
    assert.throws(() => assertNoSideEffects(before, changedCount), /leads/);
  });

  it("records mutating request methods and fails when any occur", async () => {
    const { assertNoMutatingRequests } = await import("./desk-production-regression-logic.mjs");
    const clean = assertNoMutatingRequests([{ method: "GET", url: "/desk/queue" }, { method: "HEAD", url: "/desk" }]);
    assert.equal(clean.length, 0);
    assert.throws(
      () => assertNoMutatingRequests([{ method: "POST", url: "/desk/queue" }]),
      /mutating request/i,
    );
  });

  it("labels the setup step as intentionally mutating and records it", async () => {
    const { setupStepDisclosure } = await import("./desk-production-regression-logic.mjs");
    assert.match(setupStepDisclosure(true), /mutat/i);
    assert.equal(setupStepDisclosure(false), null);
  });

  it("keeps snapshot queries deterministic with an ORDER BY-able hash", async () => {
    const { snapshotTableSpecs } = await import("./desk-production-regression-logic.mjs");
    const specs = snapshotTableSpecs();
    assert.ok(specs.length >= 4);
    for (const spec of specs) {
      assert.match(spec.hashSql, /md5/i);
      assert.match(spec.hashSql, /order by/i);
    }
  });
});
