import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  coerceScanTopic,
  parseScanResult,
  previousScanNeedsReread,
  shouldCommitFetchHashes,
} from "./schema.ts";

describe("parseScanResult", () => {
  it("keeps good leads when one sibling has a bad topic string", () => {
    const parsed = parseScanResult({
      editor_summary: "Council packet is up.",
      leads: [
        {
          headline: "Council takes up the water plant",
          why: "Vote is Tuesday",
          topic: "council|budget|housing|utilities|schools|planning|infrastructure|elections",
          source_urls: ["https://www.longmontcolorado.gov/agenda"],
          evidence: "packet posted",
          newsworthiness: 16,
        },
        {
          headline: "School board work session",
          why: "Budget work session Thursday",
          topic: "schools",
          newsworthiness: 11,
        },
        { headline: "", why: "drop me" },
      ],
    });
    assert.equal(parsed.parseError, null);
    assert.equal(parsed.leads.length, 2);
    assert.equal(parsed.leads[0]!.topic, "council");
    assert.equal(parsed.leads[1]!.topic, "schools");
  });

  it("does not dump the whole scan when more than 8 leads come back", () => {
    const leads = Array.from({ length: 11 }, (_, i) => ({
      headline: `Lead ${i + 1} from the packet`,
      topic: "council",
      newsworthiness: 10,
    }));
    const parsed = parseScanResult({ editor_summary: "Busy night.", leads });
    assert.equal(parsed.parseError, null);
    assert.equal(parsed.leads.length, 11);
  });

  it("records a parse error on prose instead of silently filing zero leads", () => {
    const parsed = parseScanResult("Sorry, I could not find news.");
    assert.match(parsed.parseError ?? "", /usable JSON/i);
    assert.equal(parsed.leads.length, 0);
  });

  it("keeps leads with missing or invalid scores and tells the editor they rank at zero", () => {
    const parsed = parseScanResult({
      editor_summary: "Two useful notices were filed.",
      leads: [
        { headline: "Missing score", topic: "council" },
        { headline: "Numeric string score", topic: "schools", newsworthiness: "12" },
        { headline: "Out of range score", topic: "council", newsworthiness: 99 },
        { headline: "Decimal score", topic: "schools", newsworthiness: 12.5 },
      ],
    });
    assert.equal(parsed.parseError, null);
    assert.deepEqual(parsed.leads.map((lead) => lead.newsworthiness), [0, 0, 0, 0]);
    assert.match(parsed.editor_summary, /4 filed leads had missing or invalid newsworthiness scores/i);
    assert.match(parsed.editor_summary, /kept at 0\/20/i);
  });

  it("keeps an explicit numeric zero as an intentional low rank without a warning", () => {
    const parsed = parseScanResult({
      editor_summary: "One low-priority notice was filed.",
      leads: [{ headline: "Explicit low priority", topic: "council", newsworthiness: 0 }],
    });
    assert.equal(parsed.leads[0]!.newsworthiness, 0);
    assert.equal(parsed.editor_summary, "One low-priority notice was filed.");
  });

  it("keeps the ranking diagnostic visible when the model summary fills its limit", () => {
    const parsed = parseScanResult({
      editor_summary: "x".repeat(2000),
      leads: [{ headline: "Missing score", topic: "council" }],
    });
    assert.ok(parsed.editor_summary.length <= 2000);
    assert.match(parsed.editor_summary, /Ranking note: 1 filed lead had missing or invalid/i);
    assert.match(parsed.editor_summary.slice(0, 1200), /Ranking note: 1 filed lead had missing or invalid/i);
  });
});

describe("scan fetch hashes", () => {
  it("rereads when the last scan fetched sources and filed nothing", () => {
    assert.equal(previousScanNeedsReread({ leads_created: 0, sources_fetched: 33 }), true);
    assert.equal(previousScanNeedsReread({ leads_created: 4, sources_fetched: 33 }), false);
    assert.equal(previousScanNeedsReread({ leads_created: 0, sources_fetched: 0 }), false);
  });

  it("does not stamp source hashes after a failed writing pass", () => {
    assert.equal(shouldCommitFetchHashes({ aiOk: false, parseError: null }), false);
    assert.equal(
      shouldCommitFetchHashes({ aiOk: true, parseError: "Writing pass returned no usable JSON." }),
      false,
    );
    assert.equal(shouldCommitFetchHashes({ aiOk: true, parseError: null }), true);
  });

  it("maps a pipe-separated topic example to a real topic", () => {
    assert.equal(coerceScanTopic("council|budget|housing"), "council");
    assert.equal(coerceScanTopic("Schools"), "schools");
  });
});
