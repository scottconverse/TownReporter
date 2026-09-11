import assert from "node:assert/strict";
import test from "node:test";
import { extractLongmontSportsRegistrationDeadlines } from "./routine-notice-registration.ts";

const provenance = {
  newsroomId: 1,
  sourceId: 2,
  sourceUrl: "https://longmontcolorado.gov/wp-content/uploads/2026/07/f26_sports.pdf",
  policyRevision: 3,
  captureEventId: 4,
  artifactVersionId: 5,
  contentHash: "abc",
};

test("maps an explicit basketball registration deadline from the brochure page", () => {
  const rows = extractLongmontSportsRegistrationDeadlines(
    {
      pages: [
        {
          page: 2,
          text: "Fall 2026 Youth Basketball League: Grades 3-12. Practice two hours per week. Registration deadline is Dec 13. ... bit.ly/recreationregistration",
        },
      ],
    },
    provenance,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, "parsed");
  if (rows[0]?.status === "parsed" && rows[0].validation.valid) {
    assert.equal(rows[0].validation.notice.normalizedFields.program, "Youth Basketball League");
    assert.equal(rows[0].validation.notice.normalizedFields.eligibility, "Grades 3-12");
    assert.equal(rows[0].validation.notice.normalizedFields.deadline, "2026-12-13");
    assert.equal(
      rows[0].validation.notice.normalizedFields.registrationUrl,
      "https://bit.ly/recreationregistration",
    );
    assert.match(rows[0].locator, /page\[2\]/);
    assert.match(rows[0].validation.notice.fields.deadline.locator, /Registration deadline/);
  }
});

test("does not confuse a program start or registration opening with a deadline", () => {
  const rows = extractLongmontSportsRegistrationDeadlines(
    {
      pages: [
        {
          page: 2,
          text: "Fall 2026 Youth Basketball League: Grades 3-12. Dates: Jan 11-Feb 27. Registration opens Aug 11. bit.ly/recreationregistration",
        },
      ],
    },
    provenance,
  );
  assert.equal(rows.length, 0);
});

test("refuses the same brochure shape without a year or registration URL", () => {
  const noYear = extractLongmontSportsRegistrationDeadlines(
    { pages: [{ page: 2, text: "Youth Basketball League: Grades 3-12. Registration deadline is Dec 13." }] },
    provenance,
  );
  assert.equal(noYear.length, 0);
  const noUrl = extractLongmontSportsRegistrationDeadlines(
    { pages: [{ page: 2, text: "Fall 2026 Youth Basketball League: Grades 3-12. Registration deadline is Dec 13." }] },
    provenance,
  );
  assert.equal(noUrl.length, 0);
});

test("fails closed for a different source and an impossible calendar date", () => {
  const text = "Fall 2026 Youth Basketball League: Grades 3-12. Registration deadline is Feb 31. bit.ly/recreationregistration";
  assert.equal(
    extractLongmontSportsRegistrationDeadlines(
      { pages: [{ page: 2, text }] },
      { ...provenance, sourceUrl: "https://longmontcolorado.gov/events/" },
    ).length,
    0,
  );
  const malformed = extractLongmontSportsRegistrationDeadlines(
    { pages: [{ page: 2, text }] },
    provenance,
  );
  assert.equal(malformed[0]?.status, "refused");
});
