import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleMonitorsCronRequest } from "./cron-monitors-request.ts";

const monitorResult = {
  users: 2,
  checked: 3,
  anomalies: 1,
  jobs: 4,
  purged: 5,
  purgeError: null,
  legalPurged: 6,
  legalPurgeError: null,
};

describe("authenticated monitor cron wake", () => {
  it("reserves daily scans before the existing monitor and job-drain tick", async () => {
    const calls: string[] = [];
    const response = await handleMonitorsCronRequest(
      new Request("https://paper.test/api/cron/monitors", {
        headers: { authorization: "Bearer wake-secret" },
      }),
      {
        secret: " wake-secret ",
        tickDaily: async () => {
          calls.push("daily");
          return { reserved: 1 };
        },
        tickMonitors: async () => {
          calls.push("monitors");
          return monitorResult;
        },
      },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(calls, ["daily", "monitors"]);
    assert.deepEqual(await response.json(), monitorResult);
  });

  it("does no work when cron is disabled or authorization is wrong", async () => {
    for (const testCase of [
      { secret: "", authorization: "Bearer wake-secret", status: 503, body: "cron disabled" },
      { secret: "wake-secret", authorization: "Bearer wrong", status: 403, body: "forbidden" },
    ]) {
      const calls: string[] = [];
      const response = await handleMonitorsCronRequest(
        new Request("https://paper.test/api/cron/monitors", {
          headers: { authorization: testCase.authorization },
        }),
        {
          secret: testCase.secret,
          tickDaily: async () => {
            calls.push("daily");
            return { reserved: 1 };
          },
          tickMonitors: async () => {
            calls.push("monitors");
            return monitorResult;
          },
        },
      );
      assert.equal(response.status, testCase.status);
      assert.equal(await response.text(), testCase.body);
      assert.deepEqual(calls, []);
    }
  });

  it("still drains monitors but reports failure when daily reservation fails", async (t) => {
    const calls: string[] = [];
    t.mock.method(console, "error", () => undefined);
    const response = await handleMonitorsCronRequest(
      new Request("https://paper.test/api/cron/monitors", {
        headers: { authorization: "Bearer wake-secret" },
      }),
      {
        secret: "wake-secret",
        tickDaily: async () => {
          calls.push("daily");
          throw new Error("daily schema unavailable");
        },
        tickMonitors: async () => {
          calls.push("monitors");
          return monitorResult;
        },
      },
    );

    assert.equal(response.status, 500);
    assert.deepEqual(calls, ["daily", "monitors"]);
    assert.deepEqual(await response.json(), monitorResult);
    assert.equal(console.error.mock.callCount(), 1);
  });
});
