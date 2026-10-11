import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { getSql } from "../db.ts";
import { ensureJobsSchema, enqueueJob } from "./jobs.ts";
import { ensurePaperSettingsSchema } from "./paper-settings.ts";
import { ensureStoryDocuments, storeStoryDocument } from "./story-documents.server.ts";
import { commitOpinionForAuthenticatedEditor } from "./model-request-commit.server.ts";
import {
  clearSetupCodeOverrideForTests,
  forceSetupCodeSatisfiedForTests,
} from "./setup-code.server.ts";

/*
  Audit item 21: Opinion's document count and total-material caps warn once and
  accept a second call carrying `override: [key]`, storing the material whole
  rather than truncating it. The model/network technical limits (an unready
  provider, a duplicate document) are NOT warnable and still refuse.
*/

const room = 75001;

const DOCUMENTS_KEY = "opinion:documents-over-20";
const MATERIAL_KEY = "opinion:material-over-20-million";

const readyOpinionDeps = {
  checkReadiness: async () => ({
    ready: true,
    why: "",
    problems: [],
    effectiveChoice: "auto" as const,
  }),
  ensureEditorialRequestSchema: async () => undefined,
  assertRate: async () => undefined,
  enqueueJob: (opts: Parameters<typeof enqueueJob>[0]) => enqueueJob({ ...opts, kick: false }),
  findOpenJob: async () => null,
  audit: async () => undefined,
};

async function ensureSchema() {
  const sql = await getSql();
  await ensureJobsSchema();
  await ensureStoryDocuments(sql);
  await sql.query(`
    create table if not exists editorial_requests (
      id serial primary key,
      user_id text not null,
      newsroom_id integer not null default 1,
      subject text not null,
      source_text text not null default '',
      source_kind text not null default 'paste',
      source_ref text not null default '',
      asked_for text not null default '',
      pointers_json text not null default '[]',
      our_story_json text,
      model_choice text not null default 'auto',
      draft_id integer,
      error text,
      created_at timestamptz not null default now(),
      finished_at timestamptz
    )
  `);
  await sql.query("delete from editorial_requests where newsroom_id=$1", [room]);
  await sql.query("delete from desk_jobs where newsroom_id=$1", [room]);
  await sql.query("delete from story_documents where newsroom_id=$1", [room]);
  await sql.query("delete from audit_events where newsroom_id=$1", [room]);
  return sql;
}

