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
const REASON =
  "The publisher asked us to remove the excerpt; it quoted their subscriber-only article.";

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
  rememberCapture: (opts: {
    userId: string;
    investigationId: number | null;
    url: string;
    title: string;
    text: string;
    hash: string;
    status: number;
    outcome: string;
    classification?: string;
    newsroomId?: number;
    autoWatch?: boolean;
  }) => Promise<{ versionId: number | null; captureEventId: number }>;
  takeDownCapture: (
    context: { userId: string; newsroomId: number; role: string },
    input: { versionId: number; reason: string; removeLink?: boolean; override?: string[] },
  ) => Promise<
    | {
    ok: true;
    linkKept: boolean;
    purged: {
      chunks: number;
      blobs: number;
      artifacts: number;
      claims: number;
      relationships: number;
    };
      }
    | { ok: false; warning: { key: string; sentence: string } }
  >;
  publicArticle: (row: Record<string, unknown>) => {
    provenance: { url: string; version_id?: number }[];
    findings: unknown[];
  };
  publicArticleForReaders: (row: Record<string, unknown>) => Promise<{
    provenance: {
      url: string;
      version_id?: number;
      excerpt_removed?: boolean;
      excerpt_removed_link_kept?: boolean;
    }[];
    findings: unknown[];
  }>;
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
    const investigate = await import("./investigate.ts");
    loaded = {
      loadPublicEvidence: evidence.loadPublicEvidence,
      takeDownCapture: takedown.takeDownCapture,
      rememberCapture: investigate.rememberCapture as unknown as Loaded["rememberCapture"],
      publicArticle: publicModule.publicArticle as unknown as Loaded["publicArticle"],
      publicArticleForReaders:
        publicModule.publicArticleForReaders as unknown as Loaded["publicArticleForReaders"],
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

/** The desk's own copies of one capture: an artifact, a claim, a relationship. */
async function seedWorkingCopies(versionId: number, tag: string) {
  const { rows: artifact } = await client.query<{ id: number }>(
    `insert into artifacts (user_id, newsroom_id, url, title, content_hash, full_text, version_id)
     values ('takedown-proof', 1, $1, 'Board packet', $2, $3, $4) returning id`,
    [CAPTURE_URL, `artifact-${tag}`, `ARTIFACT WHOLE PAGE ${tag}`, versionId],
  );
  const { rows: claim } = await client.query<{ id: number }>(
    `insert into claims (user_id, newsroom_id, body, kind, evidence, source_url, version_id, excerpt)
     values ('takedown-proof', 1, $1, 'record', $2, $3, $4, $5) returning id`,
    [`claim body ${tag}`, `CLAIM NOTE ${tag}`, CAPTURE_URL, versionId, `CLAIM EXCERPT ${tag}`],
  );
  const { rows: relationship } = await client.query<{ id: number }>(
    `insert into relationships (user_id, newsroom_id, from_name, to_name, kind, evidence, source_url, version_id, excerpt)
     values ('takedown-proof', 1, 'board', 'library', 'approved', $1, $2, $3, $4) returning id`,
    [`RELATIONSHIP NOTE ${tag}`, CAPTURE_URL, versionId, `RELATIONSHIP EXCERPT ${tag}`],
  );
  return { artifact: artifact[0]!.id, claim: claim[0]!.id, relationship: relationship[0]!.id };
}

/**
 * Seed one captured page, its chunks and bytes, the desk's own copies of it,
 * a second capture of the same page that must NOT be touched, and a published
 * story citing the first.
 */
async function seeded(): Promise<{
  versionId: number;
  otherVersionId: number;
  slug: string;
  copies: { artifact: number; claim: number; relationship: number };
  otherCopies: { artifact: number; claim: number; relationship: number };
}> {
  const slug = `takedown-proof-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const ids = "(select id from artifact_versions where url = $1)";
  await client.query(`delete from claims where version_id in ${ids}`, [CAPTURE_URL]);
  await client.query(`delete from relationships where version_id in ${ids}`, [CAPTURE_URL]);
  await client.query(`delete from artifacts where version_id in ${ids}`, [CAPTURE_URL]);
  await client.query(`delete from artifact_chunks where version_id in ${ids}`, [CAPTURE_URL]);
  await client.query(`delete from artifact_blobs where version_id in ${ids}`, [CAPTURE_URL]);
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
  const { rows: otherRows } = await client.query<{ id: number }>(
    `insert into artifact_versions (user_id, newsroom_id, url, content_hash, title, full_text, fetch_outcome, captured_at)
     values ('takedown-proof', 1, $1, 'proof-hash-2', 'Board packet', $2, 'fetched', now())
     returning id`,
    [CAPTURE_URL, `${CAPTURED_TEXT} The vote was revised.`],
  );
  const otherVersionId = otherRows[0]!.id;
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
  const copies = await seedWorkingCopies(versionId, "1");
  const otherCopies = await seedWorkingCopies(otherVersionId, "2");
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
    [
      slug,
      JSON.stringify([CAPTURE_URL]),
      JSON.stringify([{ url: CAPTURE_URL, version_id: versionId }]),
    ],
  );
  return { versionId, otherVersionId, slug, copies, otherCopies };
}

/** What the desk's own copies hold right now. */
async function workingCopyState(copies: { artifact: number; claim: number; relationship: number }) {
  const artifact = await client.query<{ full_text: string }>(
    "select full_text from artifacts where id = $1",
    [copies.artifact],
  );
  const claim = await client.query<{ excerpt: string; evidence: string }>(
    "select excerpt, evidence from claims where id = $1",
    [copies.claim],
  );
  const relationship = await client.query<{ excerpt: string; evidence: string }>(
    "select excerpt, evidence from relationships where id = $1",
    [copies.relationship],
  );
  return {
    artifact: artifact.rows[0]!,
    claim: claim.rows[0]!,
    relationship: relationship.rows[0]!,
  };
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
    const seed = await seeded();
    const { versionId, slug } = seed;

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
    assert.equal(result.purged.artifacts, 1, "the Dark Desk's copy of the page must be emptied");
    assert.equal(result.purged.claims, 1);
    assert.equal(result.purged.relationships, 1);

    // 3. The text is gone; the record is not.
    const after = await storedText(versionId);
    assert.equal(after.version.full_text, "", "the stored text must be purged");
    assert.ok(after.version.taken_down_at, "the capture must be marked with when it came down");
    assert.equal(
      after.version.taken_down_reason,
      REASON,
      "the desk keeps the reason beside the row",
    );
    assert.equal(
      after.version.taken_down_link_kept,
      true,
      "the link is kept unless asked otherwise",
    );
    assert.equal(after.version.url, CAPTURE_URL, "the record must still name the original");
    assert.equal(
      after.version.content_hash,
      "proof-hash-1",
      "the hash must survive: citations use it",
    );
    for (const chunk of after.chunks)
      assert.equal(chunk.excerpt, "", "every stored passage must be emptied");
    for (const blob of after.blobs)
      assert.equal(blob.body_b64, "", "the original bytes must be emptied");

    /*
      3b. The desk's own copies of the page (unit U11b2).

      The legal/security audit's HIGH finding: `artifacts.full_text` holds the
      WHOLE page for an investigation-linked capture, and a claim or a
      relationship records a verbatim passage of it. The first cut of this
      action left all three in place, so the public promise ("the excerpt was
      removed") was false while the publisher's text sat in the desk's own
      tables. The mutation for this case drops the `artifacts` update, and the
      first assertion below is what fails.
    */
    const copies = await workingCopyState(seed.copies);
    assert.equal(copies.artifact.full_text, "", "the Dark Desk's copy of the page must be emptied");
    assert.equal(copies.claim.excerpt, "", "a claim's recorded passage must be emptied");
    assert.equal(copies.relationship.excerpt, "", "a relationship's passage must be emptied");
    /* The desk's own note of what the record says is a working note, not the
       stored capture, and is not touched -- the manual says so in the same
       words this test pins. */
    assert.equal(copies.claim.evidence, "CLAIM NOTE 1");
    assert.equal(copies.relationship.evidence, "RELATIONSHIP NOTE 1");

    /* And a second capture of the SAME page keeps everything it had: the purge
       follows the version it was asked about, not the URL. */
    const untouched = await workingCopyState(seed.otherCopies);
    assert.equal(untouched.artifact.full_text, "ARTIFACT WHOLE PAGE 2");
    assert.equal(untouched.claim.excerpt, "CLAIM EXCERPT 2");
    assert.equal(untouched.relationship.excerpt, "RELATIONSHIP EXCERPT 2");
    const otherCapture = await storedText(seed.otherVersionId);
    assert.equal(otherCapture.version.full_text, `${CAPTURED_TEXT} The vote was revised.`);
    assert.equal(otherCapture.version.taken_down_at, null, "the other capture is not taken down");

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
    assert.equal(
      record!.has_original_bytes,
      false,
      "the page may not claim bytes it no longer holds",
    );
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

  it("carries the taken-down flags onto the story's own provenance, ticked box and all", async () => {
    const seed = await seeded();
    const readArticle = async () => {
      const { rows } = await client.query<Record<string, unknown>>(
        `select id, slug, headline, dek, body, topic, source_urls, status, published_at,
                provenance_json, form, found_note, unanswered
         from articles where slug = $1`,
        [seed.slug],
      );
      return rows[0]!;
    };

    /* Before the takedown the story's card is an ordinary one. */
    const readable = await loaded.publicArticleForReaders(await readArticle());
    assert.equal(readable.provenance[0]!.excerpt_removed, undefined, "nothing is marked yet");

    /* The owner takes it down AND asks for the link to go with it. */
    const result = await loaded.takeDownCapture(
      { userId: "takedown-proof", newsroomId: 1, role: "owner" },
      { versionId: seed.versionId, reason: REASON, removeLink: true },
    );
    assert.equal(result.ok, true);
    assert.equal(result.linkKept, false);

    /*
      The reader's story page reads its provenance through
      `publicArticleForReaders` -- the same function `getPublishedArticle`
      calls. The row it returns must carry the flags, because that is what
      `ProvenanceBlock` renders: without them the card keeps a "Current source"
      link to the publisher whose link the owner just removed.
    */
    const served = await loaded.publicArticleForReaders(await readArticle());
    const row = served.provenance[0]!;
    assert.equal(row.url, CAPTURE_URL);
    assert.equal(row.version_id, seed.versionId);
    assert.equal(row.excerpt_removed, true, "the story must know the excerpt came down");
    assert.equal(row.excerpt_removed_link_kept, false, "and that the link went with it");

    /* A capture of the same URL that was NOT taken down carries nothing. */
    await client.query("update articles set provenance_json = $1 where slug = $2", [
      JSON.stringify([
        { url: CAPTURE_URL, version_id: seed.versionId },
        { url: CAPTURE_URL, version_id: seed.otherVersionId },
      ]),
      seed.slug,
    ]);
    const both = await loaded.publicArticleForReaders(await readArticle());
    assert.equal(both.provenance[0]!.excerpt_removed, true);
    assert.equal(both.provenance[1]!.excerpt_removed, undefined, "the other capture is untouched");
  });

  it("does not put the text back when the page is fetched again", async () => {
    const seed = await seeded();
    const { versionId, slug } = seed;

    await loaded.takeDownCapture(
      { userId: "takedown-proof", newsroomId: 1, role: "owner" },
      { versionId, reason: REASON, removeLink: true },
    );
    const purged = await storedText(versionId);
    assert.equal(purged.version.full_text, "");

    /* An investigation, so the fetch writes the Dark Desk's own artifact. */
    const investigation = await client.query<{ id: number }>(
      `insert into investigations (user_id, newsroom_id, title)
       values ('takedown-proof', 1, 'Re-fetch proof') returning id`,
    );
    /*
      The SAME page: same URL, same content hash, same text -- which is exactly
      what a scheduled check or a second look at a page that has not moved
      does. The version row is unique on (newsroom, url, hash), so this
      resolves to the captured-then-taken-down version rather than minting a
      new one.
    */
    const again = await loaded.rememberCapture({
      userId: "takedown-proof",
      newsroomId: 1,
      investigationId: investigation.rows[0]!.id,
      url: CAPTURE_URL,
      title: "Board packet",
      text: CAPTURED_TEXT,
      hash: "proof-hash-1",
      status: 200,
      outcome: "fetched",
      autoWatch: false,
    });
    assert.equal(again.versionId, versionId, "the re-fetch must resolve to the same capture");

    /* Nothing anywhere holds the page again: not the version, not its
       passages, not its bytes, not the Dark Desk's copy of the fetch. */
    const after = await storedText(versionId);
    assert.equal(after.version.full_text, "", "the version's text must stay purged");
    assert.ok(after.version.taken_down_at, "and it must stay marked as taken down");
    const textChunks = await client.query<{ count: number }>(
      "select count(*)::int as count from artifact_chunks where version_id = $1 and excerpt <> ''",
      [versionId],
    );
    assert.equal(textChunks.rows[0]!.count, 0, "no passage may come back");
    const textBlobs = await client.query<{ count: number }>(
      "select count(*)::int as count from artifact_blobs where version_id = $1 and body_b64 <> ''",
      [versionId],
    );
    assert.equal(textBlobs.rows[0]!.count, 0, "no original bytes may come back");
    const artifacts = await client.query<{ id: number; full_text: string }>(
      "select id, full_text from artifacts where version_id = $1",
      [versionId],
    );
    assert.ok(artifacts.rows.length >= 2, "the re-fetch records a new artifact row");
    for (const row of artifacts.rows)
      assert.equal(row.full_text, "", "no Dark Desk artifact may hold the page again");
    /* The fetch itself is still recorded -- it happened. */
    const events = await client.query<{ count: number }>(
      "select count(*)::int as count from capture_events where version_id = $1",
      [versionId],
    );
    assert.ok(events.rows[0]!.count >= 2, "the observation is still recorded");

    /*
      And the manual's other half: a page that DID change mints a new version,
      which this takedown never covered, and that version keeps its text.
    */
    const changed = await loaded.rememberCapture({
      userId: "takedown-proof",
      newsroomId: 1,
      investigationId: investigation.rows[0]!.id,
      url: CAPTURE_URL,
      title: "Board packet",
      text: `${CAPTURED_TEXT} The vote was revised again.`,
      hash: "proof-hash-3",
      status: 200,
      outcome: "changed",
      autoWatch: false,
    });
    assert.notEqual(changed.versionId, versionId, "changed content is a new capture");
    const changedRows = await storedText(changed.versionId!);
    assert.notEqual(changedRows.version.full_text, "", "a new capture keeps its own text");
    assert.equal(changedRows.version.taken_down_at, null);

    /* The story's own payload still carries no verbatim quote (unit U11b3). */
    await client.query("update articles set found_note = $1 where slug = $2", [
      JSON.stringify([
        {
          text: "The board approved the recreation room update.",
          source_urls: [CAPTURE_URL],
          artifact_version_ids: [versionId],
          capture_event_ids: [],
          locators: ["char:0-40"],
          excerpt: "A QUOTE FROM THE PUBLISHER'S SUBSCRIBER-ONLY PAGE",
        },
      ]),
      slug,
    ]);
    const article = await client.query<Record<string, unknown>>(
      `select id, slug, headline, dek, body, topic, source_urls, status, published_at,
              provenance_json, form, found_note, unanswered
       from articles where slug = $1`,
      [slug],
    );
    const served = await loaded.publicArticleForReaders(article.rows[0]!);
    assert.equal((served.findings as { excerpt?: string }[]).length, 1);
    assert.ok(
      !("excerpt" in (served.findings[0] as object)),
      "the reader's finding must not carry the recorded quote",
    );
    assert.ok(
      !JSON.stringify(served).includes("SUBSCRIBER-ONLY PAGE"),
      "and the quote must be nowhere in the served article",
    );
  });

  it("refuses, and purges nothing, when a legal-removal case already covers the page", async () => {
    const seed = await seeded();
    const { versionId } = seed;

    /*
      A removal case that covers this exact capture row. `legal_removal_targets`
      is what the 0047 guard consults first (`prevent_legal_resurrection`), and
      a row there is enough for it to refuse every update to that capture --
      including the purge.
    */
    await client.query(
      `insert into legal_removals(id, newsroom_id, requested_by, case_ref, policy)
       values ($1, 1, 'takedown-proof', 'TAKEDOWN-GUARD-PROOF', 'destroy')`,
      ["takedown-guard-proof"],
    );
    await client.query(
      `insert into legal_removal_targets(newsroom_id, table_name, row_id, case_id)
       values (1, 'artifact_versions', $1, 'takedown-guard-proof')`,
      [versionId],
    );

    try {
      await assert.rejects(
        () =>
          loaded.takeDownCapture(
            { userId: "takedown-proof", newsroomId: 1, role: "owner" },
            { versionId, reason: REASON },
          ),
        /legal removal/i,
        "the guard must refuse a capture a removal case already covers",
      );

      /*
        Nothing moved: the whole transaction rolled back, so there is no
        half-purge -- no emptied version with its artifacts still full, and no
        audit row claiming a capture came down that is still here.
      */
      const after = await storedText(versionId);
      assert.equal(after.version.full_text, CAPTURED_TEXT, "the text must be untouched");
      assert.equal(after.version.taken_down_at, null, "the capture must not be marked");
      assert.equal(after.chunks.length, 2, "its passages must be untouched");
      const copies = await workingCopyState(seed.copies);
      assert.equal(copies.artifact.full_text, "ARTIFACT WHOLE PAGE 1");
      assert.equal(copies.claim.excerpt, "CLAIM EXCERPT 1");
      assert.equal(copies.relationship.excerpt, "RELATIONSHIP EXCERPT 1");
      const audit = await client.query(
        "select 1 from audit_events where subject_kind = 'artifact_versions' and subject_id = $1",
        [versionId],
      );
      assert.equal(audit.rows.length, 0, "a refused takedown writes no audit row");
      assert.ok(
        await loaded.loadPublicEvidence(versionId),
        "and the capture is still the public record it was",
      );
    } finally {
      await client.query(
        "delete from legal_removal_targets where case_id = 'takedown-guard-proof'",
      );
      await client.query("delete from legal_removals where id = 'takedown-guard-proof'");
    }
  });
});
