/*
  UI1b-6 / Option A: THE CLOUD ROWS ON THE FIRST-RUN CARD HAVE NO BUTTON.

  WHAT WAS WRONG. `FirstRunModelCard` drew a "Use <model>" button for EVERY
  model its catalog listed, cloud models included. The server
  (`answerFirstRunModelOffer`, src/lib/news/first-run-model-settings.ts) refuses
  a cloud pick on purpose -- a model on Ollama's hosted service is not "on this
  computer" and spends the owner's allowance -- so a cloud row's button could
  only ever produce that refusal sentence. A control that exists to fail reads
  as a broken screen to the one person who meets it: a brand-new owner, on
  their first visit, with nothing loaded.

  THE DECISION. A cloud row is a plain labelled LINE that says why it cannot
  be picked ("hosted by Ollama, spends credits, cannot be the desk's default").
  A model on this computer keeps its real, working "Use <model>" button, and
  "Keep the Automatic ladder" stays a real button. The server's refusal is
  untouched -- it is still the guard, and
  `src/lib/news/first-run-model.test.ts` ("refuses a cloud model as the
  default") still drives it.

  WHY A SOURCE PIN. The card is a hook component (`useQuery` + `useMutation`)
  and this repo has no render harness for a React Query tree under node:test,
  so what it DRAWS is pinned against its own source, the same way
  `publish-bar-done.test.ts` pins the story route and `desk-chip-case.test.mjs`
  pins the stylesheets. The RULE itself -- which row is a pick -- is a pure
  function with its own unit test in first-run-model.test.ts; this file only
  proves the card calls it and does not draw a button anywhere else.

  Mutations of the brief: draw the Use button for a cloud row again (delete the
  `firstRunModelRowKind(model) === "local"` branch) and test (a) fails.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const CARD = readFileSync(new URL("./first-run-model.tsx", import.meta.url), "utf8");

/**
 * The card's own row map -- the `<ul>` that lists a server's models. Scoped to
 * `FirstRunModelCard`: the read-only list above it maps the same rows, and its
 * rows are lines by design (it has no buttons at all).
 */
function rowBlock(): string {
  const card = CARD.indexOf("export function FirstRunModelCard()");
  assert.notEqual(card, -1, "FirstRunModelCard is gone from first-run-model.tsx");
  const start = CARD.indexOf("{row.models.map(", card);
  assert.notEqual(start, -1, "FirstRunModelCard no longer maps over a row's models");
  const end = CARD.indexOf("</ul>", start);
  assert.notEqual(end, -1, "the row map has no closing </ul>");
  return CARD.slice(start, end);
}

test("(a) a cloud row draws a line with the reason, never a button", () => {
  const block = rowBlock();
  // The branch is on the row kind, and the cloud arm is the one without a button.
  assert.match(
    block,
    /firstRunModelRowKind\(model\)\s*===\s*"local"/,
    "the row map no longer asks which kind of row this is -- every row could draw a button again",
  );
  const [localArm = "", cloudArm = ""] = block.split(/\s*:\s*\(\s*\n\s*<li/);
  assert.match(localArm, /<button/, "the local arm lost its button");
  assert.doesNotMatch(cloudArm, /<button/, "a cloud row draws a button again -- its only outcome is the refusal");
  assert.match(cloudArm, /firstRunModelLine\(model\)/, "the cloud row no longer carries its explanatory line");
});

test("(b) a model on this computer still draws its real Use button", () => {
  const block = rowBlock();
  assert.match(
    block,
    /Use \{localModelListLabel\(model\)\}/,
    'the local row no longer draws "Use <model>"',
  );
  assert.match(
    block,
    /onClick=\{\(\) => answer\.mutate\(\{ choice: \{ baseUrl: row\.baseUrl, id: model\.id \} \}\)\}/,
    "the local row's button no longer sends the pick to the server",
  );
});

test("the card keeps Keep-the-Automatic as a real button, and the refusal door is untouched", () => {
  assert.match(
    CARD,
    /FIRST_RUN_MODEL_KEEP_AUTOMATIC\}/,
    '"Keep the Automatic ladder" is no longer drawn as a button label',
  );
  const settings = readFileSync(new URL("../lib/news/first-run-model-settings.ts", import.meta.url), "utf8");
  assert.match(
    settings,
    /if \(model\.cloud\) \{[\s\S]*?cannot be the desk's default/,
    "the server no longer refuses a cloud pick -- this unit must not have touched that door",
  );
});
