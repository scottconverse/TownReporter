import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  MAX_AUTHOR,
  MAX_EXCERPT,
  MAX_POSTS,
  MAX_TITLE,
  capText,
  isRedditHost,
  normalizePermalink,
  toDeskPosts,
} from "./reddit-send-to-desk/parse.js";

/*
  The collector is a classic script injected into the Reddit tab, so the only
  honest way to test it is to run the real file against real fixture HTML.
  `miniDocument` below is a deliberately small DOM: enough HTML parsing and
  selector matching for the selectors collector.js actually uses (tag names,
  `.class`, `[attr="value"]`, descendant combinators and comma lists). It is
  test scaffolding, not shipped.
 */

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function parseCompound(text) {
  const compound = { tag: null, classes: [], id: null, attrs: [] };
  const re = /([a-zA-Z][\w:-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\]/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) compound.tag = m[1].toLowerCase();
    else if (m[2]) compound.classes.push(m[2]);
    else if (m[3]) compound.id = m[3];
    else if (m[4]) compound.attrs.push({ name: m[4].toLowerCase(), value: m[5] ?? m[6] ?? m[7] });
  }
  return compound;
}

function parseSelector(selector) {
  return selector
    .split(",")
    .map((part) => part.trim().split(/\s+/).filter(Boolean).map(parseCompound))
    .filter((seq) => seq.length > 0);
}

function hasAttr(node, name) {
  return Object.prototype.hasOwnProperty.call(node.attrs, name);
}

function matchCompound(node, compound) {
  if (compound.tag && node.tag !== compound.tag) return false;
  if (compound.id && node.attrs.id !== compound.id) return false;
  if (compound.classes.length) {
    const classes = (node.attrs.class || "").split(/\s+/);
    if (!compound.classes.every((c) => classes.includes(c))) return false;
  }
  for (const a of compound.attrs) {
    if (!hasAttr(node, a.name)) return false;
    if (a.value !== undefined && node.attrs[a.name] !== a.value) return false;
  }
  return true;
}

function matchesSequence(node, sequence) {
  let i = sequence.length - 1;
  let n = node;
  if (!matchCompound(n, sequence[i])) return false;
  i -= 1;
  while (i >= 0) {
    n = n.parent;
    while (n && !matchCompound(n, sequence[i])) n = n.parent;
    if (!n) return false;
    i -= 1;
  }
  return true;
}

function makeNode(tag, attrs, parent) {
  const node = {
    tag,
    attrs,
    parent,
    children: [],
    getAttribute(name) {
      const key = String(name).toLowerCase();
      return hasAttr(node, key) ? node.attrs[key] : null;
    },
    get textContent() {
      let out = "";
      for (const child of node.children) out += typeof child === "string" ? child : child.textContent;
      return out;
    },
    querySelectorAll(selector) {
      const sequences = parseSelector(selector);
      const all = [];
      for (const child of node.children) {
        if (typeof child === "string") continue;
        all.push(child);
        all.push(...child.querySelectorAll("*"));
      }
      return all.filter((el) => sequences.some((seq) => matchesSequence(el, seq)));
    },
    querySelector(selector) {
      return node.querySelectorAll(selector)[0] ?? null;
    },
  };
  return node;
}

