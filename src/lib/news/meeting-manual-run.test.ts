import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modPath = new URL("./meeting-manual-run.ts", import.meta.url);

describe("N-2 manual meeting run", () => {
  it("describes forced capture as an immutable revision, never an overwrite", () => {
    const ui = readFileSync(new URL("../../components/meeting-capture-settings.tsx", import.meta.url), "utf8");
    assert.match(ui, /new immutable revision/i);
    assert.match(ui, /earlier recording evidence remains available/i);
    assert.doesNotMatch(ui, /overwrites the stored transcript/i);
  });

  it("does not offer an editable form when the settings never loaded", () => {
    /*
      0.6.67, found by the dump sweep. `settings.isPending` was the only guard,
      so a failed read fell through to the form with every field at its
      initial value: `enabled ?? false`, `channels ?? []`,
      `retentionMode ?? "transcript-only"`. Save was live, so one click after
      a transient failure wrote the paper's defaults over its real settings.
      The ordering is the assertion -- the refusal has to come before the
      fallbacks are read into the form.
    */
    const ui = readFileSync(new URL("../../components/meeting-capture-settings.tsx", import.meta.url), "utf8");
    assert.match(ui, /if \(settings\.isError\)/, "the read failure has no branch");
    assert.match(ui, /could not read the meeting capture settings/);
    assert.ok(
      ui.indexOf("settings.isError") < ui.indexOf("const list = channels ?? []"),
      "the refusal must come before the defaults are read",
    );
  });

  it("writes execution_origin='manual' with daily_reservation_id NULL (not a reservation)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(modPath, "utf8");
    assert.match(src, /execution_origin,daily_reservation_id,forced_recapture/i);
    assert.match(src, /'manual',null,false/i);
    // It must not insert a daily reservation row.
    assert.doesNotMatch(src, /insert into daily_scan_reservations/i);
  });

  it("records the forced re-capture flag and preserves the prior caption hash", async () => {
    const src = readFileSync(modPath, "utf8");
    const capture = readFileSync(new URL("./meeting-capture.ts", import.meta.url), "utf8");
    assert.match(src, /applyCapturedMeetingTranscript/);
    assert.match(src, /forced:\s*true/i);
    assert.match(capture, /prior_caption_sha256/i);
    assert.match(capture, /forced_recapture_at/i);
    assert.match(capture, /lockMeetingRevisionForCapture/);
    assert.match(capture, /applyDraftRevision/);
    assert.match(capture, /flagPublishedArticlesForTranscriptRevision/);
    assert.match(src, /'manual',null,true/i);
  });

  it("writes the counts and named failures to the scan_runs row it owns", async () => {
    const src = readFileSync(modPath, "utf8");
    assert.match(src, /meetings_found = \$1, meetings_captured = \$2, meetings_failed = \$3/i);
    assert.match(src, /meeting_failures = \$4/i);
    assert.match(src, /summary = \$5/i);
  });

  it("uses the shared runMeetingAwareness step (same path the scheduler drives)", async () => {
    const src = readFileSync(modPath, "utf8");
    assert.match(src, /runMeetingAwareness/);
    assert.match(src, /recheckProvisionalMeetings/);
  });

  it("does not clear a reservation to run", async () => {
    const src = readFileSync(modPath, "utf8");
    assert.doesNotMatch(src, /delete from daily_scan_reservations/i);
    assert.doesNotMatch(src, /update daily_scan_reservations/i);
  });
});

describe("N-2 migration 0075", () => {
  it("adds the forced-recapture columns additively", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../../../migrations/0075_manual_run_control.sql", import.meta.url), "utf8");
    assert.match(sql, /alter table scan_runs add column if not exists forced_recapture/i);
    assert.match(sql, /alter table meeting_capture_records add column if not exists forced_recapture/i);
    assert.match(sql, /add column if not exists prior_caption_sha256/i);
  });
});
