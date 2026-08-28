import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleMonitorsCron } from "./monitors-cron.ts";

describe("monitors cron handler", () => {
  it("returns 503 when CRON_SECRET is empty", async () => {
    const prev = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const res = await handleMonitorsCron(new Request("http://127.0.0.1/api/cron/monitors"));
      assert.equal(res.status, 503);
      assert.match(await res.text(), /cron disabled/);
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });

  it("returns 403 when the bearer does not match", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "desk-cron";
    try {
      const res = await handleMonitorsCron(
        new Request("http://127.0.0.1/api/cron/monitors", {
          headers: { authorization: "Bearer wrong" },
        }),
      );
      assert.equal(res.status, 403);
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });
});
