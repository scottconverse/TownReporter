/*
  PUB2 item 3: /desk/setup passes `firstRun` only when the install really needs
  setup, and sends an already-onboarded owner to /desk.

  The route rendered `<PaperSetupForm firstRun ...>` for ANY owner who reached
  it, so an owner whose paper was already set up and who navigated there
  directly got a BLANK form -- and Save would have overwritten the paper's
  identity with whatever was typed into it. The flag now comes from the same
  server answer the Server panel reads (`firstRunSetupState`, query key
  `["first-run-setup"]`), and an onboarded owner is redirected to /desk.

  THE HARD CONSTRAINT (production auditor, 2026-10-02): the live paper is
  `onboarded = true` with EMPTY name, city and state columns. The decision must
  key off the `onboarded` flag -- through `firstRunSetupState` -- and NEVER off
  whether city or name is filled in, or the live paper would read as un-set-up
  and its owner would be sent to a blank form. `paper-live-shape.test.ts` pins
  the server side of that; this test pins the route's side of it.

  A source-shape test: what has to hold is which value reaches `firstRun`, which
  answer drives the redirect, and what happens when the answer never arrives.
*/
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const setup = await readFile(new URL("../src/routes/desk.setup.tsx", import.meta.url), "utf8");

test("firstRun comes from the onboarded answer, not from a constant", () => {
  assert.match(
    setup,
    /firstRun=\{setupState\.data\.needsSetup === true\}/,
    "a hard `firstRun` drew a blank form for an already-set-up owner",
  );
  assert.doesNotMatch(setup, /firstRun\s*\n?\s*submitLabel/, "the bare `firstRun` prop is gone");
  assert.match(setup, /import \{ firstRunSetupState, getPaperConfigForEditor \}/);
  assert.match(setup, /queryKey: \["first-run-setup"\]/, "the same key the Server panel reads");
});

test("an owner whose paper is already set up is sent to /desk", () => {
  assert.match(
    setup,
    /const alreadySetUp = me\.data\?\.role === "owner" && setupState\.data\?\.needsSetup === false/,
    "only an explicit `needsSetup: false` triggers the departure; pending never does",
  );
  assert.match(setup, /if \(alreadySetUp\) void navigate\(\{ to: "\/desk" \}\)/);
  // And the form is not drawn for that owner, even for the one frame before
  // the router swaps the screen.
  assert.match(setup, /if \(alreadySetUp\) \{[\s\S]*?<ScreenPending/);
});

test("a missing or errored onboarded answer fails closed", () => {
  assert.match(
    setup,
    /setupState\.isError \|\| setupState\.data === undefined/,
    "the Server panel's fail-closed rule is copied, not re-invented",
  );
  assert.match(setup, /role="alert"/);
  assert.match(setup, /could not check whether this paper has been set up yet/);
});

test("the decision never reads city or name", () => {
  /*
    The live paper is onboarded with blank name/city/state. A guard like
    `!current.data?.city` would read it as un-set-up and blank its owner's form.
    Comments are stripped: the prose above explains the blank-city shape and
    would otherwise match a regex about code.
  */
  const code = setup.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(
    code,
    /needsSetup[^\n]*\b(city|name)\b|\b(city|name)\b[^\n]*needsSetup/,
    "needsSetup is not combined with a city or name check",
  );
  assert.doesNotMatch(code, /current\.data\?\.(city|name)\s*(\?\?|===|\|\|)/, "no such fallback");
});

test("a cached first-run answer is unresolved until THIS mount has refetched it (review-bot finding)", async () => {
  /*
    `needsSetup: true` left in the cache is returned with isPending === false
    while a background refetch runs. Drawing the blank first-run form from it for
    an already-onboarded paper lets Save overwrite the paper's identity, so the
    route and the Server panel refetch on every mount and wait for that fetch.
  */
  const ops = await readFile(new URL("../src/components/ops-panels.tsx", import.meta.url), "utf8");
  const panel = ops.slice(
    ops.indexOf("export function PaperSetupPanel("),
    ops.indexOf("export function DarkDeskCounty("),
  );
  for (const [name, source] of [["setup route", setup], ["Server panel", panel]]) {
    assert.match(source, /refetchOnMount: "always"/, `${name}: the answer is refetched on every mount`);
    assert.match(source, /!setupState\.isFetchedAfterMount/, `${name}: a cached answer is not drawn from`);
  }
});