function parseHtml(html) {
  const root = makeNode("#root", {}, null);
  const stack = [root];
  const token =
    /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = token.exec(html))) {
    const [whole, closeTag, openTag, rawAttrs, selfClose, text] = m;
    if (whole.startsWith("<!--") || whole.startsWith("<!")) continue;
    if (closeTag) {
      const name = closeTag.toLowerCase();
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (openTag) {
      const attrs = {};
      const attrRe = /([^\s"'=<>/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
      let a;
      while ((a = attrRe.exec(rawAttrs || ""))) {
        const name = a[1].toLowerCase();
        let value = a[2] ?? "";
        if (value.startsWith('"') || value.startsWith("'")) value = value.slice(1, -1);
        attrs[name] = value;
      }
      const tag = openTag.toLowerCase();
      const node = makeNode(tag, attrs, stack[stack.length - 1]);
      stack[stack.length - 1].children.push(node);
      if (!VOID_TAGS.has(tag) && !selfClose) stack.push(node);
      continue;
    }
    if (text) stack[stack.length - 1].children.push(text);
  }
  return root;
}

const collectorSource = readFileSync(
  new URL("./reddit-send-to-desk/collector.js", import.meta.url),
  "utf8",
);

/** Run the real collector.js in a context whose `document` is fixture HTML. */
function collectFromFixture(html, max = MAX_POSTS) {
  const root = parseHtml(html);
  const document = {
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    querySelector: (selector) => root.querySelector(selector),
    getElementById: () => null,
    body: root,
    createElement: (tag) => makeNode(tag, {}, null),
  };
  const sandbox = { document, console };
  vm.createContext(sandbox);
  vm.runInContext(collectorSource, sandbox);
  return sandbox.__townreporterRedditCollect(max);
}

const SHREDDIT_FIXTURE = `
<main>
  <shreddit-post post-title="Council meets Tuesday on the 2027 budget"
                 permalink="/r/Longmont/comments/abc123/council_meets_tuesday/"
                 author="u/reader_one" created-timestamp="2026-11-18T10:00:00.000Z">
    <div slot="text-body">The council will discuss the 2027 budget on Tuesday night.</div>
  </shreddit-post>
  <shreddit-post post-title="Road closed on Main Street"
                 permalink="https://old.reddit.com/r/Longmont/comments/def456/road_closed/"
                 author="u/reader_two" created-timestamp="2026-11-17T09:00:00.000Z">
  </shreddit-post>
</main>`;

const OLD_REDDIT_FIXTURE = `
<div class="content">
  <div class="thing link" data-timestamp="1763500000">
    <div class="entry">
      <p class="title"><a class="title" href="https://example.com/story">Old style post about a road</a></p>
      <p class="tagline">submitted by <a class="author">u/old_reader</a>
        <time datetime="2026-11-19T08:00:00+00:00">x</time>
      </p>
      <ul class="flat-list"><li><a class="comments" href="https://old.reddit.com/r/Longmont/comments/ghi789/old_style/">3 comments</a></li></ul>
      <div class="expando"><div class="usertext-body">Body text from old Reddit.</div></div>
    </div>
  </div>
</div>`;

describe("collector.js against fixture HTML", () => {
  it("reads current Reddit (shreddit-post) attributes and body", () => {
    const raw = collectFromFixture(SHREDDIT_FIXTURE);
    assert.equal(raw.length, 2);
    assert.equal(raw[0].title, "Council meets Tuesday on the 2027 budget");
    assert.equal(raw[0].author, "u/reader_one");
    assert.match(raw[0].excerpt, /2027 budget/);
    const posts = toDeskPosts(raw);
    assert.equal(posts[0].url, "https://www.reddit.com/r/Longmont/comments/abc123/council_meets_tuesday");
    assert.equal(posts[1].url, "https://www.reddit.com/r/Longmont/comments/def456/road_closed");
  });

  it("reads old Reddit (div.thing) title, author, time and body", () => {
    const raw = collectFromFixture(OLD_REDDIT_FIXTURE);
    assert.equal(raw.length, 1);
    const posts = toDeskPosts(raw);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].title, "Old style post about a road");
    assert.equal(posts[0].author, "u/old_reader");
    assert.equal(posts[0].url, "https://www.reddit.com/r/Longmont/comments/ghi789/old_style");
    assert.match(posts[0].excerpt, /Body text from old Reddit/);
    // data-timestamp is epoch seconds and is handed on as an ISO date.
    assert.match(posts[0].time, /^\d{4}-\d{2}-\d{2}T/);
  });

  it("reads data-timestamp in seconds and in milliseconds without blowing up the date", () => {
    const expected = new Date(1763500000000).toISOString();
    const seconds = collectFromFixture(
      `<div class="thing" data-timestamp="1763500000">
         <a class="title" href="https://example.com/s">Seconds post</a>
         <a class="comments" href="/r/Longmont/comments/sec1/seconds/">1 comment</a>
       </div>`,
    );
    const millis = collectFromFixture(
      `<div class="thing" data-timestamp="1763500000000">
         <a class="title" href="https://example.com/m">Millis post</a>
         <a class="comments" href="/r/Longmont/comments/ms1/millis/">1 comment</a>
       </div>`,
    );
    assert.equal(seconds[0].time, expected);
    assert.equal(millis[0].time, expected);
    assert.match(seconds[0].time, /^2025-11-18T/);
    assert.match(millis[0].time, /^2025-11-18T/);
  });

  it("skips promoted ads (class and data-promoted) instead of collecting them", () => {
    const html = `
      <div class="thing link" data-timestamp="1763500000">
        <a class="title" href="https://example.com/real">A real post</a>
        <a class="comments" href="/r/Longmont/comments/real1/real/">1 comment</a>
      </div>
      <div class="thing link promoted" data-timestamp="1763500000">
        <a class="title" href="https://example.com/ad">A promoted ad</a>
        <a class="comments" href="/r/Longmont/comments/ad1/ad/">1 comment</a>
      </div>
      <div class="thing link" data-promoted="true" data-timestamp="1763500000">
        <a class="title" href="https://example.com/ad2">Another ad</a>
        <a class="comments" href="/r/Longmont/comments/ad2/ad2/">1 comment</a>
      </div>`;
    const raw = collectFromFixture(html);
    assert.equal(raw.length, 1);
    const posts = toDeskPosts(raw);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].title, "A real post");
  });

  it("stops at the 50-post cap even when the page has more", () => {
    const html = Array.from(
      { length: 60 },
      (_, i) =>
        `<shreddit-post post-title="Post ${i}" permalink="/r/Longmont/comments/id${i}/post_${i}/" author="u/a"></shreddit-post>`,
    ).join("");
    const raw = collectFromFixture(html);
    assert.equal(raw.length, MAX_POSTS);
    assert.equal(toDeskPosts(raw).length, MAX_POSTS);
  });

  it("returns nothing for a page with no posts (login wall, block, empty feed)", () => {
    // The collector runs in another vm realm, so its array has that realm's
    // Array.prototype -- check the shape, not reference equality.
    const raw = collectFromFixture("<main><p>Log in to continue</p></main>");
    assert.ok(Array.isArray(raw));
    assert.equal(raw.length, 0);
  });
});

