import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { markPulledTodo } from "./pull.server.ts";
import { emptyNotes, packNotes, parseNotes, sanitizeTodos, type NoteTodo } from "./notes.ts";

/*
  PULL1b finding 3.

  An empty Pull writes its reason into `notes.todo[i].q`, and the row drew the
  time from whichever run happened to be newest. A later, successful retry
  strikes the line but used to leave the old reason in `q` -- so an editor who
  restored the line read "Tried 12:15 p.m.: search unavailable", where 12:15 was
  the *retry's* finish, beside a failure from the morning. The time has to
  belong to the reason: it is stamped with the reason and cleared with it.

  The stamp is a new optional field on the row, so it must also survive the
  round trip through the editor's own save (parse/sanitize in `notes.ts`).
*/

const ROW: NoteTodo = { t: "Get the board packet", done: false, src: "you" };
const REASON = "search unavailable (Exa: rate limited)";
const AT = "2026-10-02T18:15:00.000Z";

function notesWith(row: NoteTodo) {
  return { ...emptyNotes(), todo: [row] };
}

describe("the reason and the moment it happened travel together", () => {
  it("stamps the failure with the run's own moment", () => {
    const after = markPulledTodo(notesWith(ROW), 0, {
      documentFound: false,
      reason: REASON,
      at: AT,
    });
    assert.equal(after.todo[0]!.q, REASON);
    assert.equal(after.todo[0]!.triedAt, AT);
    assert.equal(after.todo[0]!.done, false, "only a document strikes the line");
  });

  it("clears the reason and the stamp when a later Pull finds a document", () => {
    const failed = markPulledTodo(notesWith(ROW), 0, {
      documentFound: false,
      reason: REASON,
      at: AT,
    });
    const succeeded = markPulledTodo(failed, 0, { documentFound: true });
    assert.equal(succeeded.todo[0]!.done, true);
    assert.equal(succeeded.todo[0]!.q, undefined, "no stale reason is left behind");
    assert.equal(succeeded.todo[0]!.triedAt, undefined, "and no stale time with it");
  });

  it("starts a restored line clean", () => {
    const failed = markPulledTodo(notesWith(ROW), 0, {
      documentFound: false,
      reason: REASON,
      at: AT,
    });
    const succeeded = markPulledTodo(failed, 0, { documentFound: true });
    const restored = { ...succeeded, todo: succeeded.todo.map((r) => ({ ...r, done: false })) };
    assert.equal(restored.todo[0]!.q, undefined, "a restored line says nothing about the old try");
    assert.equal(restored.todo[0]!.triedAt, undefined);
  });

  it("clears a reason an earlier build wrote without a stamp", () => {
    const after = markPulledTodo(notesWith({ ...ROW, q: "no relevant document found" }), 0, {
      documentFound: true,
    });
    assert.equal(after.todo[0]!.q, undefined);
    assert.equal(after.todo[0]!.done, true);
  });

  it("keeps the gate's own detail line -- that is not a Pull's reason", () => {
    const gate: NoteTodo = {
      t: "Claim of absence: the city published nothing",
      done: false,
      src: "gate",
      q: "searched longmontcolorado.gov and 2 more ways",
    };
    const after = markPulledTodo(notesWith(gate), 0, { documentFound: true });
    assert.equal(after.todo[0]!.q, "searched longmontcolorado.gov and 2 more ways");
  });

  it("keeps a drafting detail line an editor typed -- also not a Pull's reason", () => {
    const typed: NoteTodo = { ...ROW, q: "ask the clerk for the 2019 packet" };
    const after = markPulledTodo(notesWith(typed), 0, { documentFound: true });
    assert.equal(after.todo[0]!.q, "ask the clerk for the 2019 packet");
  });

  it("does nothing to a row that is not there", () => {
    const notes = notesWith(ROW);
    assert.equal(markPulledTodo(notes, 7, { documentFound: true }), notes);
  });
});

describe("the stamp survives the editor's own save", () => {
  const marked = markPulledTodo(notesWith(ROW), 0, {
    documentFound: false,
    reason: REASON,
    at: AT,
  });

  it("round-trips through packNotes and parseNotes", () => {
    const back = parseNotes(packNotes(marked));
    assert.equal(back.todo[0]!.q, REASON);
    assert.equal(back.todo[0]!.triedAt, AT);
  });

  it("round-trips through the to-do patch a manual edit sends", () => {
    const patched = sanitizeTodos(JSON.parse(JSON.stringify(marked.todo)));
    assert.equal(patched[0]!.q, REASON);
    assert.equal(patched[0]!.triedAt, AT);
  });

  it("drops a stamp that is not a date rather than storing nonsense", () => {
    const patched = sanitizeTodos([{ ...ROW, q: REASON, triedAt: "yesterday-ish" }]);
    assert.equal(patched[0]!.q, REASON);
    assert.equal(patched[0]!.triedAt, undefined);
  });

  it("keeps a row with a reason and no stamp as the reason alone", () => {
    const older = parseNotes(
      packNotes({ ...emptyNotes(), todo: [{ ...ROW, q: REASON } as NoteTodo] }),
    );
    assert.equal(older.todo[0]!.q, REASON);
    assert.equal(older.todo[0]!.triedAt, undefined);
  });
});
