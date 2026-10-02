/*
  F3b: the wiring, pinned where a browser walk cannot see it.

  `src/lib/news/first-run-picker.test.ts` proves the RULE -- what the server
  answers, and what a run does with it. What it cannot prove is that the six
  screens actually ask, because a route needs a database, a router and a
  session to mount, and this repo has no component-rendering harness (no
  jsdom, no testing-library; `node --test`'s type-stripping cannot parse JSX).

  Source pins are the house convention for exactly that
  (`scripts/fb5-desk-wiring.test.mjs`, `scripts/fb6-desk-wiring.test.mjs`,
  `scripts/desk-uiux-pins.test.mjs`), so each screen is pinned here by the call
  that supplies the seed and by the flag that protects the editor's own pick.

  WHAT THIS FILE IS FOR: five of these six screens are the F3b fix, and the
  failure mode of a source pin is a screen that quietly goes back to sending
  `"auto"` -- which is invisible in every test and every walk, because a run on
  Automatic still works. Each case below names one screen and what it would
  look like if F3b were reverted on it.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const raw = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
/** The file with its comments blanked: a pin may only be satisfied by code. */
const read = (path) =>
  raw(path)
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (comment) => comment.replace(/[^\n]/g, " "));

/*
  Every screen that opens a writing-model picker and sends it as an explicit
  pick. `surface` is what each one must ask the server for; `state` is the
  picker state the seed lands in.
*/
const SCREENS = [
  { file: "src/routes/desk.index.tsx", surface: "story", state: "storyModel" },
  { file: "src/routes/desk.scan.tsx", surface: "scan", state: "modelChoice" },
  { file: "src/routes/desk.dark.tsx", surface: "dark", state: "modelChoice" },
  { file: "src/routes/desk.opinion.tsx", surface: "opinion", state: "modelChoice" },
  { file: "src/routes/desk.story.$leadId.tsx", surface: "story", state: "modelChoice" },
  { file: "src/components/desk-leads.tsx", surface: "story", state: "modelChoice" },
];

test("every screen that sends a model choice asks for the first-run default", () => {
  for (const { file, surface, state } of SCREENS) {
    const source = read(file);
    assert.match(
      source,
      /useFirstRunPickerSeed\s*\(/,
      `${file}: imports and calls the F3b seed hook`,
    );
    assert.match(
      source,
      new RegExp(`surface:\\s*"${surface}"`),
      `${file}: asks for its own surface's answer`,
    );
    assert.match(
      source,
      new RegExp(`current:\\s*${state}\\b`),
      `${file}: the seed lands in the picker state this screen sends`,
    );
  }
});

test("every screen protects the owner's own pick with a touched flag", () => {
  for (const { file } of SCREENS) {
    const source = read(file);
    assert.match(source, /touched:\s*\(\)\s*=>\s*\w+\.current/, `${file}: the seed defers to a touched flag`);
    // ...and the flag is set by the picker's OWN onChange, not somewhere a
    // walk would never reach. If this were missing, switching the picker to
    // Automatic (or to another model) would be silently undone by the seed.
    assert.match(
      source,
      /on(?:Change|ModelChoice)=\{[^}]*\w+\.current = true/,
      `${file}: the picker's own onChange marks the state touched`,
    );
  }
});

test("no screen sends a literal `auto` as its explicit pick any more", () => {
  for (const { file } of SCREENS) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /modelChoice:\s*"auto"/,
      `${file}: the explicit pick is the picker's state, never the literal "auto"`,
    );
  }
  /*
    Today's triage press used to be the one exception (`draftLead({ leadId,
    modelChoice: "auto", ... })`). It sends the composer's picker now, so the
    page cannot have two answers for the same paper.
  */
  assert.match(
    read("src/routes/desk.index.tsx"),
    /draftLead\(\{\s*data:\s*\{\s*leadId,\s*modelChoice:\s*storyModel,\s*modelEffort:\s*storyModelEffort\s*\}\s*\}\)/,
  );
});

test("the Dark Desk keeps needing a named reader, and the seed is what satisfies it", () => {
  const source = read("src/routes/desk.dark.tsx");
  // The rule itself is unchanged -- this unit changes what the picker OPENS
  // on, never what "the owner has not chosen" means.
  assert.match(source, /mustChooseReader\s*=\s*modelChoice\s*===\s*"auto"/);
});

test("the story page's job hydration still wins over the seed", () => {
  const source = read("src/routes/desk.story.$leadId.tsx");
  const seedAt = source.indexOf("useFirstRunPickerSeed(");
  const hydrateAt = source.indexOf("rememberedStoryModelChoice(");
  assert.ok(seedAt > -1 && hydrateAt > -1, "both the seed and the hydration are present");
  assert.ok(
    seedAt < hydrateAt,
    "the seed is declared before the job hydration, so a story that already has a model keeps it",
  );
});

test("the seed hook itself reads the marker, never the stored assignments", () => {
  const hook = read("src/components/first-run-picker-default.ts");
  assert.match(hook, /getFirstRunPickerDefault/);
  assert.match(hook, /pickerSeedToApply/);
  assert.doesNotMatch(hook, /model_assignments|readModelAssignments|assignment/i);

  const settings = read("src/lib/news/first-run-model-settings.ts");
  // The server read is the F3 marker and nothing else.
  assert.match(settings, /firstRunPickerDefault\(await readModelPromptState\(me\.newsroomId\), surface\)/);
});
