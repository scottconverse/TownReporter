import assert from "node:assert/strict";
import { it } from "node:test";
import { getSql } from "../db.ts";
import { performCreateAiFollowUp, performUpdateAiFollowUp } from "./follow-ups.ts";

it("a follow-up without a link warns, then creates the row with explicit consent and an audit", async () => {
  const context = { userId: "override-follow-up-editor", newsroomId: 1 };
  const input = { what: "Check next week's agenda", agentKind: "agenda" as const, schedule: "daily" as const, targets: [] };
  const sql = await getSql();
  const first = await performCreateAiFollowUp(context, input);
  assert.equal(first.ok, false);
  assert.ok("warning" in first);
  if (!("warning" in first)) assert.fail("Expected a warning");
  const warning = first.warning as { key: string; sentence: string };
  assert.equal(warning.key, "follow-up-missing-link");
  const empty = await sql<{ c: number }>`select count(*)::int c from follow_ups where user_id=${context.userId}`;
  assert.equal(empty[0].c, 0);
  const result = await performCreateAiFollowUp(context, { ...input, override: [warning.key] });
  assert.equal(result.ok, true);
  const rows = await sql<{ c: number }>`select count(*)::int c from follow_ups where user_id=${context.userId}`;
  assert.equal(rows[0].c, 1);
  const audit = await sql<{ detail: string; created_at: unknown }>`select detail,created_at from audit_events where user_id=${context.userId} and action='override'`;
  assert.equal(audit.length, 1);
  assert.equal(JSON.parse(audit[0].detail).key, warning.key);
  assert.ok(JSON.parse(audit[0].detail).target);
  assert.ok(audit[0].created_at);
});

it("follow-up overrides cannot create a private URL target or edit a missing record", async () => {
  const context = { userId: "override-follow-up-security", newsroomId: 1 };
  const input = { what: "Read agenda", agentKind: "agenda" as const, schedule: "daily" as const, override: ["follow-up-missing-link"] };
  const invalid = await performCreateAiFollowUp(context, { ...input, targets: ["http://127.0.0.1/admin"] });
  assert.equal(invalid.ok, false);
  assert.equal("warning" in invalid, false);
  const missing = await performUpdateAiFollowUp(context, { ...input, targets: [], id: 2147483000 });
  assert.equal(missing.ok, false);
  assert.equal("warning" in missing, false);
});
