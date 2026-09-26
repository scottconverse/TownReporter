/**
 * The Models screen's form state: reading rows into ten jobs, writing the form
 * back out, and answering "how many jobs have changed".
 *
 * The round trip is the whole point of this file. `rowsFromDraft(draftFromRows(rows))`
 * has to equal the rows it was given, or the screen's Save silently rewrites
 * settings the editor never touched -- and the fallback efforts are exactly
 * where that would happen, because the design draws no effort control for a
 * fallback while the table still stores one.
 *
 * Nothing here needs a database or a model.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MODEL_JOB_KEYS, type ModelAssignmentRow } from "./model-assignments.ts";
import {
  DRAFT_SLOTS,
  draftFromRows,
  dirtyJobKeys,
  emptyDraft,
  rowsFromDraft,
  unsavedJobCount,
  unsavedSummary,
} from "./model-assignment-draft.ts";

function row(
  jobKey: string,
  rank: number,
  providerId: string,
  effort: string | null = null,
): ModelAssignmentRow {
  return { jobKey: jobKey as ModelAssignmentRow["jobKey"], rank, providerId, effort };
}

/** Rows in the order `rowsFromDraft` writes them: job order, then rank. */
function sorted(rows: readonly ModelAssignmentRow[]): ModelAssignmentRow[] {
  return [...rows].sort(
    (a, b) => MODEL_JOB_KEYS.indexOf(a.jobKey) - MODEL_JOB_KEYS.indexOf(b.jobKey) || a.rank - b.rank,
  );
}

describe("reading rows into the form", () => {
  it("gives every job a draft, so no row renders as a hole", () => {
    const draft = draftFromRows([]);
    assert.deepEqual(Object.keys(draft), [...MODEL_JOB_KEYS]);
    for (const key of MODEL_JOB_KEYS) {
      assert.deepEqual(draft[key], {
        first: { providerId: "", effort: "" },
        fallback1: { providerId: "", effort: "" },
        fallback2: { providerId: "", effort: "" },
      });
    }
  });

  it("places rank 0 in first and ranks 1 and 2 in the fallbacks", () => {
    const draft = draftFromRows([
      row("story-draft", 0, "claude-sonnet", "high"),
      row("story-draft", 1, "codex-balanced"),
      row("story-draft", 2, "claude-haiku", "low"),
    ]);
    assert.deepEqual(draft["story-draft"].first, { providerId: "claude-sonnet", effort: "high" });
    assert.deepEqual(draft["story-draft"].fallback1, { providerId: "codex-balanced", effort: "" });
    assert.deepEqual(draft["story-draft"].fallback2, { providerId: "claude-haiku", effort: "low" });
    assert.deepEqual(draft.scan.first.providerId, "", "a job with no rows stays blank");
  });

  it("carries a custom connection's id through untouched", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    const draft = draftFromRows([row("opinion", 0, `custom:${id}`)]);
    assert.equal(draft.opinion.first.providerId, `custom:${id}`);
  });

  it("puts a null effort in the slot as an empty string, not as 'null'", () => {
    const draft = draftFromRows([row("dark", 0, "claude-fable", null)]);
    assert.equal(draft.dark.first.effort, "");
  });

  it("ignores a rank it has no slot for and a job it does not know", () => {
    // The store drops both on read, so they should not arrive -- but a draft
    // that threw here would take the whole screen down over one stray row.
    const draft = draftFromRows([
      row("story-draft", 7, "claude-sonnet"),
      { jobKey: "invented" as ModelAssignmentRow["jobKey"], rank: 0, providerId: "x", effort: null },
    ]);
    assert.equal(draft["story-draft"].first.providerId, "");
    assert.deepEqual(Object.keys(draft), [...MODEL_JOB_KEYS]);
  });
});

