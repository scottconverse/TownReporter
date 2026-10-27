import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dropCopiesPaced, readConfig, waitForPaperTurn } from "../../../ops/lib-promote-db.mjs";

/**
 * G25-DK-2: the pre-rollout copy prune looks at the live paper between drops
 * and waits while it is slow. Everything here is a fake: no :3000, no database,
 * no real wait.
 */

function fakeClient(failOn: string[] = []) {
  const queries: string[] = [];
  return {
    queries,
    client: {
      async query(sql: string) {
        queries.push(sql);
        if (failOn.some((name) => sql.includes(name))) throw new Error("database is being accessed by other users");
        return {};
      },
    },
  };
}

const refused = () => Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3000"), { code: "ECONNREFUSED" });

describe("dropCopiesPaced", () => {
  it("looks at the paper between drops, not before the first, and waits while it is slow", async () => {
    const { client, queries } = fakeClient();
    const looks: number[] = [];
    const slept: number[] = [];
    // First look: timeout. Second: slow 200. Third: fast 200. Then fast for the next gap.
    const answers: Array<() => { status: number; seconds: number }> = [
      () => { throw new Error("The operation was aborted due to timeout"); },
      () => ({ status: 200, seconds: 6.2 }),
      () => ({ status: 200, seconds: 0.2 }),
      () => ({ status: 200, seconds: 0.2 }),
    ];
    const result = await dropCopiesPaced(client, ["townreporter_a", "townreporter_b", "townreporter_c"], {
      port: 3000,
      probe: async (port) => {
        looks.push(port);
        return answers[looks.length - 1]!();
      },
      sleep: async (seconds) => { slept.push(seconds); },
    });
    assert.deepEqual(result.dropped, ["townreporter_a", "townreporter_b", "townreporter_c"]);
    assert.equal(queries.length, 3);
    // Two gaps, so the first gap needed 3 looks (2 waits) and the second 1.
    assert.equal(looks.length, 4);
    assert.deepEqual(slept, [5, 5]);
    assert.equal(result.pauses.filter((note) => /pausing 5 s/.test(note)).length, 2);
    assert.match(result.pauses.join("\n"), /townreporter_b/);
    assert.match(result.pauses.join("\n"), /answering again after 10 s/);
  });

  it("does not wait for a refused connection, and does nothing when no port is known", async () => {
    const first = fakeClient();
    const slept: number[] = [];
    const refusedRun = await dropCopiesPaced(first.client, ["townreporter_a", "townreporter_b"], {
      port: 3000,
      probe: async () => { throw refused(); },
      sleep: async (seconds) => { slept.push(seconds); },
    });
    assert.deepEqual(refusedRun.dropped, ["townreporter_a", "townreporter_b"]);
    assert.deepEqual(slept, []);
    assert.match(refusedRun.pauses.join("\n"), /nothing listens on :3000/);

    const second = fakeClient();
    let looked = false;
    const noPort = await dropCopiesPaced(second.client, ["townreporter_a", "townreporter_b"], {
      port: null,
      probe: async () => { looked = true; return 200; },
      sleep: async () => { throw new Error("must not wait"); },
    });
    assert.equal(looked, false);
    assert.deepEqual(noPort.pauses, []);
    assert.equal(noPort.dropped.length, 2);
  });

  it("goes on after the cap and never fails the prune because of the check", async () => {
    const { client } = fakeClient(["townreporter_b"]);
    const slept: number[] = [];
    const result = await dropCopiesPaced(client, ["townreporter_a", "townreporter_b", "townreporter_c"], {
      port: 3000,
      probe: async () => 503,
      sleep: async (seconds) => { slept.push(seconds); },
    });
    // The paper never recovers: each gap waits at most 120 s, the whole prune at most 900 s.
    assert.equal(slept.reduce((a, b) => a + b, 0), 240);
    assert.match(result.pauses.join("\n"), /wait cap is used up, going on/);
    // A failed drop is a warning, and the drops after it still happen.
    assert.deepEqual(result.dropped, ["townreporter_a", "townreporter_c"]);
    assert.equal(result.warnings.length, 1);

    // A probe that throws something odd is also just a note.
    const odd = fakeClient();
    const oddRun = await dropCopiesPaced(odd.client, ["townreporter_a", "townreporter_b"], {
      port: 3000,
      probe: async () => { throw new Error("socket hang up"); },
      sleep: async () => {},
      });
    assert.equal(oddRun.dropped.length, 2);
  });

  it("caps the whole prune at 900 seconds across many gaps", async () => {
    const { client } = fakeClient();
    let total = 0;
    const names = Array.from({ length: 12 }, (_, i) => `townreporter_x${i}`);
    const result = await waitForPaperTurn({ port: 1, probe: async () => 503, sleep: async (s) => { total += s; }, budget: { usedSeconds: 890, maxTotalSeconds: 900 } });
    assert.equal(result.capped, true);
    assert.equal(total, 10);
    const run = await dropCopiesPaced(client, names, { port: 3000, probe: async () => 503, sleep: async (s) => { total += s; } });
    assert.equal(run.dropped.length, 12);
    assert.equal(total - 10, 900);
  });
});

describe("readConfig: the paper's port", () => {
  it("reads PROMOTE_DB_PAPER_PORT when it is a number, else no pause", () => {
    assert.equal(readConfig({ PROMOTE_DB_PAPER_PORT: "3000" } as NodeJS.ProcessEnv).paperPort, 3000);
    assert.equal(readConfig({ PROMOTE_DB_PAPER_PORT: "" } as NodeJS.ProcessEnv).paperPort, null);
    assert.equal(readConfig({ PROMOTE_DB_PAPER_PORT: "abc" } as NodeJS.ProcessEnv).paperPort, null);
    assert.equal(readConfig({} as NodeJS.ProcessEnv).paperPort, null);
  });
});
