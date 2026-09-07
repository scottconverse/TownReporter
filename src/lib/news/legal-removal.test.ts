import { before, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { getSql, getPglite } from "../db.ts";
import { LEGAL_SCHEMA, ensureLegalSchema } from "./legal-removal-schema.ts";
import {
  previewLegalRemoval,
  removeLegally,
  getLegalCase,
  readLegalCopy,
  expireLegalCopies,
  recordBackupAction,
} from "./legal-removal-store.ts";
import { tickAllDueMonitors } from "./monitors-cron.ts";
import { fileEditorial } from "./editorial.server.ts";
import type { LegalSelection } from "./legal-removal-types.ts";

before(async () => {
  const pg = await getPglite();
  for (const file of (await readdir(new URL("../../../migrations/", import.meta.url)))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    await pg.exec(await readFile(new URL("../../../migrations/" + file, import.meta.url), "utf8"));
  }
  await ensureLegalSchema();
});
let roomCounter = 901;
async function fixture() {
  const sql = await getSql();
  const room = roomCounter++;
  const user = `legal-owner-${room}`;
  const secret = `REMOVED_SECRET_${room}`;
  await sql`insert into newsroom_members(user_id,role,newsroom_id) values(${user},'owner',${room}),(${user + "-editor"},'editor',${room})`;
  const [lead] = await sql<{
    id: number;
  }>`insert into leads(user_id,newsroom_id,headline,why,topic) values(${user},${room},${secret},${secret},'council') returning id`;
  const [draft] = await sql<{
    id: number;
  }>`insert into drafts(user_id,newsroom_id,lead_id,headline,body,topic) values(${user},${room},${lead.id},${secret},${secret},'council') returning id`;
  const [article] = await sql<{
    id: number;
  }>`insert into articles(user_id,newsroom_id,lead_id,origin_draft_id,slug,headline,body,topic) values(${user},${room},${lead.id},${draft.id},${"legal-" + room},${secret},${secret},'council') returning id`;
  await sql`insert into corrections(user_id,newsroom_id,article_id,body) values(${user},${room},${article.id},${secret})`;
  await sql`insert into editorial_extras(draft_id,newsroom_id,fact_sheet) values(${draft.id},${room},${secret})`;
  const [request] = await sql<{
    id: number;
  }>`insert into editorial_requests(user_id,newsroom_id,subject,draft_id) values(${user},${room},${secret},${draft.id}) returning id`;
  await sql`insert into desk_jobs(user_id,newsroom_id,kind,subject_id,status,error,result_json) values(${user},${room},'editorial',${request.id},'completed',${secret},${JSON.stringify({ body: secret })})`;
  await sql`insert into follow_ups(user_id,newsroom_id,article_id,who,what,reply_text) values(${user},${room},${article.id},${secret},${secret},${secret})`;
  await sql`insert into beat_memory(user_id,newsroom_id,article_id,entity,last_angle) values(${user},${room},${article.id},${secret},${secret})`;
  await sql`insert into audit_events(user_id,newsroom_id,action,detail,subject_kind,subject_id) values(${user},${room},'publish',${secret},'articles',${article.id})`;
  await sql`insert into deleted_items(newsroom_id,kind,ref_id,label,payload) values(${room},'article',${article.id},${secret},${JSON.stringify({ row: { id: article.id, body: secret } })})`;
  const selection: LegalSelection = {
    articleIds: [article.id],
    draftIds: [],
    memoryIds: [],
    auditIds: [],
    trashIds: [],
    reviewedLegacy: true,
    reviewedEvidence: true,
  };
  return { sql, user, room, secret, lead, draft, article, selection };
}
it("retained removal deletes connected copies, denies editors/foreign owners, exposes no text in metadata and blocks resurrection", async () => {
  const f = await fixture();
  const other = await fixture();
  await assert.rejects(previewLegalRemoval(f.user + "-editor", f.selection), /Only the owner/);
  await assert.rejects(previewLegalRemoval(other.user, f.selection), /another newsroom/);
  const preview = await previewLegalRemoval(f.user, f.selection);
  assert.equal(preview.counts.articles, 1);
  assert.equal(preview.counts.drafts, 1);
  assert.equal(preview.counts.deleted_items, 1);
  const input = {
    selection: f.selection,
    fingerprint: preview.fingerprint,
    policy: "retain" as const,
    caseRef: "CASE-001",
  };
  const result = await removeLegally(f.user, input);
  for (const table of [
    "articles",
    "leads",
    "drafts",
    "corrections",
    "editorial_extras",
    "editorial_requests",
    "follow_ups",
    "beat_memory",
    "deleted_items",
    "desk_jobs",
    "audit_events",
  ]) {
    assert.deepEqual(
      await f.sql.query(`select * from ${table} where newsroom_id=$1`, [f.room]),
      [],
      table,
    );
  }
  assert.ok((await readLegalCopy(f.user, result.caseId)).includes(f.secret));
  await assert.rejects(readLegalCopy(f.user + "-editor", result.caseId), /Only the owner/);
  await assert.rejects(readLegalCopy(other.user, result.caseId), /not found/);
  assert.ok(!JSON.stringify(await getLegalCase(f.user, result.caseId)).includes(f.secret));
  const metadata = await getLegalCase(f.user, result.caseId);
  assert.equal(typeof metadata.created_at, "string");
  assert.ok(metadata.events.every((event) => typeof event.created_at === "string"));
  assert.equal(metadata.externalStatus, "pending");
  assert.deepEqual(await removeLegally(f.user, input), result);
  await assert.rejects(
    f.sql`insert into drafts(user_id,newsroom_id,lead_id,headline,body,topic) values(${f.user},${f.room},${f.lead.id},'stale','stale','council')`,
    /legal removal/,
  );
  await assert.rejects(
    f.sql`insert into articles(user_id,newsroom_id,origin_draft_id,slug,headline,body,topic) values(${f.user},${f.room},${f.draft.id},'changed-slug','stale','stale','council')`,
    /legal removal/,
  );
  await assert.rejects(
    f.sql`insert into deleted_items(newsroom_id,kind,ref_id,label,payload) values(${f.room},'article',${f.article.id},'stale','{}')`,
    /Legally removed/,
  );
  assert.equal((await other.sql`select id from articles where id=${other.article.id}`).length, 1);
  await recordBackupAction(f.user, result.caseId, { identifier: "Halo backup snapshot A" });
  let detail = await getLegalCase(f.user, result.caseId);
  assert.equal(detail.externalStatus, "pending");
  await recordBackupAction(f.user, result.caseId, { confirmId: detail.backups[0].id });
  detail = await getLegalCase(f.user, result.caseId);
  assert.equal(detail.externalStatus, "operator-attested");
});
it("destruction never writes sealed plaintext and requires explicit legacy review", async () => {
  const f = await fixture();
  const unresolved = { ...f.selection, reviewedLegacy: false };
  const p = await previewLegalRemoval(f.user, unresolved);
  await assert.rejects(
    removeLegally(f.user, {
      selection: unresolved,
      fingerprint: p.fingerprint,
      policy: "destroy",
      caseRef: "COURT-1",
    }),
    /requires resolving/,
  );
  await f.sql.query(
    "create function test_forbid_sealed_write() returns trigger language plpgsql as $$ begin raise exception 'Unexpected sealed copy write'; end $$",
  );
  await f.sql.query(
    "create trigger test_forbid_sealed_write before insert on legal_removal_copies for each row execute function test_forbid_sealed_write()",
  );
  try {
    const control = await fixture();
    const cp = await previewLegalRemoval(control.user, control.selection);
    await assert.rejects(
      removeLegally(control.user, {
        selection: control.selection,
        fingerprint: cp.fingerprint,
        policy: "retain",
        caseRef: "CONTROL",
      }),
      /Unexpected sealed copy write/,
    );
    const preview = await previewLegalRemoval(f.user, f.selection);
    const result = await removeLegally(f.user, {
      selection: f.selection,
      fingerprint: preview.fingerprint,
      policy: "destroy",
      caseRef: "COURT-1",
    });
    assert.deepEqual(
      await f.sql`select * from legal_removal_copies where case_id=${result.caseId}`,
      [],
    );
    await assert.rejects(readLegalCopy(f.user, result.caseId), /No retained text/);
  } finally {
    await f.sql.query("drop trigger test_forbid_sealed_write on legal_removal_copies");
  }
});
it("stale preview and mid-transaction failure preserve every linked record", async () => {
  const f = await fixture();
  const p = await previewLegalRemoval(f.user, f.selection);
  await f.sql`update drafts set body='changed' where id=${f.draft.id}`;
  await assert.rejects(
    removeLegally(f.user, {
      selection: f.selection,
      fingerprint: p.fingerprint,
      policy: "retain",
      caseRef: "ROLLBACK",
    }),
    /records changed/,
  );
  const fresh = await previewLegalRemoval(f.user, f.selection);
  await f.sql.query(
    "create function test_fail_removal() returns trigger language plpgsql as $$ begin raise exception 'Injected database failure'; end $$",
  );
  await f.sql.query(
    "create trigger test_fail_removal before delete on drafts for each row execute function test_fail_removal()",
  );
  try {
    await assert.rejects(
      removeLegally(f.user, {
        selection: f.selection,
        fingerprint: fresh.fingerprint,
        policy: "retain",
        caseRef: "ROLLBACK",
      }),
      /Injected/,
    );
  } finally {
    await f.sql.query("drop trigger test_fail_removal on drafts");
  }
  assert.equal((await f.sql`select id from articles where id=${f.article.id}`).length, 1);
  assert.deepEqual(await f.sql`select * from legal_removals where newsroom_id=${f.room}`, []);
});
it("expired text is denied before unattended purge and purge is idempotent", async () => {
  const f = await fixture();
  const p = await previewLegalRemoval(f.user, f.selection);
  const { caseId } = await removeLegally(f.user, {
    selection: f.selection,
    fingerprint: p.fingerprint,
    policy: "retain",
    caseRef: "EXPIRY",
  });
  await f.sql`update legal_removals set expires_at=now()-interval '1 second' where id=${caseId}`;
  await assert.rejects(readLegalCopy(f.user, caseId), /past its retention deadline/);
  assert.equal(await expireLegalCopies(f.sql), 1);
  assert.equal(await expireLegalCopies(f.sql), 0);
  assert.deepEqual(await f.sql`select * from legal_removal_copies where case_id=${caseId}`, []);
});
it("guards are behavior-sensitive: without the article trigger a stale editorial can be republished", async () => {
  const f = await fixture();
  const p = await previewLegalRemoval(f.user, f.selection);
  await removeLegally(f.user, {
    selection: f.selection,
    fingerprint: p.fingerprint,
    policy: "destroy",
    caseRef: "GUARD",
  });
  await f.sql.query("drop trigger articles_legal_guard on articles");
  try {
    const inserted =
      await f.sql`insert into articles(user_id,newsroom_id,origin_draft_id,slug,headline,body,topic) values(${f.user},${f.room},${f.draft.id},'unguarded-stale','stale','stale','council') returning id`;
    assert.equal(
      inserted.length,
      1,
      "the mutation permits the exact otherwise-refused stale filing",
    );
    await f.sql`delete from articles where slug='unguarded-stale'`;
  } finally {
    await f.sql.query(
      LEGAL_SCHEMA.find((s) => s.startsWith("create trigger articles_legal_guard"))!,
    );
  }
});

it("shared leads require all sibling articles, and explicit legacy selections are scoped", async () => {
  const f = await fixture();
  const [sibling] = await f.sql<{
    id: number;
  }>`insert into articles(user_id,newsroom_id,lead_id,slug,headline,body,topic) values(${f.user},${f.room},${f.lead.id},${"sibling-" + f.room},'Sibling','Other story','council') returning id`;
  const p = await previewLegalRemoval(f.user, f.selection);
  await assert.rejects(
    removeLegally(f.user, {
      selection: f.selection,
      fingerprint: p.fingerprint,
      policy: "retain",
      caseRef: "SIBLINGS",
    }),
    /every article sharing/,
  );
  const selection = { ...f.selection, articleIds: [f.article.id, sibling.id] };
  const both = await previewLegalRemoval(f.user, selection);
  await removeLegally(f.user, {
    selection,
    fingerprint: both.fingerprint,
    policy: "retain",
    caseRef: "SIBLINGS",
  });
  assert.deepEqual(await f.sql`select id from articles where newsroom_id=${f.room}`, []);
});
it("descriptor removal preserves independent drafts and refuses completion from an earlier model input", async () => {
  const f = await fixture();
  const [otherDraft] = await f.sql<{
    id: number;
  }>`insert into drafts(user_id,newsroom_id,headline,body,topic) values(${f.user},${f.room},'Independent editorial','Independent text','opinion') returning id`;
  const [req] = await f.sql<{
    id: number;
  }>`insert into editorial_requests(user_id,newsroom_id,subject,source_kind,source_ref,our_story_json,draft_id,model_choice)
    values(${f.user},${f.room},'Independent editorial','article',${"legal-" + f.room},${JSON.stringify({ headline: f.secret, dek: f.secret, url: "https://paper.example/articles/legal-" + f.room })},${otherDraft.id},'claude-frontier') returning id`;
  const [job] = await f.sql<{
    id: number;
  }>`insert into desk_jobs(user_id,newsroom_id,kind,subject_id,status,claim_token) values(${f.user},${f.room},'editorial',${req.id},'running','old-claim') returning id`;
  const heldInput = {
    userId: f.user,
    newsroomId: f.room,
    subject: "Independent editorial",
    pointers: [],
    sourceKind: "article",
    sourceRef: "legal-" + f.room,
    completion: { requestId: req.id, jobId: job.id },
  };
  const before = await fileEditorial(
    heldInput,
    { headline: "Control", body: "Control", appendix: "", factSheet: "", imagePrompt: "" },
    "claude-frontier",
  );
  assert.equal(
    before.draftId,
    otherDraft.id,
    "the exact held input is accepted before source removal",
  );
  await f.sql`update desk_jobs set status='running',claim_token='old-claim' where id=${job.id}`;
  const p = await previewLegalRemoval(f.user, f.selection);
  assert.equal(p.counts.descriptor_scrubs, 1);
  await removeLegally(f.user, {
    selection: f.selection,
    fingerprint: p.fingerprint,
    policy: "destroy",
    caseRef: "DESCRIPTOR",
  });
  assert.deepEqual(await f.sql`select body from drafts where id=${otherDraft.id}`, [
    { body: "Independent text" },
  ]);
  const [remaining] = await f.sql<{
    our_story_json: string | null;
    source_ref: string;
    source_kind: string;
  }>`select our_story_json,source_ref,source_kind from editorial_requests where id=${req.id}`;
  assert.deepEqual(remaining, {
    our_story_json: null,
    source_ref: "",
    source_kind: "legal-removed",
  });
  await assert.rejects(
    fileEditorial(
      heldInput,
      { headline: "Stale output", body: f.secret, appendix: "", factSheet: "", imagePrompt: "" },
      "claude-frontier",
    ),
    /source was legally removed/,
  );
  assert.deepEqual(await f.sql`select body from drafts where id=${otherDraft.id}`, [
    { body: "Independent text" },
  ]);
  assert.deepEqual(await f.sql`select status,claim_token from desk_jobs where id=${job.id}`, [
    { status: "failed", claim_token: null },
  ]);
});

it("historical candidates arriving after review invalidate the preview", async () => {
  const f = await fixture();
  const p = await previewLegalRemoval(f.user, f.selection);
  await f.sql`insert into audit_events(user_id,newsroom_id,action,detail) values(${f.user},${f.room},'manual-file',${f.secret})`;
  await assert.rejects(
    removeLegally(f.user, {
      selection: f.selection,
      fingerprint: p.fingerprint,
      policy: "destroy",
      caseRef: "LATE-COPY",
    }),
    /records changed/,
  );
});
it("a retry with a conflicting retention policy cannot silently reuse a case", async () => {
  const f = await fixture();
  const p = await previewLegalRemoval(f.user, f.selection);
  const input = {
    selection: f.selection,
    fingerprint: p.fingerprint,
    policy: "retain" as const,
    caseRef: "INTENT",
  };
  await removeLegally(f.user, input);
  await assert.rejects(removeLegally(f.user, { ...input, policy: "destroy" }), /conflicts/);
});
it("known same-paper captured copies block destruction even after the evidence checkbox, without matching foreign origins or rooms", async () => {
  const f = await fixture();
  const other = await fixture();
  const old = process.env.PUBLIC_SITE_URL;
  process.env.PUBLIC_SITE_URL = "https://paper.example";
  try {
    const url = "https://paper.example/articles/legal-" + f.room;
    await f.sql`insert into artifact_versions(user_id,newsroom_id,url,content_hash,full_text) values(${other.user},${other.room},${url},'foreign-room',${f.secret})`;
    await f.sql`insert into artifact_versions(user_id,newsroom_id,url,content_hash,full_text) values(${f.user},${f.room},${url.replace("paper.example", "unrelated.example")},'foreign-origin',${f.secret})`;
    assert.equal(
      (await previewLegalRemoval(f.user, f.selection)).counts.unresolved_captured_copies ?? 0,
      0,
    );
    await f.sql`insert into artifact_versions(user_id,newsroom_id,url,content_hash,full_text) values(${f.user},${f.room},${url},'own-copy',${f.secret})`;
    const p = await previewLegalRemoval(f.user, f.selection);
    assert.equal(p.counts.unresolved_captured_copies, 1);
    await assert.rejects(
      removeLegally(f.user, {
        selection: f.selection,
        fingerprint: p.fingerprint,
        policy: "destroy",
        caseRef: "CAPTURE",
      }),
      /captured copies/,
    );
    const result = await removeLegally(f.user, {
      selection: f.selection,
      fingerprint: p.fingerprint,
      policy: "retain",
      caseRef: "CAPTURE",
    });
    assert.equal((await getLegalCase(f.user, result.caseId)).review_pending, true);
  } finally {
    if (old === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = old;
  }
});

it("in-flight capture cannot reinsert exact removed article text after removal", async () => {
  const f = await fixture();
  const old = process.env.PUBLIC_SITE_URL;
  process.env.PUBLIC_SITE_URL = "https://paper.example";
  try {
    const url = "https://paper.example/articles/legal-" + f.room;
    const p = await previewLegalRemoval(f.user, f.selection);
    await removeLegally(f.user, {
      selection: f.selection,
      fingerprint: p.fingerprint,
      policy: "destroy",
      caseRef: "STALE-CAPTURE",
    });
    await assert.rejects(
      f.sql`insert into artifact_versions(user_id,newsroom_id,url,content_hash,full_text) values(${f.user},${f.room},${url},'late',${f.secret})`,
      /legal removal/,
    );
    await f.sql`insert into artifact_versions(user_id,newsroom_id,url,content_hash,full_text) values(${f.user},${f.room},${url.replace("paper.example", "other.example")},'different-origin','Unrelated')`;
  } finally {
    if (old === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = old;
  }
});

it("cached legal readiness fails closed when a required guard disappears", async () => {
  const f = await fixture();
  await ensureLegalSchema();
  await f.sql.query("drop trigger snapshots_legal_guard on snapshots");
  await assert.rejects(previewLegalRemoval(f.user, f.selection), /schema is incomplete/);
  assert.deepEqual(
    await f.sql`select name from _schema_ensure_state where name='legal-removal'`,
    [],
  );
  await ensureLegalSchema();
  assert.equal((await previewLegalRemoval(f.user, f.selection)).counts.articles, 1);
});
it("mixed trash snapshots require explicit whole-snapshot selection", async () => {
  const f = await fixture();
  const [trash] = await f.sql<{
    id: number;
  }>`insert into deleted_items(newsroom_id,kind,ref_id,label,payload) values(${f.room},'lead',${f.lead.id},'Mixed historical snapshot',${JSON.stringify({ row: { id: f.lead.id }, drafts: [{ id: 987654, lead_id: 99999, body: "Unrelated history" }] })}) returning id`;
  const p = await previewLegalRemoval(f.user, f.selection);
  await assert.rejects(
    removeLegally(f.user, {
      selection: f.selection,
      fingerprint: p.fingerprint,
      policy: "retain",
      caseRef: "MIXED",
    }),
    /mixed trash snapshot/,
  );
  assert.equal((await f.sql`select id from deleted_items where id=${trash.id}`).length, 1);
});

it("an explicitly selected historical draft snapshot removes its detached request and fences restoring its old draft ID", async () => {
  const f = await fixture();
  const [request] = await f.sql<{
    id: number;
  }>`insert into editorial_requests(user_id,newsroom_id,subject,draft_id) values(${f.user},${f.room},${f.secret},null) returning id`;
  const [trash] = await f.sql<{
    id: number;
  }>`insert into deleted_items(newsroom_id,kind,ref_id,label,payload) values(${f.room},'draft',876543,${f.secret},${JSON.stringify({ row: { id: 876543, newsroom_id: f.room, lead_id: null, body: f.secret }, requestIds: [request.id] })}) returning id`;
  const selection = { ...f.selection, trashIds: [trash.id] };
  const p = await previewLegalRemoval(f.user, selection);
  await removeLegally(f.user, {
    selection,
    fingerprint: p.fingerprint,
    policy: "destroy",
    caseRef: "HISTORICAL-DRAFT",
  });
  assert.deepEqual(await f.sql`select id from editorial_requests where id=${request.id}`, []);
  await assert.rejects(
    f.sql`insert into drafts(id,user_id,newsroom_id,headline,body,topic) values(876543,${f.user},${f.room},'restored',${f.secret},'opinion')`,
    /legal removal/,
  );
});

it("the actual scheduled tick expires retained copies and reports a failed purge honestly", async () => {
  const f = await fixture();
  const p = await previewLegalRemoval(f.user, f.selection);
  const { caseId } = await removeLegally(f.user, {
    selection: f.selection,
    fingerprint: p.fingerprint,
    policy: "retain",
    caseRef: "SCHEDULED",
  });
  await f.sql`update legal_removals set expires_at=now()-interval '1 second' where id=${caseId}`;
  // No model work or live transport is needed for retention. Dispose fixture jobs.
  await f.sql`update desk_jobs set status='failed' where status in ('queued','running')`;
  await f.sql.query(
    "create function test_fail_legal_purge() returns trigger language plpgsql as $$ begin raise exception 'Injected purge failure'; end $$",
  );
  await f.sql.query(
    "create trigger test_fail_legal_purge before delete on legal_removal_copies for each row execute function test_fail_legal_purge()",
  );
  try {
    const failed = await tickAllDueMonitors({
      fetch: async () => {
        throw new Error("No network is allowed");
      },
    });
    assert.equal(failed.legalPurged, 0);
    assert.match(failed.legalPurgeError ?? "", /cleanup failed/);
    await assert.rejects(readLegalCopy(f.user, caseId), /past its retention deadline/);
  } finally {
    await f.sql.query("drop trigger test_fail_legal_purge on legal_removal_copies");
  }
  const done = await tickAllDueMonitors({
    fetch: async () => {
      throw new Error("No network is allowed");
    },
  });
  assert.equal(done.legalPurged, 1);
  assert.equal(done.legalPurgeError, null);
  assert.deepEqual(
    await f.sql`select case_id from legal_removal_copies where case_id=${caseId}`,
    [],
  );
});

it("own article query, fragment, host case and trailing-slash variants cannot escape capture review or late-write guards", async () => {
  const f = await fixture();
  const old = process.env.PUBLIC_SITE_URL;
  process.env.PUBLIC_SITE_URL = "https://paper.example";
  try {
    const base = "https://paper.example/articles/legal-" + f.room;
    const url = base + "/?view=reader#body";
    const [version] = await f.sql<{
      id: number;
    }>`insert into artifact_versions(user_id,newsroom_id,url,content_hash,full_text) values(${f.user},${f.room},${url},'variant',${f.secret}) returning id`;
    const p = await previewLegalRemoval(f.user, f.selection);
    assert.equal(p.counts.unresolved_captured_copies, 1);
    await assert.rejects(
      removeLegally(f.user, {
        selection: f.selection,
        fingerprint: p.fingerprint,
        policy: "destroy",
        caseRef: "VARIANT",
      }),
      /captured copies/,
    );
    await f.sql`delete from artifact_versions where id=${version.id}`;
    const clean = await previewLegalRemoval(f.user, f.selection);
    await removeLegally(f.user, {
      selection: f.selection,
      fingerprint: clean.fingerprint,
      policy: "destroy",
      caseRef: "VARIANT",
    });
    for (const variant of [
      base + "?view=reader",
      base + "#body",
      base.replace("legal-", "%6cegal%2D"),
      base + "/",
      base.replace("https://paper.example", "HTTPS://PAPER.EXAMPLE:443"),
    ]) {
      await assert.rejects(
        f.sql`insert into artifact_versions(user_id,newsroom_id,url,content_hash,full_text) values(${f.user},${f.room},${variant},'late',${f.secret})`,
        /legal removal/,
      );
    }
  } finally {
    if (old === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = old;
  }
});

it("foreign CASCADE and SET NULL children refuse removal without changing either newsroom", async () => {
  const f = await fixture();
  const other = await fixture();
  const [foreignDraft] = await f.sql<{
    id: number;
  }>`insert into drafts(user_id,newsroom_id,lead_id,headline,body,topic) values(${other.user},${other.room},${f.lead.id},'Foreign draft','Private other-room work','council') returning id`;
  const [foreignMemory] = await f.sql<{
    id: number;
  }>`insert into beat_memory(user_id,newsroom_id,article_id,entity,last_angle) values(${other.user},${other.room},${f.article.id},'Foreign memory','Private other-room work') returning id`;
  const p = await previewLegalRemoval(f.user, f.selection);
  await assert.rejects(
    removeLegally(f.user, {
      selection: f.selection,
      fingerprint: p.fingerprint,
      policy: "destroy",
      caseRef: "FOREIGN-FK",
    }),
    /another newsroom/,
  );
  assert.deepEqual(await f.sql`select lead_id from drafts where id=${foreignDraft.id}`, [
    { lead_id: f.lead.id },
  ]);
  assert.deepEqual(await f.sql`select article_id from beat_memory where id=${foreignMemory.id}`, [
    { article_id: f.article.id },
  ]);
  assert.equal((await f.sql`select id from articles where id=${f.article.id}`).length, 1);
});

it("known search snippets and their frontier references block destruction and late search results are fenced", async () => {
  const f = await fixture();
  const old = process.env.PUBLIC_SITE_URL;
  process.env.PUBLIC_SITE_URL = "https://paper.example";
  try {
    const url = "https://paper.example/articles/legal-" + f.room + "?reader=1";
    const [log] = await f.sql<{
      id: number;
    }>`insert into search_log(user_id,newsroom_id,investigation_id,hop,query,results_json) values(${f.user},${f.room},9876,1,'test',${JSON.stringify([{ url, title: f.secret, snippet: f.secret }])}) returning id`;
    const p = await previewLegalRemoval(f.user, f.selection);
    assert.equal(p.counts.unresolved_captured_copies, 1);
    await assert.rejects(
      removeLegally(f.user, {
        selection: f.selection,
        fingerprint: p.fingerprint,
        policy: "destroy",
        caseRef: "SEARCH-COPY",
      }),
      /captured copies/,
    );
    await f.sql`delete from search_log where id=${log.id}`;
    const clean = await previewLegalRemoval(f.user, f.selection);
    await removeLegally(f.user, {
      selection: f.selection,
      fingerprint: clean.fingerprint,
      policy: "destroy",
      caseRef: "SEARCH-COPY",
    });
    await assert.rejects(
      f.sql`insert into search_log(user_id,newsroom_id,investigation_id,hop,query,results_json) values(${f.user},${f.room},9876,1,'test',${JSON.stringify([{ url, title: f.secret, snippet: f.secret }])})`,
      /legal removal/,
    );
  } finally {
    if (old === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = old;
  }
});

it("unrelated watch-schema failure cannot prevent the retention sweep", async () => {
  const f = await fixture();
  const p = await previewLegalRemoval(f.user, f.selection);
  const { caseId } = await removeLegally(f.user, {
    selection: f.selection,
    fingerprint: p.fingerprint,
    policy: "retain",
    caseRef: "WATCH-FAILURE",
  });
  await f.sql`update legal_removals set expires_at=now()-interval '1 second' where id=${caseId}`;
  const pg = await getPglite();
  const original = pg.query.bind(pg);
  pg.query = ((query: string, params?: unknown[]) => {
    if (query.includes("source_monitors"))
      return Promise.reject(new Error("Injected watch schema failure"));
    return original(query, params);
  }) as typeof pg.query;
  try {
    await assert.rejects(tickAllDueMonitors(), /Injected watch schema failure|Page watch schema/);
  } finally {
    pg.query = original;
  }
  assert.deepEqual(
    await f.sql`select case_id from legal_removal_copies where case_id=${caseId}`,
    [],
  );
});

it("missing critical retention columns fail visibly without deleting application content", async () => {
  const f = await fixture();
  for (const [table, column] of [
    ["legal_removals", "expires_at"],
    ["legal_removal_copies", "payload"],
    ["legal_removal_urls", "url_hash"],
  ]) {
    await f.sql.query(`alter table ${table} rename column ${column} to missing_test_column`);
    try {
      await assert.rejects(previewLegalRemoval(f.user, f.selection), /schema is incomplete/);
    } finally {
      await f.sql.query(`alter table ${table} rename column missing_test_column to ${column}`);
      await ensureLegalSchema();
    }
    assert.equal((await f.sql`select id from articles where id=${f.article.id}`).length, 1);
  }
});

it("own-article source and monitor descriptors are explicit unresolved capture scope", async () => {
  const f = await fixture();
  const url = "/articles/legal-" + f.room;
  await f.sql`insert into sources(user_id,newsroom_id,url,title) values(${f.user},${f.room},${url},${f.secret})`;
  await f.sql`insert into source_monitors(user_id,newsroom_id,url,title,enabled) values(${f.user},${f.room},${url},${f.secret},false)`;
  await f.sql`insert into recurring_baselines(user_id,newsroom_id,key,kind,typical_url,typical_title) values(${f.user},${f.room},'own-story','article',${url},${f.secret})`;
  const p = await previewLegalRemoval(f.user, f.selection);
  assert.deepEqual(p.capturedCopies.map((r) => r.table).sort(), [
    "recurring_baselines",
    "source_monitors",
    "sources",
  ]);
  await assert.rejects(
    removeLegally(f.user, {
      selection: f.selection,
      fingerprint: p.fingerprint,
      policy: "destroy",
      caseRef: "DESCRIPTORS",
    }),
    /captured copies/,
  );
});
it("encoded URL regression is sensitive to removing path decoding", async () => {
  const f = await fixture();
  const p = await previewLegalRemoval(f.user, f.selection);
  await removeLegally(f.user, {
    selection: f.selection,
    fingerprint: p.fingerprint,
    policy: "destroy",
    caseRef: "ENCODED-CONTROL",
  });
  const corrected = LEGAL_SCHEMA.find((s) =>
    s.startsWith("create or replace function legal_article_url_identity"),
  )!;
  await f.sql.query(
    corrected
      .replace("legal_decode_url_path(clean)", "clean")
      .replace("legal_decode_url_path(parts[3])", "parts[3]"),
  );
  try {
    const inserted =
      await f.sql`insert into artifact_versions(user_id,newsroom_id,url,content_hash,full_text) values(${f.user},${f.room},${"/articles/%6cegal%2D" + f.room},'old-identity',${f.secret}) returning id`;
    assert.equal(inserted.length, 1, "the pre-fix identity permits the encoded alias");
  } finally {
    await f.sql.query(corrected);
  }
});
