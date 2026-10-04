import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/* The 44px floor itself is measured on every control by the clickable guard walk
   (scripts/desk-clickable-guard-walk.mjs). This file keeps the ONE pin the guard
   cannot read from a rendered page: the Queue checkbox's drawn shape. */
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CSS = readFileSync(join(ROOT, "src", "desk-astra.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The last value `prop` is given under exactly `selector`. */
function decl(selector, prop) {
  let last;
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(",").some((s) => s.trim() === selector)) continue;
    const d = m[2].match(new RegExp("(?:^|[;\\s])" + prop + "\\s*:\\s*([^;]+)"));
    if (d) last = d[1].trim();
  }
  return last;
}

test("the Queue's row checkbox is a hollow 24px mark in a 44px label, with an ink focus ring", () => {
  /* Bug caught: a filled unchecked box (reads as checked), and a yellow focus ring (1.4:1 on cream). */
  const input = ".desk-ltr.astra .queue-check > input";
  assert.equal(decl(".desk-ltr.astra .queue-check", "min-height"), "44px");
  assert.equal(decl(input, "width"), "24px");
  assert.equal(decl(input, "border"), "2px solid var(--fg)");
  assert.equal(decl(input, "background"), "var(--bg)");
  assert.equal(decl(input + ":checked", "background"), "var(--fg)");
  assert.equal(decl(input + ":focus-visible", "outline"), "2px solid var(--fg)");
});
