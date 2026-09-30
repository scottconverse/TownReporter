import { before, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getSql } from "../db.ts";
import { ensureLegalSchema } from "./legal-removal-schema.ts";
import { previewLegalRemoval, removeLegally } from "./legal-removal-store.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { listReaderArticles } from "./reader-articles.server.ts";
import {
  LEGAL_GONE_BODY,
  LEGAL_GONE_TITLE,
  isLegallyRemovedSlug,
  legalGonePageHtml,
  legalGoneResponse,
} from "./legal-gone.ts";
import type { LegalSelection } from "./legal-removal-types.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";

// U18a-1: this file needs the migrated schema. scripts/run-tests-safe.mjs
// applies migrations/*.sql before the file loads; the postgres-integration
// runner runs the same file WITHOUT that preload, so the fixture asks for it
// itself -- through the one shared applier, which does nothing at all when
// the ledger is already full and applies the whole set when it is empty.
await applyMigrationsToTestPglite();

/**
 * Unit BH4: the URL of a legally removed story answers 410 Gone.
 *
 * The desk's removal dialog promises, on the record, "Removed now; the URL
 * returns 410 Gone" (design/redesign-review `dialog-15-legal.png`; README
 * Dialogs table, "public page -> 410 Gone"). `removeLegally` deletes the
 * article row, so before this unit the story page answered 404 -- the answer a
 * mistyped address gets -- and the promise was false. The owner's rule is that
 * a promise the UI makes is fixed in the behaviour, not in the words.
 *
 * The removal below goes through the SAME path the desk uses
 * (`previewLegalRemoval` then `removeLegally`, the two functions behind the
 * `legalPreview` / `legalConfirm` server functions), not by inserting into
 * `legal_removal_slugs` by hand: the point of the test is that what the desk
 * does produces a 410 at the URL.
 *
 * Room 1 is the room the public reader serves (`DEFAULT_NEWSROOM_ID`), so this
 * file's fixture lives there rather than in a high-numbered room as
 * `legal-removal.test.ts` does -- `isLegallyRemovedSlug` is scoped to the public
 * newsroom on purpose, and a test in room 901 could not see it.
 */

before(async () => {
  // Migrations from disk, not a hand-built schema: this file's tables are
  // production's tables (PROJECT-BRIEF rule 14). They are read and applied
  // before this file loads now (U18a-1,
  // src/lib/test-support/pglite-migrations.ts); the hand replay that used to
  // stand in for Node's missing Vite migration glob would be a second
  // application, and several migrations carry unguarded seed inserts.
  await ensureLegalSchema();
});

let caseCounter = 1;

/**
 * The public newsroom has one owner, and these tests share the room, so the
 * owner row is created once (`newsroom_members_one_owner`) and every case runs
 * as that same person -- which is also the truth of a one-desk paper.
 */
const OWNER = "bh4-owner";

async function fixture() {
  const sql = await getSql();
  const room = DEFAULT_NEWSROOM_ID;
  const n = caseCounter++;
  const user = OWNER;
  const slug = `bh4-legal-gone-${n}`;
  const headline = `Council approves the fee rise ${n}`;
  const body = `REMOVED_SECRET_${n}: the paragraph a court order says may not be published.`;
  await sql`insert into newsroom_members(user_id,role,newsroom_id)
            select ${user},'owner',${room}
            where not exists (select 1 from newsroom_members where newsroom_id=${room} and role='owner')`;
  await sql`insert into paper_settings(newsroom_id,onboarded) values(${room},true)
            on conflict (newsroom_id) do update set onboarded=true`;
  const [article] = await sql<{
    id: number;
  }>`insert into articles(user_id,newsroom_id,slug,headline,dek,body,topic,status,published_at)
     values(${user},${room},${slug},${headline},${"A dek about the fee rise"},${body},'council','published',now())
     returning id`;
  const selection: LegalSelection = {
    articleIds: [article.id],
    draftIds: [],
    memoryIds: [],
    auditIds: [],
    trashIds: [],
    reviewedLegacy: true,
    reviewedEvidence: true,
  };
  return { sql, user, room, slug, headline, body, article, selection };
}

/** The desk's own two calls: a fresh preview, then the confirmed removal. */
async function removeThroughTheDesk(f: Awaited<ReturnType<typeof fixture>>, caseRef: string) {
  const preview = await previewLegalRemoval(f.user, f.selection);
  return removeLegally(f.user, {
    selection: f.selection,
    fingerprint: preview.fingerprint,
    policy: "retain",
    caseRef,
  });
}

