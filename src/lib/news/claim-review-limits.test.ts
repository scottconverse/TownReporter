// guards: unbounded re-checking could delay filing and hide which story claims remain unchecked.
import { it } from "node:test";
import assert from "node:assert/strict";
import { reviewOpenStoryClaims } from "./civic-reporting-run.server.ts";

it("prioritizes opening claims and leaves excess or late claims open", async () => {
  const claims = Array.from({ length: 10 }, (_, i) => ({ id: String(i), text: `Residents supported walking route ${i}.`, status: "UNVERIFIED" as const, sourceIds: [], nextCheck: "" }));
  let clock = 0;
  const calls: string[] = [];
  const input = {
    story: { id: "walk", headline: claims[9]!.text, draft: `${claims[8]!.text}\n\n${claims.slice(0, 8).map(c => c.text).join(" ")}`, plainBrief: "", cannotSay: "", readinessTier: 1, claims, sources: [] },
    record: { identity: {}, segments: [] } as never, documents: [], method: { text: "Use records only." } as never,
    chatOpts: { timeoutMs: 100_000 }, checkDeadline: 100_000, now: () => clock, throwIfCancelled: async () => {},
    chat: (async (_system: string, prompt: string) => { calls.push(prompt.split("CLAIM: ")[1]!.split("\n")[0]!); return { ok: true, text: '{"verdict":"OPEN"}' }; }) as never,
  };
  const result = await reviewOpenStoryClaims(input);
  assert.equal(calls.length, 8);
  assert.deepEqual(calls.slice(0, 2), [claims[9]!.text, claims[8]!.text]);
  assert.ok(result.claims.filter(c => !calls.includes(c.text)).every(c => c.status === "UNVERIFIED" && c.checkReason === "Not re-checked: the run reached its check limit."));
  calls.length = 0;
  clock = 90_001;
  const late = await reviewOpenStoryClaims(input);
  assert.equal(calls.length, 0);
  assert.ok(late.claims.every(c => c.status === "UNVERIFIED" && c.checkReason === "Not re-checked: the run reached its check limit."));
});
