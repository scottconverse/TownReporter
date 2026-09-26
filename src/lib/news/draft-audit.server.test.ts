import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DRAFT_STYLE_TIMEOUT_MS, draftFromReply, styleRepairCall, type DraftStyleChat } from "./draft-audit.server.ts";

const request = { findings: [{ paragraph: 1, sentence: 2, message: "Nobody is named." }], body: "Experts say the fee will rise." };

/** A chat that records what it was handed and answers with `text`. */
function recordingChat(text: string, ok = true) {
  const seen: Array<{ system: string; user: string; maxTokens: number | undefined; choice: unknown; timeoutMs: number | undefined }> = [];
  const chat: DraftStyleChat = async (system, user, maxTokens, choice, options) => {
    seen.push({ system, user, maxTokens, choice, timeoutMs: options?.timeoutMs });
    return ok ? { ok: true, text } : { ok: false, error: text };
  };
  return { chat, seen };
}

describe("reading a model's rewrite out of its reply", () => {
  it("takes a bare draft as it stands", () => {
    const body = "The council voted on the water fee.\n\nThe rate starts in January.";
    assert.equal(draftFromReply(body), body);
  });

  it("takes the draft out of a fenced block", () => {
    assert.equal(
      draftFromReply("```\nThe council voted on the water fee.\n```"),
      "The council voted on the water fee.",
    );
  });

  it("takes the draft out of a fenced block that names a language", () => {
    assert.equal(draftFromReply("```markdown\nThe rate starts in January.\n```"), "The rate starts in January.");
  });

  it("drops a one-line label and keeps the draft under it", () => {
    const reply = "Here is the corrected draft:\n\nThe council voted on the water fee.";
    assert.equal(draftFromReply(reply), "The council voted on the water fee.");
  });

  it("keeps a first line that only looks like a label, because a blank line is what makes it one", () => {
    const reply = "The manager put it plainly:\nThe fee rises in January.";
    assert.equal(draftFromReply(reply), reply);
  });

  it("answers empty for an empty reply", () => {
    assert.equal(draftFromReply(""), "");
    assert.equal(draftFromReply("   \n\n  "), "");
  });

  it("reads a reply that is nothing but a fenced block with no body as empty", () => {
    assert.equal(draftFromReply("```\n\n```"), "");
  });
});

describe("the repair call the loop drives", () => {
  it("asks the chat for a rewrite and hands back the text", async () => {
    const { chat, seen } = recordingChat("The council voted on the water fee.");
    const call = styleRepairCall({ chat });
    const answer = await call(request);
    assert.deepEqual(answer, { ok: true, body: "The council voted on the water fee." });
    assert.equal(seen.length, 1);
    assert.ok(seen[0]!.maxTokens && seen[0]!.maxTokens > 0);
    assert.equal(seen[0]!.timeoutMs, DRAFT_STYLE_TIMEOUT_MS);
  });

  it("sends the findings as the prompt's subject, not the whole draft as an instruction", async () => {
    const { chat, seen } = recordingChat("The council voted on the water fee.");
    await styleRepairCall({ chat })(request);
    assert.match(seen[0]!.user, /Nobody is named\./);
    assert.match(seen[0]!.user, /Experts say the fee will rise\./);
    assert.ok(seen[0]!.system.length > 0);
  });

  it("leaves the model choice to the fail-over around it", async () => {
    const { chat, seen } = recordingChat("The council voted.");
    await styleRepairCall({ chat })(request);
    assert.equal(seen[0]!.choice, undefined);
  });

  it("carries the provider's own words back when the call fails", async () => {
    const { chat } = recordingChat("The provider login has lapsed.", false);
    assert.deepEqual(await styleRepairCall({ chat })(request), {
      ok: false,
      error: "The provider login has lapsed.",
    });
  });

  it("still says something plain when a provider fails without a reason", async () => {
    const { chat } = recordingChat("", false);
    const answer = await styleRepairCall({ chat })(request);
    assert.equal(answer.ok, false);
    assert.ok(!answer.ok && answer.error.length > 0);
  });
});
