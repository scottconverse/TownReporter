import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyObservation,
  classifyPurpose,
  csvField,
  duplicatePairs,
  healthOf,
  hostOf,
  inventoryRows,
  normalizeUrl,
  purposeReason,
  reviewSource,
  toCsv,
  unverifiedFor,
  urlShape,
  type SourceHealthFacts,
} from "./source-inventory.ts";

/*
  THE SOURCE INVENTORY, pure. The rules pinned here are the ones the brief turns
  on: a quiet source is not dead, a retrieval error is not a verdict on the site,
  a static document is reference material, and a replacement is suggested only
  from a recent, repeated, unreadable run -- never on zero leads.

  THE MUTATION this defends against: change `classifyObservation` to return
  "retrieval-error" for a clean read with no change (lumping "quiet" into
  "broken") and the quiet-vs-error cases below fail.
*/

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-05T12:00:00Z");

function facts(over: Partial<SourceHealthFacts> & { id: number }): SourceHealthFacts {
  return {
    url: "https://city.example.gov/agendas",
    title: `Source ${over.id}`,
    kind: "official",
    tier: "A",
    status: "accepted",
    ...over,
  };
}

describe("source inventory: purpose", () => {
  it("a feed or agenda path is a watch", () => {
    assert.equal(urlShape("https://x.gov/rss.xml"), "feed");
    assert.equal(urlShape("https://x.gov/council/agenda-2026"), "agenda-like");
    assert.equal(classifyPurpose(facts({ id: 1, url: "https://x.gov/rss.xml" })), "watch");
  });

  it("a document or sitemap is reference material BY ADDRESS, with a reason", () => {
    assert.equal(
      classifyPurpose(facts({ id: 2, url: "https://x.gov/minutes.pdf" })),
      "reference",
    );
    assert.equal(purposeReason(facts({ id: 2, url: "https://x.gov/minutes.pdf" })), "document-or-sitemap");
  });

  /*
    THE BUG THIS PINS. A quiet school/news/board page that read cleanly and
    produced nothing is NOT reference material. `last_ok_at` proves a read, not
    staticness. The old code returned "reference" here; it must now be "unknown"
    so the page stays on trial instead of being retired by its own silence.
  */
  it("a bare page read once with no cadence signal is unknown, never reference", () => {
    const quiet = facts({ id: 3, url: "https://x.gov/", last_ok_at: "2026-09-01T00:00:00Z" });
    assert.equal(classifyPurpose(quiet), "unknown");
    assert.equal(purposeReason(quiet), "no-cadence-signal");
    // And the review status is a trial, not a settled reference row.
    assert.equal(reviewSource(quiet, NOW).reviewStatus, "trial");
  });

  it("the editor's recorded purpose outranks every heuristic", () => {
    const factsRow = facts({
      id: 9,
      url: "https://x.gov/minutes.pdf",
      purpose_preference: "watch",
    });
    assert.equal(classifyPurpose(factsRow), "watch");
    assert.equal(purposeReason(factsRow), "editor-set");
  });

  it("a recorded observation of a changed page is a watch even on a static-looking address", () => {
    const observed = facts({ id: 10, url: "https://x.gov/", observed_purpose: "watch" });
    assert.equal(classifyPurpose(observed), "watch");
    assert.equal(purposeReason(observed), "observed-history");
  });

  it("a page that has changed is a watch even if its address looks static", () => {
    assert.equal(
      classifyPurpose(facts({ id: 4, url: "https://x.gov/", new_since_last_pass: 2 })),
      "watch",
    );
  });

  it("a never-checked page with no history is unverified, not guessed", () => {
    assert.equal(healthOf(facts({ id: 5, url: "https://x.gov/news" }), NOW).purpose, "unknown");
  });
});

