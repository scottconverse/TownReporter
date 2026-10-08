// guards: unrelated source words could mark an unsupported statement verified in the editor's story.
import { it } from "node:test";
import assert from "node:assert/strict";
import { reviewOpenStoryClaims } from "./civic-reporting-run.server.ts";

it("requires a relevant quote when a claim has no checkable elements", async () => {
  const text = "Residents supported safer walking routes.";
  for (const [quote, status] of [["Volunteers planted flowers beside benches.", "UNVERIFIED"], ["Residents supported safer walking routes.", "VERIFIED"]]) {
    const result = await reviewOpenStoryClaims({
      story: { id: "walk", headline: text, draft: text, plainBrief: "", cannotSay: "", readinessTier: 1,
        claims: [{ id: "walk", text, status: "UNVERIFIED", sourceIds: [], nextCheck: "" }], sources: [] },
      record: { identity: { videoUrl: "https://city.test/recording" }, segments: [{ seconds: 60, text: quote }] } as never,
      documents: [], method: { text: "Use records only." } as never, chatOpts: {}, throwIfCancelled: async () => {},
      chat: (async () => ({ ok: true, text: JSON.stringify({ verdict: "VERIFIED", quote }) })) as never,
    });
    assert.equal(result.claims[0]!.status, status);
  }
});
