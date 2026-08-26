import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hostNeedsRendering,
  looksLikeAppShell,
  needsRenderedFetch,
} from "./render-fetch.ts";

describe("rendered fetch detection", () => {
  it("flags Municode and other JS civic hosts", () => {
    assert.equal(
      hostNeedsRendering(new URL("https://library.municode.com/co/longmont/codes/code_of_ordinances")),
      true,
    );
    assert.equal(hostNeedsRendering(new URL("https://longmont.legistar.com/Calendar.aspx")), true);
    assert.equal(hostNeedsRendering(new URL("https://www.longmontcolorado.gov/agendas")), false);
  });

  it("treats the IE9 Municode shell as needing a real browser", () => {
    const shell =
      "Municode Library We're sorry. Internet Explorer 9 and below are no longer supported. Please use a different browser. Google Chrome Mozilla Firefox Microsoft Internet Explorer";
    assert.equal(looksLikeAppShell(shell), true);
    assert.equal(
      needsRenderedFetch(new URL("https://library.municode.com/co/longmont"), shell),
      true,
    );
  });

  it("does not escalate a normal static city page", () => {
    const html = "<html><body><h1>City Council</h1><p>Council meets Tuesday at 7 p.m. at City Hall.</p></body></html>";
    const text = "City Council Council meets Tuesday at 7 p.m. at City Hall.";
    assert.equal(looksLikeAppShell(text, html), false);
    assert.equal(needsRenderedFetch(new URL("https://www.longmontcolorado.gov/council"), text, html), false);
  });
});
