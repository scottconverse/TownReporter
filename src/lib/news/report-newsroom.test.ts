import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import type { ReportChat, reportAndDraft as ReportAndDraft } from "./report.ts";
import type { LeadRow } from "./types.ts";
import type { DeskJob } from "./jobs.ts";

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let getPaperConfig: typeof import("./paper-settings.ts").getPaperConfig;
let rememberCapture: typeof import("./investigate.ts").rememberCapture;
let reportAndDraft: typeof ReportAndDraft;
let performDraftWork: typeof import("./desk.ts").performDraftWork;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ getPaperConfig } = await vite.ssrLoadModule("/src/lib/news/paper-settings.ts"));
  ({ rememberCapture } = await vite.ssrLoadModule("/src/lib/news/investigate.ts"));
  ({ reportAndDraft } = await vite.ssrLoadModule("/src/lib/news/report.ts"));
  ({ performDraftWork } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
});

it("threads the claimed job newsroom into the actual report worker", async () => {
  const sql = await getSql();
  const newsroomId = 99802;
  const userId = "report-worker-boundary";
  await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict(id) do nothing", [
    newsroomId,
    "Worker boundary newsroom",
  ]);
  await sql.query(
    "insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)",
    [userId, newsroomId],
  );
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Worker boundary lead','Why this matters','council','new','[]','',10,'{}') returning id",
    [userId, newsroomId],
  );
  const [jobRow] = await sql.query<{ id: number }>(
    "insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token) values($1,$2,'draft',$3,'local-model','editor','public','default','running','Drafting','worker-boundary-claim') returning id",
    [userId, newsroomId, lead.id],
  );
  const job = {
    id: jobRow.id,
    newsroom_id: newsroomId,
    user_id: userId,
    kind: "draft",
    subject_id: lead.id,
    model_choice: "local-model",
    model_choice_source: "editor",
    research_scope: "public",
    lane: "default",
    status: "running",
    stage: "Drafting",
    claim_token: "worker-boundary-claim",
  } as DeskJob;
  let observedNewsroomId: number | undefined;
  try {
    await performDraftWork(job, {
      reportAndDraft: async (input) => {
        observedNewsroomId = input.newsroomId;
        return {
          headline: "Worker boundary draft",
          dek: "A scoped draft.",
          body: "The worker retained its newsroom context.",
          topic: "council",
          source_urls: [],
          integrity_notes: "",
          memory_entities: [],
          form: "brief",
          provenance: [],
          found_note: "[]",
          findings: [],
          unanswered: [],
          claims: [],
          research_memo: {},
        };
      },
      setJobStage: async () => undefined,
    });
    assert.equal(observedNewsroomId, newsroomId);
  } finally {
    await sql.query("delete from audit_events where newsroom_id=$1", [newsroomId]);
    await sql.query("delete from drafts where newsroom_id=$1", [newsroomId]);
    await sql.query("delete from desk_jobs where newsroom_id=$1", [newsroomId]);
    await sql.query("delete from leads where newsroom_id=$1", [newsroomId]);
    await sql.query("delete from newsroom_members where newsroom_id=$1", [newsroomId]);
    await sql.query("delete from newsrooms where id=$1", [newsroomId]);
  }
});
after(async () => vite.close());

