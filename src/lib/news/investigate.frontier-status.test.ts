// guards: off-topic discoveries could remain active in the editor's research queue.
import "../test-support/pglite-migrations.ts";
import "../test-support/model-seal.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { emptyPlan, ensureInvestigateSchema, researchLoop } from "./investigate.ts";

test("stores an off-topic planner discovery closed on its first write", async () => {
  await ensureInvestigateSchema();
  const sql = await getSql();
  const [{ id }] = await sql<{ id: number }>`insert into investigations (user_id, title) values ('frontier-editor', 'Longmont council meeting') returning id`;
  const plan = emptyPlan();
  plan.frontier = [{ kind: "url", label: "https://trefoiltechnology.co.uk/rtal/index.html", why: "Company website", priority: 5, queries: [] }];
  await researchLoop({ userId: "frontier-editor", investigationId: id, hops: 1,
    place: { city: "Longmont", state: "Colorado" }, planner: async () => plan,
    search: async () => [], archives: async () => [],
    fetch: async () => ({ ok: false, status: 404, text: "", title: "", extras: [] }),
  });
  const [row] = await sql<{ status: string; closed_reason: string }>`select status, closed_reason from frontier_items where investigation_id = ${id} and label = ${plan.frontier[0]!.label}`;
  assert.equal(row?.status, "closed");
  assert.ok(row.closed_reason);
});
