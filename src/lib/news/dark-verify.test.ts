import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureInvestigateSchema } from "./investigate.ts";
import { ensureDarkSchema, queueInvestigationFor, sendDarkSignalToQueueFor } from "./dark.ts";
import { verifyRunSignals } from "./dark-verify.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";

/**
 * Stage 2 against a real database.
 *
 * Search and model are both injected — no live network, and no provider call.
 * What is being proved here is the machinery the operator's original demands
 * and this desk had lost: the APP runs the adversarial searches, every query
 * and URL is written down, and a signal with any gate missing stays
 * unverified and says so.
 *
 * `getSql()` auto-applies `migrations/*.sql` via a Vite-only macro, so under
 * plain `node --test` the `leads` table has to be declared here — the same
 * reason dark-queue.test.ts declares it.
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

const PLACE = { city: "Longmont", state: "Colorado", county: "Boulder" };

const FULL_ANSWER = JSON.stringify({
  gates: {
    disproof_attempted:
      "Looked for the routine explanation first: the results page runs on a quarterly cycle and March is inside it.",
    source_independence:
      "Both mentions trace back to the same January press release, so they are one source, not two.",
    missing_context: "Nobody has asked the housing division whether the survey was rescheduled.",
    self_referential: false,
  },
  counter_narrative: "The city says the survey is delayed pending a vendor contract.",
  newsworthiness: { life_changes: true, is_new: true, has_record: true, note: "" },
});

const MISSING_GATE_ANSWER = JSON.stringify({
  gates: {
    disproof_attempted: "Searched for a routine reason and found a quarterly posting cycle.",
    source_independence: "",
    missing_context: "",
    self_referential: false,
  },
  newsworthiness: { life_changes: true, is_new: true, has_record: true, note: "" },
});

const WATCH_ANSWER = JSON.stringify({
  gates: {
    disproof_attempted: "The routine explanation is simply that this is the annual schedule posting.",
    source_independence: "Only the city's own calendar mentions it; there is one origin.",
    missing_context: "Nothing a reader would need is missing; there is nothing here.",
    self_referential: false,
  },
  newsworthiness: {
    life_changes: false,
    is_new: false,
    has_record: false,
    note: "Routine annual posting; nobody is affected.",
  },
});

/**
 * Fixture search: the app's own searching, mocked.
 *
 * The default answers each kind of adversarial query from a different kind of
 * source, because that is what "a minimum of 3 platforms" means — four
 * queries that all land on the same .gov have not covered three platforms,
 * and the gate is right to say so.
 */
function defaultHits(q: string): string[] {
  if (/reddit|disputed|denied|responded/i.test(q)) return ["https://www.reddit.com/r/longmont/x"];
  if (/news|reported|according to/i.test(q)) return ["https://longmontleader.com/story"];
  return ["https://longmontcolorado.gov/hit"];
}

function fakeSearch(hitsFor: (q: string) => string[] = defaultHits) {
  const seen: string[] = [];
  return {
    seen,
    fn: async (q: string) => {
      seen.push(q);
      return hitsFor(q).map((url) => ({ title: "hit", url, snippet: "" }));
    },
  };
}

async function seedSignal(
  user: string,
  fields: Partial<{
    name: string;
    observation: string;
    pattern: string;
    alternatives: string;
    strength: number;
  }> = {},
) {
  await ensureInvestigateSchema();
  await ensureDarkSchema();
  const sql = await getSql();
  const inv = await sql<{ id: number }>`
    insert into investigations (user_id, newsroom_id, title, summary, status)
    values (${user}, ${DEFAULT_NEWSROOM_ID}, ${"Survey results"}, ${""}, ${"open"})
    returning id
  `;
  const run = await sql<{ id: number }>`
    insert into dark_runs (user_id, newsroom_id) values (${user}, ${DEFAULT_NEWSROOM_ID}) returning id
  `;
  const sig = await sql<{ id: number }>`
    insert into dark_signals (
      user_id, newsroom_id, run_id, investigation_id, name, posture, signal_type,
      strength, confidence, observation, pattern, alternatives, stage, verification_status
    ) values (
      ${user}, ${DEFAULT_NEWSROOM_ID}, ${run[0]!.id}, ${inv[0]!.id},
      ${fields.name ?? "Resident survey results promised in March never posted"},
      ${"Dog That Didn't Bark"}, ${"delayed-record"},
      ${fields.strength ?? 9}, ${0.4},
      ${fields.observation ?? "The results page has not changed since January."},
      ${fields.pattern ?? ""}, ${fields.alternatives ?? "A quarterly posting cycle."},
      ${"black-desk"}, ${"unverified"}
    ) returning id
  `;
  return { investigationId: inv[0]!.id, runId: run[0]!.id, signalId: sig[0]!.id };
}

