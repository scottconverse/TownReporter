import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import {
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  withDatabase,
} from "../test-support/pg-admin.ts";

/*
  Unit U11b, on a real PostgreSQL built by `migrations/*.sql` alone.

  WHY NOT PGLITE. `evidence-takedown.test.ts` proves the same action against
  the runtime `ensure*` schema, which is the path a plain `node --test` run
  takes. This file proves it against the other one: the schema a deployed desk
  actually has, built by migrations 0001..0110 and carrying things PGlite in a
  unit test does not install -- the 0047 legal-removal guard triggers on
  `artifact_versions`, `artifact_chunks` and `artifact_blobs`, which fire on
  every one of the three UPDATEs the purge performs, and a `not null default
  true` column whose default only the migration path gives an existing row.

  WHAT IT PROVES, in the order the cases run:

    1. A capture cited by a published story is public: the reader's record
       carries the excerpt, and the story's provenance names that version.
    2. An owner takes it down. The stored text is empty in the database -- the
       version, every chunk, the original bytes -- while the row, its URL, its
       timestamp and its content hash are all still there.
    3. Exactly one audit row records who, when, the reason and the capture,
       and it carries no captured text.
    4. The public loader returns the NOTICE, not an excerpt, and the reason is
       nowhere in what a reader is served.
    5. The citing story still renders its citation, and that citation still
       resolves -- to the notice. This is the property the whole unit exists
       for: taking one capture down must not break the story that cited it.

  The scratch database is created and dropped by this file, exactly as
  `welcome-article-migration.postgres.test.ts` does; `scripts/
  run-postgres-integration.mjs` runs it with the other discovered real-Postgres
  proofs, and CI's `postgres-integration` job runs that runner.
*/

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : { ok: false as const, reason: "set TEST_POSTGRES_ADMIN_URL; CI runs this proof" };
const skip = probe.ok ? false : probe.reason;
const dbName = `townreporter_takedown_${process.pid}_${Date.now()}`;

let client: Client;
let created = false;

/** Every migration, in apply order, exactly as `scripts/migrate.mjs` sorts them. */
function migrationFiles(): string[] {
  return readdirSync(resolve(process.cwd(), "migrations"))
    .filter((value) => /^\d+.*\.sql$/.test(value))
    .sort();
}

/** The captured page this proof is about. */
const CAPTURE_URL = "https://records.example.test/takedown-proof/agenda";
const CAPTURED_TEXT =
  "The board approved the recreation room update on a 5-2 vote, with two members absent.";
const OTHER_CHUNK =
  "Item 7: the recreation room update, approved 5-2 after forty minutes of public comment.";
const REASON = "The publisher asked us to remove the excerpt; it quoted their subscriber-only article.";

type Loaded = {
  loadPublicEvidence: (id: number) => Promise<{
    excerpt: string;
    excerpt_removed: boolean;
    excerpt_removed_link_kept: boolean;
    has_original_bytes: boolean;
    byte_length: number | null;
    url: string;
    content_hash: string;
    timeline: unknown[];
  } | null>;
  takeDownCapture: (
    context: { userId: string; newsroomId: number; role: string },
    input: { versionId: number; reason: string; removeLink?: boolean },
  ) => Promise<{ ok: true; purged: { chunks: number; blobs: number } }>;
  publicArticle: (row: Record<string, unknown>) => {
    provenance: { url: string; version_id?: number }[];
    findings: unknown[];
  };
  closePoolForTests: () => Promise<void>;
};

let loaded: Loaded;

if (probe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`create database ${dbName}`);
      created = true;
    } finally {
      await admin.end();
    }
    client = new Client({ connectionString: withDatabase(adminUrl, dbName) });
    await client.connect();
    for (const name of migrationFiles())
      await client.query(readFileSync(resolve(process.cwd(), "migrations", name), "utf8"));

    /*
      Point the process at the scratch database BEFORE anything that reads
      `DATABASE_URL` is evaluated: `db.ts` resolves its backend the moment it
      first loads, and the modules below import it.
    */
    process.env.DATABASE_URL = withDatabase(adminUrl, dbName);
    process.env.TOWNREPORTER_CLAUDE_CODE = "0";
    const db = await import("../db.ts");
    const evidence = await import("./evidence.ts");
    const takedown = await import("./evidence-takedown.ts");
    const publicModule = await import("./public.ts");
    loaded = {
      loadPublicEvidence: evidence.loadPublicEvidence,
      takeDownCapture: takedown.takeDownCapture,
      publicArticle: publicModule.publicArticle as unknown as Loaded["publicArticle"],
      closePoolForTests: db.closePoolForTests,
    };
  });

  after(async () => {
    try {
      await loaded.closePoolForTests();
    } catch {
      /* the pool may never have opened */
    }
    await client.end();
    if (!created) return;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`drop database if exists ${dbName} with (force)`);
    } catch {
      /* a leftover scratch database is recoverable; see docs/postgres-integration-testing.md */
    } finally {
      await admin.end();
    }
  });
}

