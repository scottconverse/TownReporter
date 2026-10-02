/*
  SG1b finding 1: the refusal lives at the SHARED DRAFT COMMIT BOUNDARY.

  The bot's finding, verbatim in substance: `draftLead` was gated, but the other
  user-facing draft starters were not -- the New story "Write draft" box
  (`writeStoryFromInput` -> `writeStoryForAuthenticatedEditor`), Retry on a
  failed draft (`retryStoryJob` -> `commitStoryDraftForAuthenticatedEditor`),
  and Add lead with `then: "draft"` (the editor dialog's injected
  `commitDraft`) -- so on an un-onboarded newsroom each of them still queued
  paid drafting work against the shipped fallback town.

  Every test below runs against a real in-process database (PGlite) and the
  model seal: no provider is ever reached, because a refusal must happen before
  any provider is asked. `LIVE_SHAPED` is the production row -- onboarded, name,
  city and state EMPTY -- and it must be allowed EVERY one of these paths; the
  gate keys off `onboarded` and nothing else.
*/
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Sql } from "../db.ts";
import { getSql } from "../db.ts";
import { ensureJobsSchema } from "./jobs.ts";
import { ensurePaperSettingsSchema, PAPER_NOT_SET_UP_SENTENCE } from "./paper-settings.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import {
  commitStoryDraftForAuthenticatedEditor,
  writeStoryForAuthenticatedEditor,
} from "./model-request-commit.server.ts";
import { requestDraftReconciliation } from "./draft-reconcile.server.ts";
import { performAddLead, type EditorDialogDeps } from "./editor-dialog-actions.server.ts";

await applyMigrationsToTestPglite();

const UNSET = 990_101; // no paper_settings row at all: a brand-new install
const LIVE_SHAPED = 990_102; // onboarded = true, name/city/state empty: production

const READY_PROBE = async () => ({
  ok: true as const,
  label: "Claude Frontier",
  choice: "claude-frontier" as const,
});

before(async () => {
  await ensurePaperSettingsSchema();
  await ensureJobsSchema();
  const sql = await getSql();
  for (const id of [UNSET, LIVE_SHAPED]) {
    await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict (id) do nothing", [
      id,
      `SG1b room ${id}`,
    ]);
    await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'editor') on conflict do nothing", [
      "sg1b-editor",
      id,
    ]);
  }
  await sql.query("delete from paper_settings where newsroom_id in ($1,$2)", [UNSET, LIVE_SHAPED]);
  // The live shape, exactly as the production auditor read it.
  await sql.query(
    "insert into paper_settings(newsroom_id,name,city,state,onboarded) values($1,'','','',true)",
    [LIVE_SHAPED],
  );
});

/** A lead exists for this newsroom, so a refusal cannot be "lead not found". */
async function freshLead(newsroomId: number, userId: string): Promise<number> {
  const sql = await getSql();
  const [row] = await sql<{ id: number }>`
    insert into leads(user_id,newsroom_id,headline,why,topic,status)
    values(${userId},${newsroomId},'Council schedules a water hearing','The hearing is open to residents.','council','new')
    returning id
  `;
  return row!.id;
}

async function counts(newsroomId: number) {
  const sql = await getSql();
  const [row] = await sql<{ jobs: number; drafts: number; rate: number; leads: number }>`
    select
      (select count(*)::int from desk_jobs where newsroom_id = ${newsroomId}) as jobs,
      (select count(*)::int from drafts where newsroom_id = ${newsroomId}) as drafts,
      (select count(*)::int from desk_rate where newsroom_id = ${newsroomId}) as rate,
      (select count(*)::int from leads where newsroom_id = ${newsroomId}) as leads
  `;
  return row!;
}