describe("source inventory: observation keeps quiet apart from broken", () => {
  /*
    THE POINT OF THE NEW VOCABULARY. Without a stored content version, a clean
    read cannot say whether the page's BYTES changed; it can only say that no
    item came out. The old code called that "no-change" -- a byte-level claim
    from a lead count. It must now read "no-new-items".
  */
  it("a clean read with no items and no content fact is 'no-new-items', not 'no-change'", () => {
    assert.equal(
      classifyObservation(
        facts({ id: 1, last_ok_at: "2026-10-05T09:00:00Z", last_fetched_at: "2026-10-05T09:00:00Z" }),
        NOW,
      ),
      "no-new-items",
    );
  });

  it("a clean read that yielded items with no content fact is 'new-items-unknown-content'", () => {
    assert.equal(
      classifyObservation(
        facts({
          id: 1,
          last_ok_at: "2026-10-05T09:00:00Z",
          last_fetched_at: "2026-10-05T09:00:00Z",
          new_since_last_pass: 1,
        }),
        NOW,
      ),
      "new-items-unknown-content",
    );
  });

  it("with a real content comparison, changed/unchanged is claimed honestly", () => {
    const base = {
      id: 1,
      last_ok_at: "2026-10-05T09:00:00Z",
      last_fetched_at: "2026-10-05T09:00:00Z",
      last_hash: "abc123",
    };
    assert.equal(classifyObservation(facts({ ...base, content_version_changed: true }), NOW), "changed-content");
    assert.equal(classifyObservation(facts({ ...base, content_version_changed: false }), NOW), "unchanged-content");
    // A hash present but never compared is NOT a change claim.
    assert.equal(classifyObservation(facts(base), NOW), "no-new-items");
  });

  it("a timeout is a retrieval error; an unparsable page is extraction", () => {
    assert.equal(
      classifyObservation(facts({ id: 1, last_error: "fetch timed out after 20s" }), NOW),
      "retrieval-error",
    );
    assert.equal(
      classifyObservation(facts({ id: 1, last_error: "had almost no readable text" }), NOW),
      "extraction-failure",
    );
  });

  it("a site asking us to wait is 'asked-to-wait', not a failure", () => {
    assert.equal(
      classifyObservation(
        facts({ id: 1, retry_after: new Date(NOW + 3_600_000).toISOString(), last_error: "429" }),
        NOW,
      ),
      "asked-to-wait",
    );
  });
  it("a block outranks a wait; a wait outranks an error", () => {
    assert.equal(
      classifyObservation(
        facts({
          id: 1,
          blocked_at: "2026-10-04T00:00:00Z",
          retry_after: new Date(NOW + 1_000).toISOString(),
          last_error: "403",
        }),
        NOW,
      ),
      "blocked",
    );
  });
});

describe("source inventory: review status never culls on quiet or old errors", () => {
  it("a repeatedly failing, never-read source is a replacement candidate", () => {
    const review = reviewSource(
      facts({ id: 1, consecutive_failures: 5, last_error: "fetch timed out" }),
      NOW,
    );
    assert.equal(review.reviewStatus, "replacement-candidate");
    assert.equal(review.replaceable, true);
  });

  it("old errors alone are NOT a replacement when the row is not failing now", () => {
    const review = reviewSource(
      facts({
        id: 1,
        consecutive_failures: 1,
        last_error: "fetch timed out",
        last_ok_at: new Date(NOW - 10 * DAY).toISOString(),
      }),
      NOW,
    );
    assert.equal(review.replaceable, false);
  });

  it("zero leads (a quiet source) is never a replacement", () => {
    const review = reviewSource(
      facts({ id: 1, last_ok_at: new Date(NOW - 400 * DAY).toISOString(), new_since_last_pass: 0 }),
      NOW,
    );
    assert.notEqual(review.reviewStatus, "replacement-candidate");
  });

  it("a reference document is labelled reference", () => {
    const review = reviewSource(
      facts({
        id: 1,
        url: "https://x.gov/budget.pdf",
        last_ok_at: new Date(NOW - DAY).toISOString(),
      }),
      NOW,
    );
    assert.equal(review.reviewStatus, "reference");
    assert.match(review.note, /Reference material by address/);
  });

  it("a quiet bare page is a trial, not a reference and not retired", () => {
    const review = reviewSource(
      facts({ id: 1, url: "https://school.example.edu/news", last_ok_at: new Date(NOW - 90 * DAY).toISOString() }),
      NOW,
    );
    assert.equal(review.reviewStatus, "trial");
    assert.equal(review.replaceable, false);
    assert.match(review.note, /on trial/);
  });

  it("an unchanged-content page keeps its trial purpose but says the content is unchanged", () => {
    const review = reviewSource(
      facts({
        id: 1,
        url: "https://x.gov/news",
        last_ok_at: new Date(NOW - DAY).toISOString(),
        last_hash: "h",
        content_version_changed: false,
      }),
      NOW,
    );
    // Purpose stays unknown (one unchanged read does not prove the page static),
    // but the note is honest about the content comparison we actually made.
    assert.equal(review.reviewStatus, "trial");
    assert.match(review.note, /unchanged since the last read/);
    assert.equal(review.replaceable, false);
  });
});

