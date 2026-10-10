import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureInvestigateSchema } from "./investigate.ts";
import { ensureAuditEventsSchema } from "./ops.ts";
import {
  comparePublishedEvidence,
  loadPublicEvidence,
  markRemovedCaptures,
  removedCapturesFor,
} from "./evidence.ts";
import {
  TAKEDOWN_ACTION,
  TAKEDOWN_BLANK_REASON_KEY,
  TAKEDOWN_REASON_MAX,
  TAKEDOWN_SUBJECT_KIND,
  takeDownCapture,
  takedownFailure,
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
  await sql.query(
    `alter table articles add column if not exists provenance_json text not null default '[]'`,
  );
  await sql.query(
    `alter table articles add column if not exists found_note text not null default ''`,
  );
  await sql.query(
    `alter table articles add column if not exists newsroom_id integer not null default 1`,
  );
}

type Seeded = {
  versionId: number;
  /** A second capture of the same page -- never taken down, so nothing of its
      rows or its working copies may move. */
  otherVersionId: number;
  url: string;
  text: string;
  /** The second capture's text, which DIFFERS: a comparison of the two has
      something to report while both are readable. */
  otherText: string;
  reason: string;
  workingCopies: { artifact: number; claim: number; relationship: number };
  otherWorkingCopies: { artifact: number; claim: number; relationship: number };
};

