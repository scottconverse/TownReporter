import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureInvestigateSchema } from "./investigate.ts";
import { ensureAuditEventsSchema } from "./ops.ts";
import { loadPublicEvidence } from "./evidence.ts";
import {
  TAKEDOWN_ACTION,
  TAKEDOWN_REASON_MAX,
  TAKEDOWN_SUBJECT_KIND,
  takeDownCapture,
} from "./evidence-takedown.ts";

/*
  Unit U11b: taking down ONE evidence capture, at a publisher's request.

  What this file proves, and why each case is here:

    1. A non-owner editor is refused and NOTHING moves. The role check is the
       same one the legal-removal routes use, and a mutation that drops it
       fails the first case below.
    2. The owner's takedown PURGES the stored text -- the version's
       `full_text`, the version's chunks and the original bytes -- while the
       record and its hashes stay. This is the assertion the "skip the purge"
       mutation fails: with the purge removed, the columns are still full.
    3. The public loader for that capture returns the NOTICE and not an
       excerpt, and the reason never reaches a reader: `loadPublicEvidence`'s
       whole record is searched for the reason text.
    4. "Remove the link too" is honoured, and a capture that is not ticked
       keeps its link.
    5. A second takedown, a blank reason and an oversize reason are refused --
       there is no restore, so the desk must not be able to imply one by
       silently re-running the action.

  The database is the shared PGlite one (`getSql`), and this file creates the
  `articles` table inline exactly as `evidence.public.test.ts` does: it is a
  migrations-only table with no `ensure*` counterpart (see the allowlist in
  `schema-parity.test.ts`), and the public loader needs a published story
  citing the URL before a capture is public at all.
*/

async function ensureArticlesSchema() {
  await ensureInvestigateSchema();
  /*
    `audit_events` is what the takedown writes to, and `ensureAuditEventsSchema`
    is the same entry point the runtime uses. Ensured here as well so the
    refusal cases can read the table and assert that a refused takedown left
    nothing behind -- on a desk that has never recorded an action the table
    would not exist yet, and "no audit row" must be a measurement, not a
    missing table.
  */
  await ensureAuditEventsSchema();
  const sql = await getSql();
  await sql.query(`
    create table if not exists articles (
      id serial primary key,
      user_id text not null,
      lead_id integer,
      slug text not null unique,
      headline text not null,
      dek text not null default '',
      body text not null,
      topic text not null,
      source_urls text not null default '[]',
      status text not null default 'published',
      published_at timestamptz not null default now(),
      provenance_json text not null default '[]',
      form text not null default 'reported',
      found_note text not null default '',
      unanswered text not null default '[]'
    )
  `);
  await sql.query(`alter table articles add column if not exists provenance_json text not null default '[]'`);
  await sql.query(`alter table articles add column if not exists found_note text not null default ''`);
  await sql.query(`alter table articles add column if not exists newsroom_id integer not null default 1`);
}

type Seeded = {
  versionId: number;
  url: string;
  text: string;
  reason: string;
};

