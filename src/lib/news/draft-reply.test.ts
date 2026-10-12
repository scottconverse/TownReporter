import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runDraftReply } from "./draft-reply.ts";

const reply = (text: string) => async () => ({ ok: true as const, text });

describe("runDraftReply: an empty draft is a failed attempt", () => {
  it("does not hand back an ok result with an empty body, even without requireReadable", async () => {
    const result = await runDraftReply(reply(JSON.stringify({ headline: "H", dek: "D", body: "", topic: "T" })));
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /empty draft/i);
  });

  it("does not save a draft with a blank headline, even when the body is written", async () => {
    const body = "The council voted 5-2 on Tuesday to approve the budget. ".repeat(3).trim();
    const result = await runDraftReply(reply(JSON.stringify({ headline: "  ", dek: "D", body, topic: "T" })), 0);
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /empty draft/i);
  });

  it("keeps a reply with a body as a success", async () => {
    const body = "The council voted 5-2 on Tuesday to approve the budget. ".repeat(3).trim();
    const result = await runDraftReply(reply(JSON.stringify({ headline: "H", dek: "D", body, topic: "T" })), 0);
    assert.equal(result.ok, true);
  });
});
