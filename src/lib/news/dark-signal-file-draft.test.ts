// guards: a selected signal must keep the AI-drafted question and explanation in the new file
import { it } from "node:test";
import assert from "node:assert/strict";
import { grokChat } from "./ai.ts";
import { draftSignalFileFor } from "./dark.ts";
import type { WorthSeed } from "./worth-a-look.ts";

it("prefills a file from the stubbed question and ordinary explanation", async () => {
  const item: WorthSeed = {
    id: "anomaly:changed:https://records.example/notice",
    kind: "changed",
    title: "The notice changed",
    happened: "The captured notice has a different date.",
    why: "A public record changed.",
    evidence: "https://records.example/notice",
    source_url: "https://records.example/notice",
    question: "Why did the notice change?",
    seed: "The notice changed\nhttps://records.example/notice",
    priority: 10,
  };
  const stub = async (..._args: Parameters<typeof grokChat>) => ({
    ok: true,
    text: JSON.stringify({
      question: "Why was the meeting notice revised?",
      ordinary_explanation: "The clerk may have corrected a routine scheduling error.",
    }),
  }) as Awaited<ReturnType<typeof grokChat>>;
  const result = await draftSignalFileFor(item, 98126, "codex-balanced", null, stub);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.prefill, {
    question: "Why was the meeting notice revised?",
    tip: item.seed,
    explanation: "The clerk may have corrected a routine scheduling error.",
  });
});
