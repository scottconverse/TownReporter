import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormError } from "./form-error.ts";

const render = (props: Parameters<typeof FormError>[0]) =>
  renderToStaticMarkup(createElement(FormError, props));

describe("FormError", () => {
  /*
    UX-3: "Passwords do not match.", "Wrong setup code." and every failed
    sign-in on /login rendered as a plain `<p>` with no `role` and no live
    ancestor -- a screen reader was told nothing, while Scan and Add-lead
    errors were announced. This is the check that the one component those lines
    now share actually carries the role: delete `role="alert"` from the
    component and this test is the thing that fails.
  */
  it("announces itself as an alert by default", () => {
    const html = render({ children: "Passwords do not match." });
    assert.match(html, /<p[^>]*\brole="alert"/);
    assert.match(html, /Passwords do not match\./);
    // The pairing the Opinion notices and `Notice` already carry for UIUX-03:
    // a region mounted at the same moment as its text still needs to say it is
    // live, and `aria-atomic` reads the line as one message.
    assert.match(html, /role="alert"[\s\S]{0,120}aria-live="assertive"/);
    assert.match(html, /aria-atomic="true"/);
  });

  it("announces a reveal as a status instead, when asked", () => {
    const html = render({ children: "One-time temporary password: abcd-efgh", role: "status" });
    assert.match(html, /<p[^>]*\brole="status"/);
    assert.match(html, /role="status"[\s\S]{0,120}aria-live="polite"/);
    assert.doesNotMatch(html, /role="alert"/);
  });

  it("passes the call site's error styling through and invents none", () => {
    // The line every call site already drew keeps its exact classes...
    assert.match(
      render({ children: "Could not save.", className: "text-sm text-rust" }),
      /<p[^>]*\bclass="text-sm text-rust"/,
    );
    // ...and a spot that had no class gets none, so nothing is restyled.
    const bare = render({ children: "One-time temporary password: abcd", role: "status" });
    assert.doesNotMatch(bare, /class=/);
  });
});
