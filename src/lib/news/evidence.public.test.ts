import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureInvestigateSchema } from "./investigate.ts";
import {
  comparePublishedEvidence,
  loadPublicEvidence,
  listPublicCaptureHistory,
  classifyCaptureTimeline,
  selectComparePair,
  PUBLIC_EXCERPT_MAX,
  PUBLIC_CHANGE_SNIPPETS_MAX,
  PUBLIC_CHANGE_SNIPPET_MAX,
  PUBLIC_CHANGE_CHARS_MAX,
} from "./evidence.ts";
import { CHANGE_SENTENCES_MAX } from "./retrieve.ts";
import {
  parseFindings,
  provenanceFromUrls,
  resolvePublicFindings,
  serializeFindings,
} from "./report.ts";

async function ensureArticlesSchema() {
  await ensureInvestigateSchema();
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
  await sql.query(`alter table articles add column if not exists form text not null default 'reported'`);
  await sql.query(`alter table articles add column if not exists found_note text not null default ''`);
  await sql.query(`alter table articles add column if not exists unanswered text not null default '[]'`);
  await sql.query(`alter table articles add column if not exists newsroom_id integer not null default 1`);
  /* 0098's column, spelled the way 0098 spells it: nullable, no default. */
  await sql.query(`alter table articles add column if not exists area text`);
}