describe("normalizePermalink", () => {
  it("normalizes the three Reddit hosts to www.reddit.com", () => {
    for (const host of ["reddit.com", "www.reddit.com", "old.reddit.com"]) {
      assert.equal(
        normalizePermalink(`https://${host}/r/Longmont/comments/abc/title/`),
        "https://www.reddit.com/r/Longmont/comments/abc/title",
      );
    }
  });

  it("resolves a relative href and drops query, fragment and trailing slashes", () => {
    assert.equal(
      normalizePermalink("/r/Longmont/comments/abc/title/?utm=1#c1"),
      "https://www.reddit.com/r/Longmont/comments/abc/title",
    );
  });

  it("rejects everything that is not an https Reddit permalink", () => {
    const bad = [
      "http://www.reddit.com/r/Longmont/comments/abc/title/",
      "https://example.com/r/Longmont/comments/abc/title/",
      "https://evil.reddit.com/r/Longmont/comments/abc/title/",
      "https://www.reddit.com.evil.com/r/Longmont/comments/abc/title/",
      "https://www.reddit.com/r/Longmont/",
      "https://www.reddit.com/comments/abc/title/",
      "https://user:pass@www.reddit.com/r/Longmont/comments/abc/title/",
      "javascript:alert(1)",
      "not a url at all",
      "",
      null,
      42,
    ];
    for (const raw of bad) assert.equal(normalizePermalink(raw), null, String(raw));
  });
});

describe("toDeskPosts", () => {
  it("caps titles, excerpts and authors instead of trusting their length", () => {
    const posts = toDeskPosts([
      {
        title: "T".repeat(10_000),
        permalink: "/r/Longmont/comments/abc/long/",
        author: "A".repeat(10_000),
        excerpt: "E".repeat(10_000),
      },
    ]);
    assert.equal(posts[0].title.length, MAX_TITLE);
    assert.equal(posts[0].author.length, MAX_AUTHOR);
    assert.equal(posts[0].excerpt.length, MAX_EXCERPT);
  });

  it("drops bad URLs, empty titles and duplicates", () => {
    const posts = toDeskPosts([
      { title: "Good", permalink: "/r/Longmont/comments/abc/good/" },
      { title: "Good again", permalink: "https://www.reddit.com/r/Longmont/comments/abc/good/?x=1" },
      { title: "Bad host", permalink: "https://example.com/r/Longmont/comments/abc/bad/" },
      { title: "", permalink: "/r/Longmont/comments/abc/untitled/" },
      { title: "No permalink" },
      null,
      "junk",
    ]);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].title, "Good");
  });

  it("returns an empty list for non-array input", () => {
    assert.deepEqual(toDeskPosts(null), []);
    assert.deepEqual(toDeskPosts("posts"), []);
    assert.deepEqual(toDeskPosts({ 0: { title: "x" } }), []);
  });
});

describe("small helpers", () => {
  it("isRedditHost accepts exactly the three Reddit hosts", () => {
    for (const host of ["reddit.com", "www.reddit.com", "old.reddit.com", "WWW.REDDIT.COM"]) {
      assert.equal(isRedditHost(host), true, host);
    }
    for (const host of ["example.com", "reddit.com.evil.com", "notreddit.com", "", null]) {
      assert.equal(isRedditHost(host), false, String(host));
    }
  });

  it("capText collapses whitespace and never leaves half a surrogate pair", () => {
    assert.equal(capText("  a \n b  ", 10), "a b");
    assert.equal(capText("😀😀", 3).length, 2);
  });
});
