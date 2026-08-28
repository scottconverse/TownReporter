import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleMonitorsCron } from "./monitors-cron.ts";

describe("monitors cron", () => {
  it("empty CRON_SECRET is 503 and does not tick", async () => {
    const prev = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const res = await handleMonitorsCron(
        new Request("https://example.com/api/cron/monitors"),
      );
      assert.equal(res.status, 503);
      assert.match(await res.text(), /cron disabled/);
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });

  it("wrong bearer is 403", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "desk-cron";
    try {
      const res = await handleMonitorsCron(
        new Request("https://example.com/api/cron/monitors", {
          headers: { authorization: "Bearer nope" },
        }),
      );
      assert.equal(res.status, 403);
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });
});