/**
 * One captured page, cited by one published story, with the desk's own working
 * copies of it: a Dark Desk artifact of the same fetch, and a claim and a
 * relationship that recorded a passage from it.
 *
 * Every one of those is a place the same third-party text sits (`investigate.ts`
 * writes all three with a `version_id`), which is what the legal/security audit
 * found and what the purge now has to reach. A second version of the same page
 * carries the same three rows so the test can prove the purge does not reach
 * past the capture it was asked about.
 */
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
  const otherText = `${text} The vote was revised the next morning.`;
  const [other] = await sql<{ id: number }>`
    insert into artifact_versions (user_id, url, content_hash, title, full_text, fetch_outcome, captured_at)
    values ('takedown-test', ${url}, ${`hash-${label}-2`}, 'Board packet', ${otherText}, 'fetched', now() + interval '1 day')
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
  const workingCopies = await seedWorkingCopies(url, version!.id, `${label}-1`);
  const otherWorkingCopies = await seedWorkingCopies(url, other!.id, `${label}-2`);
  await sql`
    insert into articles (user_id, slug, headline, body, topic, source_urls, status, provenance_json)
    values ('takedown-test', ${`slug-${label}-${version!.id}`}, 'Library story', 'Body text',
      'council', ${JSON.stringify([url])}, 'published', ${JSON.stringify([{ url, version_id: version!.id }])})
  `;
  return {
    versionId: version!.id,
    otherVersionId: other!.id,
    url,
    text,
    otherText,
    reason,
    workingCopies,
    otherWorkingCopies,
  };
}

/** An artifact, a claim and a relationship all keyed to one captured version. */
async function seedWorkingCopies(url: string, versionId: number, tag: string) {
  const sql = await getSql();
  const [artifact] = await sql<{ id: number }>`
    insert into artifacts (user_id, newsroom_id, url, title, content_hash, full_text, version_id)
    values ('takedown-test', 1, ${url}, 'Board packet', ${`artifact-${tag}`}, ${`artifact text ${tag}`}, ${versionId})
    returning id
  `;
  const [claim] = await sql<{ id: number }>`
    insert into claims (user_id, newsroom_id, investigation_id, body, kind, evidence, source_url, version_id, excerpt)
    values ('takedown-test', 1, null, ${`claim body ${tag}`}, 'record', ${`claim note ${tag}`},
      ${url}, ${versionId}, ${`claim excerpt ${tag}`})
    returning id
  `;
  const [relationship] = await sql<{ id: number }>`
    insert into relationships (user_id, newsroom_id, investigation_id, from_name, to_name, kind, evidence, source_url, version_id, excerpt)
    values ('takedown-test', 1, null, 'board', 'library', 'approved', ${`relationship note ${tag}`},
      ${url}, ${versionId}, ${`relationship excerpt ${tag}`})
    returning id
  `;
  return { artifact: artifact!.id, claim: claim!.id, relationship: relationship!.id };
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

/** What the desk's own copies of a capture hold right now. */
async function workingCopyState(copies: Seeded["workingCopies"]) {
  const sql = await getSql();
  const [artifact] = await sql<{ full_text: string }>`
    select full_text from artifacts where id = ${copies.artifact}
  `;
  const [claim] = await sql<{ excerpt: string; evidence: string }>`
    select excerpt, evidence from claims where id = ${copies.claim}
  `;
  const [relationship] = await sql<{ excerpt: string; evidence: string }>`
    select excerpt, evidence from relationships where id = ${copies.relationship}
  `;
  return { artifact, claim, relationship };
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
    assert.equal(
      state.version.full_text,
      seeded.text,
      "a refused takedown must not empty the text",
    );
    assert.equal(state.version.taken_down_at, null, "a refused takedown must not mark the capture");
    assert.equal(
      state.chunks[0]?.excerpt,
      seeded.text,
      "a refused takedown must not empty a chunk",
    );
    assert.deepEqual(state.audit, [], "a refused takedown must not write an audit row");
    const record = await loadPublicEvidence(seeded.versionId);
    assert.equal(
      record?.excerpt_removed,
      false,
      "a refused takedown must leave the excerpt public",
    );
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
    assert.equal(result.purged.artifacts, 1, "the Dark Desk's copy of the fetch is one row");
    assert.equal(result.purged.claims, 1);
    assert.equal(result.purged.relationships, 1);

    const state = await purgeState(seeded.versionId);
    assert.equal(state.version.full_text, "", "the version's stored text must be emptied");
    assert.ok(state.version.taken_down_at, "the capture must be marked as taken down");
    for (const chunk of state.chunks)
      assert.equal(chunk.excerpt, "", "every stored passage of the capture must be emptied");
    for (const blob of state.blobs)
      assert.equal(blob.body_b64, "", "the original bytes of the capture must be emptied");

    /*
      The three room-scoped stores that hold the same page (unit U11b2).

      `artifacts.full_text` is the Dark Desk's own copy of the fetch -- the
      WHOLE page, not an excerpt -- and a claim or relationship records a
      verbatim passage of it. The first cut of this action left all three
      alone, so the public page could say an excerpt was removed while the
      publisher's text sat in the desk's own tables. The mutation for this
      case drops the `artifacts` update: the first assertion below fails.
    */
    const copies = await workingCopyState(seeded.workingCopies);
    assert.equal(copies.artifact.full_text, "", "the Dark Desk's copy of the page must be emptied");
    assert.equal(copies.claim.excerpt, "", "a claim's recorded passage must be emptied");
    assert.equal(
      copies.relationship.excerpt,
      "",
      "a relationship's recorded passage must be emptied",
    );
    /* The desk's own note of what the record says is a working note, not the
       stored capture, and stays (the manual says so in the same words). */
    assert.equal(copies.claim.evidence, "claim note purged-1");
    assert.equal(copies.relationship.evidence, "relationship note purged-1");

    /*
      And nothing of the second capture's moved. A purge that reached by URL,
      or that forgot its `version_id` predicate, would take this with it.
    */
    const untouched = await workingCopyState(seeded.otherWorkingCopies);
    assert.equal(untouched.artifact.full_text, "artifact text purged-2");
    assert.equal(untouched.claim.excerpt, "claim excerpt purged-2");
    assert.equal(untouched.relationship.excerpt, "relationship excerpt purged-2");
    const otherState = await purgeState(seeded.otherVersionId);
    assert.equal(
      otherState.version.full_text,
      seeded.otherText,
      "the other capture's text must stay",
    );
    assert.equal(otherState.version.taken_down_at, null, "the other capture must not be marked");

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
    assert.equal(
      record!.excerpt_removed_link_kept,
      true,
      "the link is kept unless asked otherwise",
    );
    assert.equal(
      record!.has_original_bytes,
      false,
      "the page may not claim bytes it no longer holds",
    );
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
    const cited = (
      JSON.parse(article!.provenance_json) as { url: string; version_id: number }[]
    )[0]!;
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

  it("refuses a second takedown, a missing capture and an oversize reason", async () => {
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
    const other = await seedCapture("oversize");
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
    const copies = await workingCopyState(other.workingCopies);
    assert.equal(copies.artifact.full_text, "artifact text oversize-1");
  });


  it("asks before taking down a capture with no reason, then does it on the second call", async () => {
    const seeded = await seedCapture("blank-reason");
    const asking = await takeDownCapture(owner, { versionId: seeded.versionId, reason: "   " });
    assert.equal(asking.ok, false);
    assert.ok("warning" in asking, "the first call is a warning, not a refusal");
    if (asking.ok || !("warning" in asking)) throw new Error("expected a warning");
    assert.equal(asking.warning.key, TAKEDOWN_BLANK_REASON_KEY);
    assert.ok(asking.warning.sentence.length > 0, "the desk is given a sentence to draw");

    const untouched = await purgeState(seeded.versionId);
    assert.equal(untouched.version.full_text, seeded.text, "asking purges nothing");
    assert.equal(untouched.version.taken_down_at, null, "asking marks nothing");
    assert.deepEqual(untouched.audit, [], "asking records no takedown row");

    const done = await takeDownCapture(owner, {
      versionId: seeded.versionId,
      reason: "   ",
      override: [TAKEDOWN_BLANK_REASON_KEY],
    });
    assert.equal(done.ok, true);
    assert.equal(done.linkKept, true);

    const state = await purgeState(seeded.versionId);
    assert.equal(state.version.full_text, "", "the second call purges the text");
    assert.ok(state.version.taken_down_at, "and marks the capture");
    assert.equal(state.audit.length, 1, "the takedown still writes its own audit row");

    const sql = await getSql();
    const [reason] = await sql<{ taken_down_reason: string | null }>`
      select taken_down_reason from artifact_versions where id = ${seeded.versionId}
    `;
    assert.equal(reason!.taken_down_reason, "", "an empty reason is stored as the empty string");

    const overrides = await sql<{
      user_id: string;
      detail: string;
      subject_kind: string | null;
      subject_id: number | null;
    }>`
      select user_id, detail, subject_kind, subject_id from audit_events
      where action = 'override' and subject_kind = ${TAKEDOWN_SUBJECT_KIND} and subject_id = ${seeded.versionId}
      order by id asc
    `;
    assert.equal(overrides.length, 1, "the accepted warning is one override row");
    assert.equal(overrides[0]!.user_id, owner.userId);
    assert.equal(
      (JSON.parse(overrides[0]!.detail) as { key: string }).key,
      TAKEDOWN_BLANK_REASON_KEY,
    );
  });

  it("compares nothing once either side's excerpt has been taken down", async () => {
    const seeded = await seedCapture("compared");
    const both = await comparePublishedEvidence({ url: seeded.url });
    assert.ok(both, "the two captures of one cited URL must be comparable");
    assert.equal(both!.excerpt_removed, false);
    assert.ok(
      both!.changes.added_total + both!.changes.removed_total > 0,
      "two captures that differ must report changes while both are readable",
    );

    await takeDownCapture(owner, { versionId: seeded.versionId, reason: seeded.reason });

    const after = await comparePublishedEvidence({ url: seeded.url });
    assert.ok(after, "the comparison still exists: only the diff is withheld");
    assert.equal(after!.excerpt_removed, true, "the page is told to say the excerpt was removed");
    assert.deepEqual(after!.changes.added, [], "no snippets may be shown from either side");
    assert.deepEqual(after!.changes.removed, []);
    assert.equal(after!.changes.added_total + after!.changes.removed_total, 0);

    /* By explicit ids too: the page can be reached with `?a=&b=`, and that path
       builds its own pair. */
    const byId = await comparePublishedEvidence({
      a: seeded.versionId,
      b: seeded.otherVersionId,
    });
    assert.equal(byId!.excerpt_removed, true);
    assert.deepEqual(byId!.changes.added, []);
  });

  it("marks a cited capture as removed for the story page, and only that capture", async () => {
    const seeded = await seedCapture("provenance");
    const items = [
      { url: seeded.url, version_id: seeded.versionId },
      { url: seeded.url, version_id: seeded.otherVersionId },
      { url: "https://records.example.test/no-capture", version_id: null },
    ];

    const before = markRemovedCaptures(
      items,
      await removedCapturesFor([seeded.versionId, seeded.otherVersionId]),
    );
    assert.deepEqual(before, items, "nothing is marked while the capture is readable");

    await takeDownCapture(owner, {
      versionId: seeded.versionId,
      reason: seeded.reason,
      removeLink: true,
    });

    const state = await removedCapturesFor([seeded.versionId, seeded.otherVersionId]);
    assert.equal(state.get(seeded.versionId)?.linkKept, false, "the ticked box reaches the story");
    assert.equal(state.has(seeded.otherVersionId), false, "an untouched capture is not in the map");

    const marked = markRemovedCaptures(items, state);
    assert.equal(marked[0]!.excerpt_removed, true, "the cited capture is marked as removed");
    assert.equal(marked[0]!.excerpt_removed_link_kept, false);
    assert.equal(marked[1]!.excerpt_removed, undefined, "the other capture is left alone");
    assert.equal(marked[2]!.excerpt_removed, undefined, "a citation with no capture is left alone");
    assert.equal(marked[2]!.version_id, null);
  });

  it("names the legal-removal case when the guard is what refused the write", async () => {
    /*
      The guard's own two sentences, as `prevent_legal_resurrection` raises
      them (migrations/0047_legal_removal.sql). A takedown of a page already
      inside a case cannot proceed; the owner is told why rather than left with
      a generic failure. The real-PG proof has the other half of this: that the
      guard really does block the write and nothing is half-purged.
    */
    for (const sentence of [
      "This record is covered by a legal removal and cannot be restored or filed.",
      "This captured article address is covered by a legal removal.",
    ]) {
      const failure = takedownFailure(new Error(sentence));
      assert.equal(failure.ok, false);
      assert.equal(failure.code, "legal-removal");
      assert.match(failure.error, /legal-removal case already covers this page/);
      assert.match(failure.error, /Nothing was removed/, "the owner must know nothing moved");
    }
    /* Anything else says nothing about the database it came from. */
    const other = takedownFailure(new Error('relation "artifact_versions" does not exist'));
    assert.equal(other.code, "error");
    assert.ok(
      !other.error.includes("artifact_versions"),
      "a database error's text is not rendered",
    );
    assert.match(other.error, /Nothing was removed/);
  });
});
