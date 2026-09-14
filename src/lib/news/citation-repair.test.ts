import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateCitationReceipts, type FetchedDoc } from "./report.ts";

const URL = "https://longmontcolorado.gov/budget/2027-message.pdf";
const draft = "City Manager Harold Dominguez proposed a $547.5 million budget for 2027.";
const docs: FetchedDoc[] = [{
  url: URL,
  title: "2027 budget message",
  text: "Presented by Harold Dominguez, City Manager. The total proposed 2027 budget is $547.5 million.",
  extras: [],
  version_id: 41,
  capture_event_id: 91,
}];

describe("citation repair receipts", () => {
  it("accepts only an exact draft clause backed by an exact saved-source passage", () => {
    assert.deepEqual(validateCitationReceipts({ receipts: [{
      fact: "Harold Dominguez proposed a $547.5 million budget for 2027.",
      url: URL,
      excerpt: "The total proposed 2027 budget is $547.5 million.",
      kind: "record",
    }] }, draft, docs), [{
      fact: "Harold Dominguez proposed a $547.5 million budget for 2027.",
      url: URL,
      kind: "record",
    }]);
  });

  it("rejects invented facts, invented excerpts, unsaved URLs and uncaptured documents", () => {
    const rows = [
      { fact: "The council adopted the budget.", url: URL, excerpt: docs[0]!.text, kind: "record" },
      { fact: draft, url: URL, excerpt: "The council adopted it unanimously.", kind: "record" },
      { fact: draft, url: "https://example.com/guess", excerpt: docs[0]!.text, kind: "news" },
    ];
    const uncaptured = [{ ...docs[0]!, version_id: null }];
    assert.deepEqual(validateCitationReceipts({ receipts: rows }, draft, docs), []);
    assert.deepEqual(validateCitationReceipts({ receipts: [rows[0]] }, draft, uncaptured), []);
  });
});
