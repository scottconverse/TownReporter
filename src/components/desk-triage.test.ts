import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTypingTarget, movedIndex, TRIAGE_LEGEND, triageAction } from "./desk-triage.ts";

/**
 * The triage keys, as one rule (unit FB6, item 4).
 *
 * README "Interactions & behavior": "Keyboard triage on Today AND in the Queue:
 * J/K move the selection, S starts a story, H opens Hold, X opens Kill, U
 * undoes, Enter opens the lead, N starts a new story, ... Keys are ignored while
 * typing in an input."
 *
 * FB0-Report Table B's Queue section opens with "keyboard triage -- **missing
 * entirely** -- no `onKeyDown` in the file, against README:468". The keys were
 * Today's private listener; they are this module now, and both screens bind it,
 * so the test is a test of both.
 *
 * WHAT THIS FILE CANNOT SEE, said once: which handler a screen wires to which
 * action. That is pinned as source in `scripts/fb6-desk-wiring.test.mjs`, and
 * walked in the browser.
 *
 * THE MUTATIONS THAT MATTER. Removing the `isTypingTarget` guard fails "stands
 * down while the editor is typing"; removing the modifier guard fails "leaves a
 * modified keystroke alone"; pointing `s` at anything else fails the key table.
 */

/** A keystroke, shaped the way `triageAction` reads one. */
function key(
  k: string,
  over: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; target?: unknown } = {},
) {
  return {
    key: k,
    metaKey: over.metaKey ?? false,
    ctrlKey: over.ctrlKey ?? false,
    altKey: over.altKey ?? false,
    target: over.target ?? null,
  };
}

/** A text field, as the event's target. */
function field(tagName: string, extra: Record<string, unknown> = {}) {
  return { tagName, isContentEditable: false, ...extra };
}

describe("the eight triage keys", () => {
  it("maps every key the README names", () => {
    assert.deepEqual(triageAction(key("j")), { kind: "move", delta: 1 });
    assert.deepEqual(triageAction(key("k")), { kind: "move", delta: -1 });
    assert.deepEqual(triageAction(key("s")), { kind: "start" });
    assert.deepEqual(triageAction(key("h")), { kind: "hold" });
    assert.deepEqual(triageAction(key("x")), { kind: "kill" });
    assert.deepEqual(triageAction(key("u")), { kind: "undo" });
    assert.deepEqual(triageAction(key("Enter")), { kind: "open" });
    assert.deepEqual(triageAction(key("n")), { kind: "new" });
  });

  it("reads the keys case-insensitively, because caps lock is not a command", () => {
    assert.deepEqual(triageAction(key("J")), { kind: "move", delta: 1 });
    assert.deepEqual(triageAction(key("X")), { kind: "kill" });
    assert.deepEqual(triageAction(key("ENTER")), { kind: "open" });
  });

  it("leaves every other key alone, so the page keeps its own behaviour", () => {
    /*
      Space, the arrows and PageDown are how an editor scrolls a 25-row table;
      swallowing them to do nothing would be worse than never binding a key.
    */
    for (const other of [" ", "ArrowDown", "PageDown", "Escape", "Tab", "?", "a", "1"]) {
      assert.equal(triageAction(key(other)), null, `${other} must not be claimed`);
    }
    assert.equal(triageAction(key("?")), null, "the shortcut sheet is the shell's, not a list's");
  });
});

describe("when the keys stand down", () => {
  it("stands down while the editor is typing", () => {
    /*
      The Queue carries a search box, the file-a-lead form, and a reason box on a
      bulk Kill; Today carries three textareas and a paste box. A J that moved
      the list instead of typing a letter would make every one of them unusable.
    */
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      assert.equal(triageAction(key("j", { target: field(tag) })), null, tag);
      assert.equal(triageAction(key("s", { target: field(tag) })), null, tag);
    }
    assert.equal(
      triageAction(key("x", { target: field("DIV", { isContentEditable: true }) })),
      null,
      "a contenteditable owns the keystroke just as a textarea does",
    );
  });

  it("still answers when the target is not a field", () => {
    assert.deepEqual(triageAction(key("j", { target: field("DIV") })), { kind: "move", delta: 1 });
    assert.deepEqual(triageAction(key("j", { target: field("BODY") })), { kind: "move", delta: 1 });
    // A synthesised event may name nothing at all.
    assert.deepEqual(triageAction(key("j", { target: null })), { kind: "move", delta: 1 });
  });

  it("leaves a modified keystroke to whoever it belongs to", () => {
    /*
      Ctrl-K is the desk's search, Cmd-S the workbench's save, Cmd-R a reload.
      A list that acted on those too would fire two things per press.
    */
    assert.equal(triageAction(key("j", { ctrlKey: true })), null);
    assert.equal(triageAction(key("s", { metaKey: true })), null);
    assert.equal(triageAction(key("h", { altKey: true })), null);
  });

  it("does not stand down for Shift, because the shell's '?' needs it", () => {
    // Shift+J is still a move: nothing here is shift-sensitive, and excluding
    // Shift would be a rule with no reason behind it.
    assert.deepEqual(triageAction(key("J", { target: field("DIV") })), { kind: "move", delta: 1 });
  });
});

describe("isTypingTarget", () => {
  it("names the fields a keystroke belongs to", () => {
    assert.equal(isTypingTarget(field("INPUT")), true);
    assert.equal(isTypingTarget(field("TEXTAREA")), true);
    assert.equal(isTypingTarget(field("SELECT")), true);
    assert.equal(isTypingTarget(field("DIV", { isContentEditable: true })), true);
    assert.equal(isTypingTarget(field("DIV")), false);
    assert.equal(isTypingTarget(null), false);
    assert.equal(isTypingTarget(undefined as never), false);
  });
});

describe("where a move lands", () => {
  it("clamps at both ends rather than wrapping to the other", () => {
    /*
      Wrapping is not a preference: an editor holding J to read down a list who
      suddenly finds themselves at the top has lost their place, and the next
      H would hold the wrong lead.
    */
    assert.equal(movedIndex(0, 1, 3), 1);
    assert.equal(movedIndex(2, 1, 3), 2);
    assert.equal(movedIndex(0, -1, 3), 0);
  });

  it("survives an empty list", () => {
    assert.equal(movedIndex(0, 1, 0), 0);
    assert.equal(movedIndex(7, -1, 0), 0);
  });

  it("clamps a stored cursor that a shrinking list has left past the end", () => {
    // A Hold drops a row off the Open tab while the cursor is on it.
    assert.equal(movedIndex(9, 0, 4), 3);
  });
});

describe("the legend bar's words", () => {
  it("is the drawing's six and nothing the desk does not bind", () => {
    assert.deepEqual(
      TRIAGE_LEGEND.map(([k]) => k),
      ["J / K", "S", "H", "X", "U", "Enter"],
    );
  });

  it("names only keys this module actually acts on", () => {
    /*
      README: "the keys are on the screen, not only in the '?' sheet -- an editor
      triaging a list should not have to open a dialog to learn what J does." The
      bar is a promise about the keyboard, so every key it prints must be one
      `triageAction` answers.
    */
    for (const [printed] of TRIAGE_LEGEND) {
      for (const single of printed.split(" / ")) {
        assert.notEqual(
          triageAction(key(single)),
          null,
          `the legend prints ${single} and nothing acts on it`,
        );
      }
    }
  });
});