it("a story removed through the desk answers 410 Gone, with none of the story on the page", async () => {
  const f = await fixture();
  const unknown = `bh4-never-existed-${caseCounter}`;

  // Before: nothing legal has happened to this slug, so the route falls through
  // to the ordinary render (the story still publishes, and the unknown slug is
  // the router's own 404).
  assert.equal(await isLegallyRemovedSlug(f.slug), false, "not removed before the case");
  assert.equal(await isLegallyRemovedSlug(unknown), false, "an unknown slug is not a removal");

  await removeThroughTheDesk(f, "BH4-CASE-1");

  // The article row is really gone -- so the 410 cannot be coming from the
  // story's own content, only from the removal record.
  const rows = await f.sql<{ n: number }>`select count(*)::int as n from articles where slug=${f.slug}`;
  assert.equal(rows[0]?.n, 0, "the story row is deleted");

  assert.equal(await isLegallyRemovedSlug(f.slug), true);

  const res = legalGoneResponse();
  assert.equal(res.status, 410, "the wire status");
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-robots-tag"), "noindex");
  const html = await res.text();
  assert.ok(html.includes(LEGAL_GONE_TITLE), "the page says the story was removed");
  // The sentence is one export used by both doors (BH6), so the 410 page and
  // the panel the in-app path renders cannot drift into different words.
  assert.ok(html.includes(LEGAL_GONE_BODY), "the page carries the shared removal sentence");
  // Both links the brief asks for: the front page, and the corrections log.
  assert.ok(html.includes('href="/"'), "links back to the front page");
  assert.ok(html.includes('href="/corrections"'), "links to the corrections log");
  // Nothing of the story. A "removed" page that repeated the headline would
  // republish the story at a second URL.
  for (const secret of [f.headline, f.body, "REMOVED_SECRET_", "A dek about the fee rise"])
    assert.ok(!html.includes(secret), `the page carries no story text (${secret})`);
  assert.ok(!html.includes(f.slug), "the page does not even repeat the slug");

  // An unknown slug is still unknown: 404 stays 404, and the removal record
  // says nothing about it.
  assert.equal(await isLegallyRemovedSlug(unknown), false, "an unknown slug is still a 404");
});

it("the dialog's search-index and RSS promise holds: the removed story is in neither", async () => {
  const f = await fixture();
  await removeThroughTheDesk(f, "BH4-CASE-2");

  // The reader query is what search and the archive read.
  const page = await listReaderArticles({ page: 1, q: "REMOVED_SECRET" });
  assert.ok(
    !page.stories.some((s) => s.slug === f.slug),
    "the removed story is not in the reader's search results",
  );
  // `feed.ts` and `sitemap[.]xml.ts` both select status='published' from
  // `articles`; the row is gone, so the slug is in neither. Asserted on the
  // data those routes read, since the routes themselves are curl-checked in
  // this unit's camera against the built server.
  const live = await f.sql<{ n: number }>`
    select count(*)::int as n from articles where slug=${f.slug} and status='published'`;
  assert.equal(live[0]?.n, 0, "no published row for the feed or the sitemap to print");
});

it("the in-app path says the same words, from the same two strings", async () => {
  /*
    Unit BH6. A reader who reaches a removed story INSIDE the app -- by a link,
    or by pressing Back to a story they had open when it was live -- never makes
    a request for the URL, so nothing in the route's handler runs for them. The
    route's loader asks the same question (`isLegallyRemovedForReader`, the
    server function over `isLegallyRemovedSlug` above) and renders the removal
    page itself.

    The route's rendering is checked where it can be checked properly -- in a
    real browser, by this unit's own walk -- so what is asserted here is the one
    thing a browser walk cannot hold down over time: that the two doors print
    the SAME strings, and that the route does not grow a second copy of the
    sentence. Drift is the failure mode: a route that re-typed the paragraph
    would pass every browser check the day it was written.
  */
  const html = legalGonePageHtml();
  assert.ok(html.includes(`<h1>${LEGAL_GONE_TITLE}</h1>`), "the 410 page's heading is the shared title");
  assert.ok(html.includes(`<p>${LEGAL_GONE_BODY}</p>`), "the 410 page's sentence is the shared body");

  const route = await readFile(
    new URL("../../routes/articles.$slug.tsx", import.meta.url),
    "utf8",
  );
  for (const name of ["LEGAL_GONE_TITLE", "LEGAL_GONE_BODY", "isLegallyRemovedForReader"])
    assert.ok(route.includes(name), `the route uses ${name} for the in-app path`);
  assert.ok(
    !route.includes(LEGAL_GONE_BODY),
    "the route does not re-type the removal sentence; it prints the export",
  );
});

it("a removal in another newsroom leaves this paper's URLs alone", async () => {
  const sql = await getSql();
  const other = 912;
  const user = "bh4-other-owner";
  const slug = `bh4-other-room-${caseCounter}`;
  await sql`insert into newsroom_members(user_id,role,newsroom_id) values(${user},'owner',${other})`;
  const [article] = await sql<{
    id: number;
  }>`insert into articles(user_id,newsroom_id,slug,headline,dek,body,topic,status,published_at)
     values(${user},${other},${slug},'Another paper''s story','dek','body','council','published',now())
     returning id`;
  const selection: LegalSelection = {
    articleIds: [article.id],
    draftIds: [],
    memoryIds: [],
    auditIds: [],
    trashIds: [],
    reviewedLegacy: true,
    reviewedEvidence: true,
  };
  const preview = await previewLegalRemoval(user, selection);
  await removeLegally(user, {
    selection,
    fingerprint: preview.fingerprint,
    policy: "retain",
    caseRef: "BH4-CASE-3",
  });
  // The row IS in the removal table, but for that room only: the public paper
  // must not start answering 410 for a slug another newsroom removed.
  const any = await sql<{ n: number }>`
    select count(*)::int as n from legal_removal_slugs where slug_hash=md5(${slug})`;
  assert.equal(any[0]?.n, 1, "the other newsroom's removal is recorded");
  assert.equal(await isLegallyRemovedSlug(slug), false, "this paper is unaffected");
});
