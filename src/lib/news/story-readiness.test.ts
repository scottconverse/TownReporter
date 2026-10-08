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

// guards: the editor could be told the lead is open when only later facts need checking.
it("maps open facts to their own paragraphs before explaining not-ready", () => {
  const texts = [
    "Council approved the budget at the final meeting.",
    "Council reviewed the plan after the second reading.",
    "Council debated the proposal during public comment.",
    "Council adopted the calendar after public comment.",
    "Council approved the plan in the evening session.",
    "Council reviewed the budget after a public comment.",
  ];
  const result = storyReadiness({
    headline: "Council budget update",
    body: "Council approved a budget proposal. Council reviewed the plan.\n\n" + texts.join("\n\n"),
    claims: texts.map((text) => ({ text, status: "UNVERIFIED" as const })),
  });
  assert.equal(result.state, "not-ready");
  assert.equal(result.openCount, 6);
  assert.equal(result.reason, "6 facts need checking.");
});