describe("public evidence publication", { timeout: 60000 }, () => {
  it("opens a canonical capture when the published citation retains a trailing slash", async () => {
    await ensureArticlesSchema();
    const sql = await getSql();
    const suffix = `reader-${Date.now()}`;
    const url = `https://example.org/${suffix}`;
    const [capture] = await sql<{ id: number }>`
      insert into artifact_versions (user_id, url, content_hash, title, full_text, fetch_outcome)
      values ('reader-test', ${url}, ${suffix}, 'Public source', 'The original published source text.', 'fetched') returning id
    `;
    await sql`
      insert into articles (user_id, slug, headline, body, topic, source_urls, status)
      values ('reader-test', ${suffix}, 'Reader citation', 'Story', 'council', ${JSON.stringify([`${url}/`])}, 'published')
    `;
    assert.equal((await loadPublicEvidence(capture!.id))?.excerpt, 'The original published source text.');
    assert.equal((await listPublicCaptureHistory(`${url}/`))[0]?.version_id, capture!.id);
    assert.ok(await comparePublishedEvidence({ url: `${url}/` }));
    assert.deepEqual(await listPublicCaptureHistory(`${url}?document=private`), []);
    await sql`update articles set status = 'draft' where slug = ${suffix}`;
    assert.equal(await loadPublicEvidence(capture!.id), null);
  });

  it("survives draft provenance fields onto a published article and exposes compare", async () => {
    await ensureArticlesSchema();
    const sql = await getSql();
    const user = `pub-${Date.now()}`;
    const url = `https://longmontcolorado.gov/water/report-${Date.now()}.pdf`;
    const v1 = await sql<{ id: number }>`
      insert into artifact_versions (user_id, url, content_hash, title, full_text, fetch_outcome)
      values (${user}, ${url}, ${"aaa"}, ${"August water report"}, ${"The report said construction begins June 1."}, ${"fetched"})
      returning id
    `;
    const v2 = await sql<{ id: number }>`
      insert into artifact_versions (user_id, url, content_hash, title, full_text, fetch_outcome)
      values (${user}, ${url}, ${"bbb"}, ${"August water report"}, ${"The report said construction begins August 31 after a delay."}, ${"fetched"})
      returning id
    `;
    const privateV = await sql<{ id: number }>`
      insert into artifact_versions (user_id, url, content_hash, title, full_text, fetch_outcome)
      values (
        ${user}, ${"https://example.com/private-notes.txt"}, ${"ccc"}, ${"Internal"},
        ${"Do not publish this hypothesis."}, ${"fetched"}
      )
      returning id
    `;
    const provenance = provenanceFromUrls(
      [url],
      [
        {
          url,
          title: "August water report",
          organization: "City of Longmont",
          document_date: "2026-08-01",
          role: "source",
          captured_at: "2026-08-25T12:00:00.000Z",
          version_id: v2[0]!.id,
          version_count: 2,
          disappeared: false,
        },
      ],
    );
    const slug = `group-2-water-${Date.now()}`;
    await sql`
      insert into articles (
        user_id, slug, headline, dek, body, topic, source_urls, status, published_at,
        provenance_json, form, found_note, unanswered
      )
      values (
        ${user}, ${slug}, ${"Group 2 starts Aug. 31"}, ${"A delayed waterline job."},
        ${"Hover Street closures begin August 31."}, ${"utilities"}, ${JSON.stringify([url])},
        ${"published"}, now(), ${JSON.stringify(provenance)}, ${"reported"},
        ${JSON.stringify([{ text: "Packet lists $2.4 million.", source_urls: [url], artifact_version_ids: [v2[0]!.id] }])},
        ${JSON.stringify(["which hydrants"])}
      )
    `;

    const stored = await sql<{
      provenance_json: string;
      found_note: string;
      source_urls: string;
    }>`
      select provenance_json, found_note, source_urls from articles where slug = ${slug} limit 1
    `;
    const kept = JSON.parse(stored[0]!.provenance_json) as typeof provenance;
    assert.equal(kept[0]!.title, "August water report");
    assert.equal(kept[0]!.organization, "City of Longmont");
    assert.equal(kept[0]!.document_date, "2026-08-01");
    assert.equal(kept[0]!.url, url);
    assert.equal(kept[0]!.captured_at, "2026-08-25T12:00:00.000Z");
    assert.equal(kept[0]!.version_id, v2[0]!.id);
    assert.equal(kept[0]!.disappeared, false);

    const pub = await loadPublicEvidence(v2[0]!.id);
    assert.ok(pub);
    assert.equal(pub!.url, url);
    assert.match(pub!.excerpt, /August 31/);
    assert.match(pub!.content_hash, /bbb/);

    const earlier = await loadPublicEvidence(v1[0]!.id);
    assert.ok(earlier, "other captured versions of a published URL remain readable for compare");

    const hidden = await loadPublicEvidence(privateV[0]!.id);
    assert.equal(hidden, null);

    const compared = await comparePublishedEvidence({ url });
    assert.ok(compared);
    assert.equal(compared!.older.version_id, v1[0]!.id);
    assert.equal(compared!.newer.version_id, v2[0]!.id);
    assert.ok(compared!.changes.added.some((s) => /August 31/.test(s)) || compared!.changes.removed.length > 0);

    const findings = resolvePublicFindings(parseFindings(stored[0]!.found_note), kept);
    assert.equal(findings.length, 1);

    const unbound = resolvePublicFindings(
      parseFindings({ text: "Unsourced allegation.", source_urls: [] }),
      kept,
    );
    assert.equal(unbound.length, 0);

    const urlOnly = resolvePublicFindings(
      parseFindings({
        text: "Packet lists $2.4 million.",
        source_urls: [url],
      }),
      kept,
    );
    assert.equal(urlOnly.length, 0);

    const crossed = resolvePublicFindings(
      parseFindings({
        text: "A URL cannot borrow another source's version.",
        source_urls: [url],
        artifact_version_ids: [v1[0]!.id],
      }),
      [{...kept[0]!,version_id:v2[0]!.id},{...kept[0]!,url:"https://public.example/other",version_id:v1[0]!.id}],
    );
    assert.deepEqual(crossed, []);

    /*
      The comparison still diffs the two CAPTURES, which is why the added
      sentence is the whole added sentence and not an excerpt of one.
    */
    assert.ok(compared!.changes.added.some((s) => /begins August 31 after a delay/.test(s)));
  });

  /*
    A reader must not be handed the article.

    The public evidence page printed `full_text.slice(0, 80_000)` -- a
    crawlable copy of somebody else's page, up to 80,000 characters of it,
    from a newsroom whose own "How we report" page says "We do not copy their
    article". The owner's decision (2026-09-30) is that a public evidence page
    shows an excerpt and a link.

    The bound is asserted where the RECORD is built, not where it is printed:
    the page is one consumer of `loadPublicEvidence`, `listPublicCaptureHistory`
    is another, and the compare payload is a third. A fix that only trimmed the
    JSX would leave all three serving the article.
  */
  it("bounds every public view of a long capture to a short excerpt", async () => {
    await ensureArticlesSchema();
    const sql = await getSql();
    const user = `excerpt-bound-${Date.now()}`;
    const url = `https://example.org/excerpt-bound-${Date.now()}`;
    const full = Array.from(
      { length: 100 },
      (_, i) => `Paragraph ${i + 1} of the captured record holds roughly fifty characters.`,
    ).join(" ");
    assert.ok(full.length >= 5_000, `fixture should be a long capture, was ${full.length}`);
    const [capture] = await sql<{ id: number }>`
      insert into artifact_versions (user_id, url, content_hash, title, full_text, fetch_outcome)
      values (${user}, ${url}, ${"long-hash"}, ${"A long captured page"}, ${full}, ${"fetched"})
      returning id
    `;
    await sql`
      insert into articles (user_id, slug, headline, body, topic, source_urls, status)
      values (${user}, ${`excerpt-bound-${Date.now()}`}, ${"Long capture"}, ${"Story"}, ${"council"}, ${JSON.stringify([url])}, ${"published"})
    `;

    const pub = await loadPublicEvidence(capture!.id);
    assert.ok(pub);
    assert.ok(
      pub!.excerpt.length <= PUBLIC_EXCERPT_MAX + 1,
      `a public record carried ${pub!.excerpt.length} characters of the capture`,
    );
    assert.ok(pub!.excerpt.startsWith("Paragraph 1 of the captured record"));
    assert.ok(pub!.excerpt.endsWith("…"), "a truncated excerpt must say so");
    assert.doesNotMatch(
      pub!.excerpt,
      /Paragraph 40 /,
      "the middle of the capture reached the reader",
    );

    const history = await listPublicCaptureHistory(url);
    assert.equal(history.length, 1);
    assert.ok(history[0]!.excerpt.length <= PUBLIC_EXCERPT_MAX + 1);
    assert.doesNotMatch(JSON.stringify(history), /Paragraph 40 /);

    const compared = await comparePublishedEvidence({ a: capture!.id, b: capture!.id });
    assert.ok(compared);
    assert.ok(compared!.older.excerpt.length <= PUBLIC_EXCERPT_MAX + 1);
    assert.ok(compared!.newer.excerpt.length <= PUBLIC_EXCERPT_MAX + 1);
    assert.doesNotMatch(JSON.stringify(compared), /Paragraph 40 /);
  });

  /*
    The excerpt is centred on what the story actually quoted.

    A finding's `excerpt` is the receipt the desk copied out of the capture
    when it wrote the story. It is the one passage we have already decided is
    worth showing a reader, so the window opens on it rather than on the page's
    navigation and cookie banner.
  */
  it("centres the public excerpt on a receipt a published story recorded", async () => {
    await ensureArticlesSchema();
    const sql = await getSql();
    const user = `excerpt-receipt-${Date.now()}`;
    const url = `https://example.org/excerpt-receipt-${Date.now()}`;
    const quote = "The council approved the annexation on a 5-2 vote.";
    const full = `${"Earlier procedural text. ".repeat(60)}${quote} ${"Later procedural text. ".repeat(60)}`;
    const [capture] = await sql<{ id: number }>`
      insert into artifact_versions (user_id, url, content_hash, title, full_text, fetch_outcome)
      values (${user}, ${url}, ${"receipt-hash"}, ${"A quoted captured page"}, ${full}, ${"fetched"})
      returning id
    `;
    const provenance = provenanceFromUrls(
      [url],
      [{ url, title: "A quoted captured page", version_id: capture!.id, role: "source" }],
    );
    const found = serializeFindings([
      {
        text: "The council approved the annexation.",
        source_urls: [url],
        artifact_version_ids: [capture!.id],
        capture_event_ids: [],
        locators: [],
        excerpt: quote,
      },
    ]);
    await sql`
      insert into articles (
        user_id, slug, headline, body, topic, source_urls, status, provenance_json, found_note
      )
      values (
        ${user}, ${`excerpt-receipt-${Date.now()}`}, ${"Annexation approved"}, ${"Story"},
        ${"council"}, ${JSON.stringify([url])}, ${"published"}, ${JSON.stringify(provenance)}, ${found}
      )
    `;

    const pub = await loadPublicEvidence(capture!.id);
    assert.ok(pub);
    assert.ok(
      pub!.excerpt.includes(quote),
      `the receipt the story quoted is missing from the excerpt: ${pub!.excerpt}`,
    );
    assert.ok(
      pub!.excerpt.length <= PUBLIC_EXCERPT_MAX + 1,
      `a centred excerpt carried ${pub!.excerpt.length} characters`,
    );
    const at = pub!.excerpt.indexOf(quote);
    assert.ok(
      at > 0 && at < 300,
      `the receipt should sit in the middle of the window, was at ${at}`,
    );
    assert.match(pub!.excerpt, /^…/, "a window that starts mid-capture must say so");
    assert.match(pub!.excerpt, /…$/, "a window that ends mid-capture must say so");
  });

  /*
    Counts and a few sentences, never the diff of two articles.

    The budget is ONE budget. A cap per side would let a comparison hand back
    six snippets of 200 characters -- 1,200 characters of two third-party
    pages, twice the evidence page's own 600-character excerpt -- so the caps
    that matter are on the whole payload: at most three snippets together and
    at most 600 characters together, spent removed-first so the set is stable
    between two identical requests.
  */
  it("never returns more than three changed snippets or 600 characters in total", async () => {
    await ensureArticlesSchema();
    const sql = await getSql();
    const user = `excerpt-diff-${Date.now()}`;
    const url = `https://example.org/excerpt-diff-${Date.now()}`;
    const sentence = (word: string) => `${word} ${"filler word ".repeat(20)}changed here.`;
    const olderText = ["alpha", "bravo", "charlie", "delta", "echo"].map(sentence).join(" ");
    const newerText = ["foxtrot", "golf", "hotel", "india", "juliett"].map(sentence).join(" ");
    const vOlder = await sql<{ id: number }>`
      insert into artifact_versions (user_id, url, content_hash, title, full_text, fetch_outcome)
      values (${user}, ${url}, ${"older-hash"}, ${"Old state"}, ${olderText}, ${"fetched"})
      returning id
    `;
    const vNewer = await sql<{ id: number }>`
      insert into artifact_versions (user_id, url, content_hash, title, full_text, fetch_outcome)
      values (${user}, ${url}, ${"newer-hash"}, ${"New state"}, ${newerText}, ${"fetched"})
      returning id
    `;
    await sql`
      insert into articles (user_id, slug, headline, body, topic, source_urls, status)
      values (${user}, ${`excerpt-diff-${Date.now()}`}, ${"Changed page"}, ${"Story"}, ${"council"}, ${JSON.stringify([url])}, ${"published"})
    `;

    const compared = await comparePublishedEvidence({ a: vOlder[0]!.id, b: vNewer[0]!.id });
    assert.ok(compared);
    assert.ok(compared!.changes.added_total >= 5, "the diff should have seen all five sentences");
    assert.ok(compared!.changes.removed_total >= 5);

    const snippets = [...compared!.changes.removed, ...compared!.changes.added];
    assert.equal(
      snippets.length,
      PUBLIC_CHANGE_SNIPPETS_MAX,
      `a comparison returned ${snippets.length} snippets in total`,
    );
    const characters = snippets.reduce((sum, snippet) => sum + snippet.length, 0);
    assert.ok(
      characters <= PUBLIC_CHANGE_CHARS_MAX,
      `a comparison returned ${characters} characters of changed text in total`,
    );
    for (const snippet of snippets) {
      assert.ok(
        snippet.length <= PUBLIC_CHANGE_SNIPPET_MAX + 1,
        `a changed snippet carried ${snippet.length} characters`,
      );
    }

    // Removed first: the whole budget went to the side that comes first, and
    // the side that got nothing still reports its own count honestly.
    assert.equal(compared!.changes.removed.length, PUBLIC_CHANGE_SNIPPETS_MAX);
    assert.deepEqual(compared!.changes.added, []);
    assert.ok(compared!.changes.added_total >= 5);
    assert.ok(!compared!.changes.added_total_at_least, "five is below the diff's own cap");

    // The sentences the budget cut must not be in the diff that is sent. (The
    // records' own excerpts legitimately open with some of these words, so the
    // assertion is about `changes`, which is the diff.)
    assert.doesNotMatch(JSON.stringify(compared!.changes), /echo |golf |juliett /);
  });

  /*
    A total that sits on the diff's cap is a floor, not a count.

    `describeTextChanges` stops counting at 24 sentences a side, so a
    comparison of two long captures reports "24" for a difference that may be
    hundreds of sentences long. The public payload has to carry that
    uncertainty, or the compare page prints a number it does not know as
    though it were exact.
  */
  it("says a total that reached the diff's own cap is a floor", async () => {
    await ensureArticlesSchema();
    const sql = await getSql();
    const user = `excerpt-floor-${Date.now()}`;
    const url = `https://example.org/excerpt-floor-${Date.now()}`;
    const sentence = (word: string) => `${word} ${"padding words ".repeat(12)}the end.`;
    const words = (prefix: string) =>
      Array.from({ length: 30 }, (_, i) => `${prefix}${i + 1}`).map(sentence).join(" ");
    const vOlder = await sql<{ id: number }>`
      insert into artifact_versions (user_id, url, content_hash, title, full_text, fetch_outcome)
      values (${user}, ${url}, ${"floor-older"}, ${"Old state"}, ${words("old")}, ${"fetched"})
      returning id
    `;
    const vNewer = await sql<{ id: number }>`
      insert into artifact_versions (user_id, url, content_hash, title, full_text, fetch_outcome)
      values (${user}, ${url}, ${"floor-newer"}, ${"New state"}, ${words("new")}, ${"fetched"})
      returning id
    `;
    await sql`
      insert into articles (user_id, slug, headline, body, topic, source_urls, status)
      values (${user}, ${`excerpt-floor-${Date.now()}`}, ${"Long changed page"}, ${"Story"}, ${"council"}, ${JSON.stringify([url])}, ${"published"})
    `;

    const compared = await comparePublishedEvidence({ a: vOlder[0]!.id, b: vNewer[0]!.id });
    assert.ok(compared);
    assert.equal(compared!.changes.removed_total, CHANGE_SENTENCES_MAX);
    assert.equal(compared!.changes.added_total, CHANGE_SENTENCES_MAX);
    assert.equal(compared!.changes.removed_total_at_least, true);
    assert.equal(compared!.changes.added_total_at_least, true);
  });
});

