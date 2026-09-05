import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { setImmediate } from "node:timers/promises";
import { setFetchImplForTests } from "./fetch-url.ts";
import { fetchRedditDocument, resetRedditPacing, sweepRedditFeeds } from "./reddit.server.ts";

const THREAD = "https://www.reddit.com/r/longmont/comments/abc123/budget/";
const RSS = `${THREAD}.rss`;
const XML = `<feed><entry><title>Longmont budget</title><link href="${THREAD}"/><content>The city budget includes funding for streets and public libraries.</content></entry></feed>`;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The transport AND DNS are mocked: no Reddit requests or DNS traffic.
// Step the clock while letting native promise/stream jobs drain between ticks.
async function finish<T>(work: Promise<T>): Promise<T> {
  let settled = false;
  const result = work.then(
    (value) => {
      settled = true;
      return { value };
    },
    (error: unknown) => {
      settled = true;
      return { error };
    },
  );
  for (let i = 0; i < 4000 && !settled; i++) {
    await setImmediate();
    mock.timers.tick(100);
  }
  assert.ok(settled, "request queue must settle within the bounded fake clock");
  const outcome = await result;
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

describe("TR-001 shared Reddit request queue", () => {
  beforeEach(() => {
    mock.method(dns, "lookup", async () => [{ address: "151.101.1.140", family: 4 }]);
    syncBuiltinESMExports();
    mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
    resetRedditPacing();
  });
  afterEach(() => {
    setFetchImplForTests(null);
    resetRedditPacing();
    mock.timers.reset();
    mock.restoreAll();
    syncBuiltinESMExports();
  });

  function transport(headerMs = 150, bodyMs = 0, statuses: number[] = []) {
    const starts: number[] = [];
    const urls: string[] = [];
    let active = 0;
    let maxActive = 0;
    setFetchImplForTests(async (url) => {
      urls.push(url.toString());
      starts.push(Date.now());
      active++;
      maxActive = Math.max(maxActive, active);
      await pause(headerMs);
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          await pause(bodyMs);
          controller.enqueue(new TextEncoder().encode(XML));
          controller.close();
          active--;
        },
      });
      return new Response(body, { status: statuses.shift() ?? 200 });
    });
    return { starts, urls, maxActive: () => maxActive };
  }
  function spaced(starts: number[], minimum = 8000) {
    for (let i = 1; i < starts.length; i++) {
      assert.ok(
        starts[i]! - starts[i - 1]! >= minimum,
        `request offsets ${starts.map((n) => n - starts[0]!)}, required gap ${minimum}`,
      );
    }
  }

  it("spaces three concurrent document callers by >=8000ms and never overlaps", async () => {
    const observed = transport();
    const docs = await finish(
      Promise.all(Array.from({ length: 3 }, () => fetchRedditDocument(new URL(THREAD)))),
    );
    assert.ok(docs.every((doc) => doc.ok));
    assert.equal(observed.starts.length, 3);
    spaced(observed.starts);
    assert.equal(observed.maxActive(), 1);
  });

  it("shares the queue across sweep, thread RSS and a user-page RSS fetch", async () => {
    const observed = transport();
    await finish(
      Promise.all([
        sweepRedditFeeds(["https://www.reddit.com/r/longmont/new/.rss"]),
        fetchRedditDocument(new URL(THREAD)),
        fetchRedditDocument(new URL("https://www.reddit.com/user/resident")),
      ]),
    );
    assert.equal(observed.starts.length, 3);
    assert.ok(observed.urls.includes("https://www.reddit.com/user/resident/.rss"));
    spaced(observed.starts);
    assert.equal(observed.maxActive(), 1);
  });

  it("shares the queue with an old-Reddit fallback for a no-feed page", async () => {
    const observed = transport();
    await finish(
      Promise.all([
        fetchRedditDocument(new URL(THREAD)),
        fetchRedditDocument(new URL("https://www.reddit.com/r/longmont/wiki/rules")),
      ]),
    );
    assert.equal(observed.starts.length, 2);
    assert.ok(observed.urls.includes("https://old.reddit.com/r/longmont/wiki/rules"));
    spaced(observed.starts);
    assert.equal(observed.maxActive(), 1);
  });

  it("holds the queue through a body lasting longer than the minimum gap", async () => {
    const observed = transport(150, 12000);
    await finish(
      Promise.all([fetchRedditDocument(new URL(THREAD)), fetchRedditDocument(new URL(THREAD))]),
    );
    assert.equal(
      observed.maxActive(),
      1,
      "response headers must not release the queue before the body completes",
    );
    spaced(observed.starts, 12150);
  });

  it("applies a 429 cooldown to already queued callers and keeps the slower pace", async () => {
    const observed = transport(150, 0, [429, 200, 200]);
    const docs = await finish(
      Promise.all(Array.from({ length: 3 }, () => fetchRedditDocument(new URL(THREAD)))),
    );
    assert.equal(docs[0]!.status, 429);
    assert.ok(
      observed.starts[1]! - observed.starts[0]! >= 60150,
      "queued caller must respect 60s from 429 receipt",
    );
    assert.ok(observed.starts[2]! - observed.starts[1]! >= 16000, "429 halves the pace");
    assert.equal(observed.maxActive(), 1);
  });

  it("recovers after transport and body failures without poisoning queued work", async () => {
    let calls = 0;
    setFetchImplForTests(async () => {
      calls++;
      if (calls === 1) throw new Error("mock network failure");
      if (calls === 2)
        return new Response(
          new ReadableStream({
            start(c) {
              c.error(new Error("mock body failure"));
            },
          }),
        );
      return new Response(XML);
    });
    const docs = await finish(
      Promise.all(Array.from({ length: 3 }, () => fetchRedditDocument(new URL(THREAD)))),
    );
    assert.deepEqual(
      docs.map((doc) => doc.ok),
      [false, false, true],
    );
    assert.equal(calls, 3);
  });

  it("stops a sweep after three 429s while preserving the shared cooldown", async () => {
    const observed = transport(150, 0, [429, 429, 429]);
    const sweep = await finish(sweepRedditFeeds(Array(4).fill(RSS)));
    assert.equal(sweep.incomplete, true);
    assert.equal(sweep.log.length, 3);
    assert.match(sweep.reason!, /3 times/);
    await finish(fetchRedditDocument(new URL(THREAD)));
    spaced(observed.starts, 60150);
  });

  it("resolves redd.it to the canonical thread RSS and paces each redirect hop", async () => {
    const urls: string[] = [];
    const starts: number[] = [];
    setFetchImplForTests(async (url) => {
      urls.push(url.toString());
      starts.push(Date.now());
      if (url.hostname === "redd.it")
        return new Response(null, { status: 302, headers: { location: THREAD } });
      return new Response(XML);
    });
    const doc = await finish(fetchRedditDocument(new URL("https://redd.it/abc123")));
    assert.equal(doc.ok, true);
    assert.equal(doc.extractionMethod, "reddit-rss");
    assert.deepEqual(urls, ["https://redd.it/abc123", RSS]);
    assert.ok(doc.redirectChain.includes(THREAD));
    spaced(starts);
  });

  for (const canonical of [`${THREAD}#comments`, `${RSS}?context=3#comments`]) {
    it(`normalizes canonical short-link RSS routing: ${canonical}`, async () => {
      const calls: string[] = [];
      setFetchImplForTests(async (url) => {
        calls.push(url.toString());
        if (url.hostname === "redd.it")
          return new Response(null, { status: 302, headers: { location: canonical } });
        return new Response(XML);
      });
      const doc = await finish(fetchRedditDocument(new URL("https://redd.it/abc123")));
      assert.equal(doc.ok, true);
      assert.deepEqual(calls, ["https://redd.it/abc123", RSS]);
    });
  }

  it("paces redirects from an RSS request too", async () => {
    const starts: number[] = [];
    setFetchImplForTests(async () => {
      starts.push(Date.now());
      return starts.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: "https://old.reddit.com/r/longmont/comments/abc123/budget/.rss" },
          })
        : new Response(XML);
    });
    const doc = await finish(fetchRedditDocument(new URL(THREAD)));
    assert.equal(doc.ok, true);
    assert.equal(starts.length, 2);
    spaced(starts);
  });

  for (const destination of [
    "http://127.0.0.1/private",
    "https://example.com/",
    "https://reddit.com.evil.example/",
    "ftp://www.reddit.com/file",
  ]) {
    it(`rejects unsafe or non-Reddit short-link redirect: ${destination}`, async () => {
      let calls = 0;
      setFetchImplForTests(async () => {
        calls++;
        return new Response(null, { status: 302, headers: { location: destination } });
      });
      const doc = await finish(fetchRedditDocument(new URL("https://redd.it/abc123")));
      assert.equal(doc.ok, false);
      assert.equal(calls, 1, "must reject before sending to redirect destination");
    });
  }

  it("rejects Reddit DNS resolving privately before the transport sends", async () => {
    mock.restoreAll();
    mock.method(dns, "lookup", async () => [{ address: "127.0.0.1", family: 4 }]);
    syncBuiltinESMExports();
    let calls = 0;
    setFetchImplForTests(async () => {
      calls++;
      return new Response(XML);
    });
    const doc = await finish(fetchRedditDocument(new URL(THREAD)));
    assert.equal(doc.ok, false);
    assert.match(doc.text, /not fetchable/);
    assert.equal(calls, 0);
  });

  it("limits a chain of distinct Reddit redirects to five sends", async () => {
    let calls = 0;
    setFetchImplForTests(async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { location: `https://redd.it/hop${calls}` },
      });
    });
    const doc = await finish(fetchRedditDocument(new URL("https://redd.it/abc123")));
    assert.equal(doc.ok, false);
    assert.match(doc.text, /Too many Reddit redirects/);
    assert.equal(calls, 5);
  });

  it("caps repeated 429 slowdown at sixty seconds", async () => {
    const observed = transport(150, 0, [429, 429, 429, 429, 200, 200]);
    await finish(
      Promise.all(Array.from({ length: 6 }, () => fetchRedditDocument(new URL(THREAD)))),
    );
    assert.equal(observed.starts.length, 6);
    spaced(observed.starts, 60000);
    assert.ok(
      observed.starts[5]! - observed.starts[4]! < 61000,
      "pace must stop doubling at sixty seconds",
    );
  });

  it("bounds short-link loops and rejects a non-thread destination", async () => {
    let calls = 0;
    setFetchImplForTests(async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location: "https://redd.it/abc123" } });
    });
    const loop = await finish(fetchRedditDocument(new URL("https://redd.it/abc123")));
    assert.equal(loop.ok, false);
    assert.ok(calls <= 5);
    setFetchImplForTests(async () => new Response("not a canonical thread"));
    const missing = await finish(fetchRedditDocument(new URL("https://redd.it/abc123")));
    assert.equal(missing.ok, false);
  });

  const LISTING_XML =
    `<feed>` +
    `<entry><title>Water main break on Main St</title><link href="${THREAD}listing1/"/>` +
    `<author><name>resident1</name></author><content>Crews are on scene, expect closures.</content></entry>` +
    `<entry><title>Council votes on budget tonight</title><link href="${THREAD}listing2/"/>` +
    `<author><name>resident2</name></author><content>Meeting starts at 7pm.</content></entry>` +
    `</feed>`;

  for (const c of [
    { name: "subreddit front page", page: "https://www.reddit.com/r/longmont/", feed: "https://www.reddit.com/r/longmont/.rss" },
    { name: "subreddit new", page: "https://www.reddit.com/r/longmont/new", feed: "https://www.reddit.com/r/longmont/new/.rss" },
    { name: "subreddit hot", page: "https://www.reddit.com/r/longmont/hot", feed: "https://www.reddit.com/r/longmont/hot/.rss" },
    { name: "subreddit rising", page: "https://www.reddit.com/r/longmont/rising", feed: "https://www.reddit.com/r/longmont/rising/.rss" },
    {
      name: "subreddit top with t= carried",
      page: "https://www.reddit.com/r/longmont/top?t=week",
      feed: "https://www.reddit.com/r/longmont/top/.rss?t=week",
    },
    {
      name: "subreddit search with q and restrict_sr",
      page: "https://www.reddit.com/r/longmont/search?q=city%20council&sort=new",
      feed: "https://www.reddit.com/r/longmont/search.rss?q=city%20council&restrict_sr=on&sort=new",
    },
    {
      name: "site search",
      page: "https://www.reddit.com/search?q=longmont%20ordinance",
      feed: "https://www.reddit.com/search.rss?q=longmont%20ordinance",
    },
    {
      name: "user page",
      page: "https://www.reddit.com/user/resident",
      feed: "https://www.reddit.com/user/resident/.rss",
    },
    {
      name: "u/ shorthand user page",
      page: "https://www.reddit.com/u/resident",
      feed: "https://www.reddit.com/user/resident/.rss",
    },
  ]) {
    it(`routes ${c.name} to its .rss feed`, async () => {
      const calls: string[] = [];
      setFetchImplForTests(async (url) => {
        calls.push(url.toString());
        return new Response(LISTING_XML, { status: 200 });
      });
      const doc = await finish(fetchRedditDocument(new URL(c.page)));
      assert.deepEqual(calls, [c.feed]);
      assert.equal(doc.extractionMethod, "reddit-rss");
      assert.equal(doc.ok, true);
    });
  }

  it("falls back to old.reddit.com only for a page with no feed equivalent", async () => {
    const calls: string[] = [];
    setFetchImplForTests(async (url) => {
      calls.push(url.toString());
      return new Response("<html><title>wiki</title><body>rules go here, long enough text</body></html>", {
        status: 200,
      });
    });
    const doc = await finish(fetchRedditDocument(new URL("https://www.reddit.com/r/longmont/wiki/rules")));
    assert.deepEqual(calls, ["https://old.reddit.com/r/longmont/wiki/rules"]);
    assert.equal(doc.extractionMethod, "reddit-old");
  });

  it("turns a listing feed's posts into readable document text", async () => {
    setFetchImplForTests(async () => new Response(LISTING_XML, { status: 200 }));
    const doc = await finish(fetchRedditDocument(new URL("https://www.reddit.com/r/longmont/new")));
    assert.equal(doc.ok, true);
    assert.equal(doc.extractionMethod, "reddit-rss");
    assert.match(doc.text, /Water main break on Main St/);
    assert.match(doc.text, /resident1/);
    assert.match(doc.text, /Crews are on scene/);
    assert.match(doc.text, /Council votes on budget tonight/);
    assert.match(doc.text, /resident2/);
  });
});

