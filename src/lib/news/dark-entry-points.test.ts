// guards: lead questions, tip text, or the selected file can be lost at a Dark Desk handoff
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DARK_FILE_PREFILL_KEY,
  DARK_OPEN_KEY,
  darkLeadPrefill,
  rememberDarkJobFile,
  saveDarkFilePrefill,
  takeDarkFilePrefill,
} from "./dark-seed.ts";

describe("Dark Desk entry handoffs", () => {
  it("opens from Today with the tip and no invented question", () => {
    const kept = new Map<string, string>();
    const storage = {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    };
    assert.equal(saveDarkFilePrefill(storage, { tip: "Read the meeting minutes." }), true);
    assert.deepEqual(takeDarkFilePrefill(storage), { tip: "Read the meeting minutes." });
    assert.equal(kept.has(DARK_FILE_PREFILL_KEY), false);
  });

  it("places a lead title in the question and its source in the starting point", () => {
    assert.deepEqual(
      darkLeadPrefill("When was the notice posted?", "https://example.test/notice"),
      { question: "When was the notice posted?", tip: "https://example.test/notice" },
    );
    assert.deepEqual(darkLeadPrefill("When was the notice posted?", null), {
      question: "When was the notice posted?",
      tip: "",
    });
  });

  it("opens the file from a completed run", () => {
    const kept = new Map<string, string>();
    const storage = { setItem: (key: string, value: string) => void kept.set(key, value) };
    assert.equal(rememberDarkJobFile(storage, 42), true);
    assert.equal(kept.get(DARK_OPEN_KEY), "42");
  });
});
