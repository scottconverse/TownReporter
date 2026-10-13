/*
  B08 and FC03: a Dark Desk investigation's follow-up list wandered off its
  subject.

  The saved Sept. 1 City Council (Longmont, Colorado) file kept proposing UK
  aggregate businesses, a Walton Road / Kirby Le Soken / Frinton-on-Sea
  property record and a Trefoil technology page as its next steps. None of
  them names Longmont or the council question.

  Two behaviours are pinned here, one per row:
    B08  -- a proposed follow-up from another country is not added to the
            trail as an open lead, and it is still written down (closed, with
            the reason) rather than thrown away.
    FC03 -- an item already saved in a trail is never taken away. It gets one
            plain line saying it does not mention the town or the question.
*/
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
await applyMigrationsToTestPglite();
import {
  emptyPlan,
  ensureInvestigateSchema,
  persistDiscovery,
  researchLoop,
} from "./investigate.ts";
import { gateFrontierRelevance } from "./frontier-relevance.ts";

/*
  The marker the page prints for one saved trail item. Read through the module
  namespace so a build that does not yet carry the marker reports the behaviour
  it is missing -- the old gate closes the row but prints no line -- instead of
  failing to load the file at all.
*/
async function pageNoteFor(
  item: { label: string; why: string },
  context: { subject: string; town: string },
): Promise<string | null> {
  const mod: Record<string, unknown> = await import("./frontier-relevance.ts");
  const markerFor = mod["offSubjectMarkerFor"];
  if (typeof markerFor !== "function") {
    const gated = gateFrontierRelevance(item, context);
    return gated.status === "closed" ? (gated.closed_reason as string) : null;
  }
  return (markerFor as (i: typeof item, c: typeof context) => string | null)(item, context);
}

const UK_AGGREGATE_URL =
  "https://unitedkingdominbusiness.co.uk/Company/2076451/Aggregate-Silverton-Aggregates/Walton-Road-Kirby-Le-Soken-0-CO130D-Frinton-on-Sea-01255851777";
const TREFOIL_URL = "http://www.trefoiltechnology.co.uk/rtal/index.html";
const COUNCIL_URL = "https://longmontcolorado.gov/government/agendas/september-1-council.html";

async function bootInv(user: string, title: string, explanation = "") {
  await ensureInvestigateSchema();
  const sql = await getSql();
  const rows = await sql<{ id: number }>`
    insert into investigations (user_id, title, ordinary_explanation)
    values (${user}, ${title}, ${explanation}) returning id
  `;
  return { sql, id: rows[0]!.id };
}

/** The paper these rows were filed for: Longmont, Colorado. */
const SUBJECT = "September 1 City Council YouTube investigation";
const TOWN = "Longmont";

describe("B08 — the post-search selector does not file an off-subject lead as open", { timeout: 120000 }, () => {
  it("closes the UK results the selector proposes and keeps the council result open", async () => {
    const user = `b08-off-subject-${Date.now()}`;
    const { sql, id } = await bootInv(user, SUBJECT);
    /*
      Subject and town are the only two things the question is allowed to be
      about. The walk's file is a Colorado city council question; these are the
      exact results it proposed as next steps.
    */
    const proposed = [
      { kind: "url", label: UK_AGGREGATE_URL, why: "Company record page found this round" },
      { kind: "url", label: TREFOIL_URL, why: "Search result for rtal on a company page" },
      { kind: "document", label: "Walton Road, Kirby Le Soken, Frinton-on-Sea", why: "Property and road records" },
      { kind: "url", label: COUNCIL_URL, why: "The Sept. 1 Longmont City Council meeting recording" },
    ];

    /*
      The selector's own plan reaches the same write path as a hop plan. Held to
      the subject-and-place check the run holds every other plan to: the ones
      about somewhere else are closed, the one about the town and the question
      stays open. Nothing is dropped.
    */
    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      // The selector only runs after a search has returned results, so the hop
      // needs one search to have happened.
      planner: async () => {
        const plan = emptyPlan();
        plan.searches = ["Longmont City Council September 1 meeting"];
        return plan;
      },
      search: async () => [
        { title: "City Council", url: COUNCIL_URL, snippet: "Longmont City Council meeting" },
      ],
      readSelector: async () => {
        const plan = emptyPlan();
        plan.frontier = proposed;
        return plan;
      },
      fetch: async () => ({ ok: true, status: 200, text: "Readable page.", title: "Page", extras: [] }),
      archives: async () => [],
    });

    const rows = await sql<{ label: string; status: string; closed_reason: string | null }>`
      select label, status, closed_reason from frontier_items where investigation_id = ${id}
    `;
    const byLabel = (needle: string) => rows.find((row) => row.label.includes(needle));
    for (const needle of ["Kirby-Le-Soken", "trefoiltechnology", "Kirby Le Soken"]) {
      const row = byLabel(needle);
      assert.ok(row, `${needle} was thrown away instead of recorded`);
      assert.notEqual(row.status, "open", `${needle} was added to the trail as a live next step`);
      assert.match(String(row.closed_reason), /off-topic/i, `${needle} was closed without saying why`);
    }
    const council = byLabel("september-1-council");
    assert.ok(council, "a result about the town and the council question was not added");
    assert.doesNotMatch(
      String(council.closed_reason ?? ""),
      /off-topic/i,
      "a result about the town and the council question was marked off subject",
    );
  });
});

describe("FC03 — a saved off-subject trail item is kept and marked, never removed", { timeout: 120000 }, () => {
  it("keeps every saved item and marks only the off-subject ones", async () => {
    const user = `fc03-saved-trail-${Date.now()}`;
    const { sql, id } = await bootInv(user, SUBJECT);
    const context = { subject: SUBJECT, town: TOWN };

    // Items an earlier version of the desk already saved.
    await persistDiscovery(user, id, {
      kind: "url",
      label: UK_AGGREGATE_URL,
      why: "Company record page saved on an earlier run",
    });
    await persistDiscovery(user, id, {
      kind: "entity",
      label: "Trefoil technology",
      why: "Search result for rtal on a company page",
    });
    await persistDiscovery(user, id, {
      kind: "url",
      label: COUNCIL_URL,
      why: "The Sept. 1 Longmont City Council meeting recording",
    });

    const rows = await sql<{ id: number; label: string; why: string; status: string }>`
      select id, label, why, status from frontier_items where investigation_id = ${id} order by id
    `;
    // Every saved row is still here, and none of them was closed or hidden.
    assert.equal(rows.length, 3, "a saved trail item was removed");
    assert.deepEqual(rows.map((row) => row.status), ["open", "open", "open"]);

    /*
      Marked, not moved. Every saved row keeps the label, the why and the open
      state it already had, and each off-subject one gains exactly one line the
      editor can read.
    */
    const marked = [];
    for (const row of rows) marked.push({ row, note: await pageNoteFor(row, context) });
    const note = (needle: string) => marked.find((m) => m.row.label.includes(needle))!.note;
    const savedLabel = (needle: string) => marked.find((m) => m.row.label.includes(needle))!.row.label;

    assert.equal(savedLabel("Kirby-Le-Soken"), UK_AGGREGATE_URL);
    assert.equal(savedLabel("Trefoil"), "Trefoil technology");

    assert.equal(
      note("Kirby-Le-Soken"),
      "Off subject: this does not mention Longmont or the question.",
      "an off-subject saved item was not marked",
    );
    assert.equal(note("Trefoil"), "Off subject: this does not mention Longmont or the question.");
    assert.equal(note("september-1-council"), null, "a result about the town and the question was marked off subject");
  });
});