describe("capture chronology", () => {
  it("classifies A → B → A → missing → restored A without flattening repeats", () => {
    const history = classifyCaptureTimeline([
      { capture_event_id: 1, observed_at: "2026-08-01", version_id: 10, content_hash: "A", fetch_outcome: "fetched" },
      { capture_event_id: 2, observed_at: "2026-08-05", version_id: 11, content_hash: "B", fetch_outcome: "fetched" },
      { capture_event_id: 3, observed_at: "2026-08-08", version_id: 10, content_hash: "A", fetch_outcome: "fetched" },
      { capture_event_id: 4, observed_at: "2026-08-10", version_id: null, content_hash: null, fetch_outcome: "not-found" },
      { capture_event_id: 5, observed_at: "2026-08-12", version_id: 10, content_hash: "A", fetch_outcome: "fetched" },
    ]);
    assert.equal(history.length, 5);
    assert.deepEqual(
      history.map((h) => h.observation),
      ["captured", "changed", "reverted", "unavailable", "restored"],
    );
    assert.equal(history[4]!.content_hash, "A");
    assert.notEqual(history[4]!.content_hash, "B");
    const pair = selectComparePair(history);
    assert.ok(pair);
    assert.equal(pair!.older.content_hash, "B");
    assert.equal(pair!.newer.content_hash, "A");
    assert.equal(pair!.older.observed_at, "2026-08-05");
    assert.equal(pair!.newer.observed_at, "2026-08-12");
  });
});

