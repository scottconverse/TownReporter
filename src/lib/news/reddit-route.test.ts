import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { setFetchImplForTests } from "./fetch-url.ts";
import { ingestDocument } from "./ingest.ts";
import { isRedditThreadUrl, isRedditUrl, threadFeed } from "./reddit.ts";
import { resetRedditPacing } from "./reddit.server.ts";
import {
  REDDIT_FETCHES_PER_HOP_CAP,
  emptyPlan,
  ensureInvestigateSchema,
  researchLoop,
  type FetchFn,
  type HopPlan,
} from "./investigate.ts";

/**
 * Dark Desk F5 — the generic fetch/ingest path (ingest.ts, what fetch_urls
 * from a "dig" plan go through — see investigate.ts:defaultFetch) had zero
 * reddit handling, so a reddit thread URL the model proposed got the
 * tracked-fetch-and-strip-tags treatment, which for reddit.com means the JS
 * app shell rather than content. This proves the fix routes it through the
 * `.rss`/browser-UA technique instead, by making the plain-HTML path return
 * an app-shell stub that fails the "real content" assertion below and the
 * `.rss` path return real content — so the test only passes if the RSS path
 * was actually taken.
 */

const THREAD_URL = "https://www.reddit.com/r/longmont/comments/abc123/interesting_budget_situation/";

const APP_SHELL_HTML = `<!doctype html><html><head><title>reddit</title></head><body><div id="2x-container"></div><script src="/shell.js"></script></body></html>`;

const THREAD_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Interesting budget situation</title>
    <link href="${THREAD_URL}" />
    <updated>2026-08-28T12:00:00+00:00</updated>
    <author><name>a_longmont_resident</name></author>
    <content type="html">&lt;div&gt;The city budget packet shows a $2.1M shortfall in the general fund, see agenda item 7&lt;/div&gt;</content>
  </entry>
  <entry>
    <title>comment</title>
    <link href="${THREAD_URL}comment123/" />
    <updated>2026-08-28T13:00:00+00:00</updated>
    <author><name>another_user</name></author>
    <content type="html">&lt;div&gt;Confirmed, saw it in the packet on page 14&lt;/div&gt;</content>
  </entry>
</feed>`;

describe("reddit URL detection (Dark Desk F5)", () => {
  it("recognizes reddit.com/redd.it hosts and thread permalinks", () => {
    assert.equal(isRedditUrl(new URL(THREAD_URL)), true);
    assert.equal(isRedditUrl(new URL("https://redd.it/abc123")), true);
    assert.equal(isRedditUrl(new URL("https://old.reddit.com/r/longmont")), true);
    assert.equal(isRedditUrl(new URL("https://longmontcolorado.gov")), false);

    assert.equal(isRedditThreadUrl(new URL(THREAD_URL)), true);
    assert.equal(isRedditThreadUrl(new URL("https://www.reddit.com/r/longmont/")), false);
    assert.equal(isRedditThreadUrl(new URL("https://www.reddit.com/user/someone")), false);
  });
});

describe("generic ingest routes reddit through the .rss/browser-UA technique (Dark Desk F5)", () => {
  afterEach(() => {
    setFetchImplForTests(null);
    resetRedditPacing();
  });

  it("fetches a reddit thread URL via its .rss feed, not the plain page", async () => {
    resetRedditPacing();
    const expectedRss = threadFeed(THREAD_URL);
    const calls: string[] = [];
    setFetchImplForTests(async (url) => {
      calls.push(url.toString());
      if (url.toString() === expectedRss) {
        return new Response(THREAD_RSS, {
          status: 200,
          headers: { "content-type": "application/atom+xml" },
        });
      }
      // If the generic (non-reddit) path were taken instead, it would land
      // here — the app shell, not the .rss feed.
      return new Response(APP_SHELL_HTML, { status: 200, headers: { "content-type": "text/html" } });
    });

    const doc = await ingestDocument(THREAD_URL);

    assert.equal(calls.includes(expectedRss), true, `expected a request to ${expectedRss}, got: ${calls.join(", ")}`);
    assert.equal(doc.extractionMethod, "reddit-rss");
    assert.equal(doc.ok, true);
    assert.match(doc.text, /\$2\.1M shortfall/);
    assert.match(doc.text, /page 14/);
    // Never the raw app-shell markup a generic HTML strip would have kept.
    assert.doesNotMatch(doc.text, /shell\.js|2x-container/);
  });

  it("does not special-case a non-reddit URL", async () => {
    resetRedditPacing();
    // A real-shaped article (long enough, no app-shell markers) so this
    // never falls into the JS-render path and spins up a real browser —
    // this test is only about which extraction path was chosen.
    const article =
      "<article><h1>City Council Notice</h1>" +
      Array.from(
        { length: 12 },
        (_, i) =>
          `<p>Paragraph ${i + 1}: the Longmont city council discussed the general fund budget shortfall at length, citing the agenda packet distributed before the meeting.</p>`,
      ).join("") +
      "</article>";
    setFetchImplForTests(async () =>
      new Response(`<html><title>City page</title><body>${article}</body></html>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    const doc = await ingestDocument("https://longmontcolorado.gov/notice");
    assert.notEqual(doc.extractionMethod, "reddit-rss");
    assert.notEqual(doc.extractionMethod, "reddit-old");
    assert.doesNotMatch(doc.extractionMethod, /playwright/);
  });
});

describe("researchLoop caps reddit fetches per hop (Dark Desk F5)", () => {
  it(`fetches at most ${REDDIT_FETCHES_PER_HOP_CAP} reddit URLs in one hop, deferring the rest`, async () => {
    await ensureInvestigateSchema();
    const sql = await getSql();
    const user = `reddit-cap-${Date.now()}`;
    const rows = await sql<{ id: number }>`
      insert into investigations (user_id, title) values (${user}, ${"reddit cap"}) returning id
    `;
    const investigationId = rows[0]!.id;

    const redditUrls = Array.from(
      { length: REDDIT_FETCHES_PER_HOP_CAP + 2 },
      (_, i) => `https://www.reddit.com/r/longmont/comments/thread${i}/post${i}/`,
    );

    let fetchCalls = 0;
    const fetch: FetchFn = async (url) => {
      fetchCalls += 1;
      return { ok: true, status: 200, text: `content for ${url}`.repeat(5), title: url, extras: [] };
    };

    const plan = (): HopPlan => ({ ...emptyPlan(), fetch_urls: redditUrls });

    await researchLoop({
      userId: user,
      investigationId,
      hops: 1,
      search: async () => [],
      fetch,
      planner: async () => plan(),
      archives: async () => [],
    });

    assert.ok(
      fetchCalls <= REDDIT_FETCHES_PER_HOP_CAP,
      `expected at most ${REDDIT_FETCHES_PER_HOP_CAP} reddit fetches in one hop, got ${fetchCalls}`,
    );

    const deferred = await sql<{ label: string }>`
      select label from frontier_items
      where investigation_id = ${investigationId} and status = 'deferred'
        and closed_reason = 'Reddit fetch cap reached this hop'
    `;
    assert.ok(deferred.length >= 1, "at least one reddit URL over the cap should be deferred, not fetched");
  });
});