/** Seed one captured page, its chunks and bytes, and a published story citing it. */
async function seed(): Promise<{ versionId: number; slug: string }> {
  const slug = `takedown-proof-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await client.query("delete from artifact_chunks where version_id in (select id from artifact_versions where url = $1)", [CAPTURE_URL]);
  await client.query("delete from artifact_blobs where version_id in (select id from artifact_versions where url = $1)", [CAPTURE_URL]);
  await client.query("delete from capture_events where source_url = $1", [CAPTURE_URL]);
  await client.query("delete from artifact_versions where url = $1", [CAPTURE_URL]);
  await client.query("delete from articles where source_urls like $1", [`%${CAPTURE_URL}%`]);
  const { rows } = await client.query<{ id: number }>(
    `insert into artifact_versions (user_id, newsroom_id, url, content_hash, title, full_text, fetch_outcome, captured_at)
     values ('takedown-proof', 1, $1, 'proof-hash-1', 'Board packet', $2, 'fetched', now() - interval '1 hour')
     returning id`,
    [CAPTURE_URL, CAPTURED_TEXT],
  );
  const versionId = rows[0]!.id;
  await client.query(
    `insert into artifact_chunks (version_id, user_id, newsroom_id, chunk_index, excerpt, locator)
     values ($1, 'takedown-proof', 1, 0, $2, 'p1'), ($1, 'takedown-proof', 1, 1, $3, 'p2')`,
    [versionId, CAPTURED_TEXT, OTHER_CHUNK],
  );
  await client.query(
    `insert into artifact_blobs (version_id, user_id, newsroom_id, sha256, original_url, byte_length, body_b64)
     values ($1, 'takedown-proof', 1, 'proof-sha-1', $2, 128, $3)`,
    [versionId, CAPTURE_URL, Buffer.from(CAPTURED_TEXT).toString("base64")],
  );
  await client.query(
    `insert into capture_events (user_id, newsroom_id, source_url, observed_at, fetch_outcome, version_id, content_hash)
     values ('takedown-proof', 1, $1, now() - interval '1 hour', 'fetched', $2, 'proof-hash-1')`,
    [CAPTURE_URL, versionId],
  );
  await client.query(
    `insert into articles (user_id, newsroom_id, slug, headline, dek, body, topic, source_urls, status, published_at, provenance_json)
     values ('takedown-proof', 1, $1, 'Library board approves recreation room update',
       'The board voted 5-2.', 'The board approved the recreation room update.', 'council',
       $2, 'published', now(), $3)`,
    [slug, JSON.stringify([CAPTURE_URL]), JSON.stringify([{ url: CAPTURE_URL, version_id: versionId }])],
  );
  return { versionId, slug };
}

async function storedText(versionId: number) {
  const { rows } = await client.query<{
    full_text: string;
    taken_down_at: string | null;
    taken_down_reason: string | null;
    taken_down_link_kept: boolean;
    url: string;
    content_hash: string;
  }>(
    `select full_text, taken_down_at::text as taken_down_at, taken_down_reason,
            taken_down_link_kept, url, content_hash
     from artifact_versions where id = $1`,
    [versionId],
  );
  const chunks = await client.query<{ excerpt: string }>(
    "select excerpt from artifact_chunks where version_id = $1 order by chunk_index",
    [versionId],
  );
  const blobs = await client.query<{ body_b64: string }>(
    "select body_b64 from artifact_blobs where version_id = $1",
    [versionId],
  );
  return { version: rows[0]!, chunks: chunks.rows, blobs: blobs.rows };
}

describe("taking down one captured excerpt, on migration-built PostgreSQL", { skip }, () => {
  it("purges the capture's text, keeps its record, and leaves the story's citation resolving", async () => {
    const { versionId, slug } = await seed();

    // 1. Public while the story cites it, and the excerpt is the captured text.
    const before = await loaded.loadPublicEvidence(versionId);
    assert.ok(before, "a capture cited by a published story must be public");
    assert.match(before!.excerpt, /recreation room update/);
    assert.equal(before!.excerpt_removed, false);
    assert.ok(before!.has_original_bytes, "the seeded capture holds original bytes");

    const beforeRows = await storedText(versionId);
    assert.equal(beforeRows.version.full_text, CAPTURED_TEXT);
    assert.equal(beforeRows.version.taken_down_at, null);
    assert.equal(beforeRows.chunks.length, 2);
    assert.equal(beforeRows.blobs.length, 1);

    // 2. The owner takes it down.
    const result = await loaded.takeDownCapture(
      { userId: "takedown-proof", newsroomId: 1, role: "owner" },
      { versionId, reason: REASON },
    );
    assert.equal(result.ok, true);
    assert.equal(result.purged.chunks, 2, "both stored passages of the capture must be emptied");
    assert.equal(result.purged.blobs, 1, "the original bytes must be emptied");

    // 3. The text is gone; the record is not.
    const after = await storedText(versionId);
    assert.equal(after.version.full_text, "", "the stored text must be purged");
    assert.ok(after.version.taken_down_at, "the capture must be marked with when it came down");
    assert.equal(after.version.taken_down_reason, REASON, "the desk keeps the reason beside the row");
    assert.equal(after.version.taken_down_link_kept, true, "the link is kept unless asked otherwise");
    assert.equal(after.version.url, CAPTURE_URL, "the record must still name the original");
    assert.equal(after.version.content_hash, "proof-hash-1", "the hash must survive: citations use it");
    for (const chunk of after.chunks)
      assert.equal(chunk.excerpt, "", "every stored passage must be emptied");
    for (const blob of after.blobs)
      assert.equal(blob.body_b64, "", "the original bytes must be emptied");

    // 4. One audit row: who, when, the reason and the capture -- and no captured text.
    const audit = await client.query<{
      user_id: string;
      action: string;
      detail: string;
      created_at: string;
      subject_kind: string | null;
      subject_id: number | null;
      row: unknown;
    }>(
      `select user_id, action, detail, created_at::text as created_at, subject_kind, subject_id,
              to_jsonb(audit_events) as row
       from audit_events where subject_kind = 'artifact_versions' and subject_id = $1`,
      [versionId],
    );
    assert.equal(audit.rows.length, 1, "a takedown writes exactly one audit row");
    const row = audit.rows[0]!;
    assert.equal(row.user_id, "takedown-proof", "the audit row records who");
    assert.ok(row.created_at, "the audit row records when");
    assert.equal(row.action, "evidence-capture-takedown");
    assert.equal(row.detail, REASON, "the audit row carries the reason, and nothing else");
    assert.equal(row.subject_id, versionId, "the audit row records the capture id");
    const auditWire = JSON.stringify(row.row);
    assert.ok(!auditWire.includes(CAPTURED_TEXT), "no captured text may reach the audit row");
    assert.ok(!auditWire.includes(OTHER_CHUNK), "no captured text may reach the audit row");

    // 5. The reader gets the notice, and never the reason.
    const record = await loaded.loadPublicEvidence(versionId);
    assert.ok(record, "the capture must still resolve: the published citation points at it");
    assert.equal(record!.excerpt, "", "no excerpt survives a takedown");
    assert.equal(record!.excerpt_removed, true, "the public page must print the notice");
    assert.equal(record!.excerpt_removed_link_kept, true);
    assert.equal(record!.has_original_bytes, false, "the page may not claim bytes it no longer holds");
    assert.equal(record!.byte_length, null);
    assert.equal(record!.url, CAPTURE_URL, "the notice still names the original");
    const wire = JSON.stringify(record);
    assert.ok(!wire.includes(REASON), "the takedown reason must never reach a reader");
    assert.ok(!wire.includes("subscriber-only"), "the takedown reason must never reach a reader");
    assert.ok(!wire.includes(CAPTURED_TEXT), "no captured text may reach a reader");

    /*
      The story that cited it still renders its citation.

      The article page reads the article's own provenance (`publicArticle` is
      the function its loader passes the row through) and links each entry's
      `/evidence/:versionId`. Both halves are asserted here: the citation is
      still on the story, and the address it points at is the notice -- which
      is the difference between "we removed the excerpt" and "the story's
      citation broke".
    */
    const article = await client.query<Record<string, unknown>>(
      `select id, slug, headline, dek, body, topic, source_urls, status, published_at,
              provenance_json, form, found_note, unanswered
       from articles where slug = $1`,
      [slug],
    );
    assert.equal(article.rows.length, 1, "the citing story must still be published");
    const rendered = loaded.publicArticle(article.rows[0]!);
    assert.equal(rendered.provenance.length, 1, "the story must still carry its citation");
    assert.equal(rendered.provenance[0]!.url, CAPTURE_URL);
    assert.equal(rendered.provenance[0]!.version_id, versionId);
    const cited = await loaded.loadPublicEvidence(rendered.provenance[0]!.version_id!);
    assert.equal(cited?.excerpt_removed, true, "the citation must land on the notice");
  });
});
