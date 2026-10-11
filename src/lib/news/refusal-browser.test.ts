import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { setFetchImplForTests } from "./fetch-url.ts";
import { ingestUrl, IngestFetchError, withRetry, type IngestUrlOptions } from "./ingest.ts";
import { HostGate } from "./host-gate.ts";
import {
  BLOCKED_AFTER_RENDER_MESSAGE,
  looksLikeBotWall,
  publicPageRoutes,
  isPrivatePage,
} from "./refusal-routes.ts";

afterEach(() => setFetchImplForTests(null));
const instantSchedule: NonNullable<IngestUrlOptions["schedule"]> = (send) => send();
function captureRendered(html: string) {
  return {
    html,
    text: html.replace(/<[^>]*>/g, " "),
    title: "Public page",
    finalUrl: `${BASE}/article`,
  };
}
const BASE = "https://1.1.1.1";
const ARTICLE =
  "<html><head><title>City Council Meeting Notes</title></head><body><article>" +
  "<h1>City Council Meeting Notes</h1>" +
  "<p>The council convened on Tuesday and approved the annual budget after a lengthy discussion that touched on " +
  "road maintenance, library funding, park improvements, and several other matters of public interest. Residents " +
  "spoke during the public comment period about traffic calming measures near the elementary school, and staff " +
  "presented a timeline for the upcoming road resurfacing project which is expected to begin in the spring. The " +
  "meeting concluded with a closed session on personnel matters that is not open to the public per state law.</p>" +
  "</article></body></html>";

const BOT_WALL =
  "<html><head><title>Access Denied</title></head><body><h1>Access Denied</h1>" +
  "<p>You have been blocked by our bot protection. Please enable JavaScript and cookies to continue.</p>" +
  '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>';

const CLOUDFLARE_LONG =
  "<html><head><title>Just a moment...</title></head><body><h1>Just a moment...</h1>" +
  "<p>Verifying you are human. This may take a few seconds.</p>" +
  "<p>" +
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore ".repeat(
    80,
  ) +
  '</p><div class="cf-browser-verification"></div></body></html>';

const REAL_ARTICLE_WITH_CF_SCRIPT = ARTICLE.replace(
  "</head>",
  '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></head>',
);

function installFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): void {
  setFetchImplForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  });
}

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });
}

function statusResponse(status: number, init: ResponseInit = {}): Response {
  return new Response("", { status, ...init });
}

async function runRefusal(
  opts: {
    first?: Response | Response[] | ((url: string) => Response | Promise<Response>);
    renderer?: (raw: string) => ReturnType<NonNullable<IngestUrlOptions["renderer"]>>;
  } = {},
): Promise<import("./ingest.ts").IngestResult> {
  const first = opts.first;
  let call = 0;
  installFetch(async (url) => {
    call += 1;
    if (typeof first === "function") return first(url);
    if (Array.isArray(first)) return first[Math.min(call - 1, first.length - 1)]!;
    if (first) return call === 1 ? first : htmlResponse("");
    return statusResponse(403);
  });
  const renderer = opts.renderer ?? (async () => captureRendered(ARTICLE));
  return ingestUrl(`${BASE}/article`, { renderer, schedule: instantSchedule });
}

test("401 with renderer falls back to playwright", async () => {
  const result = await runRefusal({ first: statusResponse(401) });
  assert.equal(result.outcome, "fetched");
  assert.equal(result.method, "playwright");
  assert.ok(result.text.length >= 40);
});

test("403 with renderer falls back to playwright", async () => {
  const result = await runRefusal({ first: statusResponse(403) });
  assert.equal(result.outcome, "fetched");
  assert.equal(result.method, "playwright");
});

test("429 without Retry-After falls back to playwright", async () => {
  const result = await runRefusal({ first: statusResponse(429) });
  assert.equal(result.outcome, "fetched");
  assert.equal(result.method, "playwright");
});

test("200 bot wall then successful render", async () => {
  const result = await runRefusal({ first: htmlResponse(BOT_WALL) });
  assert.equal(result.outcome, "fetched");
  assert.equal(result.method, "playwright");
});

test("still Access Denied after render throws BlockedAfterRenderError", async () => {
  await assert.rejects(
    () =>
      runRefusal({
        first: statusResponse(403),
        renderer: async () => captureRendered(BOT_WALL),
      }),
    (err: unknown) => {
      assert.ok(err instanceof IngestFetchError);
      assert.equal((err as IngestFetchError & { outcome: string }).outcome, "blocked-after-render");
      assert.equal(err.message, BLOCKED_AFTER_RENDER_MESSAGE);
      return true;
    },
  );
});

test("cloudflare wall with long filler after render still blocked", async () => {
  await assert.rejects(
    () =>
      runRefusal({
        first: statusResponse(403),
        renderer: async () => captureRendered(CLOUDFLARE_LONG),
      }),
    (err: unknown) => {
      assert.ok(err instanceof IngestFetchError);
      assert.equal((err as IngestFetchError & { outcome: string }).outcome, "blocked-after-render");
      assert.equal(err.message, BLOCKED_AFTER_RENDER_MESSAGE);
      return true;
    },
  );
});

