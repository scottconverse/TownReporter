import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withSourceOrganization } from "./findings.ts";

/**
 * A14 — a writer checkpoint saved provenance with no organization, and the
 * public story page crashed on those rows (Test walk Oct 20 2026). Both
 * writers now pass their items through this builder, which reads the
 * organization from the URL the same way `describeSourceUrl` does. An item
 * that already names one is left exactly as it was.
 */
type WriterItem = { url?: string; title?: string; role?: string; organization?: string };

describe("writer provenance items carry an organization", () => {
  it("fills the organization from the URL when it is missing", () => {
    const [item] = withSourceOrganization<WriterItem>([
      { url: "https://www.longmontcolorado.gov/news", title: "News", role: "followed" },
    ]);
    assert.equal(item.organization, "longmontcolorado.gov");
    assert.equal(item.url, "https://www.longmontcolorado.gov/news");
    assert.equal(item.title, "News");
  });

  it("keeps an organization the item already has", () => {
    const [item] = withSourceOrganization([
      { url: "https://example.test/story", organization: "The Example Times" },
    ]);
    assert.equal(item.organization, "The Example Times");
  });

  it("leaves an item with no URL alone", () => {
    const [item] = withSourceOrganization([{ title: "No address", organization: "" }]);
    assert.equal(item.organization, "");
    assert.equal(item.title, "No address");
  });
});
