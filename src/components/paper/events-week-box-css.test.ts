import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CSS = readFileSync(join(ROOT, "src/reader-astra.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

type Rule = { selector: string; body: string };

function cssRules(source: string): Rule[] {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2],
  }));
}

function declarations(body: string, property: string): string[] {
  return body
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const colon = declaration.indexOf(":");
      return colon === -1
        ? null
        : {
            property: declaration.slice(0, colon).trim().toLowerCase(),
            value: declaration.slice(colon + 1).trim(),
          };
    })
    .filter((declaration) => declaration?.property === property)
    .map((declaration) => declaration!.value);
}

function pxValue(value: string): number {
  const match = value.match(/(-?(?:\d+|\d*\.\d+))px/);
  assert.ok(match, `cannot evaluate CSS length in px: ${value}`);
  return Number(match[1]);
}

const EVENTWEEK_RULES = cssRules(CSS).filter((rule) =>
  rule.selector.split(",").some((selector) => selector.includes(".eventweek")),
);

test("every event-week font size is at least 14px", () => {
  const undersized: string[] = [];

  for (const rule of EVENTWEEK_RULES) {
    for (const value of declarations(rule.body, "font-size")) {
      if (pxValue(value) < 14) undersized.push(`${rule.selector} { font-size: ${value} }`);
    }
  }

  assert.deepEqual(undersized, []);
});

test("event-week title links have a 44px tap target", () => {
  const heights = EVENTWEEK_RULES.filter((rule) =>
    rule.selector.split(",").some((selector) => selector.includes(".eventweek-title")),
  ).flatMap((rule) => declarations(rule.body, "min-height").map(pxValue));

  assert.ok(
    heights.some((height) => height >= 44),
    "an .eventweek-title rule must set min-height to at least 44px",
  );
});