// Wall-clock check of the original three-caller reproduction. Mocked DNS and
// a 150ms transport; this never contacts Reddit. Deeper cases above use fake time.
it("TR-001 real-clock three-caller transport regression", async (t) => {
  mock.method(dns, "lookup", async () => [{ address: "151.101.1.140", family: 4 }]);
  syncBuiltinESMExports();
  resetRedditPacing();
  const starts: number[] = [];
  let active = 0;
  let maxActive = 0;
  setFetchImplForTests(async () => {
    starts.push(Date.now());
    active++;
    maxActive = Math.max(maxActive, active);
    await pause(150);
    active--;
    return new Response(XML);
  });
  try {
    const docs = await Promise.all(
      Array.from({ length: 3 }, () => fetchRedditDocument(new URL(THREAD))),
    );
    assert.ok(docs.every((doc) => doc.ok));
    const offsets = starts.map((value) => value - starts[0]!);
    t.diagnostic(`request offsets ${JSON.stringify(offsets)} ms; max in flight ${maxActive}`);
    assert.equal(starts.length, 3);
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i]! - starts[i - 1]! >= 8000);
    assert.equal(maxActive, 1);
  } finally {
    setFetchImplForTests(null);
    resetRedditPacing();
    mock.restoreAll();
    syncBuiltinESMExports();
  }
});
