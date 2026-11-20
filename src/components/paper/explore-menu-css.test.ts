import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/*
  F11: at phone width the "Explore the publication" menu is a grid of cells,
  and the base rule keeps links on one line (`white-space: nowrap`). A long
  section name like "Environment & Open Space" then ran into the next column.
  The phone menu must let labels wrap instead.
*/
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CSS = readFileSync(join(ROOT, "src/reader-astra.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

test("the phone Explore menu lets section labels wrap", () => {
  const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim().replace(/\s+/g, " "),
    body: match[2],
  }));
  const menuRules = rules.filter(
    (rule) =>
      rule.selector.includes(".reader .sections.open a") &&
      /white-space\s*:/.test(rule.body),
  );
  assert.ok(menuRules.length > 0, "no white-space rule for the open menu links");
  const effective = menuRules[menuRules.length - 1];
  assert.match(effective.body, /white-space\s*:\s*normal\b/);
});
