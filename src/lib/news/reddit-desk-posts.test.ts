import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DESK_POSTS,
  REDDIT_DESK_MESSAGE,
  REDDIT_DESK_ORIGINS,
  deskPostFromUnknown,
  deskPostsFromUnknown,
  normalizeRedditPermalink,
  readRedditDeskEnvelope,
} from "./reddit-desk-posts.ts";

/**
 * The desk page's half of "Send to Desk": anything a content script posts into
 * the page is untrusted, so these tests cover the two speaker checks (origin
 * and source) and the field validation that runs after them.
 */

const ownWindow = {};
const ownOrigin = "https://townreporter.org";

function envelope(posts: unknown[]) {
  return { type: REDDIT_DESK_MESSAGE, posts, capturedAt: 1_763_000_000_000 };
}

function read(overrides: Partial<Parameters<typeof readRedditDeskEnvelope>[0]> = {}) {
  return readRedditDeskEnvelope({
    origin: ownOrigin,
    ownOrigin,
    source: ownWindow,
    ownWindow,
    data: envelope([{ url: "https://www.reddit.com/r/Longmont/comments/abc/title/", title: "A post" }]),
    ...overrides,
  });
}

describe("readRedditDeskEnvelope", () => {
  it("accepts a message from this window on a desk origin", () => {
    const posts = read();
    assert.ok(posts);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "https://www.reddit.com/r/Longmont/comments/abc/title");
  });

  it("ignores a message from the wrong origin", () => {
    assert.equal(read({ origin: "https://evil.example" }), null);
    assert.equal(read({ ownOrigin: "https://evil.example", origin: "https://evil.example" }), null);
  });

  it("ignores a message from the wrong source (an iframe, another window)", () => {
    assert.equal(read({ source: {} }), null);
  });

  it("ignores a message that is not this extension's shape", () => {
    assert.equal(read({ data: { type: "something-else", posts: [] } }), null);
    assert.equal(read({ data: { type: REDDIT_DESK_MESSAGE, posts: "nope" } }), null);
    assert.equal(read({ data: null }), null);
    assert.equal(read({ data: "posts" }), null);
  });

  it("allows both desk origins and nothing else", () => {
    assert.deepEqual([...REDDIT_DESK_ORIGINS], ["https://townreporter.org", "http://127.0.0.1:3100"]);
    const local = read({ origin: "http://127.0.0.1:3100", ownOrigin: "http://127.0.0.1:3100" });
    assert.ok(local);
  });

  it("an accepted message with no usable posts is an empty list, not null", () => {
    assert.deepEqual(read({ data: envelope([{ url: "https://example.com/x", title: "bad" }]) }), []);
  });
});

describe("normalizeRedditPermalink", () => {
  it("normalizes the three Reddit hosts and drops query, hash and trailing slashes", () => {
    for (const host of ["reddit.com", "www.reddit.com", "old.reddit.com"]) {
      assert.equal(
        normalizeRedditPermalink(`https://${host}/r/Longmont/comments/abc/title/?utm=1#c`),
        "https://www.reddit.com/r/Longmont/comments/abc/title",
      );
    }
  });

  it("rejects non-https, non-Reddit, non-permalink and credentialed URLs", () => {
    const bad = [
      "http://www.reddit.com/r/Longmont/comments/abc/title/",
      "https://example.com/r/Longmont/comments/abc/title/",
      "https://www.reddit.com.evil.com/r/Longmont/comments/abc/title/",
      "https://www.reddit.com/r/Longmont/",
      "https://www.reddit.com/comments/abc/title/",
      "https://user:pass@www.reddit.com/r/Longmont/comments/abc/title/",
      "/r/Longmont/comments/abc/title/",
      "javascript:alert(1)",
      "",
      null,
      42,
    ];
    for (const raw of bad) assert.equal(normalizeRedditPermalink(raw), null, String(raw));
  });
});

describe("deskPostFromUnknown / deskPostsFromUnknown", () => {
  it("caps oversize fields instead of showing them at full length", () => {
    const post = deskPostFromUnknown({
      url: "https://www.reddit.com/r/Longmont/comments/abc/title/",
      title: "T".repeat(10_000),
      author: "A".repeat(10_000),
      time: "9".repeat(10_000),
      excerpt: "E".repeat(10_000),
    });
    assert.ok(post);
    assert.equal(post.title.length, 300);
    assert.equal(post.author.length, 100);
    assert.equal(post.time.length, 40);
    assert.equal(post.excerpt.length, 1_000);
  });

  it("drops records with a bad URL, an empty title or the wrong types", () => {
    assert.equal(deskPostFromUnknown({ url: "https://example.com/r/x/comments/a/b/", title: "x" }), null);
    assert.equal(deskPostFromUnknown({ url: "https://www.reddit.com/r/x/comments/a/b/", title: "  " }), null);
    assert.equal(deskPostFromUnknown({ url: 42, title: "x" }), null);
    assert.equal(deskPostFromUnknown({ url: "https://www.reddit.com/r/x/comments/a/b/", title: 42 }), null);
    assert.equal(deskPostFromUnknown(null), null);
    assert.equal(deskPostFromUnknown("junk"), null);
  });

  it("de-duplicates by URL and caps the list at 50", () => {
    const list = Array.from({ length: 60 }, (_, i) => ({
      url: `https://www.reddit.com/r/Longmont/comments/id${i}/post_${i}/`,
      title: `Post ${i}`,
    }));
    list.push({ url: "https://reddit.com/r/Longmont/comments/id0/post_0/?x=1", title: "Duplicate" });
    const posts = deskPostsFromUnknown(list);
    assert.equal(posts.length, MAX_DESK_POSTS);
    assert.equal(new Set(posts.map((p) => p.url)).size, MAX_DESK_POSTS);
  });

  it("never returns anything for a non-array", () => {
    assert.deepEqual(deskPostsFromUnknown(null), []);
    assert.deepEqual(deskPostsFromUnknown({ 0: { title: "x" } }), []);
  });
});
