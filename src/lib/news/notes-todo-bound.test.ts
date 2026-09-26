import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TODO_DETAIL_MAX, TODO_TEXT_MAX, clipTodoText, parseNotes } from "./notes.ts";
import { reportingNotesInput } from "./request-input.ts";

/**
 * The to-do round trip, which is the live bug 0.6.66 exists to close.
 *
 * The story: `notes.ts` wrote to-do lines up to 400 characters; the wire
 * (`request-input.ts`) refused anything over `LIMITS.listItem`, 200. The desk
 * sends a lead's stored to-do list back whole on every save, publish and
 * redraft, so ONE line the machine had written longer than 200 characters made
 * the whole request invalid -- on a finished story, both Save and Publish were
 * dead, and the editor was shown the raw zod array (`too_big`, maximum 200,
 * path `todos,0,t`). Lead 240's stored line was 227 characters.
 *
 * Three things are asserted here, and they are the three that must not regress
 * together: the writer and the wire read ONE bound, the writer always produces
 * something inside that bound, and a stored item of any length survives the
 * round trip instead of being refused.
 */

/** The lead-240 line, at its real length: 227 characters. */
const REPORTED_LINE =
  "Claim of absence: the city has published no notice of a public hearing on " +
  "the annexation of the Olson property, and nothing in the packet or the " +
  "minutes of either meeting addresses it";

/**
 * A line the writer has to cut: 40 short words, 439 characters.
 *
 * Short words on purpose -- whether the cut landed on a word boundary is only
 * checkable if the boundary is near the ceiling, and evenly spaced words put
 * one there.
 */
const OVER_LONG_LINE = "annexation ".repeat(40).trim();

/** Code only: the file's own comments quote the bug it fixes, `max(LIMITS.listItem)` included. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the machine's to-do bound", () => {
  it("is one number, read by the writer and the wire both", async () => {
    // The writer's own ceiling, restated here so a change to either file has to
    // come past this test rather than only past the file that moved.
    assert.equal(TODO_TEXT_MAX, 400);
    assert.ok(TODO_TEXT_MAX > REPORTED_LINE.length, "the reported line must fit the writer's bound");
    assert.ok(TODO_DETAIL_MAX <= TODO_TEXT_MAX);
    const source = code(
      await import("node:fs").then((fs) =>
        fs.readFileSync(new URL("./request-input.ts", import.meta.url), "utf8"),
      ),
    );
    assert.match(
      source,
      /import \{ TODO_DETAIL_MAX, TODO_TEXT_MAX, clipTodoText \} from "\.\/notes\.ts"/,
      "the wire must import the writer's bound rather than restating it",
    );
    assert.doesNotMatch(
      source,
      /max\(LIMITS\.listItem\)/,
      "the bound that caused the bug must not come back",
    );
  });

  it("clips a long line at a word, not through one", () => {
    assert.ok(OVER_LONG_LINE.length > TODO_TEXT_MAX, "the fixture must be over the bound");
    const clipped = clipTodoText(OVER_LONG_LINE);
    assert.ok(clipped.length <= TODO_TEXT_MAX);
    assert.ok(clipped.length < OVER_LONG_LINE.length, "an over-long line really is cut");
    assert.ok(clipped.length >= TODO_TEXT_MAX - 12, "a cut at a word rarely loses much");
    assert.ok(OVER_LONG_LINE.startsWith(clipped), "clipping only ever shortens");
    assert.doesNotMatch(clipped, /\s$/, "no trailing space");
    assert.doesNotMatch(clipped, /[\s,;:.—–-]$/, "no dangling punctuation after the cut");
    // The word the cut fell inside is gone whole, not halved.
    const lastWord = clipped.slice(clipped.lastIndexOf(" ") + 1);
    assert.ok(OVER_LONG_LINE.split(" ").includes(lastWord), `"${lastWord}" is a whole word`);
  });

  it("leaves anything already inside the bound exactly as it was written", () => {
    assert.equal(clipTodoText("Pull the packet for the September 3 meeting."), "Pull the packet for the September 3 meeting.");
    assert.equal(clipTodoText(""), "");
    assert.equal(clipTodoText("   "), "");
    assert.equal(clipTodoText("short", 400), "short");
  });

  it("still returns a usable line when the text has no word break to cut at", () => {
    const clipped = clipTodoText("x".repeat(900));
    assert.equal(clipped.length, TODO_TEXT_MAX);
    assert.equal(clipped, "x".repeat(TODO_TEXT_MAX));
  });

  it("accepts a stored line of any length back, and stores it clipped", () => {
    const long = "y".repeat(900);
    const parsed = reportingNotesInput.parse({
      leadId: 240,
      todos: [{ t: long, done: false, src: "machine" }],
    });
    const stored = parsed.todos?.[0]?.t ?? "";
    assert.equal(stored.length, TODO_TEXT_MAX, "an over-long stored line is normalised, not refused");
    assert.ok(long.startsWith(stored));
  });

  it("saves the reported 227-character line without touching it", () => {
    const parsed = reportingNotesInput.parse({
      leadId: 240,
      todos: [{ t: REPORTED_LINE, done: false, src: "machine" }],
    });
    assert.equal(parsed.todos?.[0]?.t, REPORTED_LINE);
  });

  it("round-trips a whole stored notes blob the way the desk sends it back", () => {
    /*
      The shape that was failing. `notes_json.todo` is what is stored, the desk
      parses it (`parseNotes`) and sends every item straight back
      (`desk.story.$leadId.tsx:398` and `:513`, on save and on publish), so the
      loop asserted here is the one the editor's two dead buttons were.
    */
    const stored = parseNotes(
      JSON.stringify({
        todo: [
          { t: REPORTED_LINE, done: false, src: "machine" },
          { t: "Pull the September 3 packet.", done: true, src: "you", q: "q".repeat(500) },
        ],
        news: "Annexation.",
      }),
    );
    const parsed = reportingNotesInput.parse({
      leadId: 240,
      todos: stored.todo.map((todo) => ({
        t: todo.t,
        done: todo.done,
        src: todo.src,
        q: todo.q,
      })),
    });
    assert.equal(parsed.todos?.length, 2);
    assert.equal(parsed.todos?.[0]?.t, REPORTED_LINE);
    assert.equal(parsed.todos?.[1]?.done, true);
    // The detail line is clipped to its own, tighter bound -- still accepted.
    assert.equal(parsed.todos?.[1]?.q?.length, TODO_DETAIL_MAX);
  });

  it("still refuses a to-do that is not a to-do", () => {
    // Normalisation is about length, not shape: the checks around it stand.
    assert.throws(() => reportingNotesInput.parse({ leadId: 240, todos: [{ t: "x", done: "no", src: "machine" }] }));
    assert.throws(() => reportingNotesInput.parse({ leadId: 240, todos: [{ t: "x", done: false, src: "elsewhere" }] }));
    // No line at all is not a to-do, however long the other checks tolerate.
    assert.throws(() => reportingNotesInput.parse({ leadId: 240, todos: [{ done: false, src: "machine" }] }));
    assert.throws(() => reportingNotesInput.parse({ leadId: 240, todos: [{ t: "   ", done: false, src: "machine" }] }));
    // The list itself is still capped (`LIMITS.noteList`, 500).
    assert.throws(() =>
      reportingNotesInput.parse({
        leadId: 240,
        todos: Array.from({ length: 600 }, () => ({ t: "x", done: false, src: "machine" })),
      }),
    );
  });
});
