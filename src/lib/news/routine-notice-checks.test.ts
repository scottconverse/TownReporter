import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";
import { getSql } from "../db.ts";
import type { IngestDocument } from "./ingest.ts";

let vite: Awaited<ReturnType<typeof createServer>>;
let checks: typeof import("./routine-notice-checks.server.ts");
let ingestModule: typeof import("./ingest.ts");
let setFetchImplForTests: typeof import("./fetch-url.ts").setFetchImplForTests;
let roomSequence = 98000;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
  checks = await vite.ssrLoadModule("/src/lib/news/routine-notice-checks.server.ts");
  ingestModule = await vite.ssrLoadModule("/src/lib/news/ingest.ts");
  ({ setFetchImplForTests } = await vite.ssrLoadModule("/src/lib/news/fetch-url.ts"));
});

after(async () => {
  setFetchImplForTests?.(null);
  await vite?.close();
});

function htmlDocument(html: string): IngestDocument {
  return {
    ok: false,
    status: 200,
    outcome: "parse-failed",
    text: "",
    title: "Structured calendar",
    extras: [],
    contentType: "text/html; charset=utf-8",
    needsOcr: false,
    redirectChain: [],
    extractionMethod: "readability",
    pages: [],
    notices: [],
    rawBytes: new TextEncoder().encode(html),
  };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    "@type": "Event",
    "@id": "event-1",
    name: "Library craft hour",
    startDate: "2026-09-12T10:00:00-06:00",
    organizer: { name: "Town Library" },
    location: { name: "Main Library" },
    ...overrides,
  };
}

function page(...events: Array<Record<string, unknown>>) {
  return `<html><head><script type="application/ld+json">${JSON.stringify(
    events.length === 1 ? events[0] : { "@graph": events },
  )}</script></head><body></body></html>`;
}

async function fixture(formatKey = "library-notice") {
  const sql = await getSql();
  const room = ++roomSequence;
  const owner = `routine-check-owner-${room}`;
  const editor = `routine-check-editor-${room}`;
  const url = `https://example.test/routine/${room}`;
  await checks.ensureRoutineNoticeCheckSchema();
  await sql.query("insert into newsrooms(id,name) values($1,'Routine checks')", [room]);
  await sql.query(
    "insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'owner'),($3,$2,'editor')",
    [owner, room, editor],
  );
  const [source] = await sql.query<{ id: number }>(
    "insert into sources(user_id,newsroom_id,url,title,status) values($1,$2,$3,'Library','accepted') returning id",
    [owner, room, url],
  );
  await sql.query(
    "insert into routine_notice_policies(newsroom_id,revision,paused,updated_by) values($1,1,false,$2)",
    [room, owner],
  );
  await sql.query(
    "insert into routine_notice_approvals(newsroom_id,source_id,source_url,format_key) values($1,$2,$3,$4)",
    [room, source!.id, url, formatKey],
  );
  return {
    room,
    owner,
    editor,
    sourceId: source!.id,
    url,
    input: {
      requestId: randomUUID(),
      sourceId: source!.id,
      sourceUrl: url,
      formatKey,
      expectedPolicyRevision: 1,
    },
  };
}

