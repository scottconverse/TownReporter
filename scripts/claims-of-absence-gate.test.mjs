import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/*
  2026-09-05. A draft told readers that no city survey page, launch release or
  council agenda item existed, and that the city's own published deadline was
  unverified. All of it was on the city's website, including a banner on the
  home page. The story was caught by an outside audit, not by the desk.

  These pin the parts of the fix that live in the screen and in the server
  function, where a unit test cannot reach them: the story may not print while
  a claim of absence is unconfirmed, the editor is told why in words rather
  than by a greyed-out button, and a pull that found nothing does not strike
  its line.
*/
const root = new URL("../", import.meta.url);
const story = await readFile(new URL("src/routes/desk.story.$leadId.tsx", root), "utf8");
const desk = await readFile(new URL("src/lib/news/desk.ts", root), "utf8");
const pull = await readFile(new URL("src/lib/news/pull.server.ts", root), "utf8");
const notes = await readFile(new URL("src/lib/news/notes.ts", root), "utf8");
const styles = await readFile(new URL("src/styles.css", root), "utf8");
const blockersLib = await readFile(new URL("src/lib/news/publish-blockers.ts", root), "utf8");

test("Publish is disabled while a claim of absence is unchecked", () => {
  assert.match(
    story,
    /const openClaims = uncheckedGateTodos\(notes\);/,
    "the story page must read the unconfirmed claims off the lead's notes",
  );
  /*
    The button's own words moved in 0.6.67: it now reads "Publish in
    <Section>", carrying the section the press will confirm, so the claim of
    absence is one of the reasons inside `disabled` rather than a label the
    pattern could anchor on. What this test is for is unchanged -- a claim of
    absence keeps the button down until a person confirms it.

    0.6.81 (unit CT) moved every reason into one list. `openClaims.length` is
    an input to `blockers`, and the button's `disabled` is the length of that
    list, so the claim still holds the press down; the assertion follows the
    reason to where it now lives instead of anchoring on the button's own
    `disabled` expression, which is the stronger arrangement -- a rule cannot
    sit in the button and never reach the sentence beside it. The claim's
    refusal is still pinned in `publish-blockers.ts`, checked below.
  */
  /*
    Unit UI1a2 moved both Publish presses onto the shared `ActionButton`, so
    the anchor is the piece rather than `InkButton`. The FACT is unchanged and
    is what this still reads: `blockers.length > 0` is inside the button's own
    `disabled`, so an unconfirmed claim of absence holds the press down.
  */
  assert.match(
    story,
    /<(?:ActionButton|InkButton)[\s\S]{0,1200}?disabled=\{publish\.isPending \|\| blockers\.length > 0\}[\s\S]{0,250}?Publish in \$\{sectionNameNow\}/,
    "the Publish button must be disabled while the blocker list is not empty",
  );
  assert.match(
    story,
    /const blockers = publishBlockers\(\{[\s\S]{0,500}?openClaims: openClaims\.length,/,
    "an unconfirmed claim of absence must be one of the reasons in that list",
  );
  assert.match(
    blockersLib,
    /key: "claims"[\s\S]{0,400}?claims of absence have not been confirmed/,
    "the claim of absence must still be a reason the editor can read",
  );
});

test("a disabled Publish says why, in words, not just opacity", () => {
  /*
    0.6.81 (unit CT). This used to pin `blockedReason`: one sentence, naming
    the first reason only, at the far right of the bottom bar. The owner's
    story had five reasons and four of them turned the button off with nothing
    said at all, and the one sentence that did print was read as stray text.
    The replacement was stronger, not weaker, and this test followed it: the
    bar counts the reasons and offers one press to the list at the top of the
    Checks tab, where each reason has its own sentence and its own button.

    0.6.81 (unit CW) changed the bar's words to the drawn ones -- "Confirm the
    claim to publish." -- so this assertion follows the screen. What it no
    longer pins on the bar is the count; the count did not go anywhere, it is
    the heading of the list this press opens ("3 things block Publish. Each row
    has the press that clears it."), and that is asserted where it renders, in
    `src/components/publish-blockers.test.ts`. The reason is still rendered
    beside the button, still in words, and the press is still there.
  */
  assert.match(
    story,
    /publish-blocked">\s*\{publishGateNote\(blockers\)\}/,
    "the reason must be rendered beside the button, in words",
  );
  assert.match(
    story,
    /\{publishGateNote\(blockers\)\}\{" "\}[\s\S]{0,700}?Review/,
    "the reason must offer the press that opens the list",
  );
  assert.match(
    blockersLib,
    /export function publishBlockedSummary[\s\S]{0,300}?thing(?:s)? blocks Publish/,
    "the reasons must still be counted in words",
  );
  assert.match(
    styles,
    /\.publish-blocked \{[^}]*color:var\(--warn\)[^}]*\}/,
    "the blocked reason needs its own visible styling",
  );
});

