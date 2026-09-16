import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  enrichRedditPostsWithLocalRedlib,
  redlibBaseUrl,
} from "./reddit.server.ts";
import { canonicalRedditThreadUrl, parseRedlibThreadHtml } from "./redlib.ts";
import type { RedditPost } from "./reddit.ts";

const THREAD_URL = "https://www.reddit.com/r/longmont/comments/abc123/council_packet/";

const REDLIB_HTML = `<!doctype html>
<html><head>
  <title>Council packet - r/longmont</title>
  <meta name="description" content="View on Redlib, an alternative private front-end to Reddit.">
  <meta property="og:url" content="/r/longmont/comments/abc123/council_packet/">
</head><body>
  <div class="post highlighted" id="abc123">
    <h1 class="post_title">Council packet has a $2.1 million contract</h1>
    <a class="post_author">u/civic_reader</a>
    <span class="created" title="Sep 14 2026, 12:00:00 UTC"></span>
    <span class="post_score" title="125">125 Upvotes</span>
    <div class="post_body"><p>The city council packet schedules a public hearing on ordinance 22-01.</p></div>
    <div class="post_footer">93% Upvoted</div>
  </div>
  <span id="comment_count">2 comments</span>
  <div class="comment" id="comment-one">
    <a class="comment_author">u/neighbor</a>
    <span class="comment_score" title="8">8 points</span>
    <div class="comment_body"><p>The hearing begins at 7 p.m.</p></div>
  </div>
</body></html>`;

function post(): RedditPost {
  return {
    title: "Council packet",
    url: THREAD_URL,
    updated: "2026-09-14T12:00:00Z",
    author: "/u/civic_reader",
    excerpt: "The feed cut this sentence short.",
  };
}

describe("Redlib thread parser", () => {
  it("recovers the complete OP and metadata while preserving a Reddit permalink", () => {
    const thread = parseRedlibThreadHtml(REDLIB_HTML, THREAD_URL);
    assert.equal(thread.canonicalUrl, THREAD_URL);
    assert.equal(thread.bodyText, "The city council packet schedules a public hearing on ordinance 22-01.");
    assert.equal(thread.score, 125);
    assert.equal(thread.upvoteRatio, 0.93);
    assert.equal(thread.reportedCommentCount, 2);
    assert.equal(thread.retrievedCommentCount, 1);
    assert.equal(thread.coverage, "partial");
    assert.equal(thread.comments[0]?.canonicalUrl, `${THREAD_URL}comment-one/`);
  });

  it("rejects an error page and a mismatched discussion", () => {
    assert.throws(() => parseRedlibThreadHtml("<html><title>Sign in</title></html>", THREAD_URL), /parse_failure/);
    assert.throws(
      () => parseRedlibThreadHtml(REDLIB_HTML.replaceAll("abc123", "other1"), THREAD_URL),
      /does not match requested thread/,
    );
  });

  it("canonicalizes Redlib-relative links to reddit.com", () => {
    assert.equal(canonicalRedditThreadUrl("/r/longmont/comments/abc123/council_packet"), THREAD_URL);
  });
});

describe("Dark Desk local Redlib enrichment", () => {
  it("defaults to loopback, accepts an explicit instance, and supports an off switch", () => {
    assert.equal(redlibBaseUrl("http://127.0.0.1:18080")?.origin, "http://127.0.0.1:18080");
    assert.equal(redlibBaseUrl("off"), null);
    assert.equal(redlibBaseUrl("https://redlib.example.org")?.origin, "https://redlib.example.org");
    assert.throws(() => redlibBaseUrl("https://editor:secret@redlib.example.org"), /credentials/);
  });

  it("enriches an RSS candidate through a healthy local Redlib", async () => {
    const fetcher = async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/info.json") {
        return Response.json({ git_commit: "a4d36e954cf1bd64f209cd8868c5a29edc81b374" });
      }
      return new Response(REDLIB_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    };
    const result = await enrichRedditPostsWithLocalRedlib([post()], 1, {
      baseUrl: "http://127.0.0.1:18080",
      fetcher,
      paced: false,
    });
    assert.equal(result.report.adapter, "redlib");
    assert.equal(result.report.enriched, 1);
    assert.equal(result.report.coverage, "partial");
    assert.equal(result.posts[0]?.sourceAdapter, "redlib-html");
    assert.match(result.posts[0]?.fullText ?? "", /public hearing/);
    assert.equal(result.posts[0]?.url, THREAD_URL);
  });

  it("keeps the RSS result when Redlib cannot read the thread", async () => {
    const fetcher = async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/info.json") {
        return Response.json({ git_commit: "a4d36e954cf1bd64f209cd8868c5a29edc81b374" });
      }
      return new Response("upstream unavailable", { status: 502, headers: { "content-type": "text/plain" } });
    };
    const original = post();
    const result = await enrichRedditPostsWithLocalRedlib([original], 1, {
      baseUrl: "http://127.0.0.1:18080",
      fetcher,
      paced: false,
    });
    assert.equal(result.report.adapter, "rss-only");
    assert.equal(result.report.coverage, "unavailable");
    assert.equal(result.posts[0]?.excerpt, original.excerpt);
    assert.equal(result.posts[0]?.sourceAdapter, "reddit-rss");
  });
});
