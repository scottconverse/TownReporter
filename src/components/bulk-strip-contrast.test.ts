import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

/*
  TMA-3: the caption under the bulk Start button ("Starts AI drafts for the
  ticked leads.") sits on the gold bulk strip (`.queue-bulk`, background --a).
  The caption's base rule paints it --fg, which is near-white in dark mode
  (#e8e6e1, about 1.6:1 on #e6c35c). The test resolves the caption's ink from
  the real stylesheet the way the cascade does: the strip's own caption rule if
  it sets one, otherwise the theme's --fg. It then checks the contrast against
  the theme's real --a token. No browser runs here; this reads desk-astra.css.
*/

const CSS = readFileSync(new URL("../desk-astra.css", import.meta.url), "utf8");

const DARK_THEME = ':root[data-appearance="desk-dark"] .desk-ltr.astra {';
const LIGHT_THEME = ".desk-ltr.astra {";
const STRIP_CAPTION = ".desk-ltr.astra .queue-bulk .bulk-start-note {";

function ruleBody(selector: string): string {
  const start = CSS.indexOf(selector);
  assert.notEqual(start, -1, `no rule for ${selector}`);
  return CSS.slice(start, CSS.indexOf("}", start));
}

/** A declared hex color, with #111 spelled out to #111111. */
function hexOf(body: string, property: string): string {
  const match = body.match(new RegExp(`${property}:\\s*#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b`));
  assert.ok(match, `${property} is not a hex color in ${body.split("\n")[0]}`);
  const digits = match[1];
  return "#" + (digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits);
}

/** The ink the caption draws in a theme: the strip rule's color, else the theme's --fg. */
function captionInk(theme: string): string {
  return CSS.includes(STRIP_CAPTION)
    ? hexOf(ruleBody(STRIP_CAPTION), "color")
    : hexOf(ruleBody(theme), "--fg");
}

function stripGround(theme: string): string {
  return hexOf(ruleBody(theme), "--a");
}

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** WCAG 2.x relative luminance, then the contrast ratio of the two colors. */
function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = hexToRgb(hex).map((channel) => {
      const s = channel / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("TMA-3: the bulk Start caption reads on the gold strip", () => {
  it("meets WCAG AA 4.5:1 on the strip in dark theme", () => {
    const ink = captionInk(DARK_THEME);
    const ground = stripGround(DARK_THEME);
    const ratio = contrastRatio(ink, ground);
    assert.ok(ratio >= 4.5, `caption ${ink} on ${ground} is ${ratio.toFixed(2)}:1`);
  });

  it("meets WCAG AA 4.5:1 on the strip in light theme", () => {
    const ink = captionInk(LIGHT_THEME);
    const ground = stripGround(LIGHT_THEME);
    const ratio = contrastRatio(ink, ground);
    assert.ok(ratio >= 4.5, `caption ${ink} on ${ground} is ${ratio.toFixed(2)}:1`);
  });
});
