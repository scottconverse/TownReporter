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
const notes = await readFile(new URL("src/lib/news/notes.ts", root), "utf8");
const styles = await readFile(new URL("src/styles.css", root), "utf8");

test("Publish is disabled while a claim of absence is unchecked", () => {
  assert.match(
    story,
    /const openClaims = uncheckedGateTodos\(notes\);/,
    "the story page must read the unconfirmed claims off the lead's notes",
  );
  assert.match(
    story,
    /disabled=\{[\s\S]{0,200}?openClaims\.length > 0[\s\S]{0,80}?\}[\s\S]{0,200}?Publish to the paper/,
    "the Publish button must be disabled while a claim of absence is unchecked",
  );
});

test("a disabled Publish says why, in words, not just opacity", () => {
  assert.match(
    story,
    /const blockedReason = openClaims\.length[\s\S]{0,240}?Confirm the claim of absence first/,
    "the reason must be a sentence the editor can read",
  );
  assert.match(
    story,
    /\{blockedReason \?[\s\S]{0,400}?publish-blocked[\s\S]{0,300}?\{blockedReason\}/,
    "the reason must be rendered beside the button",
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
  assert.match(
    desk,
    /if \(typeof data\.index === "number" && notes\.todo\[data\.index\]\) \{[\s\S]{0,120}?if \(docs\.length && !notes\.todo\[data\.index\]\.done\)/,
    "only a pull that returned a document may mark the line done",
  );
  assert.match(desk, /pull found nothing/);
});

test("documents opened for the draft say which ask they answered", () => {
  assert.match(story, /\{d\.for \? <span className="opened-for">for: \{d\.for\}<\/span> : null\}/);
  assert.match(
    desk,
    /const pulledFor = new Map<string, string>\(\);[\s\S]{0,400}?pulledFor\.set\(pull\.url, pull\.ask\)/,
    "the memo ask behind each pulled document must reach the notes",
  );
});