async function readSignal(id: number) {
  const sql = await getSql();
  const rows = await sql<{
    stage: string;
    verification_status: string;
    gates_missing: string | null;
    adversarial_json: string | null;
    newsworthiness_decision: string | null;
    gate_self_referential: boolean | null;
  }>`
    select stage, verification_status, gates_missing, adversarial_json,
           newsworthiness_decision, gate_self_referential
    from dark_signals where id = ${id}
  `;
  return rows[0]!;
}

describe("Dark Signal Desk — stage 2", { timeout: 60000 }, () => {
  it("runs the adversarial searches itself and logs every query and URL", async () => {
    const user = `verify-log-${Date.now()}`;
    const seeded = await seedSignal(user);
    const search = fakeSearch();
    const out = await verifyRunSignals({
      userId: user,
      newsroomId: DEFAULT_NEWSROOM_ID,
      runId: seeded.runId,
      investigationId: seeded.investigationId,
      place: PLACE,
      officialDomains: ["longmontcolorado.gov"],
      deps: { search: search.fn, model: async () => FULL_ANSWER },
    });

    assert.ok(search.seen.length >= 4, `only ${search.seen.length} adversarial searches were run`);
    assert.equal(out.searches.length, search.seen.length);
    for (const r of out.searches) {
      assert.ok(r.query, "a logged search with no query");
      assert.ok(r.tier, "a logged search with no tier");
      assert.ok(r.outcome, "a logged search with no outcome");
    }
    assert.ok(out.searches.some((r) => r.url === "https://longmontcolorado.gov/hit"));

    const sql = await getSql();
    const logged = await sql<{ query: string; tier: string | null; selected_json: string }>`
      select query, tier, selected_json from search_log
      where investigation_id = ${seeded.investigationId} and strategy like 'adversarial%'
    `;
    assert.ok(logged.length >= 4, `only ${logged.length} adversarial rows in search_log`);
    assert.ok(logged.every((r) => r.tier), "a search_log row with no tier recorded");
    assert.ok(
      logged.some((r) => r.selected_json.includes("longmontcolorado.gov")),
      "no URL was written to the run record",
    );

    const run = await sql<{ searches_json: string | null }>`
      select searches_json from dark_runs where id = ${seeded.runId}
    `;
    assert.ok(run[0]!.searches_json, "the round did not record its searches");
  });

  it("finalizes a signal only when all four gates come back answered", async () => {
    const user = `verify-ok-${Date.now()}`;
    const seeded = await seedSignal(user);
    await verifyRunSignals({
      userId: user,
      newsroomId: DEFAULT_NEWSROOM_ID,
      runId: seeded.runId,
      investigationId: seeded.investigationId,
      place: PLACE,
      deps: { search: fakeSearch().fn, model: async () => FULL_ANSWER },
    });
    const row = await readSignal(seeded.signalId);
    assert.equal(row.stage, "dark-signal-desk");
    assert.equal(row.verification_status, "verified");
    assert.equal(row.newsworthiness_decision, "lead");
  });

  it("leaves a signal unverified when a gate is missing, and names what is missing", async () => {
    const user = `verify-missing-${Date.now()}`;
    const seeded = await seedSignal(user);
    await verifyRunSignals({
      userId: user,
      newsroomId: DEFAULT_NEWSROOM_ID,
      runId: seeded.runId,
      investigationId: seeded.investigationId,
      place: PLACE,
      deps: { search: fakeSearch().fn, model: async () => MISSING_GATE_ANSWER },
    });
    const row = await readSignal(seeded.signalId);
    assert.equal(row.verification_status, "unverified");
    assert.match(row.gates_missing ?? "", /independent|context/);
  });

  /*
    The 0.6.14 regression, end to end: a signal built out of the desk
    narrating its own sandbox must never reach "verified", however
    cooperative the model is about the gates.
  */
  it("never finalizes a self-referential signal", async () => {
    const user = `verify-self-${Date.now()}`;
    const seeded = await seedSignal(user, {
      name: "WebFetch was refused by the sandbox policy",
      observation: "The tool call was denied and the search could not run.",
    });
    await verifyRunSignals({
      userId: user,
      newsroomId: DEFAULT_NEWSROOM_ID,
      runId: seeded.runId,
      investigationId: seeded.investigationId,
      place: PLACE,
      deps: { search: fakeSearch().fn, model: async () => FULL_ANSWER },
    });
    const row = await readSignal(seeded.signalId);
    assert.equal(row.verification_status, "unverified");
  });

  /*
    NON-GATING (v0.1.0 Dark Desk non-gating, commit 3ee641d): "No provenance,
    source-classification, entity-resolution, confidence, search-strategy,
    verification, or evidence-quality state may prevent creating or pursuing a
    research lead." The four gates decide what may be CALLED verified. They
    must never stop the dig, drop a signal, or close a frontier item.
  */
  it("does not stop the dig when a gate is missing — the signal, its file and its frontier all survive", async () => {
    const user = `verify-nongate-${Date.now()}`;
    const seeded = await seedSignal(user);
    const sql = await getSql();
    await sql`
      insert into frontier_items (user_id, newsroom_id, investigation_id, kind, label, why, priority, status)
      values (${user}, ${DEFAULT_NEWSROOM_ID}, ${seeded.investigationId}, ${"entity"},
              ${"Housing division"}, ${"named in the survey page"}, ${9}, ${"open"})
    `;

    // The worst case: a model that answers nothing at all.
    const out = await verifyRunSignals({
      userId: user,
      newsroomId: DEFAULT_NEWSROOM_ID,
      runId: seeded.runId,
      investigationId: seeded.investigationId,
      place: PLACE,
      deps: { search: fakeSearch().fn, model: async () => null },
    });

    assert.equal(out.checked, 1, "the pass must still run");
    const row = await readSignal(seeded.signalId);
    assert.equal(row.verification_status, "unverified");

    const stillThere = await sql<{ c: number }>`
      select count(*)::int as c from dark_signals where id = ${seeded.signalId}
    `;
    assert.equal(stillThere[0]!.c, 1, "an unverified signal must not be deleted");

    const openFrontier = await sql<{ c: number }>`
      select count(*)::int as c from frontier_items
      where investigation_id = ${seeded.investigationId}
        and status in ('open', 'investigating', 'reopened')
    `;
    assert.equal(openFrontier[0]!.c, 1, "verification must not close a frontier item");

    const inv = await sql<{ status: string }>`
      select status from investigations where id = ${seeded.investigationId}
    `;
    assert.notEqual(inv[0]!.status, "closed", "verification must not close the file");
  });
});

