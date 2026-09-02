import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OPS_ACTIONS, findOpsAction, isOpsActionId } from "./actions.ts";
import {
  databaseValue,
  diskState,
  formatAgo,
  formatBytes,
  formatIn,
  formatUptime,
  jobsState,
  overallState,
  publicState,
  watchdogState,
} from "./health.ts";

describe("ops action allowlist", () => {
  /**
   * This is the security boundary for the whole dashboard: the action id is the
   * only thing a caller controls, and it must be matched against the list
   * rather than pattern-checked. Anything that is not one of the declared ids
   * has to be refused, including the shapes someone would try.
   */
  it("refuses anything that is not a declared id", () => {
    for (const bad of [
      "",
      " ",
      "watchdog ",
      "WATCHDOG",
      "../../etc/passwd",
      "watchdog; rm -rf /",
      "watchdog && shutdown",
      "restart-app|calc.exe",
      "$(whoami)",
      "`whoami`",
      "restart-app\nwatchdog",
      "..\\..\\ops\\watchdog.ps1",
      null,
      undefined,
      42,
      {},
      ["watchdog"],
    ] as unknown[]) {
      assert.equal(isOpsActionId(bad), false, `must refuse ${JSON.stringify(bad)}`);
      // Only strings reach `findOpsAction`; the guard above is what stops
      // anything else. Coercing here would test the coercion, not the lookup —
      // `String(["watchdog"])` is "watchdog", which is a real id.
      if (typeof bad === "string") assert.equal(findOpsAction(bad), null);
    }
  });

  it("accepts every declared id and nothing else", () => {
    for (const a of OPS_ACTIONS) {
      assert.equal(isOpsActionId(a.id), true, a.id);
      assert.equal(findOpsAction(a.id)?.id, a.id);
    }
    assert.equal(isOpsActionId("deploy"), false);
  });

  it("does not inherit ids from Object.prototype", () => {
    // A Map-backed lookup, not a plain object: `constructor` and `toString`
    // are properties of every object literal and would otherwise pass.
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      assert.equal(isOpsActionId(key), false, key);
    }
  });

  it("tells the operator what interrupts the paper", () => {
    const interrupting = OPS_ACTIONS.filter((a) => a.interrupts).map((a) => a.id);
    assert.deepEqual(interrupting.sort(), ["restart-app", "restart-tunnel"]);
    for (const a of OPS_ACTIONS) {
      assert.ok(a.detail.length > 30, `${a.id} needs a real explanation`);
      assert.ok(a.expectSeconds > 0);
    }
  });
});

describe("health readings", () => {
  it("lets the worst state decide the whole page", () => {
    const c = (state: "ok" | "warn" | "down" | "unknown") => ({
      id: state,
      label: "x",
      state,
      value: "",
    });
    assert.equal(overallState([c("ok"), c("warn")]), "warn");
    assert.equal(overallState([c("ok"), c("warn"), c("down")]), "down");
    assert.equal(overallState([c("ok"), c("ok")]), "ok");
    assert.equal(overallState([c("ok"), c("unknown")]), "unknown");
    assert.equal(overallState([]), "unknown");
  });

  it("formats sizes and uptime for reading at a glance", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(2048), "2.0 KB");
    assert.match(formatBytes(5 * 1024 ** 3), /GB$/);
    assert.equal(formatBytes(-1), "—");
    assert.equal(formatUptime(30), "30s");
    assert.equal(formatUptime(90), "1m");
    assert.equal(formatUptime(3 * 3600 + 120), "3h 2m");
    assert.match(formatUptime(5 * 86400), /^5d/);
  });

  it("says 'never' rather than a wrong time when there is no reading", () => {
    assert.equal(formatAgo(null), "never");
    assert.equal(formatAgo("not a date"), "unknown");
    const now = new Date("2026-08-28T12:00:00Z");
    assert.equal(formatAgo("2026-08-28T11:58:00Z", now), "2m ago");
  });

  /** Warn long before it bites: the failure is Postgres refusing writes. */
  it("warns on disk well before it is full", () => {
    assert.equal(diskState(50 * 1024 ** 3), "ok");
    assert.equal(diskState(5 * 1024 ** 3), "warn");
    assert.equal(diskState(1 * 1024 ** 3), "down");
    assert.equal(diskState(0), "unknown");
  });

  /**
   * A watchdog that stopped running is the quietest failure on the machine:
   * everything reads fine until something breaks and nothing repairs it.
   */
  it("treats a stale watchdog as down, not as fine", () => {
    const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
    assert.equal(watchdogState(iso(2), 0), "ok");
    assert.equal(watchdogState(iso(15), 0), "warn");
    assert.equal(watchdogState(iso(45), 0), "down");
    assert.equal(watchdogState(iso(2), 1), "warn");
    assert.equal(watchdogState(null, 0), "unknown");
  });

  it("gives no partial credit on whether people can read the paper", () => {
    assert.equal(publicState(200, ""), "ok");
    assert.equal(publicState(503, ""), "down");
    assert.equal(publicState(200, "timeout"), "down");
    assert.equal(publicState(0, ""), "unknown");
  });

  it("flags a job that has been running for an hour", () => {
    assert.equal(jobsState(0, 0, 0), "ok");
    assert.equal(jobsState(1, 0, 5 * 60_000), "ok");
    assert.equal(jobsState(1, 0, 90 * 60_000), "warn");
    assert.equal(jobsState(0, 2, 0), "warn");
  });

  /**
   * PGLite answers `current_database()` with "postgres" too, so the tile
   * cannot tell a real Postgres apart from the embedded fallback just by
   * echoing that name back — it has to say which backend actually answered.
   */
  it("names the embedded fallback instead of echoing PGLite's borrowed name", () => {
    assert.equal(
      databaseValue(true, "postgres", "3.2 MB", 4),
      "embedded (PGLite) — data is lost when the server stops · answered in 4ms",
    );
    assert.equal(databaseValue(false, "townreporter", "9.8 MB", 12), "townreporter · 9.8 MB · answered in 12ms");
    assert.equal(databaseValue(false, undefined, undefined, 1), "? · ? · answered in 1ms");
  });
});

describe("formatIn", () => {
  /** `formatAgo` on a future time produced "next in the future" — useless. */
  it("reads as a countdown, not as a fact about the past", () => {
    const now = new Date("2026-08-28T12:00:00Z");
    assert.equal(formatIn("2026-08-28T12:04:00Z", now), "in 4m");
    assert.equal(formatIn("2026-08-28T12:00:30Z", now), "in 30s");
    assert.equal(formatIn("2026-08-29T12:00:00Z", now), "in 24h");
  });

  it("says 'due now' for a time that has passed", () => {
    const now = new Date("2026-08-28T12:00:00Z");
    assert.equal(formatIn("2026-08-28T11:59:00Z", now), "due now");
  });

  it("handles nothing and nonsense without throwing", () => {
    assert.equal(formatIn(null), "not scheduled");
    assert.equal(formatIn("not a date"), "unknown");
  });
});
