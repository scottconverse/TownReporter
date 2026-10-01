import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { emptyPlan, ensureInvestigateSchema, researchLoop } from "./investigate.ts";

/**
 * Unit DD1, item 1, at the loop: the hop the planner wrote is the hop that was
 * run, and nothing reached a durable column carrying an address the file does
 * not hold.
 *
 * `dark-specific-grounding.test.ts` pins the rule itself. This pins the WIRING
 * -- that `researchLoop` actually calls it, on the corpus of the captures the
 * file holds, before the searches run and before `persistPlan` writes.
 *
 * THE MUTATION THAT MATTERS. Removing the `groundPlan` call from
 * `researchLoop` (or passing it an empty corpus) fails every assertion below
 * but the last: the invented address comes back into `frontier_items`,
 * `hypotheses`, `investigations.summary`, `search_log` and the queries the
 * search function was handed.
 */

const INVENTED = "1749 Main Street";
const NAMED = "Gregory P. Halloran";

/** The Reddit post and the licensing record, as A2c found them. */
const REDDIT =
  "r/longmont: Kid City USA Longmont said to close permanently Oct. 2, 2026. " +
  "The closure letter left at 1941 Terry Street gave families one week's notice.";
const SHINES =
  "COLORADO SHINES PROGRAM DETAIL — Kid City USA Longmont. License Number: 1770463. " +
  "1941 Terry St, Longmont, CO 80501. A recommendation for probation was dated July 30, 2026.";

async function bootFile(user: string, title: string, captures: string[]) {
  await ensureInvestigateSchema();
  const sql = await getSql();
  const rows = await sql<{ id: number }>`
    insert into investigations (user_id, title) values (${user}, ${title}) returning id
  `;
  const id = rows[0]!.id;
  for (const [i, text] of captures.entries()) {
    await sql`
      insert into artifacts
        (user_id, investigation_id, url, title, content_hash, full_text, classification, fetch_status)
      values (
        ${user}, ${id}, ${`https://fixture.example/capture-${i}`}, ${`Fixture capture ${i}`},
        ${`hash-${i}`}, ${text}, ${"discovered"}, ${200}
      )
    `;
  }
  return { sql, id };
}

/** The planner the walkthrough's live run behaved like. */
function inventedPlanner() {
  return async () => {
    const plan = emptyPlan();
    plan.summary = `The facility at ${INVENTED} transitioned from a prior operator in 2024.`;
    plan.questions = [
      `Who owns the property at ${INVENTED}, Longmont, and what are the lease terms?`,
    ];
    plan.searches = [
      `Kid City USA Longmont ${INVENTED} lease termination eviction Boulder County court`,
      "Kid City USA Longmont 1941 Terry Street license 1770463 status",
    ];
    plan.hypotheses.push({
      text: `The operator at ${INVENTED} is a different entity from the licensee.`,
      supporting: `${NAMED} signed the lease.`,
      contradicting: "",
    });
    plan.frontier.push({
      label: INVENTED,
      kind: "lead",
      why: `Investigate the property at ${INVENTED}`,
      priority: 9,
      queries: [`${INVENTED} Longmont Boulder County assessor parcel owner 2026`],
    });
    return plan;
  };
}

describe("DD1 item 1 — the dig cannot write down an address no capture carries", () => {
  it("keeps the invented address out of every durable column and every query", async () => {
    const user = `dd1-grounding-${Date.now()}`;
    const { sql, id } = await bootFile(user, "Kid City USA Longmont closing", [REDDIT, SHINES]);
    const searched: string[] = [];

    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      place: { city: "Longmont", state: "Colorado", county: "Boulder" },
      planner: inventedPlanner(),
      searchAttempt: async (query) => {
        searched.push(query);
        return { state: "SEARCH_SUCCESS_ZERO_RESULTS", provider: "fixture", hits: [] };
      },
      fetch: async (url) => ({
        ok: true,
        status: 200,
        title: "Fixture",
        extras: [],
        text: `Nothing new at ${url}`,
      }),
    });

    const frontier = await sql<{ label: string; why: string; next_steps: string }>`
      select label, why, next_steps from frontier_items where investigation_id = ${id}
    `;
    const hypotheses = await sql<{ body: string; supporting: string }>`
      select body, supporting from hypotheses where investigation_id = ${id}
    `;
    const inv = await sql<{ summary: string }>`
      select summary from investigations where id = ${id}
    `;
    const log = await sql<{ query: string; research_question: string }>`
      select query, research_question from search_log where investigation_id = ${id}
    `;

    const durable = JSON.stringify({
      frontier,
      hypotheses,
      summary: inv[0]?.summary ?? "",
      log,
    });
    const unmarked = [...durable.matchAll(/1749 Main Street(?! \(not in any capture yet\))/g)];
    assert.equal(unmarked.length, 0, `an unmarked invented address was written down: ${durable}`);

    // The invented address DID reach the file -- marked, so the editor sees
    // what the model was reaching for rather than a hole in the sentence.
    assert.ok(
      durable.includes("1749 Main Street (not in any capture yet)"),
      "the invented address vanished instead of being marked",
    );
    // ... and the person no capture names is marked the same way.
    assert.ok(durable.includes(`${NAMED} (not in any capture yet)`));

    // The invented address was never spent on a search.
    assert.equal(searched.some((q) => q.includes("1749 Main Street")), false, searched.join(" | "));
    // The grounded query from the same plan WAS run, unaltered.
    assert.ok(
      searched.some((q) => q.includes("1941 Terry Street")),
      `the grounded query was dropped too: ${searched.join(" | ")}`,
    );
    // And the run says why it searched less than it planned.
    assert.match(inv[0]?.summary ?? "", /no capture in this file carries/);
  });

  it("leaves a wholly grounded hop exactly as the planner wrote it", async () => {
    const user = `dd1-grounded-${Date.now()}`;
    const { sql, id } = await bootFile(user, "Kid City USA Longmont closing", [REDDIT, SHINES]);
    const searched: string[] = [];

    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      place: { city: "Longmont", state: "Colorado", county: "Boulder" },
      planner: async () => {
        const plan = emptyPlan();
        plan.summary = "The licence record for 1941 Terry Street is the one that settles it.";
        plan.questions = ["Is licence 1770463 still active at 1941 Terry Street?"];
        plan.searches = ["Kid City USA Longmont 1941 Terry Street license 1770463 status"];
        plan.frontier.push({
          label: "1941 Terry Street licence status",
          kind: "lead",
          why: "Confirm whether the licence is active or surrendered",
          priority: 9,
        });
        return plan;
      },
      searchAttempt: async (query) => {
        searched.push(query);
        return { state: "SEARCH_SUCCESS_ZERO_RESULTS", provider: "fixture", hits: [] };
      },
      fetch: async (url) => ({ ok: true, status: 200, title: "Fixture", extras: [], text: url }),
    });

    const inv = await sql<{ summary: string }>`
      select summary from investigations where id = ${id}
    `;
    assert.equal(
      inv[0]?.summary,
      "The licence record for 1941 Terry Street is the one that settles it.",
    );
    assert.equal(
      searched.some((q) => q.includes("1941 Terry Street")),
      true,
      searched.join(" | "),
    );
    const frontier = await sql<{ label: string }>`
      select label from frontier_items where investigation_id = ${id} and label = ${"1941 Terry Street licence status"}
    `;
    assert.equal(frontier.length, 1, "a grounded frontier item was lost or rewritten");
  });
});
