import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  lastDraftLine,
  lastDraftWhen,
  readinessDot,
  readinessFailureMessage,
  saveState,
  writerIsReady,
} from "./writer-bar.ts";

/**
 * The Writer / Effort bar's lines (unit CW, 0.6.81).
 *
 * These are short functions and the point is not the strings. It is that each
 * one refuses to say something the desk did not record, and that the dot
 * answers the same question the model picker answers -- "can this writer
 * run?" -- so the bar above the panel and the panel's own option list cannot
 * tell the editor two different things.
 */

const ready = { enabled: true, modelId: "gpt-5.6-sol" };

describe("writerIsReady", () => {
  /*
    Automatic always runs: it has a ladder and resolves a provider at run time.
    The picker treats it the same way, and a run that cannot place itself is
    refused by preflight before it spends anything rather than here.
  */
  it("counts Automatic as ready whatever the provider map says", () => {
    assert.equal(
      writerIsReady({ choice: "auto", availability: {}, customConnection: null }),
      true,
    );
    assert.equal(
      writerIsReady({ choice: "auto", availability: { codex: false }, customConnection: null }),
      true,
    );
  });

  it("reads every other provider off the availability map", () => {
    assert.equal(
      writerIsReady({ choice: "codex", availability: { codex: true }, customConnection: null }),
      true,
    );
    assert.equal(
      writerIsReady({ choice: "codex", availability: { codex: false }, customConnection: null }),
      false,
    );
  });

  /*
    Undecided is not a verdict. A slow availability call must not say "Not set
    up" over a writer that is fine, and the run's own preflight is the backstop
    either way -- the same reason the picker's own check defaults to available.
  */
  it("does not call a writer unset-up while the answer is still coming", () => {
    assert.equal(
      writerIsReady({ choice: "codex", availability: undefined, customConnection: null }),
      true,
    );
  });

  it("needs a custom connection to be on and to carry a model", () => {
    const choice = "custom:8f14e45f-ceea-467a-9a3a-1f0a2b3c4d5e";
    assert.equal(
      writerIsReady({ choice, availability: undefined, customConnection: ready }),
      true,
    );
    assert.equal(
      writerIsReady({
        choice,
        availability: undefined,
        customConnection: { enabled: false, modelId: "gpt-5.6-sol" },
      }),
      false,
    );
    assert.equal(
      writerIsReady({ choice, availability: undefined, customConnection: { enabled: true, modelId: null } }),
      false,
    );
    assert.equal(writerIsReady({ choice, availability: undefined, customConnection: null }), false);
  });
});

describe("readinessDot", () => {
  it("carries the saved held-item reason to the Writer chip", () => {
    const reason = "Airport future charges: The future charge amount needs checking.";
    const status = readinessDot(true, { state: "not-ready", reason });
    assert.equal("reason" in status ? status.reason : undefined, reason);
  });
  it("says the drawn word for a writer that can run", () => {
    assert.deepEqual(readinessDot(true), { label: "● Ready", tone: "ok" });
  });

  /*
    The drawing has one state because the drawn writer is set up. The other
    state borrows the picker's own words for an option with no server behind
    it -- "not set up" -- so the dot, the option and the help line under the
    panel all use one phrase for one problem.
  */
  it("uses the picker's own words when the writer is not set up", () => {
    assert.deepEqual(readinessDot(false), { label: "● Not ready", tone: "warn" });
  });
});

describe("lastDraftWhen", () => {
  const now = new Date("2026-09-28T15:00:00");

  it("writes the drawn bare clock for a draft from today", () => {
    assert.equal(lastDraftWhen(new Date("2026-09-28T07:48:00").toISOString(), now), "7:48 a.m.");
  });

  /*
    The drawing's one clock is right on the morning it was drawn and wrong for
    a draft left over from yesterday, which would read as this morning's work.
  */
  it("carries the date once the draft is from another day", () => {
    assert.equal(lastDraftWhen(new Date("2026-09-26T07:48:00").toISOString(), now), "Sep 26, 7:48 a.m.");
  });

  it("is empty when the desk recorded no stamp at all", () => {
    assert.equal(lastDraftWhen(null, now), "");
    assert.equal(lastDraftWhen(undefined, now), "");
    assert.equal(lastDraftWhen("", now), "");
    assert.equal(lastDraftWhen("not a date", now), "");
  });
});

describe("lastDraftLine", () => {
  it("writes the drawn line from the model and the hour the desk recorded", () => {
    assert.equal(
      lastDraftLine({ modelLabel: "Codex Sol 6.1", when: "7:48 a.m." }),
      "Last draft: Codex Sol 6.1, 7:48 a.m.",
    );
  });

  /*
    A draft whose model the desk never wrote down is still a draft written at a
    known hour. "Last draft: 7:48 a.m." is true; "Last draft: , 7:48 a.m." is
    the separator leaking.
  */
  it("keeps the hour when there is no model to name", () => {
    assert.equal(lastDraftLine({ modelLabel: "", when: "7:48 a.m." }), "Last draft: 7:48 a.m.");
    assert.equal(lastDraftLine({ modelLabel: "   ", when: "7:48 a.m." }), "Last draft: 7:48 a.m.");
  });

  /*
    No draft job on the books means no hour, and then there is no line to draw
    -- `lastDraftWhen` is where that "" comes from.
  */
  it("draws no line at all when the desk recorded no time", () => {
    assert.equal(lastDraftLine({ modelLabel: "Codex Sol 6.1", when: "" }), "");
    assert.equal(lastDraftLine({ modelLabel: "Codex Sol 6.1", when: "   " }), "");
    assert.equal(lastDraftLine({ modelLabel: "", when: "" }), "");
  });
});

describe("saveState", () => {
  it("writes the drawn green line once the draft is on the books", () => {
    assert.deepEqual(saveState({ published: false, dirty: false, when: "8:20 a.m." }), {
      label: "Saved 8:20 a.m.",
      tone: "ok",
    });
  });

  /*
    The one line that must never lie. A green "Saved 8:20 a.m." beside text
    that exists only in this tab is the exact mistake a save line exists to
    prevent, so unsaved changes outrank the timestamp.
  */
  it("says unsaved changes rather than a green hour, whatever the last save was", () => {
    assert.deepEqual(saveState({ published: false, dirty: true, when: "8:20 a.m." }), {
      label: "Unsaved changes",
      tone: "warn",
    });
  });

  it("says the story is on the paper rather than pretending it is a draft", () => {
    assert.deepEqual(saveState({ published: true, dirty: false, when: "8:20 a.m." }), {
      label: "Published story",
      tone: "mut",
    });
  });

  it("falls back to the plain word when the desk recorded no hour", () => {
    assert.deepEqual(saveState({ published: false, dirty: false, when: "" }), {
      label: "Saved draft",
      tone: "ok",
    });
  });
});

it("keeps known quota and unknown provider messages visible", () => {
  assert.equal(readinessFailureMessage("custom:x", "My provider", "insufficient_quota"), "My provider hit its usage limit.");
  assert.equal(readinessFailureMessage("codex-frontier", "Codex", "Transport refused the request."), "Codex is not ready: Transport refused the request.");
});
