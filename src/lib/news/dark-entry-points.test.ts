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
import { darkFileToOpen } from "./dark-rail.ts";

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
    const kept = new Map<string, string>([["townreporter.dark.openId", "9"]]);
    const storage = { setItem: (key: string, value: string) => void kept.set(key, value) };
    assert.equal(rememberDarkJobFile(storage, 42), true);
    assert.equal(kept.get(DARK_OPEN_KEY), "42", "a new handoff replaces the remembered old file");
  });

  it("opens the requested file ahead of the current or newest file", () => {
    const rows = [
      { id: 9, updated_at: "2026-10-27T12:00:00Z" },
      { id: 11, updated_at: "2026-10-28T12:00:00Z" },
    ];
    assert.equal(darkFileToOpen(rows, 9, 11), 11);
    assert.equal(darkFileToOpen(rows, 9, null), 9);
    assert.equal(darkFileToOpen(rows, 99, null), 11);
  });
});