test("each claim of absence gets its own checkbox with the search behind it", () => {
  assert.match(story, /Verify before print · Claims of absence/);
  assert.match(
    story,
    /<input\s+type="checkbox"[\s\S]{0,300}?onChange=\{\(\) => save\.mutate\(\{ toggle: row\.i, todos: notes\.todo \}\)\}/,
    "ticking a claim must persist on the lead's notes",
  );
  assert.match(story, /I opened the city site and confirmed this/);
  assert.match(story, /\{row\.t\.q \? <span className="gate-claim-q">\{row\.t\.q\}<\/span> : null\}/);
  // Nothing informational under 14px, in either theme (the "old eyes" rule).
  const gateCss = styles.match(/\.gate-claim[^\n]*\n?/g) ?? [];
  assert.ok(gateCss.length > 0, "the claims block needs styling");
  for (const line of gateCss) {
    assert.doesNotMatch(line, /font-size:\s*(0\.[0-7]\d*rem|1[0-3]px)/, line);
  }
});

test("the server refuses to publish while a claim of absence is unconfirmed", () => {
  assert.match(
    desk,
    /const openClaims = uncheckedGateTodos\(parseNotes\(notesRows\[0\]\?\.notes_json\)\);[\s\S]{0,400}?ok: false as const/,
    "performPublish must fail closed, not rely on a disabled button",
  );
  assert.match(desk, /Confirm the claim of absence first/);
});

test("the gate's claims survive a redraft until someone confirms them", () => {
  assert.match(
    notes,
    /export function keepHumanTodos[\s\S]{0,200}?t\.src === "you" \|\| \(t\.src === "gate" && !t\.done\)/,
    "redrafting must not quietly drop an unconfirmed claim of absence",
  );
  assert.match(notes, /export function uncheckedGateTodos/);
});

test("a pull that returned nothing does not strike its line", () => {
  // PULL1b moved the row edit into `markPulledTodo` so the rule could be
  // tested without a database. The rule is unchanged and still pinned here:
  // only a document reaches `toggleTodo`, and an empty pull leaves the row
  // open with its reason in plain words.
  assert.match(
    pull,
    /if \(!outcome\.documentFound\) \{[\s\S]{0,260}?done: false, q: outcome\.reason, triedAt: outcome\.at/,
    "only a pull that returned a document may mark the line done",
  );
  assert.match(
    pull,
    /reason: pullTodoReason\([\s\S]{0,80}?status: receipt\.status/,
    "an empty durable Pull must leave the reporting line open, with a reason in plain words",
  );
  assert.doesNotMatch(
    pull,
    /pull found nothing/,
    "the old counted reason told the editor nothing about whether to try again",
  );
});

test("documents opened for the draft say which ask they answered", () => {
  assert.match(story, /\{d\.for \? <span className="opened-for">for: \{d\.for\}<\/span> : null\}/);
  assert.match(
    desk,
    /const pulledFor = new Map<string, string>\(\);[\s\S]{0,400}?pulledFor\.set\(pull\.url, pull\.ask\)/,
    "the memo ask behind each pulled document must reach the notes",
  );
});
