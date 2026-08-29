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
  packNotes,
  splitTodoLine,
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

describe("packNotes", () => {
  const big = (n: number) => "x".repeat(n);
  const base = () => ({
    news: "The district referred a sales tax.",
    why: "It taxes Longmont.",
    angle: "Longmont is inside the boundary.",
    todo: [{ t: "Get the adopted resolution", done: false, src: "you" as const }],
    found: [{ t: big(700), src: "https://example.gov/a" }],
    verify: ["checked"],
    opened: [
      { url: "https://example.gov/a", title: "A" },
      { url: "https://example.gov/b", title: "B" },
    ],
    scratch: big(8000),
  });

  it("always returns JSON that parses back", () => {
    const packed = packNotes(base(), 500);
    assert.doesNotThrow(() => JSON.parse(packed));
  });

  /**
   * The regression. `JSON.stringify(notes).slice(0, 16000)` wrote a string that
   * ended mid-token, so the very next read produced empty notes and the lead
   * silently lost its memo, its documents and every pulled excerpt.
   */
  it("never truncates mid-token the way the old slice did", () => {
    const notes = base();
    const naive = JSON.stringify(notes).slice(0, 500);
    assert.throws(() => JSON.parse(naive), "the old behaviour must still be broken");
    const packed = packNotes(notes, 500);
    assert.ok(packed.length <= 500);
    assert.doesNotThrow(() => JSON.parse(packed));
  });

  it("leaves notes that already fit completely alone", () => {
    const notes = base();
    assert.equal(packNotes(notes, 100_000), JSON.stringify(notes));
  });

  it("drops scratch before it drops the memo or the to-do list", () => {
    const parsed = JSON.parse(packNotes(base(), 900)) as Record<string, unknown>;
    assert.equal(parsed.news, "The district referred a sales tax.");
    assert.equal((parsed.todo as unknown[]).length, 1);
    assert.ok(String(parsed.scratch).length < 8000);
  });

  it("keeps the newest end of scratch, not the oldest", () => {
    const notes = base();
    notes.scratch = `${big(4000)}NEWEST-PULL`;
    const parsed = JSON.parse(packNotes(notes, 1200)) as { scratch: string };
    assert.match(parsed.scratch, /NEWEST-PULL/);
  });

  it("survives a to-do list that alone exceeds the budget", () => {
    const notes = base();
    notes.todo = Array.from({ length: 24 }, () => ({
      t: big(400),
      done: false,
      src: "machine" as const,
    }));
    const packed = packNotes(notes, 600);
    assert.doesNotThrow(() => JSON.parse(packed));
  });
});

describe("splitTodoLine", () => {
  /** The exact line that sent a PULL to three California school districts. */
  const RUN_ON =
    "Get the district board's adopted resolution and the certified ballot title text — those are the two documents that settle rate, boundary, sunset and debt. Then the board packet and minutes for the August 2026 meeting, and the district's enabling statute SB 21-238 and its boundary map.";

  it("breaks a run-on into separate errands", () => {
    const parts = splitTodoLine(RUN_ON);
    assert.ok(parts.length >= 2, "a six-document line must not stay one line");
    for (const p of parts) assert.ok(p.length <= 200, `piece too long: ${p}`);
  });

  it("leaves a line that is already one errand alone", () => {
    const one = "Get the adopted resolution referring the tax to the November ballot";
    assert.deepEqual(splitTodoLine(one), [one]);
  });

  it("does not leave a stub piece behind", () => {
    const parts = splitTodoLine(
      `${"Get the signed referral resolution from the district board and its exhibit. "}Yes. And then the certified ballot title text as adopted by the board on the night of the vote.`,
    );
    for (const p of parts) assert.ok(p.length >= 20, `stub piece: "${p}"`);
  });

  it("returns nothing for empty input", () => {
    assert.deepEqual(splitTodoLine("   "), []);
  });

  it("machineTodosFrom produces more, shorter lines from one run-on", () => {
    const todos = machineTodosFrom([RUN_ON]);
    assert.ok(todos.length >= 2);
    assert.equal(todos.every((t) => t.src === "machine"), true);
  });

  it("machineTodosFrom still caps the list", () => {
    const many = Array.from({ length: 40 }, (_, i) => `Get document number ${i} from the clerk`);
    assert.equal(machineTodosFrom(many).length, 16);
  });
});
