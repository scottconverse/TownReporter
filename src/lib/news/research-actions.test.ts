import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseResearchAction, responsiveActionPrompt } from "./research-actions.ts";

describe("responsive research action protocol", () => {
  it("parses fenced typed actions and rejects invented action types", () => {
    assert.deepEqual(parseResearchAction('```json\n{"type":"search","query":"city bid","reason":"find award"}\n```'), {
      type: "search", query: "city bid", reason: "find award",
    });
    assert.throws(() => parseResearchAction('{"type":"browse","url":"https://example.com"}'), /search, read, follow, or finish/);
  });

  it("puts executed receipts before the next decision", () => {
    const prompt = responsiveActionPrompt({
      investigation: "stored evidence",
      decision: 2,
      limit: 6,
      availableLinks: ["https://city.example/packet.pdf"],
      receiptHistory: [{
        decision: 1,
        action: { type: "search", query: "city bid", reason: "find award" },
        outcome: "SEARCH_SUCCESS_RESULTS",
        detail: "1 result",
        links: ["https://city.example/award"],
      }],
    });
    assert.match(prompt, /EXECUTED RECEIPTS/);
    assert.match(prompt, /SEARCH_SUCCESS_RESULTS/);
    assert.match(prompt, /packet\.pdf/);
    assert.match(prompt, /Search discovers results but does not read them/);
  });
});