describe("routine notice manual checks", () => {
  it("retains recognized structured-only raw HTML without rendered fallback", async () => {
    const raw = page(event());
    setFetchImplForTests(async () =>
      new Response(raw, { headers: { "content-type": "text/html; charset=utf-8" } }),
    );
    const result = await ingestModule.ingestDocument("https://1.1.1.1/routine", {
      acceptRawHtml: (body) => body.includes('"@type":"Event"'),
    });
    assert.equal(new TextDecoder().decode(result.rawBytes), raw);
    assert.equal(result.extractionMethod, "heuristic");
    setFetchImplForTests(null);
  });

  it("captures and reparses structured-only HTML without creating editorial work or monitors", async () => {
    const f = await fixture();
    const raw = page(event());
    const result = await checks.checkRoutineNoticeSourceForOwner(
      { userId: f.owner, newsroomId: f.room },
      f.input,
      { ingest: async () => htmlDocument(raw) },
    );
    assert.equal(result.check.state, "parsed");
    assert.equal(result.check.candidates.length, 1);
    assert.equal(result.check.source.sourceHref, "/desk/sources");
    const captured = await checks.readRoutineNoticeCapturedTextForOwner(
      { userId: f.owner, newsroomId: f.room },
      { checkId: result.check.checkId },
    );
    assert.equal(captured.fullText, raw);

    const sql = await getSql();
    for (const table of ["source_monitors", "leads", "drafts", "articles", "desk_jobs"]) {
      const [count] = await sql.query<{ n: number }>(
        `select count(*)::int n from ${table} where newsroom_id=$1`,
        [f.room],
      );
      assert.equal(count?.n, 0, `${table} must remain untouched`);
    }
  });

  it("returns a valid replay before fetching again and refuses a mismatched replay", async () => {
    const f = await fixture();
    let calls = 0;
    const ingest = async () => {
      calls += 1;
      return htmlDocument(page(event()));
    };
    const actor = { userId: f.owner, newsroomId: f.room };
    const first = await checks.checkRoutineNoticeSourceForOwner(actor, f.input, { ingest });
    const replay = await checks.checkRoutineNoticeSourceForOwner(actor, f.input, {
      ingest: async () => {
        throw new Error("a successful replay must not fetch");
      },
    });
    assert.equal(replay.check.checkId, first.check.checkId);
    assert.equal(calls, 1);
    const sql = await getSql();
    await sql.query(
      "insert into routine_notice_approvals(newsroom_id,source_id,source_url,format_key) select newsroom_id,source_id,source_url,'community-arts-event-logistics' from routine_notice_approvals where newsroom_id=$1 and source_id=$2 limit 1",
      [f.room, f.sourceId],
    );
    await assert.rejects(
      checks.checkRoutineNoticeSourceForOwner(
        actor,
        { ...f.input, formatKey: "community-arts-event-logistics" },
        { ingest },
      ),
      /another check/i,
    );
    await sql.query("update routine_notice_policies set revision=2 where newsroom_id=$1", [f.room]);
    await assert.rejects(
      checks.checkRoutineNoticeSourceForOwner(
        actor,
        { ...f.input, expectedPolicyRevision: 2 },
        { ingest },
      ),
      /another check/i,
    );
    const changedUrl = `${f.url}/replacement`;
    await sql.query("update sources set url=$2 where id=$1", [f.sourceId, changedUrl]);
    await sql.query(
      "update routine_notice_approvals set source_url=$3 where newsroom_id=$1 and source_id=$2",
      [f.room, f.sourceId, changedUrl],
    );
    await sql.query("update routine_notice_policies set revision=3 where newsroom_id=$1", [f.room]);
    await assert.rejects(
      checks.checkRoutineNoticeSourceForOwner(
        actor,
        { ...f.input, sourceUrl: changedUrl, expectedPolicyRevision: 3 },
        { ingest },
      ),
      /another check/i,
    );
    assert.equal(calls, 1);
  });

  it("refuses authorization, unavailable adapters, and final policy races before writes", async () => {
    const f = await fixture();
    let calls = 0;
    const ingest = async () => {
      calls += 1;
      return htmlDocument(page(event()));
    };
    await assert.rejects(
      checks.checkRoutineNoticeSourceForOwner(
        { userId: f.editor, newsroomId: f.room },
        f.input,
        { ingest },
      ),
      /only.*owner/i,
    );
    await assert.rejects(
      checks.checkRoutineNoticeSourceForOwner(
        { userId: f.owner, newsroomId: f.room },
        { ...f.input, requestId: randomUUID(), formatKey: "registration-deadline" },
        { ingest },
      ),
      /adapter/i,
    );
    assert.equal(calls, 0);

    const sql = await getSql();
    await assert.rejects(
      checks.checkRoutineNoticeSourceForOwner(
        { userId: f.owner, newsroomId: f.room },
        { ...f.input, requestId: randomUUID() },
        {
          ingest,
          beforeCommit: async () => {
            await sql.query(
              "update routine_notice_policies set paused=true,revision=revision+1 where newsroom_id=$1",
              [f.room],
            );
          },
        },
      ),
      /paused|changed/i,
    );
    const [counts] = await sql.query<{ checks: number; captures: number }>(
      `select (select count(*)::int from routine_notice_checks where newsroom_id=$1) checks,
              (select count(*)::int from capture_events where newsroom_id=$1) captures`,
      [f.room],
    );
    assert.deepEqual(counts, { checks: 0, captures: 0 });
  });

  it("keeps content-free capture failure history", async () => {
    const f = await fixture();
    const failed = htmlDocument("");
    failed.status = 503;
    failed.outcome = "error";
    failed.contentType = "text/plain";
    failed.rawBytes = undefined;
    const result = await checks.checkRoutineNoticeSourceForOwner(
      { userId: f.owner, newsroomId: f.room },
      f.input,
      { ingest: async () => failed },
    );
    assert.equal(result.check.state, "capture-failed");
    assert.equal(result.check.refusals[0]?.code, "capture-failed");
  });

  it("collapses identical candidates and flags every conflicting version", async () => {
    const duplicate = await fixture();
    const same = event();
    const duplicateResult = await checks.checkRoutineNoticeSourceForOwner(
      { userId: duplicate.owner, newsroomId: duplicate.room },
      duplicate.input,
      { ingest: async () => htmlDocument(page(same, same)) },
    );
    assert.equal(duplicateResult.check.candidates.length, 1);
    assert.equal(duplicateResult.check.state, "parsed");

    const conflict = await fixture();
    const conflictResult = await checks.checkRoutineNoticeSourceForOwner(
      { userId: conflict.owner, newsroomId: conflict.room },
      conflict.input,
      { ingest: async () => htmlDocument(page(event(), event({ name: "Moved craft hour" }))) },
    );
    assert.equal(conflictResult.check.state, "parsed-with-conflicts");
    assert.deepEqual(conflictResult.check.candidates.map((item) => item.conflict), [true, true]);
  });

  it("degrades a malformed candidate receipt to evidence unavailable", async () => {
    const f = await fixture();
    const result = await checks.checkRoutineNoticeSourceForOwner(
      { userId: f.owner, newsroomId: f.room },
      f.input,
      { ingest: async () => htmlDocument(page(event())) },
    );
    const sql = await getSql();
    await sql.query("update routine_notice_candidate_refs set ordinal=99 where check_id=$1", [
      result.check.checkId,
    ]);
    const groups = await checks.listRoutineNoticeChecksForOwner(
      { userId: f.owner, newsroomId: f.room },
      {},
    );
    assert.equal(groups[0]?.state, "evidence-unavailable");
    assert.deepEqual(groups[0]?.candidates, []);
  });

  it("never returns raw capture text across rooms or after its evidence binding changes", async () => {
    const f = await fixture();
    const result = await checks.checkRoutineNoticeSourceForOwner(
      { userId: f.owner, newsroomId: f.room },
      f.input,
      { ingest: async () => htmlDocument(page(event())) },
    );
    const foreign = await fixture();
    await assert.rejects(
      checks.readRoutineNoticeCapturedTextForOwner(
        { userId: foreign.owner, newsroomId: foreign.room },
        { checkId: result.check.checkId },
      ),
      /not found/i,
    );
    const sql = await getSql();
    await sql.query("update capture_events set version_id=null where id=$1", [
      result.check.capture!.captureEventId,
    ]);
    await assert.rejects(
      checks.readRoutineNoticeCapturedTextForOwner(
        { userId: f.owner, newsroomId: f.room },
        { checkId: result.check.checkId },
      ),
      /changed|unavailable/i,
    );
  });

  it("rolls capture, receipt, candidates, and audit back together", async () => {
    const f = await fixture();
    const sql = await getSql();
    await sql.query(
      `create function fail_routine_check_audit() returns trigger language plpgsql as $$
       begin if NEW.newsroom_id=${f.room} and NEW.action='routine-notice-check' then
         raise exception 'forced audit failure'; end if; return NEW; end $$`,
    );
    await sql.query(
      "create trigger fail_routine_check_audit before insert on audit_events for each row execute function fail_routine_check_audit()",
    );
    await assert.rejects(
      checks.checkRoutineNoticeSourceForOwner(
        { userId: f.owner, newsroomId: f.room },
        f.input,
        { ingest: async () => htmlDocument(page(event())) },
      ),
      /forced audit failure/i,
    );
    await sql.query("drop trigger fail_routine_check_audit on audit_events");
    await sql.query("drop function fail_routine_check_audit() ");
    const [counts] = await sql.query<{ checks: number; captures: number; versions: number }>(
      `select (select count(*)::int from routine_notice_checks where newsroom_id=$1) checks,
              (select count(*)::int from capture_events where newsroom_id=$1) captures,
              (select count(*)::int from artifact_versions where newsroom_id=$1) versions`,
      [f.room],
    );
    assert.deepEqual(counts, { checks: 0, captures: 0, versions: 0 });
  });

  it("source deletion irreversibly removes the bound check and candidates", async () => {
    const f = await fixture();
    const result = await checks.checkRoutineNoticeSourceForOwner(
      { userId: f.owner, newsroomId: f.room },
      f.input,
      { ingest: async () => htmlDocument(page(event())) },
    );
    const sql = await getSql();
    await sql.query("delete from sources where id=$1 and newsroom_id=$2", [f.sourceId, f.room]);
    const [counts] = await sql.query<{ checks: number; refs: number }>(
      `select (select count(*)::int from routine_notice_checks where id=$1) checks,
              (select count(*)::int from routine_notice_candidate_refs where check_id=$1) refs`,
      [result.check.checkId],
    );
    assert.deepEqual(counts, { checks: 0, refs: 0 });
  });
});