describe("source inventory: duplicates", () => {
  it("normalizes www, scheme, trailing slash and tracking params", () => {
    assert.equal(normalizeUrl("http://www.X.gov/a/"), normalizeUrl("https://x.gov/a"));
    assert.equal(
      normalizeUrl("https://x.gov/a?utm_source=n&b=2&a=1"),
      normalizeUrl("https://x.gov/a?a=1&b=2"),
    );
  });

  it("flags the same address twice, keeping the lower id", () => {
    const pairs = duplicatePairs([
      facts({ id: 7, url: "https://x.gov/a" }),
      facts({ id: 3, url: "http://www.x.gov/a/?utm_campaign=z" }),
    ]);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].keepId, 3);
    assert.equal(pairs[0].repeatId, 7);
  });

  it("never calls two different paths a duplicate", () => {
    assert.equal(
      duplicatePairs([
        facts({ id: 1, url: "https://x.gov/a" }),
        facts({ id: 2, url: "https://x.gov/b" }),
      ]).length,
      0,
    );
  });
});

describe("source inventory: the CSV an editor reads", () => {
  it("quotes fields with commas and keeps a header", () => {
    assert.equal(csvField('a,b'), '"a,b"');
    assert.equal(csvField('say "hi"'), '"say ""hi"""');
    const csv = toCsv(
      inventoryRows([facts({ id: 1, url: "https://x.gov/a,b", title: "A, B" })], { nowMs: NOW }),
    );
    assert.match(csv.split("\n")[0], /^id,title,url,/);
    assert.match(csv, /"A, B"/);
  });

  it("names what is still unverified rather than leaving a blank", () => {
    const unverified = unverifiedFor(facts({ id: 1 }));
    assert.ok(unverified.some((line) => /never checked/.test(line)));
    assert.ok(unverified.some((line) => /current live state/.test(line)));
  });

  it("host is lowercased and www-stripped", () => {
    assert.equal(hostOf("https://WWW.X.gov/a"), "x.gov");
  });

  it("carries purpose provenance and content-compared, so a row can be audited", () => {
    const rows = inventoryRows(
      [
        facts({ id: 1, url: "https://x.gov/minutes.pdf" }),
        facts({
          id: 2,
          url: "https://x.gov/news",
          last_ok_at: new Date(NOW - DAY).toISOString(),
          last_hash: "h",
          content_version_changed: true,
        }),
      ],
      { nowMs: NOW },
    );
    const doc = rows.find((r) => r.id === 1)!;
    assert.equal(doc.purposeReason, "document-or-sitemap");
    assert.equal(doc.contentCompared, false);
    const news = rows.find((r) => r.id === 2)!;
    assert.equal(news.observation, "changed-content");
    assert.equal(news.contentCompared, true);
    const csv = toCsv(rows);
    assert.match(csv.split("\n")[0], /purpose,purpose_reason,observation,review_status,content_compared,/);
  });
});