describe("public capture history publication", { timeout: 60000 }, () => {
  it("does not publish a default-room record cited only by another newsroom", async () => {
    await ensureArticlesSchema();
    const sql = await getSql();
    const stamp = Date.now();
    const url = `https://example.com/foreign-publication-${stamp}`;
    const own = await sql<{ id: number }>`
      insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,fetch_outcome)
      values (${"public-owner"},${1},${url},${"own-unpublished"},${"Own unpublished"},${"OWN UNPUBLISHED TEXT"},${"fetched"})
      returning id
    `;
    await sql`
      insert into capture_events(user_id,newsroom_id,source_url,http_status,fetch_outcome,version_id,content_hash,trigger_kind)
      values (${"public-owner"},${1},${url},${200},${"fetched"},${own[0]!.id},${"own-unpublished"},${"draft"})
    `;
    await sql`
      insert into articles(user_id,newsroom_id,slug,headline,dek,body,topic,source_urls,status,published_at,provenance_json,form,found_note,unanswered)
      values (${"foreign-publisher"},${2},${`foreign-publication-${stamp}`},${"Foreign publication"},${""},${"Body"},${"council"},${JSON.stringify([url])},${"published"},now(),${"[]"},${"reported"},${"[]"},${"[]"})
    `;

    assert.equal(await loadPublicEvidence(own[0]!.id), null);
    assert.deepEqual(await listPublicCaptureHistory(url), []);
    assert.equal(await comparePublishedEvidence({ url }), null);
  });

  it("does not authorize a foreign-only version merely because its URL is published here", async () => {
    await ensureArticlesSchema();
    const sql = await getSql();
    const stamp = Date.now();
    const url = `https://example.com/foreign-only-${stamp}`;
    const foreign = await sql<{ id: number }>`
      insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,fetch_outcome)
      values (${"foreign-only"},${2},${url},${"foreign-only-hash"},${"Foreign only"},${"FOREIGN ONLY TEXT"},${"fetched"})
      returning id
    `;
    await sql`
      insert into articles(user_id,newsroom_id,slug,headline,dek,body,topic,source_urls,status,published_at,provenance_json,form,found_note,unanswered)
      values (${"public-owner"},${1},${`foreign-only-${stamp}`},${"Published URL"},${""},${"Body"},${"council"},${JSON.stringify([url])},${"published"},now(),${"[]"},${"reported"},${"[]"},${"[]"})
    `;
    assert.equal(await loadPublicEvidence(foreign[0]!.id), null);
    assert.deepEqual(await listPublicCaptureHistory(url), []);
  });

  it("keeps the legacy version fallback and explicit compare inside the public newsroom", async () => {
    await ensureArticlesSchema();
    const sql = await getSql();
    const stamp = Date.now();
    const url = `https://example.com/fallback-boundary-${stamp}`;
    const own = await sql<{ id: number }>`
      insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,fetch_outcome)
      values (${"public-owner"},${1},${url},${"own-fallback"},${"Own fallback"},${"OWN FALLBACK TEXT"},${"fetched"})
      returning id
    `;
    const foreign = await sql<{ id: number }>`
      insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,fetch_outcome)
      values (${"foreign-owner"},${2},${url},${"foreign-fallback"},${"Foreign fallback"},${"FOREIGN FALLBACK TEXT"},${"fetched"})
      returning id
    `;
    await sql`
      insert into articles(user_id,newsroom_id,slug,headline,dek,body,topic,source_urls,status,published_at,provenance_json,form,found_note,unanswered)
      values (${"public-owner"},${1},${`fallback-boundary-${stamp}`},${"Fallback boundary"},${""},${"Body"},${"council"},${JSON.stringify([url])},${"published"},now(),${"[]"},${"reported"},${"[]"},${"[]"})
    `;
    const history = await listPublicCaptureHistory(url);
    assert.deepEqual(history.map((row) => row.version_id), [own[0]!.id]);
    assert.doesNotMatch(JSON.stringify(history), /FOREIGN FALLBACK TEXT/);
    assert.equal(
      await comparePublishedEvidence({ a: own[0]!.id, b: foreign[0]!.id }),
      null,
    );
  });

  it("rejects a public-room capture repointed to another URL's version", async () => {
    await ensureArticlesSchema();
    const sql = await getSql();
    const stamp = Date.now();
    const publishedUrl = `https://example.com/published-repoint-${stamp}`;
    const privateUrl = `https://example.com/private-repoint-${stamp}`;
    const own = await sql<{ id: number }>`
      insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,fetch_outcome)
      values (${"public-owner"},${1},${publishedUrl},${"public-own"},${"Public own"},${"PUBLIC OWN TEXT"},${"fetched"})
      returning id
    `;
    const privateVersion = await sql<{ id: number }>`
      insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,fetch_outcome)
      values (${"public-owner"},${1},${privateUrl},${"private-hash"},${"Private other URL"},${"PRIVATE OTHER URL TEXT"},${"fetched"})
      returning id
    `;
    await sql`
      insert into capture_events(user_id,newsroom_id,source_url,http_status,fetch_outcome,version_id,content_hash,trigger_kind)
      values (${"public-owner"},${1},${publishedUrl},${200},${"fetched"},${own[0]!.id},${"public-own"},${"draft"})
    `;
    const repointed = await sql<{ id: number }>`
      insert into capture_events(user_id,newsroom_id,source_url,http_status,fetch_outcome,version_id,content_hash,trigger_kind)
      values (${"public-owner"},${1},${publishedUrl},${200},${"fetched"},${privateVersion[0]!.id},${"private-hash"},${"draft"})
      returning id
    `;
    await sql`
      insert into articles(user_id,newsroom_id,slug,headline,dek,body,topic,source_urls,status,published_at,provenance_json,form,found_note,unanswered)
      values (${"public-owner"},${1},${`published-repoint-${stamp}`},${"Published repoint"},${""},${"Body"},${"council"},${JSON.stringify([publishedUrl])},${"published"},now(),${"[]"},${"reported"},${"[]"},${"[]"})
    `;
    const history = await listPublicCaptureHistory(publishedUrl);
    assert.deepEqual(history.map((row) => row.version_id), [own[0]!.id]);
    assert.ok(history.every((row) => row.capture_event_id !== repointed[0]!.id));
    assert.doesNotMatch(JSON.stringify(history), /private-hash|Private other URL|PRIVATE OTHER URL TEXT/);
  });

  it("never exposes another newsroom's version or history for a published-edition URL", async () => {
    await ensureArticlesSchema();
    const sql = await getSql();
    const stamp = Date.now();
    const url = `https://example.com/shared-public-url-${stamp}`;
    const own = await sql<{ id: number }>`
      insert into artifact_versions (user_id, newsroom_id, url, content_hash, title, full_text, fetch_outcome)
      values (${"public-owner"}, ${1}, ${url}, ${"own-hash"}, ${"Public record"}, ${"Public edition text."}, ${"fetched"})
      returning id
    `;
    const foreign = await sql<{ id: number }>`
      insert into artifact_versions (user_id, newsroom_id, url, content_hash, title, full_text, fetch_outcome)
      values (${"foreign-owner"}, ${2}, ${url}, ${"foreign-hash"}, ${"Private foreign record"}, ${"FOREIGN NEWSROOM PRIVATE TEXT"}, ${"fetched"})
      returning id
    `;
    await sql`
      insert into capture_events(user_id,newsroom_id,source_url,http_status,fetch_outcome,version_id,content_hash,trigger_kind)
      values
        (${"public-owner"},${1},${url},${200},${"fetched"},${own[0]!.id},${"own-hash"},${"draft"}),
        (${"foreign-owner"},${2},${url},${200},${"fetched"},${foreign[0]!.id},${"foreign-hash"},${"draft"})
    `;
    const repointed = await sql<{ id: number }>`
      insert into capture_events(user_id,newsroom_id,source_url,http_status,fetch_outcome,version_id,content_hash,trigger_kind)
      values (${"public-owner"},${1},${url},${200},${"fetched"},${foreign[0]!.id},${"foreign-repoint"},${"draft"})
      returning id
    `;
    await sql`
      insert into articles(user_id,newsroom_id,slug,headline,dek,body,topic,source_urls,status,published_at,provenance_json,form,found_note,unanswered)
      values (${"public-owner"},${1},${`public-boundary-${stamp}`},${"Public boundary"},${""},${"Public body"},${"council"},${JSON.stringify([url])},${"published"},now(),${"[]"},${"reported"},${"[]"},${"[]"})
    `;

    const leaked = await loadPublicEvidence(foreign[0]!.id);
    assert.equal(leaked, null, "a foreign newsroom version was readable through a public URL");
    const history = await listPublicCaptureHistory(url);
    assert.deepEqual(history.map((row) => row.version_id), [own[0]!.id]);
    assert.ok(history.every((row) => row.capture_event_id !== repointed[0]!.id));
    assert.doesNotMatch(JSON.stringify(history), /FOREIGN NEWSROOM PRIVATE TEXT/);
  });

  it("returns every observation in capture order and hides unpublished research URLs", async () => {
    await ensureArticlesSchema();
    const sql = await getSql();
    const user = `chrono-${Date.now()}`;
    const url = `https://longmontcolorado.gov/water/chrono-${Date.now()}.pdf`;
    const privateUrl = `https://example.com/unpublished-investigation-${Date.now()}.txt`;
    const vA = await sql<{ id: number }>`
      insert into artifact_versions (user_id, url, content_hash, title, full_text, fetch_outcome)
      values (${user}, ${url}, ${"hash-A"}, ${"Version A"}, ${"Content A. Construction June 1."}, ${"fetched"})
      returning id
    `;
    const vB = await sql<{ id: number }>`
      insert into artifact_versions (user_id, url, content_hash, title, full_text, fetch_outcome)
      values (${user}, ${url}, ${"hash-B"}, ${"Version B"}, ${"Content B. Construction August 31 after delay."}, ${"fetched"})
      returning id
    `;
    const vPrivate = await sql<{ id: number }>`
      insert into artifact_versions (user_id, url, content_hash, title, full_text, fetch_outcome)
      values (${user}, ${privateUrl}, ${"hash-P"}, ${"Internal lead"}, ${"Unpublished hypothesis."}, ${"fetched"})
      returning id
    `;
    const times = [
      ["2026-08-01T12:00:00.000Z", vA[0]!.id, "fetched", "hash-A", false],
      ["2026-08-05T12:00:00.000Z", vB[0]!.id, "fetched", "hash-B", false],
      ["2026-08-08T12:00:00.000Z", vA[0]!.id, "fetched", "hash-A", false],
      ["2026-08-10T12:00:00.000Z", null, "not-found", null, true],
      ["2026-08-12T12:00:00.000Z", vA[0]!.id, "fetched", "hash-A", false],
    ] as const;
    for (const [observed, versionId, outcome, hash, gone] of times) {
      await sql`
        insert into capture_events (
          user_id, source_url, observed_at, http_status, fetch_outcome,
          version_id, disappearance, content_hash, trigger_kind
        ) values (
          ${user}, ${url}, ${observed}::timestamptz, ${gone ? 404 : 200}, ${outcome},
          ${versionId}, ${gone}, ${hash}, ${"monitor"}
        )
      `;
    }
    await sql`
      insert into capture_events (
        user_id, source_url, observed_at, http_status, fetch_outcome,
        version_id, disappearance, content_hash, trigger_kind
      ) values (
        ${user}, ${privateUrl}, ${"2026-08-09T12:00:00.000Z"}::timestamptz, ${200}, ${"fetched"},
        ${vPrivate[0]!.id}, ${false}, ${"hash-P"}, ${"investigation"}
      )
    `;
    const provenance = provenanceFromUrls(
      [url],
      [{ url, title: "Chronology fixture", version_id: vA[0]!.id, role: "source" }],
    );
    const slug = `chrono-${Date.now()}`;
    await sql`
      insert into articles (
        user_id, slug, headline, dek, body, topic, source_urls, status, published_at,
        provenance_json, form, found_note, unanswered
      )
      values (
        ${user}, ${slug}, ${"Water report history"}, ${"A reverting record."},
        ${"The report came back."}, ${"utilities"}, ${JSON.stringify([url])},
        ${"published"}, now(), ${JSON.stringify(provenance)}, ${"reported"}, ${"[]"}, ${"[]"}
      )
    `;

    const history = await listPublicCaptureHistory(url);
    assert.equal(history.length, 5);
    assert.deepEqual(
      history.map((h) => h.observation),
      ["captured", "changed", "reverted", "unavailable", "restored"],
    );
    const latestContent = [...history].reverse().find((h) => !h.disappeared);
    assert.equal(latestContent?.content_hash, "hash-A");
    assert.notEqual(latestContent?.content_hash, "hash-B");

    const compared = await comparePublishedEvidence({ url });
    assert.ok(compared);
    assert.equal(compared!.older.content_hash, "hash-B");
    assert.equal(compared!.newer.content_hash, "hash-A");
    assert.ok(compared!.timeline.some((t) => t.observation === "unavailable"));
    assert.ok(compared!.timeline.some((t) => t.observation === "restored"));

    const hidden = await loadPublicEvidence(vPrivate[0]!.id);
    assert.equal(hidden, null);
    const hiddenHistory = await listPublicCaptureHistory(privateUrl);
    assert.equal(hiddenHistory.length, 0);
  });
});