describe("commitStoryDraftForAuthenticatedEditor refuses an un-set-up newsroom", () => {
  it("returns the one sentence and queues nothing at all", async () => {
    const userId = "sg1b-commit-refusal";
    const leadId = await freshLead(UNSET, userId);
    const before_ = await counts(UNSET);
    let rateCalls = 0;
    let probeCalls = 0;

    const result = await commitStoryDraftForAuthenticatedEditor(
      { context: { userId, newsroomId: UNSET }, leadId, modelChoice: "claude-frontier" },
      {
        probeProvider: (async () => {
          probeCalls += 1;
          return READY_PROBE();
        }) as never,
        assertRate: async () => {
          rateCalls += 1;
        },
      },
    );

    assert.equal(result.ok, false, "an un-set-up paper may not start a draft");
    if (result.ok) return;
    assert.equal(result.error, PAPER_NOT_SET_UP_SENTENCE("draft this story"));
    assert.equal(probeCalls, 0, "no provider may be asked before the refusal");
    assert.equal(rateCalls, 0, "no rate unit may be charged");
    const after = await counts(UNSET);
    assert.deepEqual(after, before_, "nothing was queued, drafted or charged");
  });

  it("FAILS CLOSED: a newsroom with no paper_settings row is refused, not assumed ready", async () => {
    const sql = await getSql();
    await sql.query("delete from paper_settings where newsroom_id = $1", [UNSET]);
    const leadId = await freshLead(UNSET, "sg1b-fail-closed");
    const result = await commitStoryDraftForAuthenticatedEditor(
      { context: { userId: "sg1b-fail-closed", newsroomId: UNSET }, leadId, modelChoice: "auto" },
      { probeProvider: READY_PROBE },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /has not been set up yet/);
  });

  it("ALLOWS the live shape: onboarded with blank name, city and state", async () => {
    const userId = "sg1b-live-commit";
    const leadId = await freshLead(LIVE_SHAPED, userId);
    const result = await commitStoryDraftForAuthenticatedEditor(
      { context: { userId, newsroomId: LIVE_SHAPED }, leadId, modelChoice: "claude-frontier" },
      {
        probeProvider: READY_PROBE,
        assertRate: async () => {},
        enqueueJob: async (options) => {
          const sql = await getSql();
          const [row] = await sql<{ id: number }>`
            insert into desk_jobs(newsroom_id,user_id,kind,subject_id,model_choice,status)
            values(${options.newsroomId},${options.userId},${options.kind},${options.subjectId},${options.modelChoice},'queued')
            returning id
          `;
          return { ...row!, model_choice: options.modelChoice, research_scope: null, subject_id: options.subjectId } as never;
        },
      },
    );
    assert.equal(result.ok, true, "the live paper must still be able to draft");
  });
});

describe("the New story 'Write draft' box refuses, and files nothing", () => {
  it("returns the sentence and leaves no lead and no draft behind", async () => {
    const before_ = await counts(UNSET);
    const result = await writeStoryForAuthenticatedEditor(
      {
        context: { userId: "sg1b-write-story", newsroomId: UNSET },
        text: "Library board schedules a budget hearing\nThe hearing is open to residents.",
        modelChoice: "claude-frontier",
      },
      { probeProvider: READY_PROBE, audit: async () => {}, enqueueJob: async () => { throw new Error("must not enqueue"); } },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, PAPER_NOT_SET_UP_SENTENCE("draft this story"));
    assert.deepEqual(await counts(UNSET), before_, "a refused write files no lead and no draft row");
  });

  it("still writes on the live shape", async () => {
    const result = await writeStoryForAuthenticatedEditor(
      {
        context: { userId: "sg1b-write-story-live", newsroomId: LIVE_SHAPED },
        text: "Library board schedules a budget hearing\nThe hearing is open to residents.",
        modelChoice: "claude-frontier",
      },
      {
        probeProvider: READY_PROBE,
        audit: async () => {},
        assertRate: async () => {},
        enqueueJob: async (options) => {
          const sql = await getSql();
          const [row] = await sql<{ id: number }>`
            insert into desk_jobs(newsroom_id,user_id,kind,subject_id,model_choice,status)
            values(${options.newsroomId},${options.userId},${options.kind},${options.subjectId},${options.modelChoice},'queued')
            returning id
          `;
          return { ...row!, model_choice: options.modelChoice, research_scope: null, subject_id: options.subjectId } as never;
        },
      },
    );
    assert.equal(result.ok, true);
  });
});

