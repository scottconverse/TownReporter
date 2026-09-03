import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureJobsSchema, enqueueJob } from "./jobs.ts";
import { writeStoryForAuthenticatedEditor } from "./model-request-commit.server.ts";

async function ensureWriteStorySchema() {
  const sql = await getSql();
  await ensureJobsSchema();
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
      created_at timestamptz not null default now()
    )
  `);
  await sql.query(`
    create table if not exists drafts (
      id serial primary key,
      newsroom_id integer not null default 1,
      user_id text not null,
      lead_id integer not null,
      headline text not null,
      dek text not null default '',
      body text not null default '',
      topic text not null default 'council',
      source_urls text not null default '[]',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await sql.query(`
    create table if not exists desk_rate (
      id serial primary key,
      user_id text not null,
      action text not null,
      created_at timestamptz not null default now()
    )
  `);
  await sql.query(`
    create table if not exists audit_events (
      id serial primary key,
      user_id text not null,
      action text not null,
      detail text not null default '',
      created_at timestamptz not null default now()
    )
  `);
  return sql;
}

describe("writeStoryForAuthenticatedEditor", () => {
  it("refuses without touching the database when the text does not parse into a lead", async () => {
    const sql = await ensureWriteStorySchema();
    const userId = `write-story-refuse-${Date.now()}-${Math.random()}`;
    let probeCalls = 0;
    const res = await writeStoryForAuthenticatedEditor(
      { context: { userId, newsroomId: 1 }, text: "   " },
      { probeProvider: async () => { probeCalls += 1; return { ok: false as const, error: "unused" }; } },
    );
    assert.equal(res.ok, false);
    if (res.ok) return assert.fail("empty input must be refused");
    assert.match(res.error, /not enough here/);
    assert.equal(probeCalls, 0);
    const [{ count }] = await sql<{ count: number }>`
      select count(*) as count from leads where user_id = ${userId}
    `;
    assert.equal(Number(count), 0);
  });

  it("files a lead with the pasted text kept as scratch, then probes readiness before enqueuing", async () => {
    const sql = await ensureWriteStorySchema();
    const userId = `write-story-file-${Date.now()}-${Math.random()}`;
    let probeCalls = 0;
    let enqueueCalls = 0;
    const text =
      "The planning board moved the Kimbark hearing to Oct. 2\nhttps://example.org/agenda";
    const res = await writeStoryForAuthenticatedEditor(
      { context: { userId, newsroomId: 1 }, text, modelChoice: "auto" },
      {
        probeProvider: async (choice) => {
          probeCalls += 1;
          assert.equal(choice, "auto");
          return { ok: true as const, choice: "claude-frontier" as const };
        },
        enqueueJob: async (opts) => {
          enqueueCalls += 1;
          return enqueueJob({ ...opts, kick: false });
        },
      },
    );
    assert.equal(res.ok, true);
    if (!res.ok) return assert.fail("a well-formed paste must file");
    assert.equal(probeCalls, 1);
    assert.equal(enqueueCalls, 1);
    assert.ok(res.leadId);
    assert.ok("pending" in res && res.pending);

    const [lead] = await sql<{
      headline: string;
      why: string;
      source_urls: string;
      notes_json: string;
    }>`
      select headline, why, source_urls, notes_json from leads where id = ${res.leadId}
    `;
    assert.ok(lead);
    assert.equal(lead.headline, "The planning board moved the Kimbark hearing to Oct. 2");
    assert.equal(lead.why, "Filed from the Write a story box.");
    assert.deepEqual(JSON.parse(lead.source_urls), ["https://example.org/agenda"]);
    const notes = JSON.parse(lead.notes_json) as { scratch: string };
    assert.equal(notes.scratch, text);

    const [draft] = await sql<{ source_urls: string; headline: string }>`
      select source_urls, headline from drafts where lead_id = ${res.leadId}
    `;
    assert.ok(draft, "publishLead reads the draft's source_urls, so the draft row must exist too");
    assert.deepEqual(JSON.parse(draft.source_urls), ["https://example.org/agenda"]);
  });

  it("refuses the commit step, but keeps the filed lead, when the provider is not ready", async () => {
    await ensureWriteStorySchema();
    const userId = `write-story-noprovider-${Date.now()}-${Math.random()}`;
    const NOT_INSTALLED = "Codex CLI not found on PATH.";
    const res = await writeStoryForAuthenticatedEditor(
      {
        context: { userId, newsroomId: 1 },
        text: "https://example.org/agenda The planning board moved the Kimbark hearing to Oct. 2",
        modelChoice: "codex-balanced",
      },
      {
        probeProvider: async () => ({ ok: false as const, error: NOT_INSTALLED }),
      },
    );
    assert.equal(res.ok, false);
    if (res.ok) return assert.fail("a missing provider must refuse the draft");
    assert.ok(res.leadId, "the lead is filed before the provider is asked");
    assert.match(res.error, /Codex is not installed/i);

    const sql = await getSql();
    const [{ count }] = await sql<{ count: number }>`
      select count(*) as count from leads where id = ${res.leadId}
    `;
    assert.equal(Number(count), 1);
  });
});
