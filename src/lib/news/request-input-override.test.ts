import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  updateArticleHeadlineInput,
  draftEditInput,
  meetingArticleReviewInput,
  LIMITS,
  captureTakedownInput,
  changePublishedStoryInput,
  correctionInput,
  editorialStartInput,
  importStoriesInput,
  outletInput,
} from "./request-input.ts";

/**
 * The wire half of the audit-override work.
 *
 * WHAT THIS FILE IS FOR. Every "audit" item that turned a hard refusal into a
 * warning the editor can answer works the same way: the core answers
 * `{ ok: false, warning: { key, sentence } }`, the screen shows the sentence,
 * and the SAME request is sent again with `override: [key]`. For that retry to
 * reach the core at all, the request boundary in front of it must already do
 * two things:
 *
 *   1. carry `override` through, as the editor's own list of keys, and
 *   2. NOT refuse the material the core is about to warn about -- a boundary
 *      that kept the old `max()` would answer with a zod dump before the core
 *      ever saw the oversize value, and the warning could never fire.
 *
 * Both are asserted per request below: the key survives `parse`, and the
 * material the core now warns about (`correctionInput.storyBody` past the old
 * 20-million ceiling, and the opinion subject / askedFor / document list) gets
 * through. The refusals that are NOT warnings -- malformed ids, unknown status
 * values, a non-list override -- stay refusals, and are asserted too so a later
 * loosening cannot pass unnoticed.
 *
 * The keys here are the shape a retry actually sends: the exact string the
 * core's warning named. `src/lib/news/override.ts` does the asking and the
 * auditing; this file only proves the boundary lets the answer through.
 */

const x = (n: number) => "x".repeat(n);

type Carrier = {
  /** The schema, so a failure names it. */
  name: string;
  /** A real payload for this request, without the override key. */
  valid: Record<string, unknown>;
  parse: (raw: unknown) => unknown;
};

const CARRIERS: Carrier[] = [
  {
    name: "correctionInput",
    valid: { articleSlug: "the-budget-passes", body: "The vote was 5-2, not 6-1." },
    parse: (raw) => correctionInput.parse(raw),
  },
  {
    name: "importStoriesInput",
    valid: { text: "A report to import.", stories: [] },
    parse: (raw) => importStoriesInput.parse(raw),
  },
  {
    name: "outletInput",
    valid: { leadId: 42, outlet: "The Denver Post" },
    parse: (raw) => outletInput.parse(raw),
  },
  {
    name: "editorialStartInput",
    valid: { subject: "The 2027 budget" },
    parse: (raw) => editorialStartInput.parse(raw),
  },
  {
    name: "captureTakedownInput",
    valid: { versionId: 3, reason: "The publisher asked.", removeLink: false },
    parse: (raw) => captureTakedownInput.parse(raw),
  },
  {
    name: "changePublishedStoryInput",
    valid: { articleId: 9, dek: "The approved plan.", topic: "council" },
    parse: (raw) => changePublishedStoryInput.parse(raw),
  },
];

describe("every request that can be overridden carries the key back", () => {
  it("passes an arbitrary outlet name and its full warning key back without clipping either", () => {
    const outlet = "An outlet name ".repeat(30);
    const key = `named-outlet:${outlet.trim()}`;
    const result = outletInput.parse({leadId: 42, outlet, override: [key]});
    assert.equal(result.outlet, outlet);
    assert.deepEqual(result.override, [key]);
  });
  for (const carrier of CARRIERS) {
    it(`${carrier.name} keeps the override list an accepted retry sends`, () => {
      const parsed = carrier.parse({ ...carrier.valid, override: ["some-warning-key"] }) as {
        override?: string[];
      };
      assert.deepEqual(
        parsed.override,
        ["some-warning-key"],
        `${carrier.name} dropped the override`,
      );
    });

    it(`${carrier.name} leaves a request that says nothing about overriding alone`, () => {
      const parsed = carrier.parse(carrier.valid) as Record<string, unknown>;
      assert.equal("override" in parsed, false, `${carrier.name} invented an override`);
    });
  }
});

