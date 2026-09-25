import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { setFetchImplForTests } from "./fetch-url.ts";
import { ingestUrl } from "./ingest.ts";
import { fetchRedditSourceText, resetRedditPacing } from "./reddit.server.ts";

/**
 * A subreddit as a *scan source*.
 *
 * `ingestUrl` is the function the daily scan calls for every accepted source
 * (desk.ts's `performScanWork` -> `deps.ingestUrl ?? ingestUrl`). It routed
 * YouTube and PrimeGov but had no reddit branch at all, so a reddit source
 * fell into the generic fetch-and-strip-tags path -- which for reddit.com
 * means the JavaScript app shell, not content. Live scan 52 lost accepted
 * source 2876 ("r/Longmont -- community tips (unverified)",
 * https://www.reddit.com/r/Longmont/) to exactly that: "Page had almost no
 * readable text".
 *
 * The fixture is the same r/longmont snapshot the scorer is calibrated
 * against, so these tests read the real feed shape rather than a toy one.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FEED = readFileSync(join(here, "__fixtures__", "reddit-longmont-new.xml"), "utf8");

const SUBREDDIT_URL = "https://www.reddit.com/r/Longmont/";
const FEED_URL = "https://www.reddit.com/r/Longmont/.rss";

/** What reddit.com actually answers a plain GET with: a shell and no prose. */
const APP_SHELL =
  '<!doctype html><html><head><title>reddit</title></head><body><div id="2x-container"></div><script src="/shell.js"></script></body></html>';

const CIVIC_TITLE = "All left turns at CO 119 and Hover Street in Longmont will close for construction";

const nativeSetTimeout = setTimeout;
let monotonicOffsetMs = 0;

/** Step a fake clock while letting promise/stream jobs drain between ticks. */
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
  assert.ok(settled, "the scan fetch must settle within the bounded fake clock");
  const outcome = await result;
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

/**
 * One saved Redlib thread page, built for whichever thread the adapter asks
 * for, so the enrichment under test is not tied to one fixture permalink.
 */
function redlibThreadHtml(pathname: string): string {
  const id = /\/comments\/([a-z0-9]+)/i.exec(pathname)?.[1] ?? "abc123";
  return `<!doctype html>
<html><head>
  <title>Thread - r/longmont</title>
  <meta name="description" content="View on Redlib, an alternative private front-end to Reddit.">
  <meta property="og:url" content="${pathname}">
</head><body>
  <div class="post highlighted" id="${id}">
    <h1 class="post_title">CO 119 left turns close for construction</h1>
    <a class="post_author">u/civic_reader</a>
    <span class="created" title="Aug 28 2026, 12:00:00 UTC"></span>
    <span class="post_score" title="125">125 Upvotes</span>
    <div class="post_body"><p>The city says the left turns at CO 119 and Hover Street close Monday for construction.</p></div>
    <div class="post_footer">93% Upvoted</div>
  </div>
  <span id="comment_count">1 comment</span>
  <div class="comment" id="comment-one">
    <a class="comment_author">u/neighbor</a>
    <span class="comment_score" title="8">8 points</span>
    <div class="comment_body"><p>The detour signs went up this morning.</p></div>
  </div>
</body></html>`;
}

