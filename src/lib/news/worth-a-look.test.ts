import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankWorthItems, presentWorthItem, presentWorthItems, type WorthSeed } from "./worth-a-look.ts";

/**
 * UX-003 (Critical): an outside audit found Dark Desk cards rendering
 * internal template strings as their headlines. Observed titles included
 * "linked from" and "Discovered this hop — fetch next" verbatim; every
 * card's two summary lines read "Why it matters — linked from" and "What
 * changed — linked from" — a label with nothing after it, because the old
 * cleanup stripped the URL out of "Attachment/document link on <url>"
 * *before* replacing the phrase, throwing away the very thing the sentence
 * was supposed to name. Several cards were exact duplicates.
 *
 * `rankWorthItems`/`presentWorthItem`/`presentWorthItems` are pure — no
 * database, no provider, no browser — so these drive the real rendering
 * code with the exact raw `frontier_items.why` shapes `investigate.ts`
 * writes (see the `persistDiscovery` calls in investigate.ts around lines
 * 1899, 1915, 1962 and 1979) and check what a reader would actually see.
 */

const ATTACHMENT_URL = "https://www.linkedin.com/company/datum-engineers";

describe("worth-a-look card text (UX-003)", () => {
  it("never lets 'Attachment/document link on <url>' collapse to a bare 'linked from'", () => {
    const [card] = rankWorthItems({
      frontier: [
        {
          label: ATTACHMENT_URL,
          kind: "url",
          why: `Attachment/document link on ${ATTACHMENT_URL}`,
          status: "open",
          closed_reason: null,
        },
      ],
    }).map(presentWorthItem);

    for (const field of [card!.title, card!.happened, card!.why] as const) {
      assert.notEqual(field.trim().toLowerCase(), "linked from", `"${field}" is a dangling template fragment`);
      assert.ok(field.trim().length > 0, "no field may be blank");
    }
    // The point of the sentence is to say where the link came from — that
    // information (the source, here LinkedIn) must survive into the text.
    assert.match(`${card!.happened} ${card!.why}`, /linkedin|document/i);
  });

  it("never lets the raw 'Discovered this hop — fetch next' breadcrumb reach the screen", () => {
    const url = "https://example.gov/notice";
    const [card] = rankWorthItems({
      frontier: [
        { label: url, kind: "url", why: "Discovered this hop — fetch next", status: "open", closed_reason: null },
      ],
    }).map(presentWorthItem);

    for (const field of [card!.title, card!.happened, card!.why] as const) {
      assert.doesNotMatch(field, /discovered this hop/i, `"${field}" leaked the engine's own breadcrumb`);
    }
  });

  it("never lets a 'Fetch ... deferred' or OCR breadcrumb through unrewritten either", () => {
    const [deferred] = rankWorthItems({
      frontier: [
        {
          label: "https://example.gov/packet.pdf",
          kind: "url",
          why: "Fetch timeout — deferred, not closed",
          status: "open",
          closed_reason: null,
        },
      ],
    }).map(presentWorthItem);
    assert.doesNotMatch(deferred!.happened, /deferred, not closed/i);
    assert.doesNotMatch(deferred!.why, /deferred, not closed/i);

    const [ocr] = rankWorthItems({
      frontier: [
        {
          label: "https://example.gov/scan.pdf",
          kind: "url",
          why: "Scanned or image-only document — OCR incomplete; keep investigating",
          status: "open",
          closed_reason: null,
        },
      ],
    }).map(presentWorthItem);
    assert.doesNotMatch(ocr!.happened, /OCR incomplete/i);
    assert.doesNotMatch(ocr!.why, /OCR incomplete/i);
  });

  it("collapses cards that present identically instead of showing exact duplicates", () => {
    // Two separate discovery rows for the same finding — this is exactly the
    // shape the audit saw ("several cards were exact duplicates"): distinct
    // engine records that read as the same card once written for an editor.
    const dup = (id: string): WorthSeed => ({
      id,
      kind: "url",
      title: "A record worth checking",
      happened: "This turned up while Dark Desk was reviewing a public page.",
      why: "Dark Desk found this while following an earlier record; nobody has verified it yet.",
      evidence: "https://example.gov/a",
      source_url: "https://example.gov/a",
      question: "What public record would confirm or contradict this?",
      seed: "seed",
      priority: 10,
    });
    const cards = presentWorthItems([dup("frontier:url:a"), dup("frontier:url:b")]);
    assert.equal(cards.length, 1, "identical presented cards must not both reach the screen");
  });

  it("still renders a legitimate, well-formed card unchanged", () => {
    const [card] = rankWorthItems({
      monitors: [{ url: "https://longmontcolorado.gov/agenda", title: "Council agenda", last_outcome: "removed" }],
    }).map(presentWorthItem);
    assert.match(card!.title, /council agenda|city of longmont/i);
    assert.ok(card!.why.length > 10);
  });
});