describe("the queue gate", { timeout: 60000 }, () => {
  it("refuses an unverified signal, in words, and takes it as a tip when the editor says so", async () => {
    await ensureLeadsTable();
    const user = `queue-gate-${Date.now()}`;
    const seeded = await seedSignal(user);

    const refused = await sendDarkSignalToQueueFor(user, DEFAULT_NEWSROOM_ID, seeded.signalId);
    assert.equal(refused.ok, false);
    assert.equal(refused.ok === false ? refused.blocked : null, "unverified");
    assert.match(refused.ok === false ? refused.error : "", /send unverified, as a tip/i);

    const asTip = await sendDarkSignalToQueueFor(user, DEFAULT_NEWSROOM_ID, seeded.signalId, {
      asTip: true,
    });
    assert.equal(asTip.ok, true);
    const sql = await getSql();
    const lead = await sql<{ why: string }>`
      select why from leads where id = ${asTip.ok ? asTip.leadId : 0}
    `;
    assert.match(lead[0]!.why, /Sent unverified/);
  });

  it("keeps a no / no / no signal in the file as a watch item rather than a lead", async () => {
    await ensureLeadsTable();
    const user = `queue-watch-${Date.now()}`;
    const seeded = await seedSignal(user, { name: "Annual meeting schedule posted" });
    await verifyRunSignals({
      userId: user,
      newsroomId: DEFAULT_NEWSROOM_ID,
      runId: seeded.runId,
      investigationId: seeded.investigationId,
      place: PLACE,
      deps: { search: fakeSearch().fn, model: async () => WATCH_ANSWER },
    });
    const row = await readSignal(seeded.signalId);
    assert.equal(row.verification_status, "verified");
    assert.equal(row.newsworthiness_decision, "watch");

    const res = await sendDarkSignalToQueueFor(user, DEFAULT_NEWSROOM_ID, seeded.signalId);
    assert.equal(res.ok, false);
    assert.equal(res.ok === false ? res.blocked : null, "watch");
    assert.match(res.ok === false ? res.error : "", /watch item/i);
  });

  it("blocks the whole file while every signal on it is speculative, and never blocks a file with none", async () => {
    await ensureLeadsTable();
    const user = `queue-file-${Date.now()}`;
    const seeded = await seedSignal(user);
    const blocked = await queueInvestigationFor(user, DEFAULT_NEWSROOM_ID, seeded.investigationId);
    assert.equal(blocked.ok, false);
    assert.match("error" in blocked ? blocked.error : "", /four gates/);

    const tipped = await queueInvestigationFor(user, DEFAULT_NEWSROOM_ID, seeded.investigationId, {
      asTip: true,
    });
    assert.equal(tipped.ok, true);

    // A file with no signals at all is untouched by the gate: there is
    // nothing to verify, so there is nothing to hold back.
    const sql = await getSql();
    const bare = await sql<{ id: number }>`
      insert into investigations (user_id, newsroom_id, title, summary, status)
      values (${user}, ${DEFAULT_NEWSROOM_ID}, ${"Bare file"}, ${"nothing filed"}, ${"open"})
      returning id
    `;
    const ok = await queueInvestigationFor(user, DEFAULT_NEWSROOM_ID, bare[0]!.id);
    assert.equal(ok.ok, true);
  });
});
