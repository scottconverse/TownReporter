import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureInvestigateSchema, resolveProvenance } from "./investigate.ts";

describe("empty excerpt", () => {
  it("a real capture with no quote stays unresolved and keeps the version id", async () => {
    await ensureInvestigateSchema();
    const sql = await getSql();
    const user = `empty-ex-${Date.now()}`;
    const inv = await sql<{ id: number }>`
      insert into investigations (user_id, title) values (${user}, ${"Empty excerpt"}) returning id
    `;
    const version = await sql<{ id: number }>`
      insert into artifact_versions (user_id, url, content_hash, title, full_text)
      values (
        ${user},
        ${"https://longmontcolorado.gov/water/empty-excerpt.html"},
        ${"hash-empty-excerpt"},
        ${"Water quality"},
        ${"Nitrate 0.4 mg/L in the captured report."}
      )
      returning id
    `;
    const cap = await sql<{ id: number }>`
      insert into capture_events (user_id, source_url, fetch_outcome, version_id, investigation_id)
      values (
        ${user},
        ${"https://longmontcolorado.gov/water/empty-excerpt.html"},
        ${"fetched"},
        ${version[0]!.id},
        ${inv[0]!.id}
      )
      returning id
    `;
    const hit = await resolveProvenance(user, inv[0]!.id, {
      capture_event_id: cap[0]!.id,
      excerpt: "",
    });
    assert.equal(hit.status, "unresolved");
    assert.equal(hit.versionId, version[0]!.id);
    assert.equal(hit.captureEventId, cap[0]!.id);
  });
});
