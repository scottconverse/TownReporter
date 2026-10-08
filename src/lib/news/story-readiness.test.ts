import { it } from "node:test";
import assert from "node:assert/strict";
import { storyReadiness } from "./story-readiness.ts";

// guards: the editor could be shown a ready story with four open facts or an unchecked lead fact.
it("keeps the editor's readiness state within the record-check thresholds", () => {
  const claim = (status: "VERIFIED" | "UNVERIFIED", text = "A body fact.") => ({ status, text });
  const read = (claims: ReturnType<typeof claim>[], headline = "Budget update", body = "Council met.\n\nA body fact.\n\nMore story.") =>
    storyReadiness({ headline, body, claims });
  assert.deepEqual([read([claim("VERIFIED")]).state, read([claim("VERIFIED")]).openCount], ["verified", 0]);
  assert.equal(read([claim("UNVERIFIED")]).state, "to-check");
  assert.equal(read([claim("UNVERIFIED"), claim("UNVERIFIED"), claim("UNVERIFIED")]).state, "to-check");
  assert.equal(read(Array.from({ length: 4 }, () => claim("UNVERIFIED"))).state, "not-ready");
  const lead = "The council approved the budget.";
  assert.equal(read([claim("UNVERIFIED", lead)], lead, `${lead}\n\nMore story.`).state, "not-ready");
});
