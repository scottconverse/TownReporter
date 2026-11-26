import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TEXTAREA_DEFAULT_ROWS,
  TEXTAREA_GROW_CAP,
  needsTextareaGrowFallback,
  textareaGrowSize,
  type CssSupports,
  textareaRowsHeight,
} from "./textarea-grow.ts";

/**
 * Every desk text box grows to fit its text -- the sizing math.
 *
 * The CSS path (`field-sizing: content`) does this natively. These tests pin
 * the fallback's arithmetic, which must say the same thing: a floor at the
 * box's `rows` height, growth with the text, shrink when it is removed, and a
 * stop at 70% of the window height.
 *
 * The numbers are the desk's own: a 16px field has a 25.6px line (line-height
 * 1.6) and 24px of padding and border, top and bottom. So rows=14 is 382.4px.
 */

/** Rounded to a thousandth, so float noise (25.6 x 14) does not fail a test. */
const near = (actual: number, expected: number): boolean => Math.abs(actual - expected) < 0.001;

/** a 16px astra field: 25.6px line, 22px padding + 2px border. */
const FIELD = { lineHeightPx: 25.6, framePx: 24, borderPx: 2, viewportHeightPx: 720 };

describe("desk text box growth", () => {
  it("uses the box's rows height as the floor when the text is short", () => {
    assert.ok(near(textareaRowsHeight(14, 25.6, 24), 382.4));
    const size = textareaGrowSize({ ...FIELD, rows: 14, scrollHeightPx: 2 * 25.6 + 22 });
    assert.ok(near(size.heightPx, 382.4));
    assert.equal(size.capped, false);
  });

  it("grows with the text", () => {
    const size = textareaGrowSize({ ...FIELD, rows: 14, scrollHeightPx: 15 * 25.6 + 22 });
    assert.ok(near(size.heightPx, 15 * 25.6 + 22 + 2));
    assert.equal(size.capped, false);
  });

  it("stops at 70% of the window and says it is capped", () => {
    const size = textareaGrowSize({ ...FIELD, rows: 14, scrollHeightPx: 10_000 });
    assert.equal(size.heightPx, 720 * TEXTAREA_GROW_CAP);
    assert.equal(size.capped, true);
  });

  it("shrinks back to the rows floor when the text is cleared", () => {
    const grown = textareaGrowSize({ ...FIELD, rows: 14, scrollHeightPx: 2_000 });
    assert.equal(grown.capped, true);
    const cleared = textareaGrowSize({ ...FIELD, rows: 14, scrollHeightPx: 2 * 25.6 + 22 });
    assert.ok(near(cleared.heightPx, 382.4));
    assert.equal(cleared.capped, false);
  });

  it("reads a missing or bad rows as the HTML default of 2", () => {
    assert.equal(TEXTAREA_DEFAULT_ROWS, 2);
    const missing = textareaGrowSize({ ...FIELD, rows: Number.NaN, scrollHeightPx: 0 });
    assert.equal(missing.heightPx, textareaRowsHeight(2, 25.6, 24));
    assert.equal(textareaRowsHeight(0, 25.6, 24), textareaRowsHeight(2, 25.6, 24));
    assert.equal(textareaRowsHeight(-3, 25.6, 24), textareaRowsHeight(2, 25.6, 24));
  });

  it("keeps a floor taller than the rows height, empty and cleared", () => {
    // A pasted-story box on main is 160px when empty; rows say 2 lines (75.2px).
    const empty = textareaGrowSize({
      ...FIELD,
      rows: 2,
      scrollHeightPx: 2 * 25.6 + 22,
      minHeightPx: 160,
    });
    assert.ok(near(empty.heightPx, 160));
    assert.equal(empty.capped, false);

    const typed = textareaGrowSize({
      ...FIELD,
      rows: 2,
      scrollHeightPx: 3 * 25.6 + 22,
      minHeightPx: 160,
    });
    assert.ok(near(typed.heightPx, 160), "three lines still short of the 160px floor");

    const grown = textareaGrowSize({
      ...FIELD,
      rows: 2,
      scrollHeightPx: 12 * 25.6 + 22,
      minHeightPx: 160,
    });
    assert.ok(near(grown.heightPx, 12 * 25.6 + 22 + 2), "grows past the floor");

    const cleared = textareaGrowSize({
      ...FIELD,
      rows: 2,
      scrollHeightPx: 0,
      minHeightPx: 160,
    });
    assert.ok(near(cleared.heightPx, 160), "cleared back to the floor, not the rows height");
  });

  it("never goes below the rows floor even in a window shorter than the box", () => {
    const size = textareaGrowSize({ ...FIELD, rows: 14, scrollHeightPx: 5_000, viewportHeightPx: 200 });
    assert.ok(near(size.heightPx, 382.4), "the floor wins over a 70vh cap of 140px");
    assert.equal(size.capped, true, "it still scrolls inside");
  });

  it("runs the fallback unless both field-sizing and a typed attr(rows) are supported", () => {
    const supports = (property: string, value: string) =>
      (property === "field-sizing" && value === "content") ||
      (property === "min-height" && (value.includes("attr(rows") || value === "1lh"));
    assert.equal(needsTextareaGrowFallback({ supports } as unknown as CssSupports), false);
    assert.equal(
      needsTextareaGrowFallback({ supports: () => false } as unknown as CssSupports),
      true,
    );
    assert.equal(needsTextareaGrowFallback(undefined), true, "no CSS object means no support");
    const growsOnly = (property: string, value: string) =>
      property === "field-sizing" && value === "content";
    assert.equal(
      needsTextareaGrowFallback({ supports: growsOnly } as unknown as CssSupports),
      true,
      "field-sizing without the attr floor would draw one-line boxes",
    );
  });
});