describe("a subreddit is read as a scan source, not fetched as a page", () => {
  beforeEach(() => {
    // The scan path must never reach a real Redlib in a unit test; the down
    // case is what an unconfigured machine actually sees, and it is asserted
    // below to stay honest rather than silent.
    process.env.REDDIT_REDLIB_BASE_URL = "off";
    mock.method(dns, "lookup", async () => [{ address: "151.101.1.140", family: 4 }]);
    syncBuiltinESMExports();
    mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
    monotonicOffsetMs = 0;
    mock.method(performance, "now", () => Date.now() + monotonicOffsetMs);
    resetRedditPacing();
  });
  afterEach(() => {
    delete process.env.REDDIT_REDLIB_BASE_URL;
    setFetchImplForTests(null);
    resetRedditPacing();
    mock.timers.reset();
    mock.restoreAll();
    globalThis.setTimeout = nativeSetTimeout;
    syncBuiltinESMExports();
  });

  it("reads the subreddit's recent posts through its .rss feed", async () => {
    const requested: string[] = [];
    setFetchImplForTests(async (url) => {
      requested.push(url.toString());
      if (url.toString() === FEED_URL) {
        return new Response(FEED, { status: 200, headers: { "content-type": "application/atom+xml" } });
      }
      return new Response(APP_SHELL, { status: 200, headers: { "content-type": "text/html" } });
    });

    const result = await finish(ingestUrl(SUBREDDIT_URL));

    assert.ok(requested.includes(FEED_URL), `the .rss feed must be requested; asked for ${requested.join(", ")}`);
    assert.ok(
      !requested.includes(SUBREDDIT_URL),
      "the JavaScript app shell must not be fetched as if it were the source",
    );
    assert.match(result.text, new RegExp(CIVIC_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(result.text, /https:\/\/www\.reddit\.com\/r\/longmont\/comments\//);
    // Tier C framing: a resident's post is a lead, never a fact.
    assert.match(result.text, /unverified/i);
    assert.match(result.text, /not a citation/i);
  });

  it("still yields the posts when local Redlib is down, and says so", async () => {
    const requested: string[] = [];
    const transport = async (input: string | URL | Request) => {
      const url = new URL(String(input));
      requested.push(url.toString());
      if (url.pathname.endsWith(".rss")) {
        return new Response(FEED, { status: 200, headers: { "content-type": "application/atom+xml" } });
      }
      // A Redlib that is configured and *not answering* — the state of this
      // machine on 2026-09-25 (nothing was listening on 127.0.0.1:18080).
      throw new TypeError("fetch failed: ECONNREFUSED 127.0.0.1:18080");
    };
    setFetchImplForTests(transport);

    const result = await fetchRedditSourceText(new URL(SUBREDDIT_URL), {
      // Named explicitly: what is under test is a Redlib that is *up and
      // unreachable*, not one switched off by configuration, which reads
      // differently in the coverage note.
      baseUrl: "http://127.0.0.1:18080",
      fetcher: transport,
      paced: false,
    });

    assert.ok(requested.includes(FEED_URL), `the .rss feed must be requested; asked for ${requested.join(", ")}`);
    assert.equal(result.ok, true, result.text);
    assert.match(result.text, new RegExp(CIVIC_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(result.text, /Redlib did not answer; RSS excerpts were used\./);
  });

  it("attaches the discussion when local Redlib is up", async () => {
    const requested: string[] = [];
    const transport = async (input: string | URL | Request) => {
      const url = new URL(String(input));
      requested.push(url.toString());
      if (url.pathname === "/info.json") {
        return Response.json({ git_commit: "a4d36e954cf1bd64f209cd8868c5a29edc81b374" });
      }
      if (url.pathname.endsWith(".rss")) {
        return new Response(FEED, { status: 200, headers: { "content-type": "application/atom+xml" } });
      }
      return new Response(redlibThreadHtml(url.pathname), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    };
    setFetchImplForTests(transport);

    const result = await fetchRedditSourceText(new URL(SUBREDDIT_URL), {
      baseUrl: "http://127.0.0.1:18080",
      fetcher: transport,
      paced: false,
    });

    assert.ok(requested.includes(FEED_URL), `the .rss feed must be requested; asked for ${requested.join(", ")}`);
    assert.equal(result.ok, true, result.text);
    assert.match(result.text, /The detour signs went up this morning\./);
    assert.match(result.text, /Redlib read \d+ selected discussions? in full\./);
    // The durable citation is still the Reddit permalink, never the Redlib address.
    assert.ok(!result.text.includes("127.0.0.1:18080/r/"), "a Redlib URL must never be the citation");
  });
});
