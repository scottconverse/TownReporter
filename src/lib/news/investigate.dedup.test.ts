import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import {
  DEAD_END_CONFIRMATION_CAP,
  emptyPlan,
  ensureInvestigateSchema,
  matchDeadEnds,
  meaningfulDeadEndMatch,
  persistDiscovery,
  researchLoop,
  resurfaceDeadEnds,
  type HopPlan,
} from "./investigate.ts";

/**
 * Dark Desk F4 — dedupe leads + stop zombie dead ends.
 *
 * Live symptoms this covers (artifacts/dark-desk-review-2026-09-03/DARK-DESK-REVIEW.md):
 *  - the same municode page saved 7 ways (?nodeId=..., path/case variants)
 *  - one dead-end hypothesis inserted 18x
 *  - 42 "revived-dead-end" rows pinned above real leads
 */

async function bootInv(user: string, title: string) {
  await ensureInvestigateSchema();
  const sql = await getSql();
  const rows = await sql<{ id: number }>`
    insert into investigations (user_id, title) values (${user}, ${title}) returning id
  `;
  return { sql, id: rows[0]!.id };
}

describe("persistDiscovery dedup (Dark Desk F4)", () => {
  it("collapses URL variants (nodeId, trailing slash, www, case) to one frontier row", async () => {
    const user = `dedup-url-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Municode dedup");

    await persistDiscovery(user, id, {
      kind: "url",
      label: "https://www.municode.example/codes/longmont?nodeId=12345",
      why: "Code of ordinances",
      evidence: "seed",
    });
    await persistDiscovery(user, id, {
      kind: "url",
      label: "https://municode.example/codes/longmont/",
      why: "Code of ordinances again",
      evidence: "second visit",
    });
    await persistDiscovery(user, id, {
      kind: "url",
      label: "HTTPS://MUNICODE.EXAMPLE/codes/longmont?nodeId=98765",
      why: "Code of ordinances, different scroll position",
      evidence: "third visit",
    });

    const rows = await sql<{ id: number; label: string }>`
      select id, label from frontier_items where investigation_id = ${id}
    `;
    assert.equal(rows.length, 1, `expected one collapsed row, got: ${JSON.stringify(rows)}`);
    assert.doesNotMatch(rows[0]!.label, /nodeId/i);
  });

  it("normalizes non-URL labels on case/whitespace only", async () => {
    const user = `dedup-label-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Entity label dedup");

    await persistDiscovery(user, id, {
      kind: "entity",
      label: "Front Range Municipal Solutions LLC",
      why: "Named in packet",
    });
    await persistDiscovery(user, id, {
      kind: "entity",
      label: "  front range municipal solutions llc  ",
      why: "Named again",
    });

    const rows = await sql<{ id: number }>`
      select id from frontier_items where investigation_id = ${id}
    `;
    assert.equal(rows.length, 1);

    // A genuinely different entity must NOT collapse into it.
    await persistDiscovery(user, id, {
      kind: "entity",
      label: "Peak Range Holdings LLC",
      why: "A different company",
    });
    const rows2 = await sql<{ id: number }>`
      select id from frontier_items where investigation_id = ${id}
    `;
    assert.equal(rows2.length, 2);
  });

  it("the unique index rejects a literal duplicate insert made outside persistDiscovery", async () => {
    const user = `dedup-index-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Direct insert race");

    await sql`
      insert into frontier_items (user_id, investigation_id, kind, label, label_norm, why)
      values (${user}, ${id}, ${"url"}, ${"https://example.gov/a"}, ${"https://example.gov/a"}, ${"first"})
    `;

    await assert.rejects(
      sql`
        insert into frontier_items (user_id, investigation_id, kind, label, label_norm, why)
        values (${user}, ${id}, ${"url"}, ${"https://example.gov/a"}, ${"https://example.gov/a"}, ${"second"})
      `,
      /duplicate key|unique/i,
    );
  });
});

describe("dead_ends confirmation cap + settled state (Dark Desk F4)", () => {
  it("stops resurfacing a dead end once it crosses the confirmation cap", async () => {
    const user = `deadend-cap-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Zombie dead end");

    const plan = (): HopPlan => ({
      ...emptyPlan(),
      dead_ends: [{ hypothesis: "It was aliens", reason: "No supporting record found" }],
    });

    // The model re-asserts the same dead end every hop, the way it did live
    // (18x on one hypothesis). Run one more hop than the cap.
    await researchLoop({
      userId: user,
      investigationId: id,
      hops: DEAD_END_CONFIRMATION_CAP + 1,
      search: async () => [],
      fetch: async () => ({ ok: false, status: 404, text: "", title: "", extras: [] }),
      planner: async () => plan(),
      archives: async () => [],
    });

    const rows = await sql<{ id: number; confirmation_count: number; settled: boolean }>`
      select id, confirmation_count, settled from dead_ends
      where investigation_id = ${id} and lower(hypothesis) = ${"it was aliens"}
    `;
    assert.equal(rows.length, 1, "must be exactly one row, not one per hop");
    assert.ok(
      rows[0]!.confirmation_count >= DEAD_END_CONFIRMATION_CAP,
      `expected confirmation_count >= cap, got ${rows[0]!.confirmation_count}`,
    );
    assert.equal(rows[0]!.settled, true);

    // Settled dead ends are excluded from matchDeadEnds, so evidence naming
    // it again must not resurface it.
    const hits = await matchDeadEnds(user, ["aliens"]);
    assert.equal(
      hits.find((h) => h.id === rows[0]!.id),
      undefined,
      "a settled dead end must not match",
    );

    const revived = await resurfaceDeadEnds(user, id, ["aliens"]);
    assert.equal(revived, 0, "a settled dead end must not resurface");
  });
});

describe("meaningfulDeadEndMatch (Dark Desk F4 tightened match logic)", () => {
  it("does not false-positive on a short common word that happens to be a substring", () => {
    // Old rule: any extracted name >3 chars that's a substring of the blob.
    // "Main" is a substring of "Maintenance budget shortfall" — must NOT match.
    assert.equal(meaningfulDeadEndMatch("Main", "Maintenance budget shortfall"), false);
    assert.equal(meaningfulDeadEndMatch("park", "Parking enforcement contract"), false);
  });

  it("matches a specific single long word as a whole word", () => {
    assert.equal(
      meaningfulDeadEndMatch("Longmont", "The Longmont city council voted 5-2"),
      true,
    );
  });

  it("matches a multi-token phrase only when every meaningful token is present", () => {
    assert.equal(
      meaningfulDeadEndMatch("Peak Range Holdings", "Filed by Peak Range Holdings LLC in 2021"),
      true,
    );
    assert.equal(
      meaningfulDeadEndMatch("Peak Range Holdings", "Filed by Peak Vista Partners LLC in 2021"),
      false,
    );
  });
});