describe("the boundary passes the material the core warns about", () => {
  it("lets a corrected story text past the old 20-million ceiling reach the core", () => {
    const storyBody = x(LIMITS.storyText + 1);
    const parsed = correctionInput.parse({
      articleSlug: "the-budget-passes",
      body: "The fee was $2,400, not $4,200.",
      alsoFixBody: true,
      storyBody,
      override: ["correction-fix-too-long"],
    });
    // Not clipped, not refused: the core sees the whole text and answers with
    // its warning, which is what the override key above is answering.
    assert.equal(parsed.storyBody?.length, LIMITS.storyText + 1);
    assert.deepEqual(parsed.override, ["correction-fix-too-long"]);
  });

  it("still refuses a corrected story text that is not text at all", () => {
    assert.throws(() =>
      correctionInput.parse({ articleSlug: "s", body: "b", alsoFixBody: true, storyBody: 7 }),
    );
  });

  it("leaves the short-note minimum to the core, so its warning can fire", () => {
    // The core warns (and the dialog offers "Post anyway"); the boundary must
    // not add a `.min()` that would disable the press before the warning.
    assert.equal(correctionInput.parse({ articleSlug: "s", body: "" }).body, "");
    assert.equal(correctionInput.parse({ articleSlug: "s", body: "ok" }).body, "ok");
  });

  it("lets opinion subject, askedFor and the document list past the old ceilings", () => {
    const material = x(LIMITS.storyText + 1);
    const documentIds = Array.from({ length: LIMITS.documentIds + 5 }, (_, i) => `doc-${i}`);
    const parsed = editorialStartInput.parse({
      subject: material,
      askedFor: material,
      documentIds,
      override: ["opinion-material-caps"],
    });
    assert.equal(parsed.subject.length, LIMITS.storyText + 1);
    assert.equal(parsed.askedFor?.length, LIMITS.storyText + 1);
    assert.equal(parsed.documentIds?.length, LIMITS.documentIds + 5);
    assert.deepEqual(parsed.override, ["opinion-material-caps"]);
  });

  it("keeps the override key on an opinion retry under the document warning", () => {
    const parsed = editorialStartInput.parse({
      subject: "The 2027 budget",
      documentIds: Array.from({ length: 21 }, (_, i) => `doc-${i}`),
      override: ["opinion-document-count"],
    });
    assert.deepEqual(parsed.override, ["opinion-document-count"]);
  });
});

describe("a live-story change keeps its blanks and its size out of the boundary", () => {
  it("lets a blank summary through, because only the core may refuse one", () => {
    // The coordinator's own correction: a blank DEK is not on the KEEP list. A
    // blank headline or body still is, and that refusal lives in the core.
    assert.equal(changePublishedStoryInput.parse({ articleId: 9, dek: "" }).dek, "");
    assert.equal(
      changePublishedStoryInput.parse({ articleId: 9, body: "" }).body,
      "",
      "a blank body is the core's KEEP refusal, not this schema's",
    );
  });

  it("does not add a second body-size gate to a live rewrite", () => {
    const body = x(LIMITS.storyText + 1);
    assert.equal(
      changePublishedStoryInput.parse({ articleId: 9, body }).body?.length,
      LIMITS.storyText + 1,
    );
  });
});

describe("malformed ids, roles and overrides are still refused", () => {
  it("refuses an id that is not a positive 32-bit integer", () => {
    for (const bad of [-1, 0, "42", 1.5, Number.NaN, null]) {
      assert.throws(
        () => outletInput.parse({ leadId: bad, outlet: "The Denver Post" }),
        `outletInput accepted leadId ${String(bad)}`,
      );
      assert.throws(
        () => updateArticleHeadlineInput.parse({ articleId: bad, headline: "h" }),
        `updateArticleHeadlineInput accepted articleId ${String(bad)}`,
      );
      assert.throws(
        () => changePublishedStoryInput.parse({ articleId: bad, dek: "A new summary." }),
        `changePublishedStoryInput accepted articleId ${String(bad)}`,
      );
    }
    assert.throws(() => editorialStartInput.parse({ subject: "s", retryRequestId: -4 }));
    assert.throws(() =>
      draftEditInput.parse({ leadId: "42", headline: "h", dek: "d", body: "b", topic: "council" }),
    );
  });

  it("refuses a document list that is not a list of ids", () => {
    assert.throws(() => editorialStartInput.parse({ subject: "s", documentIds: [7] }));
    assert.throws(() => editorialStartInput.parse({ subject: "s", documentIds: "doc-1" }));
  });

  it("refuses a status or decision value the schema does not name", () => {
    assert.throws(() =>
      draftEditInput.parse({
        leadId: 5,
        headline: "h",
        dek: "d",
        body: "b",
        topic: "council",
        evidenceDecision: "maybe",
      }),
    );
    assert.throws(() =>
      meetingArticleReviewInput.parse({
        reviewId: 3,
        resolution: "maybe",
        acceptedArtifactId: 8,
        note: "n",
        confirmedSegmentIndices: [],
      }),
    );
    assert.throws(() => importStoriesInput.parse({ text: "t", tool: "x", stories: "not-a-list" }));
  });

  it("refuses an override that is not a list of string keys", () => {
    for (const bad of ["a-key", { key: "a-key" }, 7, [7], [["nested"]]]) {
      assert.throws(
        () => correctionInput.parse({ articleSlug: "s", body: "b", override: bad }),
        `correctionInput accepted override ${JSON.stringify(bad)}`,
      );
    }

  });
});
