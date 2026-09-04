import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalPublicUrl,
  classifyFetchedPage,
  classifyHttpStatus,
  classifySearchHtml,
  looksLikeSoft404,
} from "./fetch-outcome.ts";

describe("classifyHttpStatus", () => {
  it("keeps 404/410 as not-found, not success", () => {
    assert.equal(classifyHttpStatus(404), "not-found");
    assert.equal(classifyHttpStatus(410), "not-found");
    assert.equal(classifyHttpStatus(500), "fetch-failed");
    assert.equal(classifyHttpStatus(0), "fetch-failed");
    assert.equal(classifyHttpStatus(200), null);
  });
});

describe("looksLikeSoft404", () => {
  it("flags generic not-found templates on HTTP 200", () => {
    assert.equal(looksLikeSoft404("Page not found", "The page you requested does not exist."), true);
    assert.equal(
      looksLikeSoft404("City of Longmont Water Quality Report 2026", "Nitrate at the treatment plant was 0.4 mg/L. ".repeat(40)),
      false,
    );
  });
});

describe("classifyFetchedPage", () => {
  it("records disappearance when a previously fetched document 404s", () => {
    assert.equal(
      classifyFetchedPage({
        status: 404,
        title: "Not Found",
        text: "",
        priorHash: "abc",
        priorStatus: 200,
        newHash: "missing",
      }),
      "removed",
    );
  });

  it("does not call a first-seen 404 a disappearance", () => {
    assert.equal(
      classifyFetchedPage({ status: 404, title: "Not Found", text: "", newHash: "missing" }),
      "not-found",
    );
  });

  it("treats a soft-404 after a real capture as removed, not changed", () => {
    assert.equal(
      classifyFetchedPage({
        status: 200,
        title: "404 Not Found",
        text: "The page you requested cannot be found.",
        priorHash: "abc",
        priorStatus: 200,
        newHash: "different",
      }),
      "removed",
    );
  });

  it("distinguishes unchanged from materially changed", () => {
    assert.equal(
      classifyFetchedPage({
        status: 200,
        title: "Report",
        text: "hello civic document body that is long enough to parse",
        priorHash: "same",
        newHash: "same",
      }),
      "unchanged",
    );
    assert.equal(
      classifyFetchedPage({
        status: 200,
        title: "Report",
        text: "hello civic document body that is long enough to parse",
        priorHash: "old",
        priorStatus: 200,
        newHash: "new",
      }),
      "changed",
    );
  });

  it("F2: marks a nav-only page failed by EXTRACTED length, not raw stripped length", () => {
    // A nav-only page: extraction comes up empty even though the raw stripped
    // HTML was thousands of chars of menu. Keyed off the extracted `text`,
    // this is a failed capture, not the article.
    assert.equal(
      classifyFetchedPage({
        status: 200,
        title: "City of Longmont",
        text: "",
        rawText: "Home About Services Departments Contact ".repeat(200),
        newHash: "x",
      }),
      "parse-failed",
    );
  });

  it("F2: keeps a small but real article (short extracted body is not a failure)", () => {
    assert.equal(
      classifyFetchedPage({
        status: 200,
        title: "Council approves budget",
        text: "The council approved the 2027 budget 5-2 on Tuesday night.",
        newHash: "y",
      }),
      "fetched",
    );
  });
});

describe("classifySearchHtml", () => {
  it("distinguishes failure from zero results", () => {
    assert.equal(classifySearchHtml(500, "error", 0), "SEARCH_FAILED_PROVIDER");
    assert.equal(classifySearchHtml(403, "nope", 0), "SEARCH_BLOCKED");
    assert.equal(classifySearchHtml(429, "slow", 0), "SEARCH_BLOCKED");
    assert.equal(classifySearchHtml(408, "", 0), "SEARCH_TIMEOUT");
    assert.equal(classifySearchHtml(0, "", 0), "SEARCH_FAILED_NETWORK");
    assert.equal(
      classifySearchHtml(200, "please verify you are a robot captcha", 0),
      "SEARCH_BLOCKED",
    );
    assert.equal(classifySearchHtml(200, "<html></html>", 0), "SEARCH_FAILED_PARSE");
    assert.equal(
      classifySearchHtml(200, "<html>" + "x".repeat(600) + " no results matched</html>", 0),
      "SEARCH_SUCCESS_ZERO_RESULTS",
    );
    assert.equal(classifySearchHtml(200, "<html>results</html>", 3), "SEARCH_SUCCESS_RESULTS");
  });
});

describe("canonicalPublicUrl", () => {
  it("drops tracking params, www, and fragments", () => {
    assert.equal(
      canonicalPublicUrl("https://WWW.Example.com/path/?utm_source=x&id=1#top"),
      "https://example.com/path?id=1",
    );
  });
});
