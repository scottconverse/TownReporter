import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureDarkSchema } from "./dark.ts";
import { verifyRunSignals } from "./dark-verify.ts";
import { researchLoop, emptyPlan } from "./investigate.ts";
import { resolveResearchPreferences } from "./dark-preferences.ts";
const preferences = resolveResearchPreferences(
  { mode: "range", startDate: "2024-01-01", endDate: "2024-12-31", verificationLimit: 2 },
  new Date("2026-09-07T00:00:00Z"),
);
test("verification applies date preference, actual cap and full eligible denominator", async () => {
  await ensureDarkSchema();
  const sql = await getSql();
  const [inv] = await sql<{
    id: number;
  }>`insert into investigations(user_id,newsroom_id,title) values('prefs-verify',91,'Community records') returning id`;
  const [run] = await sql<{
    id: number;
  }>`insert into dark_runs(user_id,newsroom_id) values('prefs-verify',91) returning id`;
  for (let i = 0; i < 8; i++)
    await sql`insert into dark_signals(user_id,newsroom_id,run_id,investigation_id,name,posture,signal_type,strength,confidence,observation,stage,verification_status) values('prefs-verify',91,${run!.id},${inv!.id},${"Signal " + i},'Follow the Thread','pattern',8,0.4,'Record changed','black-desk','unverified')`;
  const queries: string[] = [],
    packs: string[] = [];
  const out = await verifyRunSignals({
    userId: "prefs-verify",
    newsroomId: 91,
    runId: run!.id,
    investigationId: inv!.id,
    place: { city: "Longmont", state: "Colorado" },
    preferences,
    deps: {
      search: async (q) => {
        queries.push(q);
        return [];
      },
      model: async (_sys, p) => {
        packs.push(p);
        return null;
      },
    },
  });
  assert.equal(packs.length, 2);
  assert.equal(out.eligible, 8);
  assert.equal(out.deferred, 6);
  assert.equal(out.verified, 0);
  assert.equal(out.unverified, 2);
  assert.equal(out.failed, 2);
  assert.ok(queries.every((q) => q.includes("after:2023-12-31 before:2025-01-01")));
  assert.ok(packs.every((p) => p.includes("2024-01-01 through 2024-12-31")));
  assert.match(out.summary, /0 of 8.*verified/);
});
test("discovery query and planner pack use the same saved date window", async () => {
  await ensureDarkSchema();
  const sql = await getSql();
  const [inv] = await sql<{
    id: number;
  }>`insert into investigations(user_id,newsroom_id,title) values('prefs-research',92,'School choir') returning id`;
  await sql`insert into frontier_items(user_id,newsroom_id,investigation_id,label,kind) values('prefs-research',92,${inv!.id},'School choir','topic')`;
  const queries: string[] = [],
    packs: string[] = [];
  await researchLoop({
    userId: "prefs-research",
    newsroomId: 92,
    investigationId: inv!.id,
    hops: 1,
    preferences,
    planner: async (pack) => {
      packs.push(pack);
      return { ...emptyPlan(), searches: ["school choir before:2020-01-01"] };
    },
    search: async (q) => {
      queries.push(q);
      return [];
    },
    fetch: async () => ({ ok: false, status: 404, text: "", title: "", extras: [] }),
    archives: async () => [],
  });
  assert.ok(packs[0]!.includes("2024-01-01 through 2024-12-31"));
  assert.ok(queries.length > 0);
  assert.ok(
    queries.every(
      (q) => q.includes("after:2023-12-31 before:2025-01-01") && !q.includes("before:2020"),
    ),
  );
});
