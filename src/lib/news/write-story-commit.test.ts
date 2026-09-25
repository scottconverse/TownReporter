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
      topic_unchosen boolean not null default false,
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
  /*
    Two kinds of case here. Most inject `getSections` and a fixed section list,
    which is how this file names a newsroom's beats without the sections
    machinery. The last three leave the reader alone: they build only the
    `newsroom_sections` table the light reader selects from, and pin what this
    newsroom's own words do to the topic, what the shipped vocabulary does
    when that table cannot be read, and that an unvalidatable section choice
    is refused.
  */
  const sectionConfig = {
    revision: 1,
    sections: ["community-life", "council", "hidden", "retired", "about", "opinion"].map(key => ({
      key, name: key, visible: key !== "hidden", brief: "", instructions: "", sourceIds: [],
      replacementKey: key === "retired" ? "community-life" : null,
    })),
  };
  for (const sectionKey of ["community-life", "hidden", undefined]) {
    it(`files the selected section ${sectionKey ?? "omitted default"} without inventing a new topic`, async () => {
      const sql = await ensureWriteStorySchema();
      const result = await writeStoryForAuthenticatedEditor({
        context: { userId: "section-editor", newsroomId: 820 },
        text: "Write a short local item about upcoming programs.", sectionKey,
        modelChoice: "claude-frontier",
      }, {
        getSql: async () => sql, getSections: async () => sectionConfig,
        audit: async () => {}, assertRate: async () => {},
        probeProvider: async () => ({ ok: true, label: "Claude Frontier", choice: "claude-frontier" }),
        enqueueJob: opts => enqueueJob({ ...opts, kick: false }),
      });
      assert.ok(result.ok);
      const [lead] = await sql<{topic:string;topic_unchosen:boolean}>`select topic, topic_unchosen from leads where id=${result.leadId}`;
      const [draft] = await sql<{topic:string}>`select topic from drafts where lead_id=${result.leadId}`;
      /*
        No sectionKey: the pasted text names no beat this newsroom files under
        (Unit P item 2), so the column takes the FIRST SECTION THIS NEWSROOM
        FILES UNDER -- community-life here, because sectionConfig lists it
        first -- and the lead records that nobody chose it. `council` was the
        old hard-wired answer and is not the newsroom's first section.
      */
      assert.equal(lead.topic, sectionKey ?? "community-life");
      assert.equal(
        lead.topic_unchosen,
        sectionKey === undefined,
        "only the editor's own choice clears the not-chosen mark",
      );
      assert.equal(draft.topic, lead.topic);
    });
  }
  for (const sectionKey of ["foreign-only", "retired", "about", "opinion", "bad/key", "", null, 7]) {
    it(`rejects unavailable/non-reporting section ${JSON.stringify(sectionKey)} before filing`, async () => {
      const sql = await ensureWriteStorySchema();
      let touched = false;
      const result = await writeStoryForAuthenticatedEditor({
        context: { userId: "section-editor", newsroomId: 820 },
        text: "Write a short local item about upcoming programs.",
        sectionKey: sectionKey as string,
      }, {
        getSections: async (newsroomId) => { assert.equal(newsroomId, 820); return sectionConfig; },
        getSql: async () => { touched = true; return sql; },
        audit: async () => {}, assertRate: async () => {},
        probeProvider: async () => ({ ok: true, label: "Claude Frontier", choice: "claude-frontier" }),
        enqueueJob: opts => enqueueJob({ ...opts, kick: false }),
      });
      assert.equal(result.ok, false);
      assert.equal(touched, false);
      if (!result.ok) assert.match(result.error, /section/i);
    });
  }
  it("persists the authenticated Write box assignment independently of its scratch evidence", async () => {
    const sql = await ensureWriteStorySchema();
    const text = "Write a short local item about upcoming library programs.";
    const result = await writeStoryForAuthenticatedEditor({ context: { userId: "assignment-editor", newsroomId: 813 }, text, modelChoice: "claude-frontier" }, {
      getSql: async () => sql, getSections: async () => sectionConfig, audit: async () => {}, assertRate: async () => {},
      probeProvider: async () => ({ ok: true, choice: "claude-frontier", label: "Claude" }),
      enqueueJob: (opts) => enqueueJob({ ...opts, kick: false }),
    });
    assert.ok(result.ok);
    const [row] = await sql<{ notes_json: string }>`select notes_json from leads where newsroom_id=813`;
    assert.deepEqual(JSON.parse(row.notes_json).editorialAssignment, { origin: "write-box", text, requestedForm: "brief" });
  });
  it("persists supplied-material scope on both the lead and immutable queued job", async () => {
    const sql = await ensureWriteStorySchema();
    const res = await writeStoryForAuthenticatedEditor({ context: { userId: "scope-editor", newsroomId: 811 }, text: "Library hours change Tuesday. Opens at noon.", researchScope: "supplied", modelChoice: "claude-frontier" }, {
      getSql: async () => sql, getSections: async () => sectionConfig, audit: async () => {}, assertRate: async () => {},
      probeProvider: async () => ({ ok: true, choice: "claude-frontier", label: "Claude" }),
      enqueueJob: (opts) => enqueueJob({ ...opts, kick: false }),
    });
    assert.equal(res.ok, true);
    const [row] = await sql<{notes_json:string}>`select notes_json from leads where newsroom_id = 811`;
    assert.equal(JSON.parse(row.notes_json).researchScope, "supplied");
    const [job] = await sql<{research_scope:string}>`select research_scope from desk_jobs where newsroom_id = 811`;
    assert.equal(job.research_scope, "supplied");
  });
  it("allows Automatic to enqueue Codex with supplied material", async () => {
    const sql = await ensureWriteStorySchema();
    let enqueued = false;
    const res = await writeStoryForAuthenticatedEditor({ context: { userId: "scope-codex", newsroomId: 812 }, text: "Library hours change Tuesday. Opens at noon.", researchScope: "supplied", modelChoice: "auto" }, {
      getSql: async () => sql, getSections: async () => sectionConfig, audit: async () => {}, assertRate: async () => {},
      probeProvider: async () => ({ ok: true, choice: "codex-balanced", label: "Codex" }),
      enqueueJob: async (opts) => { enqueued = true; return enqueueJob({ ...opts, kick: false }); },
    });
    assert.equal(res.ok, true);
    assert.equal(enqueued, true);
    const [job] = await sql<{ model_choice: string; research_scope: string }>`select model_choice, research_scope from desk_jobs where newsroom_id = 812`;
    assert.equal(job.model_choice, "codex-balanced");
    assert.equal(job.research_scope, "supplied");
  });
  it("refuses without touching the database when the text does not parse into a lead", async () => {
    const sql = await ensureWriteStorySchema();
    const userId = `write-story-refuse-${Date.now()}-${Math.random()}`;
    let probeCalls = 0;
    const res = await writeStoryForAuthenticatedEditor(
      { context: { userId, newsroomId: 1 }, text: "   " },
      {
        getSections: async () => sectionConfig,
        probeProvider: async () => { probeCalls += 1; return { ok: false as const, error: "unused" }; },
      },
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
        getSections: async () => sectionConfig,
        probeProvider: async (choice) => {
          probeCalls += 1;
          assert.equal(choice, "auto");
          return { ok: true as const, label: "Claude Frontier", choice: "claude-frontier" as const };
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
        getSections: async () => sectionConfig,
        probeProvider: async () => ({ ok: false as const, error: NOT_INSTALLED }),
      },
    );
    assert.equal(res.ok, false);
    if (res.ok) return assert.fail("a missing provider must refuse the draft");
    if (!("leadId" in res)) return assert.fail("the failed draft must retain its filed lead");
    assert.ok(res.leadId, "the lead is filed before the provider is asked");
    assert.match(res.error, /Codex is not installed/i);

    const sql = await getSql();
    const [{ count }] = await sql<{ count: number }>`
      select count(*) as count from leads where id = ${res.leadId}
    `;
    assert.equal(Number(count), 1);
  });

  it("lets this newsroom's own section name and brief decide the beat", async () => {
    const sql = await ensureWriteStorySchema();
    await sql.query(`
      create table if not exists newsroom_sections (
        newsroom_id integer not null, key text not null, name text not null,
        position integer not null default 0, brief text not null default '', replacement_key text
      )
    `);
    await sql.query(`
      insert into newsroom_sections (newsroom_id, key, name, brief, replacement_key)
      values (817, 'local-media', 'Local media', 'Nonprofit newsrooms, hires and fundraisers', null)
    `);
    const res = await writeStoryForAuthenticatedEditor(
      {
        context: { userId: "own-words", newsroomId: 817 },
        text: "Longmont Public Media hires a new executive director\nThe nonprofit said Tuesday it hired Ana Duarte, who spent eight years at a community radio station in Greeley and holds a degree in education from Colorado State University.",
        modelChoice: "claude-frontier",
      },
      {
        getSql: async () => sql, audit: async () => {}, assertRate: async () => {},
        probeProvider: async () => ({ ok: true as const, label: "Claude Frontier", choice: "claude-frontier" as const }),
        enqueueJob: opts => enqueueJob({ ...opts, kick: false }),
      },
    );
    assert.ok(res.ok);
    const [lead] = await sql<{ topic: string; topic_unchosen: boolean }>`
      select topic, topic_unchosen from leads where id=${res.leadId}
    `;
    assert.equal(lead.topic, "local-media", "the newsroom's own brief names the hire, not the degree in education");
    assert.equal(lead.topic_unchosen, false);
  });

  it("files with the shipped vocabulary when this newsroom's sections cannot be read", async () => {
    const sql = await ensureWriteStorySchema();
    const res = await writeStoryForAuthenticatedEditor(
      {
        context: { userId: "sections-unreadable", newsroomId: 815 },
        text: "St. Vrain Valley Schools board packet posted",
        modelChoice: "claude-frontier",
      },
      {
        getSql: async () => sql, audit: async () => {}, assertRate: async () => {},
        probeProvider: async () => ({ ok: true as const, label: "Claude Frontier", choice: "claude-frontier" as const }),
        enqueueJob: opts => enqueueJob({ ...opts, kick: false }),
      },
    );
    assert.ok(res.ok, "an unreadable section list must not cost the editor the write");
    const [lead] = await sql<{ topic: string; topic_unchosen: boolean }>`
      select topic, topic_unchosen from leads where id=${res.leadId}
    `;
    assert.equal(lead.topic, "schools", "the shipped vocabulary still reads a schools story");
    assert.equal(lead.topic_unchosen, false);
  });

  it("refuses a section choice it cannot validate rather than filing the wrong one", async () => {
    const sql = await ensureWriteStorySchema();
    const res = await writeStoryForAuthenticatedEditor(
      {
        context: { userId: "sections-unreadable-choice", newsroomId: 816 },
        text: "St. Vrain Valley Schools board packet posted",
        sectionKey: "schools",
        modelChoice: "claude-frontier",
      },
      {
        getSql: async () => sql,
        getSections: async () => { throw new Error("sections are unreadable right now"); },
      },
    );
    assert.equal(res.ok, false);
    if (res.ok) return assert.fail("an unvalidatable section choice must be refused");
    assert.match(res.error, /section/i);
  });
});
