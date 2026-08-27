import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addHumanLine,
  applyTodoPatch,
  keepHumanTodos,
  machineTodosFrom,
  notesHaveMemo,
  parseNotes,
  toggleTodo,
} from "./notes.ts";

describe("reporting notes", () => {
  it("keeps human lines through a machine replace", () => {
    const prev = parseNotes(
      JSON.stringify({
        news: "old",
        todo: [
          { t: "Call planning", done: true, src: "you" },
          { t: "SEC filing", done: false, src: "machine" },
        ],
      }),
    );
    const kept = keepHumanTodos(prev);
    const machine = machineTodosFrom(["Leader S-1", "Call planning"]);
    const next = { ...prev, news: "new", todo: [...kept, ...machine] };
    assert.equal(next.news, "new");
    assert.equal(next.todo.filter((t) => t.src === "you").length, 1);
    assert.equal(next.todo.find((t) => t.src === "you")?.done, true);
    assert.ok(next.todo.some((t) => t.t === "Leader S-1"));
  });

  it("strikes and restores without deleting", () => {
    let n = addHumanLine(parseNotes("{}"), "Pull the packet");
    n = toggleTodo(n, 0);
    assert.equal(n.todo[0]?.done, true);
    n = toggleTodo(n, 0);
    assert.equal(n.todo[0]?.done, false);
    assert.equal(n.todo.length, 1);
  });

  it("empty memo vs filled", () => {
    assert.equal(notesHaveMemo(parseNotes("{}")), false);
    assert.equal(notesHaveMemo(parseNotes(JSON.stringify({ news: "Plant opened." }))), true);
  });

  it("toggle works on a displayed list that was never saved", () => {
    const shown = machineTodosFrom(["Address of the plant", "SEC filing"]);
    const next = applyTodoPatch(parseNotes("{}"), { todos: shown, toggle: 0 });
    assert.equal(next.todo[0]?.done, true);
    assert.equal(next.todo[1]?.done, false);
    assert.equal(next.todo.length, 2);
  });

  it("keeps a pull-box scratch across a machine replace", () => {
    const prev = parseNotes(
      JSON.stringify({
        news: "old",
        scratch: "From the company PR: 155 jobs.",
        todo: [{ t: "Call planning", done: false, src: "you" }],
      }),
    );
    assert.match(prev.scratch, /155 jobs/);
    const kept = keepHumanTodos(prev);
    const next = { ...prev, news: "new", todo: kept, scratch: prev.scratch };
    assert.match(next.scratch, /155 jobs/);
  });
});
