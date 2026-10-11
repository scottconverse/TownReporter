import assert from "node:assert/strict";
import { it } from "node:test";
import { getSql } from "../db.ts";
import { saveSourceScanPreferenceForEditor } from "./source-scan-preferences.server.ts";

it("a nonaccepted source preference warns, then saves the editor's override and audit", async () => {
  const sql = await getSql();
  const context = { userId: "source-preference-override-editor", newsroomId: 1 };
  const [source] = await sql<{ id: number }>`insert into sources(user_id,newsroom_id,url,title,kind,tier,status) values(${context.userId},1,'https://example.org/proposed','Proposed','page','A','proposed') returning id`;
  const input = { sourceId: source.id, purpose: "watch" as const, cadence: "weekly" as const, deadline: null };
  const warning = await saveSourceScanPreferenceForEditor(sql, context, input);
  assert.equal(warning.ok, false); assert.equal("warning" in warning && warning.warning?.key, "scan-source-not-accepted");
  assert.equal((await sql`select source_id from source_scan_preferences where source_id=${source.id}`).length, 0);
  assert.equal((await saveSourceScanPreferenceForEditor(sql, context, { ...input, override: ["scan-source-not-accepted"] })).ok, true);
  assert.equal((await sql`select source_id from source_scan_preferences where source_id=${source.id}`).length, 1);
  const [audit] = await sql<{ detail: string; created_at: unknown }>`select detail,created_at from audit_events where user_id=${context.userId} and action='override'`;
  assert.equal(JSON.parse(audit.detail).key, "scan-source-not-accepted");
  assert.equal(JSON.parse(audit.detail).target.id, source.id); assert.ok(audit.created_at);
  const missing = await saveSourceScanPreferenceForEditor(sql, context, { ...input, sourceId: 2147483000, override: ["scan-source-not-accepted"] });
  assert.equal(missing.ok, false); assert.equal("warning" in missing, false);
});
