import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/* Chips are sentence case, and "Ready to check" is a neutral chip (designer ruling, README section 7).
   The guard walk measures edges and sizes, not letter case or what a colour means. */
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const RULES = ["styles.css", "desk-astra.css"].flatMap((f) =>
  [...strip(read("src", f)).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] })),
);
const CHIPS = /\.(chip|astra-chip|astra-blocker-chip|astra-evidence-chip|wire-chip|fu-chip|job-card-chip|today-card-stage)(?![\w-])/;

test("no chip class on the desk is drawn in capitals", () => {
  /* Bug caught: every chip went through one uppercase rule, so READY TO CHECK shouted at the editor. */
  const shouting = RULES.filter((r) => CHIPS.test(r.sel) && /text-transform\s*:\s*uppercase/.test(r.body));
  assert.deepEqual(shouting.map((r) => r.sel), []);
});

test("the Drafts Ready chip is the neutral chip, not green or yellow", () => {
  /* Bug caught: a finished draft's row was drawn green, a verdict the row cannot back (checks live on the story page). */
  const tone = read("src", "routes", "desk.drafts.tsx").match(/function stateTone\([\s\S]*?\n\}/);
  assert.match(tone?.[0] ?? "", /state\.key === "ready"\) return "d-ready"/);
  const ready = RULES.filter((r) => r.sel === ".desk-ltr.astra .chip.d-ready").map((r) => r.body).join(";");
  assert.match(ready, /border\s*:\s*1px solid var\(--fg2\)/);
  assert.match(ready, /background\s*:\s*transparent/);
});

test("a stored lower-case status is capitalised where the chip is drawn", async () => {
  /* Bug caught: with the uppercase rule gone, stored words like "new" and "held" rendered lower case. */
  const { chipLabel, sentenceCase } = await import("../src/lib/news/desk-copy.ts");
  assert.equal(chipLabel("held"), "Held");
  assert.equal(sentenceCase("could not check"), "Could not check");
  assert.equal(sentenceCase("Ready to check"), "Ready to check");
});
