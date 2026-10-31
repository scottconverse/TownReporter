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

function declarationValues(selector: string, property: string): string[] {
  return EVENTWEEK_RULES.filter((rule) =>
    rule.selector.split(",").some((part) => part.trim() === selector),
  ).flatMap((rule) => declarations(rule.body, property));
}

test("the events band uses the design's light band and white card grounds", () => {
  assert.ok(declarationValues(".reader .eventweek", "background").includes("var(--band)"));
  assert.ok(declarationValues(".reader .eventweek-card", "background").includes("var(--card)"));
});

test("the day strip scrolls sideways with 84px day columns", () => {
  assert.ok(declarationValues(".reader .eventweek-strip", "grid-auto-flow").includes("column"));
  assert.ok(declarationValues(".reader .eventweek-strip", "overflow-x").includes("auto"));
  assert.ok(
    declarationValues(".reader .eventweek-strip", "grid-auto-columns").some(
      (value) => pxValue(value) >= 84,
    ),
  );
});

test("event-week title links and controls have 44px tap targets", () => {
  for (const selector of [".eventweek-title", ".eventweek-more", ".eventweek-all"]) {
    const heights = EVENTWEEK_RULES.filter((rule) =>
      rule.selector.split(",").some((part) => part.includes(selector)),
    ).flatMap((rule) => declarations(rule.body, "min-height").map(pxValue));
    assert.ok(
      heights.some((height) => height >= 44),
      `${selector} must set min-height to at least 44px`,
    );
  }
});
test("descriptions clamp to two lines and only linked titles are underlined", () => {
  const clamps = EVENTWEEK_RULES.filter((rule) =>
    rule.selector.split(",").some((selector) => selector.trim() === ".reader .eventweek-description"),
  ).flatMap((rule) => declarations(rule.body, "-webkit-line-clamp"));
  assert.ok(clamps.includes("2"));

  const titleRule = EVENTWEEK_RULES.find(
    (rule) => rule.selector.trim() === ".reader .eventweek-title",
  );
  assert.ok(titleRule);
  assert.deepEqual(declarations(titleRule.body, "text-decoration"), ["none"]);

  const linkRule = EVENTWEEK_RULES.find(
    (rule) => rule.selector.trim() === ".reader a.eventweek-title",
  );
  assert.ok(linkRule);
  assert.deepEqual(declarations(linkRule.body, "text-decoration"), ["underline"]);
});
