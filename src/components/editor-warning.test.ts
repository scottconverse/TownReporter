import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { warningFromAnswer, warningPressLabel } from "./editor-warning.ts";

function warning(key: string, sentence: string) {
  return { key, sentence };
}

describe("warningFromAnswer: the structured refusal, read out of a settled answer", () => {
  it("reads { ok:false, warning:{key,sentence} }", () => {
    assert.deepEqual(
      warningFromAnswer({
        ok: false,
        warning: warning("paper-not-set-up", "This paper is not fully set up: no town."),
        error: "This paper is not fully set up: no town.",
      }),
      warning("paper-not-set-up", "This paper is not fully set up: no town."),
    );
  });

  it("is null for success, for a bare error, and for junk", () => {
    assert.equal(warningFromAnswer({ ok: true }), null);
    assert.equal(warningFromAnswer({ ok: false, error: "Record not found." }), null);
    assert.equal(warningFromAnswer({ ok: false, warning: null }), null);
    assert.equal(warningFromAnswer({ ok: false, warning: { key: "", sentence: "x" } }), null);
    assert.equal(warningFromAnswer({ ok: false, warning: { key: "k", sentence: "  " } }), null);
    assert.equal(warningFromAnswer(null), null);
    assert.equal(warningFromAnswer("nope"), null);
    assert.equal(warningFromAnswer(undefined), null);
  });
});

describe("the labels the second press wears", () => {
  it("'<Action> anyway' is the default", () => {
    assert.equal(warningPressLabel("Draft this story"), "Draft this story anyway");
    assert.equal(warningPressLabel("Import this story"), "Import this story anyway");
  });

  it("reads 'Run anyway', 'Check anyway' and 'Stop and restart with <model>' where asked", () => {
    assert.equal(warningPressLabel("Run scan", "run"), "Run anyway");
    assert.equal(warningPressLabel("Check now", "check"), "Check anyway");
    assert.equal(
      warningPressLabel("Change model", "restart", "Local model · halo-brain-35b"),
      "Stop and restart with Local model · halo-brain-35b",
    );
  });
});