/** One captured page, cited by one published story. */
async function seedCapture(label: string): Promise<Seeded> {
  await ensureArticlesSchema();
  const sql = await getSql();
  const url = `https://records.example.test/${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const text = `The library board approved the recreation room update on ${label}.`;
  const reason = `Publisher asked on ${label}: the excerpt quoted their paywalled story.`;
  const [version] = await sql<{ id: number }>`
    insert into artifact_versions (user_id, url, content_hash, title, full_text, fetch_outcome)
    values ('takedown-test', ${url}, ${`hash-${label}`}, 'Board packet', ${text}, 'fetched')
    returning id
  `;
  await sql`
    insert into artifact_chunks (version_id, user_id, newsroom_id, chunk_index, excerpt, locator)
    values (${version!.id}, 'takedown-test', 1, 0, ${text}, 'p1')
  `;
  await sql`
    insert into artifact_blobs (version_id, user_id, newsroom_id, sha256, original_url, byte_length, body_b64)
    values (${version!.id}, 'takedown-test', 1, ${`sha-${label}`}, ${url}, 42, 'PGJyZWFkIGJvYXJk')
  `;
  await sql`
    insert into articles (user_id, slug, headline, body, topic, source_urls, status, provenance_json)
    values ('takedown-test', ${`slug-${label}-${version!.id}`}, 'Library story', 'Body text',
      'council', ${JSON.stringify([url])}, 'published', ${JSON.stringify([{ url, version_id: version!.id }])})
  `;
  return { versionId: version!.id, url, text, reason };
}

async function purgeState(versionId: number) {
  const sql = await getSql();
  const [version] = await sql<{ full_text: string; taken_down_at: string | null }>`
    select full_text, taken_down_at::text as taken_down_at from artifact_versions where id = ${versionId}
  `;
  const chunks = await sql<{ excerpt: string }>`
    select excerpt from artifact_chunks where version_id = ${versionId}
  `;
  const blobs = await sql<{ body_b64: string }>`
    select body_b64 from artifact_blobs where version_id = ${versionId}
  `;
  const audit = await sql<{
    user_id: string;
    action: string;
    detail: string;
    subject_kind: string | null;
    subject_id: number | null;
  }>`
    select user_id, action, detail, subject_kind, subject_id from audit_events
    where action = ${TAKEDOWN_ACTION} and subject_id = ${versionId}
  `;
  return { version, chunks, blobs, audit };
}

const owner = { userId: "takedown-owner", newsroomId: 1, role: "owner" };
const editor = { userId: "takedown-editor", newsroomId: 1, role: "editor" };

describe("taking down one captured excerpt", { timeout: 60000 }, () => {
  it("refuses an editor who is not the owner, and changes nothing", async () => {
    const seeded = await seedCapture("refused");
    await assert.rejects(
      () =>
        takeDownCapture(editor, {
          versionId: seeded.versionId,
          reason: seeded.reason,
          removeLink: false,
        }),
      /owner/i,
    );
    const state = await purgeState(seeded.versionId);
    assert.equal(state.version.full_text, seeded.text, "a refused takedown must not empty the text");
    assert.equal(state.version.taken_down_at, null, "a refused takedown must not mark the capture");
    assert.equal(state.chunks[0]?.excerpt, seeded.text, "a refused takedown must not empty a chunk");
    assert.deepEqual(state.audit, [], "a refused takedown must not write an audit row");
    const record = await loadPublicEvidence(seeded.versionId);
    assert.equal(record?.excerpt_removed, false, "a refused takedown must leave the excerpt public");
    assert.match(record?.excerpt ?? "", /recreation room update/);
  });

  it("purges the stored text, keeps the record, and writes one audit row", async () => {
    const seeded = await seedCapture("purged");
    assert.match((await loadPublicEvidence(seeded.versionId))?.excerpt ?? "", /recreation room/);

    const result = await takeDownCapture(owner, {
      versionId: seeded.versionId,
      reason: seeded.reason,
      removeLink: false,
    });
    assert.equal(result.ok, true);
    assert.equal(result.linkKept, true);
    assert.equal(result.purged.chunks, 1);
    assert.equal(result.purged.blobs, 1);

    const state = await purgeState(seeded.versionId);
    assert.equal(state.version.full_text, "", "the version's stored text must be emptied");
    assert.ok(state.version.taken_down_at, "the capture must be marked as taken down");
    for (const chunk of state.chunks)
      assert.equal(chunk.excerpt, "", "every stored passage of the capture must be emptied");
    for (const blob of state.blobs)
      assert.equal(blob.body_b64, "", "the original bytes of the capture must be emptied");

    assert.equal(state.audit.length, 1, "a takedown writes exactly one audit row");
    const audit = state.audit[0]!;
    assert.equal(audit.user_id, owner.userId, "the audit row names who took it down");
    assert.equal(audit.action, TAKEDOWN_ACTION);
    assert.equal(audit.detail, seeded.reason, "the audit row carries the reason, whole");
    assert.equal(audit.subject_kind, TAKEDOWN_SUBJECT_KIND);
    assert.equal(audit.subject_id, seeded.versionId, "the audit row names the capture");

    /*
      The reader's record: the notice, not the excerpt, and not the reason.

      The whole record is stringified and searched -- including the timeline,
      the hash and every label -- because "the reason is not shown" has to mean
      the reason text cannot be found anywhere in what a public loader returns,
      not merely that one field was left blank.
    */
    const record = await loadPublicEvidence(seeded.versionId);
    assert.ok(record, "the capture must still resolve: a published citation points at it");
    assert.equal(record!.excerpt, "", "no excerpt survives a takedown");
    assert.equal(record!.excerpt_removed, true, "the page must print the notice");
    assert.equal(record!.excerpt_removed_link_kept, true, "the link is kept unless asked otherwise");
    assert.equal(record!.has_original_bytes, false, "the page may not claim bytes it no longer holds");
    assert.equal(record!.byte_length, null);
    const wire = JSON.stringify(record);
    assert.ok(!wire.includes(seeded.reason), "the takedown reason must never reach a reader");
    assert.ok(!wire.includes("paywalled"), "the takedown reason must never reach a reader");
    assert.ok(
      !wire.includes(seeded.text),
      "no captured text may survive in what a reader is served",
    );

    /*
      And the citation still resolves. The story that cited this capture keeps
      its provenance entry pointing at the version, which is the address the
      article page links; that address now answers with the notice.
    */
    const sql = await getSql();
    const [article] = await sql<{ provenance_json: string; source_urls: string }>`
      select provenance_json, source_urls from articles where user_id = 'takedown-test' and slug like ${`slug-purged-${seeded.versionId}`}
    `;
    assert.ok(article, "the citing story must still be there");
    const cited = (JSON.parse(article!.provenance_json) as { url: string; version_id: number }[])[0]!;
    assert.equal(cited.version_id, seeded.versionId);
    const citedRecord = await loadPublicEvidence(cited.version_id);
    assert.equal(citedRecord?.excerpt_removed, true, "the citation must land on the notice");
  });

  it("removes the link from the notice only when the editor asked for that", async () => {
    const seeded = await seedCapture("unlinked");
    await takeDownCapture(owner, {
      versionId: seeded.versionId,
      reason: seeded.reason,
      removeLink: true,
    });
    const record = await loadPublicEvidence(seeded.versionId);
    assert.equal(record!.excerpt_removed, true);
    assert.equal(record!.excerpt_removed_link_kept, false, "the ticked box must be honoured");
    assert.equal(record!.url, seeded.url, "the address itself stays on the record");
  });

  it("refuses a second takedown, a blank reason and an oversize reason", async () => {
    const seeded = await seedCapture("refusals");
    await takeDownCapture(owner, { versionId: seeded.versionId, reason: seeded.reason });
    await assert.rejects(
      () => takeDownCapture(owner, { versionId: seeded.versionId, reason: seeded.reason }),
      /already/i,
    );
    await assert.rejects(
      () => takeDownCapture(owner, { versionId: seeded.versionId + 1_000_000, reason: "x" }),
      /not in this newsroom/i,
    );
    const other = await seedCapture("blank");
    await assert.rejects(
      () => takeDownCapture(owner, { versionId: other.versionId, reason: "   " }),
      /reason/i,
    );
    await assert.rejects(
      () =>
        takeDownCapture(owner, {
          versionId: other.versionId,
          reason: "x".repeat(TAKEDOWN_REASON_MAX + 1),
        }),
      /characters or fewer/i,
    );
    const state = await purgeState(other.versionId);
    assert.equal(state.version.full_text, other.text, "a refused takedown must not purge the text");
  });
});
