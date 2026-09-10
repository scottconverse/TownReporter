import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureInvestigateSchema } from "./investigate.ts";
import { openInvestigationForEditor } from "./dark-open.ts";
import { queueInvestigationFor } from "./dark.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";

/**
 * `getSql()` auto-applies `migrations/*.sql` via `import.meta.glob`, which is
 * a Vite-only macro -- under plain `node --test` it silently resolves to no
 * migrations (see src/lib/db.ts), so every table this test needs has to be
 * declared here, the same way newsroom-scoped-write.proof.test.ts and
 * write-story-commit.test.ts do for their own `leads` fixtures.
 */
async function ensureLeadsTable() {
  const sql = await getSql();
  await sql.query(`
    create table if not exists leads (
      id serial primary key,
      newsroom_id integer not null default 1,
      user_id text not null,
      headline text not null,
      why text not null,
      topic text not null default 'council',
      status text not null default 'new',
      source_urls text not null default '[]',
      evidence text not null default '',
      newsworthiness integer not null default 0,
      notes_json text not null default '{}',
      investigation_id integer,
      created_at timestamptz not null default now()
    )
  `);
}

/**
 * "Send to the queue" (Dark Desk, 0.6.16).
 *
 * The button always worked -- it created or found a lead -- but the
 * confirmation was so weak the owner clicked it four times thinking it was a
 * no-op. The fix is entirely in the screen (src/routes/desk.dark.tsx: a
 * persistent banner with a link to the lead, replacing "Send to the queue"
 * with a done state, and a distinct "Already on the queue" message), but
 * that screen reads the three outcomes below straight off what this
 * function returns, so the contract they depend on is what gets pinned here.
 */
describe("queueInvestigationFor", { timeout: 60000 }, () => {
  it("creates a new story lead and reports it as newly queued", async () => {
    await ensureInvestigateSchema();
    await ensureLeadsTable();
    const user = `dark-queue-new-${Date.now()}`;
    const opened = await openInvestigationForEditor(
      user,
      {
        paste: "https://assets.bouldercounty.gov/example.pdf\nA council rezoning vote.",
        title: "Rezoning vote",
      },
      DEFAULT_NEWSROOM_ID,
    );

    const res = await queueInvestigationFor(user, DEFAULT_NEWSROOM_ID, opened.investigationId);

    assert.equal(res.ok, true);
    assert.ok(res.ok && res.leadId > 0);
    assert.equal(res.ok && res.alreadyQueued, false);

    const sql = await getSql();
    const rows = await sql<{ id: number; headline: string; investigation_id: number }>`
      select id, headline, investigation_id from leads where investigation_id = ${opened.investigationId}
    `;
    assert.equal(rows.length, 1, "queueing twice must never insert a second lead");
    assert.equal(rows[0]!.headline, "Rezoning vote");
  });

  it("finds the existing lead on a second call and reports it as already queued", async () => {
    await ensureInvestigateSchema();
    await ensureLeadsTable();
    const user = `dark-queue-again-${Date.now()}`;
    const opened = await openInvestigationForEditor(
      user,
      {
        paste: "https://assets.bouldercounty.gov/example.pdf\nA second lead test.",
        title: "Second lead test",
      },
      DEFAULT_NEWSROOM_ID,
    );

    const first = await queueInvestigationFor(user, DEFAULT_NEWSROOM_ID, opened.investigationId);
    assert.ok(first.ok);

    const second = await queueInvestigationFor(user, DEFAULT_NEWSROOM_ID, opened.investigationId);

    assert.equal(second.ok, true);
    assert.ok(second.ok && second.leadId === (first.ok && first.leadId));
    assert.equal(
      second.ok && second.alreadyQueued,
      true,
      "a repeat send must say already-queued, not silently look like a fresh success",
    );
  });

  it("reports failure for an investigation id that does not exist", async () => {
    await ensureInvestigateSchema();
    await ensureLeadsTable();
    const user = `dark-queue-missing-${Date.now()}`;
    const res = await queueInvestigationFor(user, DEFAULT_NEWSROOM_ID, 9_999_999);

    assert.equal(res.ok, false);
    assert.ok(!res.ok && /not found/i.test(res.error));
  });

  it("never lets one newsroom's queue press find another newsroom's investigation", async () => {
    await ensureInvestigateSchema();
    await ensureLeadsTable();
    const user = `dark-queue-scope-${Date.now()}`;
    const otherNewsroom = DEFAULT_NEWSROOM_ID + 5000;
    const opened = await openInvestigationForEditor(
      user,
      {
        paste: "https://assets.bouldercounty.gov/example.pdf\nCross-newsroom isolation.",
        title: "Isolation check",
      },
      otherNewsroom,
    );

    const res = await queueInvestigationFor(user, DEFAULT_NEWSROOM_ID, opened.investigationId);

    assert.equal(res.ok, false, "an investigation filed under a different newsroom must not queue");
  });
});

