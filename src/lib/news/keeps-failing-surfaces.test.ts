import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/*
  SH0-3: BOTH SURFACES SAY IT, AND THE EDITOR IS THE ONE WHO ACTS.

  The predicate and the sentence are pinned where they live (`source-rows.
  test.ts`, `desk-copy.test.ts`), and the count is pinned against a real
  database (`source-failure-streak.postgres.test.ts`). What is left is the
  joining-up: does the Sources ROW actually say "Keeps failing", does the desk
  home say it too, and does the row offer the editor the two presses the owner
  asked for -- without the desk ever pausing or removing anything by itself.

  The two routes cannot be loaded headlessly (they import `@/lib/news/desk`,
  which opens a database at import time), so this binds to their source text --
  the same defence `scan-coverage.test.ts` and `announce-tone-wiring.test.ts`
  use on the files they exist to protect.

  MUTATION: putting the constant "Could not check" back on either surface fails
  the first two tests; taking the confirm off Delete fails the fourth.
*/

const sourcesScreen = readFileSync(new URL("../../routes/desk.sources.tsx", import.meta.url), "utf8");
const deskHome = readFileSync(new URL("../../routes/desk.index.tsx", import.meta.url), "utf8");
const desk = readFileSync(new URL("./desk.ts", import.meta.url), "utf8");

/** The slice of a file between two markers, so an assertion cannot be
 *  satisfied by a matching string somewhere else in the file. */
function between(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  assert.ok(start >= 0, `marker not found: ${from}`);
  const end = text.indexOf(to, start);
  assert.ok(end > start, `end marker not found after ${from}: ${to}`);
  return text.slice(start, end);
}

describe("the Sources row says the streak (SH0-3)", () => {
  it("the chip reads 'Keeps failing' where the streak has reached the threshold", () => {
    const row = between(sourcesScreen, "const paused = s.status === \"paused\";", "const checking =");
    assert.match(row, /const keeps = keepsFailing\(s\)/, "the row asks the predicate, not a literal");
    assert.match(
      row,
      /keeps\s*\n?\s*\?\s*\{[^}]*label:\s*"Keeps failing"/,
      "the chip label is 'Keeps failing'",
    );
    // The weaker word is still there, for the row that has failed once or twice.
    assert.match(row, /label:\s*"Could not check"/, "one or two failures still read 'Could not check'");
  });

  it("a paused row keeps the Paused chip: pause is checked before the streak", () => {
    const chip = between(sourcesScreen, "const chip = paused", ": s.last_fetched_at");
    assert.ok(
      chip.indexOf("paused") < chip.indexOf("Keeps failing"),
      "the paused branch must come first, or a paused row is told it keeps failing",
    );
  });

  it("the note under the chip is the streak sentence, not just the last reason", () => {
    const row = between(sourcesScreen, "const note = paused", "const checking =");
    assert.match(row, /keepsFailingNote\(\{/);
    assert.match(row, /count:\s*s\.consecutive_failures \?\? 0/);
    assert.match(row, /firstFailedAt:\s*s\.failure_streak_started_at/);
  });
});

describe("the desk home says it too, and only the word changes (SH0-3)", () => {
  it("the failure row's label reads the streak", () => {
    const wire = between(deskHome, "const failure = failReasonFor(s);", "if (citedCount.has(s.id))");
    assert.match(wire, /if \(keepsFailing\(s\)\)/, "the desk home asks the same predicate");
    assert.match(wire, /label:\s*"Keeps failing"/);
    assert.match(wire, /label:\s*"Could not check"/, "the ordinary failure still has its own words");
  });

  it("it is the same row in the same place: no fifth state, no re-sort", () => {
    const wire = between(deskHome, "if (keepsFailing(s))", "if (citedCount.has(s.id))");
    assert.match(wire, /rank:\s*0/, "the flagged row keeps the failure row's rank");
  });

  it("the desk-home note carries the count and the date, not just the reason", () => {
    const wire = between(deskHome, "if (keepsFailing(s))", "if (citedCount.has(s.id))");
    assert.match(wire, /keepsFailingNote\(\{/);
    assert.match(wire, /firstFailedAt:\s*s\.failure_streak_started_at/);
  });
});

describe("Pause and Delete are the editor's presses (owner addendum item 1)", () => {
  it("a keeps-failing row offers Pause and Delete, one press each", () => {
    const acts = between(sourcesScreen, "const keeps = keepsFailing(s);", "</Fragment>");
    assert.match(acts, /onStatus\(s\.id, "paused"\)[\s\S]*?(>\s*Pause\s*<|: "Pause"\})/, "Pause stays");
    assert.match(acts, /keeps \? \([\s\S]*?>\s*Delete\s*</, "Delete is drawn on the flagged row");
  });

  it("Delete asks exactly one question, and the question says what goes", () => {
    const del = between(sourcesScreen, "keeps ? (", ") : (");
    const ask = /confirm\(\s*`([^`]*)`/.exec(del);
    assert.ok(ask, "Delete must ask before it acts");
    assert.match(ask[1], /\$\{s\.title\}/, "the question names the source");
    assert.match(ask[1], /watch list/i, "the question says where it goes from");
    assert.match(ask[1], /stop|stops fetching/i, "the question says what the desk stops doing");
  });

  it("Delete uses the existing removal path rather than a new one", () => {
    const del = between(sourcesScreen, "keeps ? (", ") : (");
    assert.match(del, /onStatus\(s\.id, "rejected"(, s\.status)?\)/, "the same press the row's Remove already made");
    assert.ok(
      !/setSourceStatus|useMutation|new InkButton/.test(del),
      "no new server function and no new mutation: the existing press, one click closer",
    );
    // ...and the row's ordinary action is unchanged, so a healthy row still has
    // the one-click-deeper Remove it has always had.
    assert.match(sourcesScreen, /<summary className="btn quiet">More ▾<\/summary>/);
  });
});

describe("the desk never pauses or removes a source by itself", () => {
  it("nothing in the scan writes a status, and only the editor's press does", () => {
    /*
      The addendum is explicit: flag, and offer the press -- never act. The
      scan writes the streak, the error and the dates, and nothing else; the
      one writer of `sources.status` in this file is `setSourceStatus`, which
      is the editor's own press from the row.
    */
    assert.doesNotMatch(desk, /status\s*=\s*'paused'/, "no automatic pausing");
    assert.doesNotMatch(desk, /status\s*=\s*'rejected'/, "no automatic removal");
    const statusWrites = desk.match(/update sources\s+set[\s\S]{0,120}?status\s*=/g) ?? [];
    assert.equal(statusWrites.length, 1, "exactly one writer of sources.status: the editor's press");
    assert.ok(
      desk.includes("status = ${data.status}"),
      "and the one writer writes the status the editor asked for, not one of its own",
    );
  });
});