it("keeps paper identity, captures, and hydrated provenance in the report newsroom", async () => {
  const sql = await getSql();
  const newsroomId = 99801;
  const otherNewsroomId = 1;
  const userId = "report-newsroom-boundary";
  const stamp = Date.now();
  const url = `https://example.com/report-newsroom-${stamp}`;
  await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict(id) do nothing", [
    otherNewsroomId,
    "Other newsroom",
  ]);
  await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict(id) do nothing", [
    newsroomId,
    "Boundary newsroom",
  ]);
  await getPaperConfig(newsroomId);
  await sql.query(
    "insert into paper_settings(newsroom_id,name,city,state) values($1,$2,$3,$4) on conflict(newsroom_id) do update set name=excluded.name,city=excluded.city,state=excluded.state",
    [newsroomId, "Boundary Gazette", "Boundary City", "Wyoming"],
  );
  const foreign = await rememberCapture({
    userId,
    newsroomId: otherNewsroomId,
    investigationId: null,
    url,
    title: "Foreign newsroom record",
    text: "Foreign newsroom text must never hydrate into the boundary report.",
    hash: `foreign-${stamp}`,
    status: 200,
    outcome: "fetched",
    triggerKind: "draft",
    observedAt: new Date(Date.now() + 60_000),
  });
  await rememberCapture({
    userId,
    newsroomId: otherNewsroomId,
    investigationId: null,
    url,
    title: "Second foreign newsroom record",
    text: "A second foreign version must not inflate the owned version count.",
    hash: `foreign-second-${stamp}`,
    status: 200,
    outcome: "fetched",
    triggerKind: "draft",
    observedAt: new Date(Date.now() + 120_000),
  });
  const [repointed] = await sql.query<{ id: number }>(
    "insert into capture_events(user_id,newsroom_id,source_url,observed_at,http_status,fetch_outcome,version_id,content_hash,trigger_kind) values($1,$2,$3,$4,200,'fetched',$5,'foreign-repoint','draft') returning id",
    [userId, newsroomId, url, new Date(Date.now() + 180_000), foreign.versionId],
  );
  const wrongUrl = `${url}/private-other-record`;
  const wrongUrlVersion = await rememberCapture({
    userId,
    newsroomId,
    investigationId: null,
    url: wrongUrl,
    title: "Unrelated owned record",
    text: "Same-newsroom text from another URL must not hydrate here.",
    hash: `wrong-url-${stamp}`,
    status: 200,
    outcome: "fetched",
    triggerKind: "draft",
  });
  const [wrongUrlRepointed] = await sql.query<{ id: number }>(
    "insert into capture_events(user_id,newsroom_id,source_url,observed_at,http_status,fetch_outcome,version_id,content_hash,trigger_kind) values($1,$2,$3,$4,200,'fetched',$5,'wrong-url-repoint','draft') returning id",
    [userId, newsroomId, url, new Date(Date.now() + 240_000), wrongUrlVersion.versionId],
  );
  await rememberCapture({
    userId: "another-boundary-editor",
    newsroomId,
    investigationId: null,
    url,
    title: "Earlier owned newsroom record",
    text: "Another editor captured an earlier version for the same newsroom.",
    hash: `owned-earlier-${stamp}`,
    status: 200,
    outcome: "fetched",
    triggerKind: "draft",
  });

  const systems: string[] = [];
  const chat: ReportChat = async (system) => {
    systems.push(system);
    if (systems.length === 1) {
      return {
        ok: true,
        text: JSON.stringify({
          news: "The library board approved an update.",
          why_it_matters: "Residents use the room.",
          angle: "Library update",
          form: "brief",
          questions: [],
          unknowns: [],
          follow: "",
        }),
      };
    }
    return {
      ok: true,
      text: JSON.stringify({
        headline: "Library board approves recreation-room update",
        dek: "The work begins Tuesday.",
        body: "The library board approved the recreation-room update Tuesday.",
        topic: "community-life",
        source_urls: [url],
        integrity_notes: "",
        form: "brief",
        found: [],
        unanswered: [],
        reporting_trail: [],
      }),
    };
  };
  const lead: LeadRow = {
    id: 99801,
    headline: "Library board approves recreation-room update",
    why: "The work begins Tuesday.",
    topic: "community-life",
    status: "new",
    source_urls: JSON.stringify([url]),
    evidence: "",
    newsworthiness: 10,
    created_at: new Date().toISOString(),
  };

  try {
    const result = await reportAndDraft(
      {
        userId,
        newsroomId,
        lead,
        urls: [url],
        memory: [],
        modelChoice: "local-model",
      } as Parameters<typeof reportAndDraft>[0],
      {
        ingest: async () => ({
          url,
          title: "Boundary library record",
          text: "The library board approved the recreation-room update Tuesday.",
          extras: [],
        }),
        search: async () => [],
        chat,
      },
    );
    assert.ok(!("error" in result), "error" in result ? result.error : "");
    const ownVersions = await sql.query<{ id: number; user_id: string }>(
      "select id,user_id from artifact_versions where newsroom_id=$1 and url=$2",
      [newsroomId, url],
    );
    const otherVersions = await sql.query<{ id: number }>(
      "select id from artifact_versions where newsroom_id=$1 and url=$2 order by id",
      [otherNewsroomId, url],
    );
    assert.equal(ownVersions.length, 2, "the report capture was not stored in its newsroom");
    assert.equal(otherVersions.length, 2, "the report capture crossed into newsroom 1");
    assert.ok(foreign.versionId != null);
    const reportVersionId = ownVersions.find((version) => version.user_id === userId)?.id;
    assert.ok(reportVersionId != null);
    assert.ok(systems.some((system) => system.includes("Boundary Gazette")));
    if (!("error" in result)) {
      assert.ok(
        result.provenance.some(
          (item) => item.url === url && item.version_id === reportVersionId,
        ),
        "hydrated provenance did not use the same-newsroom captured version",
      );
      assert.ok(
        result.provenance.every(
          (item) => !otherVersions.some((foreignVersion) => foreignVersion.id === item.version_id),
        ),
      );
      assert.ok(
        result.provenance.every(
          (item) =>
            item.capture_event_id !== repointed.id &&
            item.capture_event_id !== wrongUrlRepointed.id,
        ),
        "a capture repointed across a newsroom or URL reached hydrated provenance",
      );
      assert.ok(
        result.provenance.some((item) => item.url === url && item.version_count === 2),
        "same-URL versions from another newsroom inflated the owned version count",
      );
    }
  } finally {
    await sql.query("delete from capture_events where newsroom_id=$1 and source_url=$2", [
      newsroomId,
      url,
    ]);
    await sql.query("delete from capture_events where newsroom_id=$1 and source_url=$2", [
      otherNewsroomId,
      url,
    ]);
    await sql.query(
      "delete from artifact_chunks where newsroom_id in ($1,$2) and version_id in (select id from artifact_versions where newsroom_id in ($1,$2) and url=$3)",
      [
      newsroomId,
      otherNewsroomId,
      url,
      ],
    );
    await sql.query("delete from artifact_versions where newsroom_id in ($1,$2) and url=$3", [
      newsroomId,
      otherNewsroomId,
      url,
    ]);
    await sql.query("delete from paper_settings where newsroom_id=$1", [newsroomId]);
    await sql.query("delete from newsrooms where id=$1", [newsroomId]);
  }
});
