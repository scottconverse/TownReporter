import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/*
  F4 (the auditor's finding on main 8b9b5fca): on an install nobody had set up,
  Server > Paper setup printed "Name TownReporter, Town Longmont, Colorado,
  Editor email <the author's address>" because the card read the shipped
  fallback config. The row text is tested in src/lib/desk/ops-rows.test.ts; this
  pins the ROUTE wiring: the card asks the same first-run question as
  /desk/setup and the Paper setup form, passes it through, and fails closed.
*/
const route = await readFile(new URL("../src/routes/desk.ops.tsx", import.meta.url), "utf8");

test("the Paper setup card asks the first-run question and passes it to the rows", () => {
  assert.match(route, /queryKey: \["first-run-setup"\]/);
  assert.match(route, /queryFn: \(\) => firstRunSetupState\(\)/);
  assert.match(route, /"paper-setup": paperSetupBody\(paper, sections, setupState\)/);
  assert.match(route, /paperSetupRows\(config, sectionConfig, needsSetup\)/);
});

test("a failed or missing first-run answer is never read as 'set up' -- the card errors or waits", () => {
  const body = route.slice(route.indexOf("function paperSetupBody("), route.indexOf("/** One read that answers"));
  assert.match(body, /if \(setupState\.isError\) return \{ state: "error"/);
  assert.match(body, /setupState\.data === undefined/);
  assert.match(body, /return \{ state: "loading" \}/);
  // The decision is the onboarded answer, never whether the name or city is filled.
  const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\.city|\.name\b|\.state\b/);
});
