import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { FormError } from "./form-error.ts";

const render = (props: Parameters<typeof FormError>[0]) =>
  renderToStaticMarkup(createElement(FormError, props));

const loginSource = readFileSync(new URL("../routes/login.tsx", import.meta.url), "utf8");

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

describe("the sign-in screen's own errors go through FormError", () => {
  it("renders the form error line -- setup, sign-in, password mismatch -- through FormError", () => {
    const block = loginSource.slice(
      loginSource.indexOf("{error ? ("),
      loginSource.indexOf("{error ? (") + 400,
    );
    assert.match(
      block,
      /<FormError className="border border-rust\/40 bg-paper-2 px-3 py-2 text-sm text-ink">/,
      "the sign-in/setup error line is no longer an announced FormError",
    );
    assert.doesNotMatch(
      loginSource,
      // The same class on a plain `<p>` is still the un-announced line -- note
      // the dead-invite notice above the form wears this class too, so the
      // check pins the paragraph that carries `{error}` rather than the class.
      /<p className="border border-rust\/40 bg-paper-2 px-3 py-2 text-sm text-ink">\s*\{error\}/,
      "the sign-in/setup error line is still a plain, unannounced paragraph",
    );
  });

  it("announces the refused recovery code, and reveals the temporary password as a status", () => {
    assert.match(
      loginSource,
      /\{error \? <FormError className="text-sm text-rust">\{error\}<\/FormError> : null\}/,
    );
    assert.match(loginSource, /<FormError role="status">\s*One-time temporary password:/);
  });

  /*
    The same check UX-2 asks for, from the screen's side: the claimed-desk
    branch names the one failure line, and the missing-account string it used to
    reach for is gone. Point this back at the old text and this fails too.
  */
  it("shows one claimed-desk failure line, and does not ask the missing-account string", () => {
    assert.match(loginSource, /taken\.signInFailed/);
    assert.doesNotMatch(loginSource, /taken\.unknownEmail/);
  });
});
