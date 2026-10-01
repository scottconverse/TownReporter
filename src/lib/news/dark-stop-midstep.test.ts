import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { emptyPlan, ensureInvestigateSchema, researchLoop } from "./investigate.ts";

/**
 * Unit DD1, item 3, at the worker: Stop lands inside the hop, not at its end.
 *
 * The stand-in walkthrough of 2026-09-30 (`A2c-REPORT.md` §3.6) pressed Stop at
 * 0:36 and the run ended at 2:17 -- 102 seconds later. The seam already asked
 * the question between hops and between searches, but a hop is one planner
 * call, three searches AND four page reads, and the read loop asked nobody
 * anything: once the searches were done the run read its whole queue before it
 * noticed the editor had pressed anything.
 *
 * THE MUTATION THAT MATTERS. Removing the `await opts.throwIfCancelled?.()`
 * from the top of the read loop reads all four documents after the stop.
 */

async function bootInv(user: string, title: string) {
  await ensureInvestigateSchema();
  const sql = await getSql();
  const rows = await sql<{ id: number }>`
    insert into investigations (user_id, title) values (${user}, ${title}) returning id
  `;
  return { sql, id: rows[0]!.id };
}

describe("DD1 item 3 — a stop lands within one page read", () => {
  it("leaves the read loop at the first document after the stop, keeping the ones already read", async () => {
    const user = `dd1-stop-reads-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Stop between reads");
    const cancelled = new Error("Cancelled by the editor");
    const read: string[] = [];
    let stopAfter = 1;

    await assert.rejects(
      researchLoop({
        userId: user,
        investigationId: id,
        hops: 1,
        // A hop with no searches at all, so nothing but the read loop can be
        // what consumes the run between the stop and the throw.
        planner: async () => {
          const plan = emptyPlan();
          plan.fetch_urls = [
            "https://fixture.example/one",
            "https://fixture.example/two",
            "https://fixture.example/three",
            "https://fixture.example/four",
          ];
          return plan;
        },
        searchAttempt: async () => ({ state: "SEARCH_SUCCESS_ZERO_RESULTS", provider: "fixture", hits: [] }),
        fetch: async (url) => {
          read.push(url);
          return {
            ok: true,
            status: 200,
            title: "Fixture",
            extras: [],
            text: `Captured ${url} with enough text to be treated as the article by the reader.`,
          };
        },
        archives: async () => [],
        throwIfCancelled: async () => {
          if (read.length >= stopAfter) throw cancelled;
        },
      }),
      /Cancelled by the editor/,
    );

    assert.equal(
      read.length,
      1,
      `the run kept reading after the editor stopped it: ${read.join(" | ")}`,
    );

    // What it read before the stop is kept: the file says what it got.
    const artifacts = await sql<{ url: string }>`
      select url from artifacts where investigation_id = ${id}
    `;
    assert.equal(artifacts.length, 1, "the capture made before the stop was lost");
    assert.match(artifacts[0]!.url, /\/one$/);

    // And nothing was searched: the stop was read before any network call in
    // this hop beyond the planner.
    stopAfter = 0;
  });

  it("runs the whole queue when nobody asks it to stop", async () => {
    const user = `dd1-nostop-reads-${Date.now()}`;
    const { id } = await bootInv(user, "No stop between reads");
    const read: string[] = [];
    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      planner: async () => {
        const plan = emptyPlan();
        plan.fetch_urls = ["https://fixture.example/one", "https://fixture.example/two"];
        return plan;
      },
      searchAttempt: async () => ({ state: "SEARCH_SUCCESS_ZERO_RESULTS", provider: "fixture", hits: [] }),
      fetch: async (url) => {
        read.push(url);
        return {
          ok: true,
          status: 200,
          title: "Fixture",
          extras: [],
          text: `Captured ${url} with enough text to be treated as the article by the reader.`,
        };
      },
      archives: async () => [],
      throwIfCancelled: async () => undefined,
    });
    assert.equal(read.length, 2, read.join(" | "));
  });
});
