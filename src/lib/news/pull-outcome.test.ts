import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  failureSummary,
  finalPullText,
  providerFailureNotes,
  providerLabel,
  pullTodoReason,
} from "./pull-outcome.ts";

/*
  Point 1 and point 3 of unit PULL1, as pure fixtures.

  The live report: three Pulls on Story lead 406 each ended "Finished · no
  relevant public document found" while Exa had answered HTTP 429 and
  DuckDuckGo had answered SEARCH_BLOCKED. The sentence said the record was not
  there; the truth was that nobody had been asked. These cases are that report,
  one provider at a time.
*/

const LIVE_FAILURES = [
  { provider: "exa-mcp", state: "SEARCH_BLOCKED", error: "HTTP 429" },
  { provider: "ddg-html", state: "SEARCH_BLOCKED", error: "SEARCH_BLOCKED" },
  { provider: "ddg-lite", state: "SEARCH_BLOCKED", error: "SEARCH_BLOCKED" },
];

describe("providerLabel", () => {
  it("names the providers the editor knows", () => {
    assert.equal(providerLabel("exa-mcp"), "Exa");
    assert.equal(providerLabel("ddg-html"), "DuckDuckGo");
    assert.equal(providerLabel("ddg-lite"), "DuckDuckGo Lite");
    assert.equal(providerLabel("DuckDuckGo"), "DuckDuckGo");
    assert.equal(providerLabel("halo-gateway"), "the search gateway");
  });

  it("never prints an empty name", () => {
    assert.equal(providerLabel(""), "a search provider");
  });
});

describe("finalPullText", () => {
  it("says search was unavailable when nothing answered and providers refused", () => {
    const text = finalPullText({
      documents: 0,
      failures: providerFailureNotes(LIVE_FAILURES),
      answered: false,
    });
    assert.match(text, /search is unavailable/i);
    assert.match(text, /Exa: rate limited/);
    assert.match(text, /DuckDuckGo: blocked this computer/);
    assert.match(text, /again/i, "the editor is told a retry will probably repeat it");
    assert.doesNotMatch(text, /no relevant public document found/i);
  });

  it("keeps the old sentence for a pull whose searches really ran and found nothing", () => {
    assert.equal(
      finalPullText({ documents: 0, failures: [], answered: true }),
      "Finished · no relevant public document found",
    );
  });

  it("keeps a failed search distinct when another search answered", () => {
    const text = finalPullText({
      documents: 0,
      failures: providerFailureNotes([LIVE_FAILURES[0]!]),
      answered: true,
    });
    assert.match(text, /Failed · some searches could not be completed/);
    assert.match(text, /Exa: rate limited/);
    assert.doesNotMatch(text, /no relevant public document found/i);
  });

  it("still counts the documents when it found some", () => {
    assert.equal(
      finalPullText({ documents: 2, failures: providerFailureNotes(LIVE_FAILURES), answered: false }),
      "Finished · 2 relevant documents saved",
    );
  });

  it("names one provider once, however many queries it failed on", () => {
    const notes = providerFailureNotes([
      LIVE_FAILURES[0]!,
      LIVE_FAILURES[0]!,
      LIVE_FAILURES[1]!,
    ]);
    assert.equal(failureSummary(notes), "Exa: rate limited; DuckDuckGo: blocked this computer");
  });

  it("calls a timeout a provider that did not answer", () => {
    const text = finalPullText({
      documents: 0,
      failures: providerFailureNotes([{ provider: "ddg-html", state: "SEARCH_TIMEOUT" }]),
      answered: false,
    });
    assert.match(text, /DuckDuckGo: did not answer/);
  });
});

describe("pullTodoReason", () => {
  it("stores plain words, not a failure count", () => {
    const reason = pullTodoReason({
      status: "completed",
      failures: providerFailureNotes(LIVE_FAILURES),
      answered: false,
    });
    assert.match(reason, /^search unavailable/);
    assert.match(reason, /Exa: rate limited/);
    assert.doesNotMatch(reason, /provider or page failure/i);
    assert.doesNotMatch(reason, /\b13\b|\d+ provider/);
  });

  it("says the searches ran when they did", () => {
    assert.equal(
      pullTodoReason({ status: "completed", failures: [], answered: true }),
      "no relevant document found",
    );
  });

  it("keeps the deadline and the editor's stop as their own reasons", () => {
    assert.match(pullTodoReason({ status: "deadline", failures: [], answered: false }), /two-minute/);
    assert.match(pullTodoReason({ status: "stopped", failures: [], answered: false }), /stopped/);
  });
});