describe("writing the form back out", () => {
  it("round-trips a full set of rows without changing one of them", () => {
    const rows = [
      row("scan", 0, "claude-haiku", "medium"),
      row("scan", 2, "codex-luna", "max"),
      row("story-draft", 0, "claude-sonnet", "high"),
      row("story-draft", 1, "codex-balanced", null),
      row("ocr", 0, "codex-astra", "low"),
    ];
    assert.deepEqual(sorted(rowsFromDraft(draftFromRows(rows))), sorted(rows));
  });

  it("keeps a fallback's effort even though the design draws no control for it", () => {
    // This is the mutation the comment at the top of the module warns about.
    const rows = [row("headlines", 1, "codex-luna", "xhigh")];
    const written = rowsFromDraft(draftFromRows(rows));
    assert.deepEqual(written, rows);
  });

  it("writes nothing for a slot with no model, and no effort without a model", () => {
    const draft = emptyDraft();
    draft.opinion.first = { providerId: "", effort: "high" };
    draft.dark.fallback2 = { providerId: "claude-fable", effort: "" };
    assert.deepEqual(rowsFromDraft(draft), [
      { jobKey: "dark", rank: 2, providerId: "claude-fable", effort: null },
    ]);
  });

  it("trims a pasted id rather than storing whitespace", () => {
    const draft = emptyDraft();
    draft.scan.first = { providerId: "  claude-haiku  ", effort: "low" };
    assert.deepEqual(rowsFromDraft(draft), [
      { jobKey: "scan", rank: 0, providerId: "claude-haiku", effort: "low" },
    ]);
  });

  it("skips a job the draft does not have rather than throwing", () => {
    const partial = { ...emptyDraft() } as Record<string, unknown>;
    delete partial["transcript"];
    const written = rowsFromDraft(partial as never);
    assert.equal(written.length, 0);
  });

  it("names its slots in rank order", () => {
    assert.deepEqual([...DRAFT_SLOTS], ["first", "fallback1", "fallback2"]);
  });
});

describe("counting what changed", () => {
  it("finds nothing dirty in a form that was just read", () => {
    const rows = [row("scan", 0, "claude-haiku"), row("scan", 1, "codex-luna")];
    const saved = draftFromRows(rows);
    assert.deepEqual(dirtyJobKeys(draftFromRows(rows), saved), []);
    assert.equal(unsavedJobCount(draftFromRows(rows), saved), 0);
  });

  it("counts jobs, not fields, and names them in the design's order", () => {
    const saved = draftFromRows([row("scan", 0, "claude-haiku")]);
    const draft = draftFromRows([row("scan", 0, "claude-haiku")]);
    // Three changed jobs, five changed fields between them: the count is jobs.
    draft.scan.first.effort = "high";
    draft.scan.fallback1 = { providerId: "codex-luna", effort: "" };
    draft.opinion.first = { providerId: "claude-fable", effort: "" };
    draft.ocr.first = { providerId: "codex-astra", effort: "low" };
    assert.equal(unsavedJobCount(draft, saved), 3);
    assert.deepEqual(dirtyJobKeys(draft, saved), ["scan", "opinion", "ocr"]);
  });

  it("calls an effort-only change dirty and a clear dirty too", () => {
    const saved = draftFromRows([row("scan", 0, "claude-haiku", "medium")]);
    const effort = draftFromRows([row("scan", 0, "claude-haiku", "high")]);
    assert.deepEqual(dirtyJobKeys(effort, saved), ["scan"]);
    const cleared = draftFromRows([]);
    assert.deepEqual(dirtyJobKeys(cleared, saved), ["scan"]);
  });

  it("does not call an unoffered stored model dirty on its own", () => {
    // The notice beside the row is where a retired id is reported. Counting it
    // as an unsaved change would ask the editor to save a form they never
    // touched, and Save would not change anything anyway.
    const rows = [row("dark", 0, "grok-oauth")];
    assert.deepEqual(dirtyJobKeys(draftFromRows(rows), draftFromRows(rows)), []);
  });
});

describe("the footer's line", () => {
  it("reassures at zero instead of saying '0 unsaved changes'", () => {
    assert.equal(unsavedSummary(0), "All jobs have a working first choice except where marked.");
  });

  it("counts one change and several changes in words", () => {
    assert.equal(unsavedSummary(1), "1 unsaved change. Nothing changes until you save.");
    assert.equal(unsavedSummary(3), "3 unsaved changes. Nothing changes until you save.");
  });
});
