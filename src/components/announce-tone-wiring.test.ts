import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * B7R, item 4: `announceToDesk`'s tone, at the call sites that announce a
 * failure.
 *
 * The default tone is "ok" -- the desk's yellow bar, the shape of a press that
 * finished, and the design system's "the next step" accent. A caller that
 * announces a refusal or an error with one argument therefore paints the bad
 * news in the colour that means everything is fine, and the editor scanning the
 * desk for what needs them sees another success.
 *
 * Every `announceToDesk(` call in `src/` was read and classified by hand for
 * this unit. The failures are pinned here by the sentence they announce, in the
 * mutation they belong to, so that a reworded or moved call is caught rather
 * than silently re-toned. The successes are pinned the other way, because a
 * blanket "err" would be just as wrong in the other direction.
 *
 * THE MUTATIONS THAT MATTER. Dropping the second argument from any of the four
 * failure calls below fails its case; adding "err" to "Draft queued -- it is
 * writing now." fails the last one.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const source = (relative: string) => fs.readFileSync(path.join(here, relative), "utf8");

/** Every `announceToDesk(...)` call in a source, as its raw argument text. */
function announceCalls(text: string): string[] {
  const out: string[] = [];
  const needle = "announceToDesk(";
  let index = text.indexOf(needle);
  while (index >= 0) {
    let depth = 0;
    let i = index + needle.length - 1;
    for (; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(text.slice(index + needle.length, i));
    index = text.indexOf(needle, i);
  }
  return out;
}

/** The source between two landmarks, with the landmark included. */
function between(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  assert.ok(start >= 0, `the test's own landmark is gone: ${from}`);
  const end = text.indexOf(to, start);
  assert.ok(end > start, `the test's own landmark is gone: ${to}`);
  return text.slice(start, end);
}

/** The calls in a slice whose arguments mention `sentence`. */
function callsSaying(text: string, sentence: string): string[] {
  const calls = announceCalls(text).filter((args) => args.includes(sentence));
  assert.ok(calls.length, `no announceToDesk call says ${sentence}`);
  return calls;
}

const INDEX = source("../routes/desk.index.tsx");
const IMPORT = source("../routes/desk.import.tsx");
const STORY = source("../routes/desk.story.$leadId.tsx");
const SCAN = source("./daily-scan-settings.tsx");

describe("a failure is never announced in the accent that means success", () => {
  it("tones the draft that did not start as an error", () => {
    const startDraft = between(INDEX, "const startDraft = useMutation({", "KEYBOARD TRIAGE");
    for (const args of callsSaying(startDraft, '"That draft did not start."'))
      assert.match(args, /"err"/, `a failed draft start was announced as a success: ${args}`);
  });

  it("tones the refused import as an error", () => {
    const runImport = between(IMPORT, "const runImport = useMutation({", "async function readFile(");
    const calls = announceCalls(runImport);
    assert.equal(calls.length, 1, "the refused import is the only thing runImport announces");
    assert.match(calls[0]!, /"err"/, `a refused import was announced as a success: ${calls[0]}`);
  });

  it("tones both failure branches of acceptUnreviewed as errors", () => {
    const accept = between(STORY, "const acceptUnreviewed = useMutation({", "const reviewEvidence = useMutation({");
    const calls = announceCalls(accept);
    assert.equal(calls.length, 2, "a refusal and a thrown failure, and nothing else");
    for (const args of calls)
      assert.match(args, /"err"/, `an acceptance that failed was announced as a success: ${args}`);
  });

  it("tones the schedule that changed elsewhere as an error, as its own feedback does", () => {
    const changed = callsSaying(SCAN, "Saved schedule changed elsewhere.");
    for (const args of changed)
      assert.match(args, /"err"/, `a stale schedule was announced as a success: ${args}`);
  });

  it("leaves a finished press in the accent that means the next step", () => {
    for (const args of callsSaying(INDEX, '"Draft queued — it is writing now."'))
      assert.doesNotMatch(args, /"err"/, `a finished press was painted as a failure: ${args}`);
  });
});