it(
  "whole-file handoff carries opposing accounts and missing context before a long summary",
  { timeout: 60000 },
  async () => {
    await ensureInvestigateSchema();
    await ensureLeadsTable();
    const user = "qa-whole-file-context";
    const opened = await openInvestigationForEditor(
      user,
      { paste: "A procurement question", title: "Procurement context" },
      1,
    );
    await queueInvestigationFor(user, 1, 9_999_998); // ensure the real Dark Desk schema
    const sql = await getSql();
    await sql`update investigations set summary = ${"One-sided summary. ".repeat(500)} where id = ${opened.investigationId}`;
    for (let n = 0; n < 4; n++)
      await sql`
    insert into dark_signals(user_id, newsroom_id, investigation_id, name, posture, signal_type, counter_narrative, gate_missing_context, what_would_kill)
    values(${user}, 1, ${opened.investigationId}, ${`Question ${n}`}, 'whisper', 'pattern', ${`Emergency exemption ${n}. ${"Long opposing account. ".repeat(80)}`}, ${`Missing signed procurement file ${n}. ${"Missing detail. ".repeat(80)}`}, 'A signed exception disproves the allegation.')
  `;
    await sql`
    insert into dark_signals(user_id, newsroom_id, investigation_id, name, posture, signal_type, counter_narrative)
    values(${user}, 2, ${opened.investigationId}, 'Other newsroom', 'whisper', 'pattern', 'FOREIGN_CONTEXT_MUST_NOT_LEAK')
  `;
    const result = await queueInvestigationFor(user, 1, opened.investigationId, { asTip: true });
    assert.ok(result.ok);
    const rows = await sql<{
      why: string;
      evidence: string;
    }>`select why, evidence from leads where id = ${result.leadId}`;
    for (const text of [rows[0]!.why, rows[0]!.evidence]) {
      assert.match(text, /Sent unverified/);
      assert.match(text, /Emergency exemption 0/);
      assert.match(text, /Missing signed procurement file 0/);
      assert.match(text, /A signed exception disproves/);
      assert.match(text, /3 of 4/);
      assert.match(text, /\[shortened\]/);
      assert.match(text, /Open investigation/);
      assert.doesNotMatch(text, /FOREIGN_CONTEXT/);
      assert.ok(text.length <= 4000);
    }
  },
);

it(
  "whole-file handoff carries the brief and frontier next steps into the queued lead",
  { timeout: 60000 },
  async () => {
    await ensureInvestigateSchema();
    await ensureLeadsTable();
    const user = `qa-next-step-handoff-${Date.now()}`;
    const opened = await openInvestigationForEditor(
      user,
      { paste: "A records question", title: "Next-step handoff" },
      1,
    );
    await queueInvestigationFor(user, 1, 9_999_997); // ensure the real Dark Desk schema
    const sql = await getSql();
    const briefNext = "BRIEF_NEXT_STEP_TOKEN: request the signed filing.";
    const frontierNext = "FRONTIER_NEXT_STEP_TOKEN: compare the amendment log.";
    await sql`
      insert into investigation_briefs (investigation_id, newsroom_id, brief_json)
      values (
        ${opened.investigationId},
        1,
        ${JSON.stringify({ next: briefNext })}
      )
    `;
    await sql`
      insert into frontier_items (user_id, newsroom_id, investigation_id, kind, label, why, next_steps, priority, status)
      values (
        ${user},
        1,
        ${opened.investigationId},
        'url',
        'Open filing',
        'The filing may resolve the records question.',
        ${frontierNext},
        10,
        'open'
      )
    `;
    const result = await queueInvestigationFor(user, 1, opened.investigationId, { asTip: true });
    assert.ok(result.ok);
    const rows = await sql<{ why: string; evidence: string }>`
      select why, evidence from leads where id = ${result.leadId}
    `;
    assert.equal(rows.length, 1);
    for (const text of [rows[0]!.why, rows[0]!.evidence]) {
      assert.match(text, new RegExp(briefNext));
      assert.match(text, new RegExp(frontierNext));
      assert.ok(text.length <= 4000);
    }
  },
);
