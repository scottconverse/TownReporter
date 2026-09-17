import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractLongmontLeafCollection } from "./routine-notice-waste.ts";

const sourceUrl =
  "https://longmontcolorado.gov/waste-services-trash-recycling-composting/special-services-events/fall-leaf-collection/";
const provenance = {
  newsroomId: 41,
  sourceId: 7,
  sourceUrl,
  policyRevision: 3,
  captureEventId: 11,
  artifactVersionId: 12,
  contentHash: "sha256:captured",
};
const html = `
<div class="content_area">
  <h2>2026 Collection Schedule</h2>
  <ul><li>Leaves will be collected at residences located<b> North of 9th Avenue Oct. 26 &#8211; Oct. 30<br /></b></li></ul>
  <ul><li>Leaves will be collected at residences located<b> South of 9th Avenue Nov. 2 <b>&#8211; 6</b></b></li></ul>
  <h2>Guidelines</h2>
  <ul><li><strong>All bags must be out before 7 a.m. on the MONDAY of your scheduled collection week and should be left out the entire week until collected.</strong></li></ul>
</div>`;

describe("Longmont fall-leaf bulletin adapter", () => {
  it("extracts both source-provided collection ranges and the shared instructions", () => {
    const results = extractLongmontLeafCollection(html, { provenance, issuer: "City of Longmont" });
    const parsed = results.filter((result) => result.status === "parsed");
    assert.equal(parsed.length, 2);
    const notices = parsed.map((result) => result.validation.notice);
    assert.deepEqual(
      notices.map((notice) => ({
        area: notice.normalizedFields.area,
        serviceDate: notice.normalizedFields.serviceDate,
        endDate: notice.normalizedFields.endDate,
      })),
      [
        { area: "North of 9th Avenue", serviceDate: "2026-10-26", endDate: "2026-10-30" },
        { area: "South of 9th Avenue", serviceDate: "2026-11-02", endDate: "2026-11-06" },
      ],
    );
    for (const result of parsed) {
      const notice = result.validation.notice;
      assert.match(result.locator, /content_area/i);
      assert.match(notice.fields.area.locator, /content_area/i);
      assert.match(notice.fields.serviceDate.locator, /content_area/i);
      assert.match(notice.fields.endDate.locator, /content_area/i);
      assert.equal(
        notice.normalizedFields.collectionInstructions,
        "All bags must be out before 7 a.m. on the MONDAY of your scheduled collection week and should be left out the entire week until collected.",
      );
      assert.match(notice.fields.collectionInstructions.locator, /content_area/i);
      assert.equal(notice.provenance.sourceUrl, sourceUrl);
    }
  });

  it("does not parse the bulletin from an unrelated URL", () => {
    const results = extractLongmontLeafCollection(html, {
      provenance: { ...provenance, sourceUrl: "https://example.test/fall-leaf-collection/" },
      issuer: "City of Longmont",
    });
    assert.deepEqual(results, []);
  });

  it("does not emit a parsed notice when the schedule year is missing", () => {
    const results = extractLongmontLeafCollection(
      html.replace("2026 Collection Schedule", "Collection Schedule"),
      { provenance, issuer: "City of Longmont" },
    );
    assert.equal(results.some((result) => result.status === "parsed"), false);
  });
});
