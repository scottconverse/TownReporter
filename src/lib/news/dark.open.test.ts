import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureInvestigateSchema } from "./investigate.ts";
import { openInvestigationForEditor } from "./dark-open.ts";

describe("open investigation", { timeout: 60000 }, () => {
  it("creates an investigation id immediately without waiting for hops", async () => {
    await ensureInvestigateSchema();
    const user = `dark-open-${Date.now()}`;
    const opened = await openInvestigationForEditor(user, {
      paste: "https://assets.bouldercounty.gov/example.pdf\nTransportation extension resurfaced.",
      title: "Transportation extension document",
    });
    assert.ok(opened.investigationId > 0);
    assert.equal(opened.title, "Transportation extension document");
    const sql = await getSql();
    const row = await sql<{ hops: number; status: string }>`
      select hops, status from investigations where id = ${opened.investigationId} and user_id = ${user}
    `;
    assert.equal(row[0]!.hops, 0);
    assert.equal(row[0]!.status, "open");
  });

  it("humanizes a pasted URL title instead of storing the raw URL", async () => {
    await ensureInvestigateSchema();
    const user = `dark-open-url-${Date.now()}`;
    const opened = await openInvestigationForEditor(user, {
      paste:
        "https://assets.bouldercounty.gov/wp-content/uploads/2025/02/2022-048-rst-td3-transportation-extension-o.100pct.pdf",
    });
    assert.doesNotMatch(opened.title, /^https?:/i);
    assert.match(opened.title, /transportation extension/i);
  });
});
