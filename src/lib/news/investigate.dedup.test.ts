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

  /*
    Unit U25, C1. A page the desk has already fetched and parked does not come
    back as "new material" because the same URL turned up again. The reopen
    path hands `mergeIntoExisting` the re-discovered URL as its evidence, and
    "≥8 characters and not seen before" is not a test of whether anything new
    is known.

    THE MUTATION THAT MATTERS. Removing `resurfaceRefused` from the
    `newEvidence` expression fails this case, and the desk's own junk returns
    to the Dark Desk front page.
  */
  it("does not reopen a parked page just because its own URL came round again", async () => {
    const user = `dedup-reopen-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Reopen guard");
    const page = "https://jetdelivery.com/locations/ca/orange-county";

    await persistDiscovery(user, id, {
      kind: "url",
      label: page,
      why: "Search hit for \"Courier Corporation\" Longmont",
      evidence: "Same-Day Courier & Freight Delivery in Orange County",
    });
    await sql`
      update frontier_items set status = ${"resolved"}, closed_reason = ${"Fetched"}
      where investigation_id = ${id}
    `;

    // The same address, re-discovered later in the run: what the leftover-URL
    // and attachment branches pass as `evidence`.
    await persistDiscovery(user, id, {
      kind: "url",
      label: page,
      why: "Discovered this hop — fetch next",
      evidence: page,
    });

    const [row] = await sql<{ status: string }>`
      select status from frontier_items where investigation_id = ${id} and label = ${page}
    `;
    assert.equal(row!.status, "resolved", "a page's own address was taken as new evidence");

    // Real evidence about the page does reopen it -- the guard is narrow.
    await persistDiscovery(user, id, {
      kind: "url",
      label: page,
      why: "Fetched",
      evidence: "The page now names the Longmont franchise as a closed location.",
    });
    const [reopened] = await sql<{ status: string }>`
      select status from frontier_items where investigation_id = ${id} and label = ${page}
    `;
    assert.equal(reopened!.status, "reopened", "a genuinely new finding could not reopen the item");
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

/**
 * Unit U25, B4 — the editor can stop a running dig.
 *
 * The walkthrough scanned every button and summary on `/desk/dark` for
 * /stop|pause|halt|cancel|abandon/ and found none, twice, during a live run: a
 * dig ended only at its own hop, time or call limit. The seam is
 * `throwIfCancelled`, read at each hop and each search; it must THROW, so the
 * round leaves the loop instead of looking like a run that finished.
 *
 * THE MUTATION THAT MATTERS. Removing the `await opts.throwIfCancelled?.()`
 * from the top of the hop loop runs all three hops after the stop.
 */
describe("stopping a running dig (Dark Desk U25 B4)", () => {
  it("leaves the hop loop at the boundary the stop landed on", async () => {
    const user = `stop-dig-${Date.now()}`;
    const { id } = await bootInv(user, "Stop a dig");
    let planned = 0;
    let searched = 0;
    const cancelled = new Error("Cancelled by the editor");

    await assert.rejects(
      researchLoop({
        userId: user,
        investigationId: id,
        hops: 3,
        search: async () => {
          searched += 1;
          return [];
        },
        fetch: async () => ({ ok: false, status: 404, text: "", title: "", extras: [] }),
        planner: async () => {
          planned += 1;
          return { ...emptyPlan(), searches: [`query ${planned}`] };
        },
        archives: async () => [],
        throwIfCancelled: async () => {
          throw cancelled;
        },
      }),
      /Cancelled by the editor/,
    );
    assert.equal(planned, 0, "a hop was planned after the editor stopped the run");
    assert.equal(searched, 0, "a search ran after the editor stopped the run");
  });

  it("runs to the end when nobody asks it to stop", async () => {
    const user = `stop-dig-quiet-${Date.now()}`;
    const { id } = await bootInv(user, "No stop asked");
    let planned = 0;
    const result = await researchLoop({
      userId: user,
      investigationId: id,
      hops: 2,
      search: async () => [],
      fetch: async () => ({ ok: false, status: 404, text: "", title: "", extras: [] }),
      planner: async () => {
        planned += 1;
        return { ...emptyPlan(), searches: [`query ${planned}`] };
      },
      archives: async () => [],
      throwIfCancelled: async () => undefined,
    });
    assert.equal(result.hops, 2);
    assert.equal(planned, 2);
  });
});

describe("dead_ends confirmation cap + settled state (Dark Desk F4)", () => {
  it("does not settle a trail from repeated model assertions without strategy exhaustion", async () => {
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
    assert.equal(rows[0]!.settled, false);

    // Repetition is bookkeeping, not proof. The candidate remains matchable
    // and its frontier row remains open until the strategy tracker exhausts it.
    const hits = await matchDeadEnds(user, ["aliens"]);
    assert.ok(hits.find((h) => h.id === rows[0]!.id));
    const frontier = await sql<{ status: string }>`
      select status from frontier_items
      where investigation_id = ${id} and lower(label) = ${"it was aliens"}
    `;
    assert.ok(frontier.length > 0);
    assert.ok(frontier.every((row) => row.status !== "dead-end"));
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
