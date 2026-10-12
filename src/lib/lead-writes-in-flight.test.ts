import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLeadWrites } from "./lead-writes-in-flight.ts";

describe("THT-8: a restore waits for the same lead's kill write", () => {
  it("runs the restore only after the slow kill has answered", async () => {
    const writes = createLeadWrites();
    const order: string[] = [];
    let landKill!: () => void;
    writes.track(452, new Promise<void>((resolve) => { landKill = () => { order.push("kill landed"); resolve(); }; }));
    const restore = writes.settled(452).then(() => order.push("restore sent"));
    await Promise.resolve();
    assert.deepEqual(order, [], "the restore must not go out while the kill is in flight");
    landKill();
    await restore;
    assert.deepEqual(order, ["kill landed", "restore sent"]);
  });

  it("does not wait on another lead, and goes ahead when the kill failed", async () => {
    const writes = createLeadWrites();
    const failing = writes.track(1, Promise.reject(new Error("refused")));
    failing.catch(() => undefined);
    await writes.settled(1);
    await writes.settled(2);
  });
});