describe("retryStoryJob's commit paths refuse", () => {
  it("the draft branch: commitStoryDraftForAuthenticatedEditor is the refusal, before any provider", async () => {
    const userId = "sg1b-retry-draft";
    const leadId = await freshLead(UNSET, userId);
    const result = await commitStoryDraftForAuthenticatedEditor(
      { context: { userId, newsroomId: UNSET }, leadId, modelChoice: "claude-frontier", modelEffort: null },
      { probeProvider: READY_PROBE, assertRate: async () => {} },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, PAPER_NOT_SET_UP_SENTENCE("draft this story"));
  });

  it("the reconcile branch: requestDraftReconciliation throws the same sentence", async () => {
    const userId = "sg1b-retry-reconcile";
    const leadId = await freshLead(UNSET, userId);
    const sql = await getSql();
    await sql.query(
      "insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic) values($1,$2,$3,'Latest','','Latest','council')",
      [userId, UNSET, leadId],
    );
    await assert.rejects(
      () =>
        requestDraftReconciliation(
          { userId, newsroomId: UNSET },
          { leadId, modelChoice: "claude-frontier" },
          { probe: READY_PROBE as never, enqueue: (async () => { throw new Error("must not enqueue"); }) as never },
        ),
      (err: unknown) => {
        assert.equal(
          (err as Error).message,
          PAPER_NOT_SET_UP_SENTENCE("check this draft's evidence"),
        );
        return true;
      },
    );
  });

  it("retryStoryJob really reaches those two functions (source shape)", () => {
    const source = readFileSync(new URL("./job-progress.ts", import.meta.url), "utf8");
    const start = source.indexOf("export const retryStoryJob = createServerFn");
    assert.notEqual(start, -1);
    const body = source.slice(start, source.indexOf("\nexport ", start + 1));
    assert.match(body, /commitStoryDraftForAuthenticatedEditor\(\{/, "the draft branch still goes through the shared commit");
    assert.match(body, /requestDraftReconciliation\(context2,/, "the reconcile branch still goes through the shared boundary");
  });
});

describe("Add lead with then: 'draft' refuses the draft but keeps the lead", () => {
  /*
    The dialog's own reads are faked; `commitDraft` is the REAL commit boundary
    against the real database, which is the thing under test. The dialog's rule
    for the other two endings is "ok: true WITH A NOTICE, not ok: false" -- the
    lead is on the desk either way, and telling the editor the add failed would
    send them to add it twice. The paper refusal arrives as that notice.
  */
  function dialogDeps(): EditorDialogDeps {
    const tag = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ? ").replace(/\s+/g, " ").trim();
      if (/from drafts/i.test(text)) return Promise.resolve([]);
      if (/from sources/i.test(text)) return Promise.resolve([]);
      if (/source_urls/i.test(text)) return Promise.resolve([]);
      if (/from leads/i.test(text)) return Promise.resolve([]);
      return Promise.resolve([]);
    }) as unknown as Sql;
    return {
      getSql: async () => tag,
      chat: (async () => ({ ok: false as const, error: "no model in this test" })) as unknown as EditorDialogDeps["chat"],
      readAssignments: async () => [],
      saveDraft: (async () => ({ ok: true as const })) as unknown as EditorDialogDeps["saveDraft"],
      proposeSource: (async () => true) as unknown as EditorDialogDeps["proposeSource"],
      linkDocuments: (async () => ({ ok: true as const })) as unknown as EditorDialogDeps["linkDocuments"],
      insertLead: (async (context: { userId: string; newsroomId?: number }, input: { headline: string; why: string; topic: string; urls: string[] }) => {
        const sql = await getSql();
        const [row] = await sql<{ id: number }>`
          insert into leads(user_id,newsroom_id,headline,why,topic,status)
          values(${context.userId},${context.newsroomId ?? 1},${input.headline},${input.why},${input.topic},'new')
          returning id
        `;
        return { ok: true as const, id: row!.id };
      }) as unknown as EditorDialogDeps["insertLead"],
      commitDraft: commitStoryDraftForAuthenticatedEditor,
      now: () => new Date("2026-10-02T09:00:00Z"),
    };
  }

  it("files the lead, refuses the draft, and says why in the notice", async () => {
    const before_ = await counts(UNSET);
    const result = await performAddLead(
      { userId: "sg1b-add-lead", newsroomId: UNSET },
      { paste: "https://records.example/council-budget", then: "draft", modelChoice: "claude-frontier" },
      dialogDeps(),
    );
    assert.equal(result.ok, true, "the lead is filed either way");
    if (!result.ok) return;
    assert.equal(result.then, "draft");
    assert.match(
      result.notice ?? "",
      /has not been set up yet\. Finish Paper setup first/,
      "the editor is told why the draft did not start",
    );
    const after = await counts(UNSET);
    assert.equal(after.leads, before_.leads + 1, "the lead still lands on the desk");
    assert.equal(after.jobs, before_.jobs, "no drafting job is queued");
  });

  it("files the lead and needs no paper setup when 'Then' is not draft", async () => {
    const before_ = await counts(LIVE_SHAPED);
    const result = await performAddLead(
      { userId: "sg1b-add-lead-as-is", newsroomId: LIVE_SHAPED },
      { paste: "https://records.example/council-budget", then: "as-is" },
      dialogDeps(),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.then, "as-is");
    const after = await counts(LIVE_SHAPED);
    assert.equal(after.leads, before_.leads + 1);
  });
});
