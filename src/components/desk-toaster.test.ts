import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DESK_TOASTER_MOBILE_OFFSET,
  DESK_TOASTER_OFFSET,
  DESK_TOASTER_PHONE_QUERY,
  DESK_TOASTER_POSITION,
  deskStackPosition,
  DESK_TOAST_LIFT,
} from "./desk-toast.ts";

/**
 * Where a toast sits, and what it is allowed to cover (unit FB5, item M6).
 *
 * The desk had no toast layer at all until FB5; when one was added it went to
 * `top-right`, which on this desk is the row menus and the workbench's stage
 * controls. It also took pointer events for its whole region, so the blank
 * space beside a card ate presses meant for the page under it.
 *
 * The geometry is asserted here as DATA -- the same values `desk-toaster.tsx`
 * hands sonner, and the same number `desk-astra.css` declares for its phone
 * rule. That the component really passes them is asserted where it is really
 * mounted: `scripts/fb5-desk-toast.test.mjs` renders the live `DeskToaster` in
 * the in-process DOM and reads `data-y-position` and `--offset-bottom` off the
 * element sonner builds.
 *
 * THE MUTATIONS THAT MATTER. Setting `DESK_TOASTER_POSITION` back to
 * "top-right" fails the first case; dropping the lift to 0 fails the second;
 * the `pointer-events` rules are pinned from the stylesheet itself, so removing
 * `none` from the region or `auto` from the buttons fails the last two.
 */

const CSS = readFileSync(new URL("../desk-astra.css", import.meta.url), "utf8");

/** The declaration block for one selector, whitespace-normalised. */
function block(selector: string, source = CSS): string {
  const at = source.indexOf(selector);
  assert.ok(at >= 0, `the stylesheet has no rule for ${selector}`);
  const open = source.indexOf("{", at);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

describe("where the toast stack sits", () => {
  it("is anchored bottom-left, where the desk has nothing", () => {
    assert.equal(DESK_TOASTER_POSITION, "bottom-left");
  });

  it("clears the publish bar and the unsaved bar with its lift", () => {
    /*
      Both bars are a 44px button inside ~14px of padding either side, and both
      are pinned to the bottom of the viewport, so the clear height is at least
      88px. This is the assertion that fails if someone lowers the number.
    */
    assert.ok(
      DESK_TOAST_LIFT >= 88,
      `the lift (${DESK_TOAST_LIFT}px) is under the tallest bottom bar and would cover it`,
    );
    assert.equal(DESK_TOASTER_OFFSET.bottom, DESK_TOAST_LIFT);
    assert.equal(DESK_TOASTER_MOBILE_OFFSET.top, DESK_TOAST_LIFT);
  });

  it("clears the nav, whatever width it is", () => {
    /*
      `--desk-nav-w` is 230px, 206px under 1200px and 0px on a phone (where the
      nav is off-canvas), so a fixed left offset is wrong at two of the three.
    */
    assert.match(String(DESK_TOASTER_OFFSET.left), /var\(--desk-nav-w/);
  });

  it("hangs from the top on a phone, below the header", () => {
    /*
      The edge is sonner's `data-y-position`, which only the `position` prop
      writes -- so this is a prop, not a stylesheet rule. An earlier cut moved
      the box with CSS and left the attribute saying bottom; measured in a
      390px frame, sonner laid the card out bottom-anchored and it landed at
      y=28px, over the phone header.
    */
    assert.equal(deskStackPosition(false), "bottom-left");
    assert.equal(deskStackPosition(true), "top-left");
    assert.ok(DESK_TOAST_LIFT > 72, "the phone offset is not larger than it was");
    // Both edges carry the same clear height, so sonner's own 600px breakpoint
    // disagreeing with this desk's 700px cannot change how far it is lifted.
    assert.equal(DESK_TOASTER_OFFSET.top, DESK_TOAST_LIFT);
    assert.equal(DESK_TOASTER_MOBILE_OFFSET.top, DESK_TOAST_LIFT);
    assert.equal(DESK_TOASTER_MOBILE_OFFSET.bottom, DESK_TOAST_LIFT);
    // The query is the desk's own phone breakpoint, not sonner's.
    assert.equal(DESK_TOASTER_PHONE_QUERY, "(max-width: 700px)");
  });

  it("clears the nav by a real gutter on a phone, where the nav is off-canvas", () => {
    /*
      The left offset is `calc(var(--desk-nav-w, 0px) + 16px)`, and that
      variable is the stylesheet's -- 230px, 206px under 1200px, and 0px at the
      phone breakpoint. Pinned here because a `--desk-nav-w` that stopped being
      zeroed would push the phone stack off the right of a 390px frame.
    */
    assert.match(
      CSS,
      /@media \(max-width: 700px\) \{\s*\.desk-ltr\.astra \{[^}]*--desk-nav-w:\s*0px/,
      "the phone breakpoint no longer zeroes --desk-nav-w, so the stack's left offset is not a gutter",
    );
    assert.equal(DESK_TOASTER_MOBILE_OFFSET.left, 16);
    /*
      And the clearance is NOT a stylesheet value: one authority for the number
      that decides whether a toast covers the publish bar.
    */
    assert.doesNotMatch(CSS, /--desk-toast-lift/, "the stylesheet has a second copy of the lift");
  });
});

describe("what a toast is allowed to cover", () => {
  it("lets presses through the region and the card", () => {
    assert.match(block(".desk-ltr .desk-toaster-host"), /pointer-events:\s*none/);
    assert.match(block(".desk-ltr .desk-toaster"), /pointer-events:\s*none/);
  });

  it("takes them back for the two things an editor presses", () => {
    assert.match(block(".desk-ltr .desk-toaster [data-button]"), /pointer-events:\s*auto/);
    assert.match(block(".desk-ltr .desk-toaster [data-close-button]"), /pointer-events:\s*auto/);
  });
});