test("discovered alternate feed yields method feed", async () => {
  const feedBody =
    '<?xml version="1.0"?><rss version="2.0"><channel><title>City News</title>' +
    "<item><title>Budget Approved</title><link>" +
    BASE +
    "/budget</link><description>The council approved the annual budget on Tuesday evening after public comment.</description></item>" +
    "</channel></rss>";
  const wall =
    "<html><head><title>Access Denied</title></head><body><h1>Access Denied</h1>" +
    '<p>You have been blocked.</p><link rel="alternate" type="application/rss+xml" href="/feed"></body></html>';
  let calls = 0;
  installFetch(async (url) => {
    calls += 1;
    if (
      url.endsWith("/feed") ||
      url.endsWith("/rss") ||
      url.endsWith("/feed.xml") ||
      url.endsWith("/rss.xml") ||
      url.endsWith("/atom.xml") ||
      url.endsWith("/events.rss")
    ) {
      return new Response(feedBody, {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      });
    }
    if (calls === 1) return htmlResponse(wall);
    return statusResponse(403);
  });
  const result = await ingestUrl(`${BASE}/article`, {
    renderer: async () => captureRendered(wall),
    schedule: instantSchedule,
  });
  assert.equal(result.method, "feed");
  assert.ok(result.routeUrl?.endsWith("/feed") || result.routeUrl?.endsWith("/rss"));
});

for (const feed of ["/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml", "/events.rss"]) {
  test(`conventional feed ${feed} is tried after refusal`, async () => {
    const feedBody =
      '<?xml version="1.0"?><rss version="2.0"><channel><title>City News</title>' +
      "<item><title>Update</title><link>" +
      BASE +
      "/update</link><description>The city published an update today regarding the ongoing road project.</description></item>" +
      "</channel></rss>";
    const wall =
      "<html><head><title>Access Denied</title></head><body><h1>Access Denied</h1></body></html>";
    installFetch(async (url) => {
      if (url.endsWith(feed)) {
        return new Response(feedBody, {
          status: 200,
          headers: { "content-type": "application/rss+xml" },
        });
      }
      if (url.endsWith("/article")) return htmlResponse(wall);
      return statusResponse(403);
    });
    const result = await ingestUrl(`${BASE}/article`, {
      renderer: async () => captureRendered(wall),
      schedule: instantSchedule,
    });
    assert.equal(result.method, "feed");
  });
}

