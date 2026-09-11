import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import {
  emptyPlan,
  ensureInvestigateSchema,
  persistDiscovery,
  researchLoop,
  type FetchFn,
  type SearchAttemptFn,
} from "./investigate.ts";
import type { ResearchAction } from "./research-actions.ts";

async function bootInv(user: string, title: string) {
  await ensureInvestigateSchema();
  const sql = await getSql();
  const rows = await sql<{ id: number }>`
    insert into investigations (user_id, title) values (${user}, ${title}) returning id
  `;
  return { sql, id: rows[0]!.id };
}

describe("responsive researchLoop", { timeout: 120_000 }, () => {
  it("executes search, read, and captured-link follow one at a time with receipts", async () => {
    const user = `responsive-actions-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Water contract award");
    const resultUrl = "https://city.example/award";
    const attachment = "https://city.example/packet.pdf";
    const searched: string[] = [];
    const fetched: string[] = [];
    const contexts: string[] = [];
    const actions: ResearchAction[] = [
      { type: "search", query: "Water contract award", reason: "find the award" },
      { type: "read", url: resultUrl, reason: "find NELSON8979 in the result" },
      { type: "follow", url: attachment, fromUrl: resultUrl, reason: "read its packet" },
      { type: "finish", summary: "The packet names Acme.", findings: [{ text: "Acme won the water contract.", evidenceUrl: attachment }] },
    ];
    const searchAttempt: SearchAttemptFn = async (query) => {
      searched.push(query);
      return { state: "SEARCH_SUCCESS_RESULTS", provider: "test", hits: [{ title: "Award", url: resultUrl, snippet: "Acme" }] };
    };
    const fetch: FetchFn = async (url) => {
      fetched.push(url);
      if (url === resultUrl) return { ok: true, status: 200, title: "Award", text: `${"routine notice ".repeat(700)} NELSON8979 Award page links the packet.`, extras: [attachment] };
      return { ok: true, status: 200, title: "Packet", text: "Acme won the water contract. Signed June 2.", extras: [] };
    };

    const result = await researchLoop({
      userId: user,
      investigationId: id,
      executionMode: "responsive",
      actionLimit: 6,
      actionChooser: async (context) => {
        contexts.push(context);
        return actions[contexts.length - 1]!;
      },
      searchAttempt,
      fetch,
      planner: async () => emptyPlan(),
      archives: async () => [],
    });

    assert.equal(searched.length, 1);
    assert.match(searched[0]!, /Water contract award/);
    assert.deepEqual(fetched, [resultUrl, attachment], "search must not hide a fetch; each read/follow fetches one URL");
    assert.match(contexts[1]!, /SEARCH_SUCCESS_RESULTS/);
    assert.match(contexts[2]!, /NELSON8979 Award page links the packet/);
    assert.match(contexts[2]!, /packet\.pdf/);
    assert.equal(result.actionDecisions, 4);
    assert.equal(result.finished, true);
    assert.match(result.summary, /packet names Acme/);
    assert.match(result.summary, /Responsive action receipts/);
    assert.match(result.summary, /1:search:SEARCH_SUCCESS_RESULTS/);
    const saved = await sql<{ summary: string }>`select summary from investigations where id = ${id}`;
    assert.match(saved[0]!.summary, /2:read:/);
    assert.match(saved[0]!.summary, /3:follow:/);
    const claims = await sql<{ body: string }>`select body from claims where investigation_id = ${id}`;
    assert.ok(claims.some((claim) => /Acme won/.test(claim.body)), "finish findings are persisted");
  });

  it("feeds not-found to the next decision and stops at the explicit cap", async () => {
    const user = `responsive-cap-${Date.now()}`;
    const { id } = await bootInv(user, "Missing agenda");
    await persistDiscovery(user, id, { kind: "url", label: "https://city.example/missing-1", why: "Search hit", priority: 9 });
    await persistDiscovery(user, id, { kind: "url", label: "https://city.example/missing-2", why: "Search hit", priority: 9 });
    const contexts: string[] = [];
    const result = await researchLoop({
      userId: user,
      investigationId: id,
      executionMode: "responsive",
      actionLimit: 2,
      actionChooser: async (context) => {
        contexts.push(context);
        return { type: "read", url: `https://city.example/missing-${contexts.length}`, reason: "check it" };
      },
      fetch: async (url) => ({ ok: false, status: 404, title: "Not found", text: "", extras: [], outcome: "not-found" }),
      search: async () => [],
      planner: async () => emptyPlan(),
      archives: async () => [],
    });
    assert.equal(contexts.length, 2);
    assert.match(contexts[1]!, /not-found/);
    assert.equal(result.actionDecisions, 2);
    assert.equal(result.finished, false);
    assert.match(result.summary, /decision limit 2/i);
  });
});