/**
 * A locator is a note to ourselves, not to a reader.
 *
 * The LURA story printed this on the public page:
 *
 *   char:14000-16000 — plan amendment adds two parcels plus part of Boston Ave
 *
 * That is a character offset into a captured transcript. It is how the desk
 * points at the passage it read; it means nothing to somebody reading a
 * newspaper, and it is exactly the notebook language the editor's manual says
 * must never reach the masthead.
 *
 * `resolvePublicFindings` decides WHICH findings print. It never looked at
 * what was inside one, so locators went straight through to the page.
 * Readers get the "Captured record" link instead — the real way in.
 */
describe("locators never reach a reader", () => {
  const provenance = provenanceFromUrls(["https://www.youtube.com/watch?v=_cTgf1W7188"]).map(
    (p) => ({ ...p, version_id: 87 }),
  );

  const withLocator = JSON.stringify([
    {
      text: "TownReporter listened to the Aug. 18 LURA recording.",
      source_urls: ["https://www.youtube.com/watch?v=_cTgf1W7188"],
      artifact_version_ids: [87],
      capture_event_ids: [],
      locators: ["char:14000-16000 — plan amendment adds two parcels"],
    },
  ]);

  it("keeps the finding but drops its locators", () => {
    const out = resolvePublicFindings(parseFindings(withLocator), provenance);
    assert.equal(out.length, 1, "the finding itself still prints");
    assert.deepEqual(out[0]!.locators, [], "locators must not survive into the public payload");
  });

  it("leaves no char offset anywhere in what the page receives", () => {
    const out = resolvePublicFindings(parseFindings(withLocator), provenance);
    assert.doesNotMatch(JSON.stringify(out), /char:\d+-\d+/, "a raw offset reached the reader");
  });

  it("does not quietly drop the finding to achieve that", () => {
    const out = resolvePublicFindings(parseFindings(withLocator), provenance);
    assert.match(out[0]!.text, /listened to the Aug\. 18 LURA recording/);
    assert.deepEqual(out[0]!.artifact_version_ids, [87], "the Captured record link must survive");
  });
});