test("rendered fetches share the host schedule with a 2000ms gap", async () => {
  let now = 0;
  const gate = new HostGate({
    jitterMs: 0,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  const starts: number[] = [];
  installFetch(async () => statusResponse(403));
  const renderer = async () => {
    starts.push(now);
    return captureRendered(ARTICLE);
  };
  await Promise.all([
    ingestUrl(`${BASE}/one`, { renderer, schedule: gate.schedule }),
    ingestUrl(`${BASE}/two`, { renderer, schedule: gate.schedule }),
  ]);
  assert.equal(starts.length, 2);
  assert.ok(starts[1]! - starts[0]! >= 2000);
});

test("200 article does not invoke browser renderer and no robots lookup", async () => {
  const fetches: string[] = [];
  installFetch(async (url) => {
    fetches.push(url);
    if (/robots\.txt/i.test(url)) throw new Error("robots.txt should not be fetched here");
    return htmlResponse(ARTICLE);
  });
  let rendered = 0;
  const result = await ingestUrl(`${BASE}/article`, {
    renderer: async () => {
      rendered += 1;
      return captureRendered(ARTICLE);
    },
    schedule: instantSchedule,
  });
  assert.equal(rendered, 0);
  assert.ok(result.text.length >= 40);
  assert.ok(fetches.every((u) => !/robots\.txt/i.test(u)));
});

test("429 with Retry-After does not render", async () => {
  let rendered = 0;
  installFetch(async () => statusResponse(429, { headers: { "retry-after": "30" } }));
  await assert.rejects(
    () =>
      ingestUrl(`${BASE}/article`, {
        renderer: async () => {
          rendered += 1;
          return captureRendered(ARTICLE);
        },
        schedule: instantSchedule,
      }),
    (err: unknown) => {
      assert.ok(err instanceof IngestFetchError);
      return true;
    },
  );
  assert.equal(rendered, 0);
});

test("newsletter anchor detection via publicPageRoutes", () => {
  const html =
    "<html><body><article>" +
    ARTICLE +
    '</article><a href="https://1.1.1.1/newsletter">Subscribe to our newsletter</a></body></html>';
  const routes = publicPageRoutes(html, `${BASE}/article`);
  assert.equal(routes.newsletterUrl, `${BASE}/newsletter`);
});

test("newsletter form detection via publicPageRoutes", () => {
  const html =
    "<html><body><article>" +
    ARTICLE +
    '</article><form action="https://1.1.1.1/subscribe"><input type="email" name="email"/><button>Join mailing list</button></form></body></html>';
  const routes = publicPageRoutes(html, `${BASE}/article`);
  assert.equal(routes.newsletterUrl, `${BASE}/subscribe`);
});

test("private feed URLs are guarded by isPrivatePage", () => {
  const html =
    '<html><body><form action="/login"><input type="password" name="password"/></form><p>Please sign in to continue reading.</p></body></html>';
  assert.equal(isPrivatePage(html), true);
});

test("ordinary header login link is not treated as private", () => {
  const html =
    '<html><body><header><a href="/login">Log in</a></header>' + ARTICLE + "</body></html>";
  assert.equal(isPrivatePage(html), false);
});

test("cloudflare script alone on real article is not a bot wall", () => {
  assert.equal(looksLikeBotWall(REAL_ARTICLE_WITH_CF_SCRIPT), false);
});

test("publicPageRoutes filters mailto and credentialed links", () => {
  const html =
    '<html><body><a href="mailto:news@example.com">Newsletter</a>' +
    '<a href="https://user:pass@1.1.1.1/feed">Subscribe</a>' +
    '<a href="https://1.1.1.1/feed">Subscribe to newsletter</a></body></html>';
  const routes = publicPageRoutes(html, `${BASE}/article`);
  assert.equal(routes.feeds.length, 0);
  assert.ok(!routes.feeds.some((u) => u.includes("user:")));
  assert.equal(routes.newsletterUrl, `${BASE}/feed`);
});

test("a 200 wall is rendered once even through the transient retry wrapper", async () => {
  let renders = 0;
  installFetch(async () => htmlResponse(BOT_WALL));
  await assert.rejects(
    () =>
      withRetry(() =>
        ingestUrl(`${BASE}/article`, {
          schedule: instantSchedule,
          renderer: async () => {
            renders++;
            return captureRendered(BOT_WALL);
          },
        }),
      ),
    (err) => {
      assert.equal((err as { outcome: string }).outcome, "blocked-after-render");
      return true;
    },
  );
  assert.equal(renders, 1);
});

test("alternate feeds in bounded raw 403 HTML work when rendering fails", async () => {
  const wall = BOT_WALL.replace(
    "</head>",
    '<link href="/public-updates.xml" type="application/atom+xml" rel="alternate"></head>',
  );
  const requests: string[] = [];
  installFetch(async (url) => {
    requests.push(url);
    return url.endsWith("/public-updates.xml")
      ? new Response(
          "<feed><entry><title>Local updates</title><summary>Residents are invited to a public neighborhood meeting at the library this Tuesday.</summary></entry></feed>",
          { headers: { "content-type": "application/atom+xml" } },
        )
      : htmlResponse(wall, { status: 403 });
  });
  const result = await ingestUrl(`${BASE}/article`, {
    schedule: instantSchedule,
    renderer: async () => null,
  });
  assert.equal(result.method, "feed");
  assert.equal(result.routeUrl, `${BASE}/public-updates.xml`);
  assert.deepEqual(requests, [`${BASE}/article`, `${BASE}/public-updates.xml`]);
});

test("blocked source retains newsletter hint without visiting or submitting signup", async () => {
  const requests: string[] = [];
  installFetch(async (url) => {
    requests.push(url);
    return statusResponse(403);
  });
  await assert.rejects(
    () =>
      ingestUrl(`${BASE}/article`, {
        schedule: instantSchedule,
        renderer: async () =>
          captureRendered(
            BOT_WALL.replace(
              "</body>",
              '<form><input type="email"><button>Join our newsletter</button></form></body>',
            ),
          ),
      }),
    (err) => {
      assert.equal((err as { newsletterUrl: string }).newsletterUrl, `${BASE}/article`);
      return true;
    },
  );
  assert.ok(requests.every((url) => !url.includes("newsletter") && !url.includes("subscribe")));
});

test("private or credentialed alternate feeds are never requested", async () => {
  const requests: string[] = [];
  const wall = BOT_WALL.replace(
    "</head>",
    '<link rel="alternate" type="application/rss+xml" href="http://127.0.0.1/private"><link rel="alternate" type="application/rss+xml" href="https://user:pass@1.1.1.1/private"></head>',
  );
  installFetch(async (url) => {
    requests.push(url);
    return statusResponse(403);
  });
  await assert.rejects(() =>
    ingestUrl(`${BASE}/article`, {
      schedule: instantSchedule,
      renderer: async () => captureRendered(wall),
    }),
  );
  assert.ok(requests.every((url) => !url.includes("private") && !url.includes("user:")));
});

test("rendered login and paid gates are never captured as public articles", async () => {
  for (const gate of [
    '<form action="/login"><input type="password"></form><p>Please sign in to continue reading.</p>',
    "<p>Subscribe to read this article. This content is for subscribers only.</p>",
  ]) {
    installFetch(async () => statusResponse(403));
    await assert.rejects(() =>
      ingestUrl(`${BASE}/article`, {
        schedule: instantSchedule,
        renderer: async () => captureRendered(`<html><body>${gate}</body></html>`),
      }),
    );
  }
});