before(() => forceSetupCodeSatisfiedForTests());
before(async () => {
  await ensurePaperSettingsSchema();
  const sql = await getSql();
  await sql.query(
    "insert into paper_settings(newsroom_id,onboarded) values($1,true) on conflict (newsroom_id) do update set onboarded=true",
    [room],
  );
});
beforeEach(ensureSchema);
describe("Opinion commit overrides (item 21)", () => {
  it("warns above 20 documents, then accepts the same request under override", async () => {
    const sql = await getSql();
    const userId = `opinion-docs-${Date.now()}-${Math.random()}`;
    const ids: string[] = [];
    for (let index = 0; index < 21; index += 1) {
      const stored = await storeStoryDocument(
        room,
        userId,
        `document-${index}.txt`,
        "text/plain",
        new TextEncoder().encode(`Document ${index}`),
      );
      ids.push(stored.id);
    }

    const warned = await commitOpinionForAuthenticatedEditor(
      { context: { userId, newsroomId: room }, subject: "", documentIds: ids, modelChoice: "auto" },
      readyOpinionDeps,
    );
    assert.equal(warned.ok, false);
    if (warned.ok) assert.fail("21 documents must warn");
    assert.equal((warned as { warning: { key: string } }).warning.key, DOCUMENTS_KEY);
    const [counts] = await sql.query<{ requests: number; jobs: number }>(
      `select (select count(*) from editorial_requests where newsroom_id=$1) as requests,
              (select count(*) from desk_jobs where newsroom_id=$1) as jobs`,
      [room],
    );
    assert.equal(Number(counts?.requests ?? -1), 0, "the warned call writes no request");
    assert.equal(Number(counts?.jobs ?? -1), 0, "the warned call writes no job");

    const saved = await commitOpinionForAuthenticatedEditor(
      {
        context: { userId, newsroomId: room },
        subject: "",
        documentIds: ids,
        modelChoice: "auto",
        override: [DOCUMENTS_KEY],
      },
      readyOpinionDeps,
    );
    assert.equal(saved.ok, true, saved.ok ? "" : (saved as { error: string }).error);
    if (!saved.ok) return;
    const [linked] = await sql.query<{ count: number }>(
      "select count(*)::int as count from story_documents where editorial_request_id=$1 and newsroom_id=$2",
      [saved.requestId, room],
    );
    assert.equal(Number(linked?.count ?? 0), 21, "every overridden document is attached");
    const [audit] = await sql.query<{ count: number }>(
      "select count(*)::int as count from audit_events where user_id=$1 and action='override'",
      [userId],
    );
    assert.equal(Number(audit?.count ?? 0), 1, "one override audit row");
  });

  it("warns above 20 million characters, then stores the material whole without truncation", async () => {
    const sql = await getSql();
    const userId = `opinion-material-${Date.now()}-${Math.random()}`;
    const material = `Start of a very long editorial. ${"x".repeat(20_000_050)}`;
    assert.ok(material.length > 20_000_000);

    const warned = await commitOpinionForAuthenticatedEditor(
      { context: { userId, newsroomId: room }, subject: material, modelChoice: "auto" },
      readyOpinionDeps,
    );
    assert.equal(warned.ok, false);
    if (warned.ok) assert.fail("over-20M material must warn");
    assert.equal((warned as { warning: { key: string } }).warning.key, MATERIAL_KEY);

    const saved = await commitOpinionForAuthenticatedEditor(
      {
        context: { userId, newsroomId: room },
        subject: material,
        modelChoice: "auto",
        override: [MATERIAL_KEY],
      },
      readyOpinionDeps,
    );
    assert.equal(saved.ok, true, saved.ok ? "" : (saved as { error: string }).error);
    if (!saved.ok) return;
    const [row] = await sql.query<{ length: number }>(
      "select length(source_text)::int as length from editorial_requests where id=$1",
      [saved.requestId],
    );
    assert.equal(
      Number(row?.length ?? 0),
      material.length,
      "the full material is stored, not truncated",
    );
    const [audit] = await sql.query<{ count: number }>(
      "select count(*)::int as count from audit_events where user_id=$1 and action='override'",
      [userId],
    );
    assert.equal(Number(audit?.count ?? 0), 1);
  });

  it("still refuses the same document twice, with or without an override", async () => {
    const userId = `opinion-dupes-${Date.now()}-${Math.random()}`;
    const stored = await storeStoryDocument(
      room,
      userId,
      "one.txt",
      "text/plain",
      new TextEncoder().encode("One document"),
    );
    const result = await commitOpinionForAuthenticatedEditor(
      {
        context: { userId, newsroomId: room },
        subject: "",
        documentIds: [stored.id, stored.id],
        modelChoice: "auto",
        override: [DOCUMENTS_KEY, MATERIAL_KEY],
      },
      readyOpinionDeps,
    );
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("a duplicate document must refuse");
    assert.match((result as { error: string }).error, /up to 20 different documents/i);
  });

  it("still refuses when no provider is ready, even with an override", async () => {
    const userId = `opinion-notready-${Date.now()}-${Math.random()}`;
    let enqueued = 0;
    const result = await commitOpinionForAuthenticatedEditor(
      {
        context: { userId, newsroomId: room },
        subject: "A subject long enough to start.",
        modelChoice: "auto",
        override: [DOCUMENTS_KEY, MATERIAL_KEY],
      },
      {
        ...readyOpinionDeps,
        checkReadiness: async () => ({
          ready: false,
          why: "AI is not available. No model is set up yet.",
          problems: ["AI is not available. No model is set up yet."],
          effectiveChoice: "auto" as const,
        }),
        enqueueJob: (opts: Parameters<typeof enqueueJob>[0]) => {
          enqueued += 1;
          return enqueueJob({ ...opts, kick: false });
        },
      },
    );
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("an unready provider must refuse regardless of override");
    assert.match((result as { error: string }).error, /not available/i);
    assert.equal(enqueued, 0, "no work is queued when the model is not reachable");
  });
});

after(() => clearSetupCodeOverrideForTests());
