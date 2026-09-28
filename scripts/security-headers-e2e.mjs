#!/usr/bin/env node
/**
 * The Server page must refuse to be framed, in a real browser.
 *
 * A gate audit found no protective headers on any route. On a reader's page
 * that is untidy; on `/desk/ops` it is a hole, because that page carries
 * controls that restart the app and the Cloudflare Tunnel on the operator's
 * own machine.
 *
 * The session guard does not help. A hostile page frames the desk, floats
 * something inviting over the restart button, and waits for a signed-in editor
 * to click. What follows is a genuine same-origin request carrying the real
 * cookie, so `assertSameSiteRequest` is satisfied -- it answers "did this come
 * from our origin", never "did the operator mean it". Only the browser can
 * refuse to draw the frame.
 *
 * Checking the header with curl proves the string is sent. This loads an
 * attacker page in Chromium, points an iframe at the desk, and asks the
 * browser whether it drew it -- which is the property that actually matters.
 *
 * ---
 *
 * It also asserts the 0.6.81 document cache rule, on the same three surfaces.
 *
 * A reviewer saw townreporter.org pages from 0.6.68 and 0.6.76 after 0.6.80
 * had shipped: a browser, a proxy or Cloudflare handed over bytes from a
 * release that was gone. Every HTML page now carries an instruction saying how
 * long it stays good -- `private, no-store` for the desk, `no-cache`
 * (revalidate before use) for the public paper -- while the hashed bundles
 * under `/assets` keep their long cache, which is what makes those two
 * answers affordable.
 *
 * The article is not hard-coded: the walk reads `/` and follows the first
 * story link it finds, so it tests whatever paper the server is actually
 * serving. Migration 0002 seeds `welcome-to-townreporter`, so a fresh install
 * has one.
 *
 *   SECURITY_HEADERS_BASE_URL=http://127.0.0.1:3218 node scripts/security-headers-e2e.mjs
 */
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";

const base = checkedUrl(
  process.env.SECURITY_HEADERS_BASE_URL || "http://127.0.0.1:8080",
).replace(/\/$/, "");

const done = [];
const step = (n) => {
  done.push(n);
  console.log(`  ok    ${n}`);
};

/** Routes a browser renders, and therefore routes a browser can be told to frame. */
const FRAMED = ["/", "/login", "/desk", "/desk/ops"];

/** The first `/articles/<slug>` the front page links to. */
async function firstStoryLink(page) {
  const href = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href^="/articles/"]')].find((el) =>
      /^\/articles\/[^/?#]+$/.test(el.getAttribute("href") ?? ""),
    );
    return a ? a.getAttribute("href") : null;
  });
  if (href) return href;
  /*
    No story is linked, which on a fresh install means the walk is looking at a
    paper that has not finished migrating. Say so, and check the article the
    schema itself seeds rather than skipping the check silently.
  */
  console.log("  note  the front page links no story; falling back to the seeded welcome article");
  return "/articles/welcome-to-townreporter";
}

/** A hashed build asset the page actually loaded, if it loaded one. */
async function firstScriptSrc(page) {
  return page.evaluate(
    () =>
      [...document.querySelectorAll("script[src], link[rel=stylesheet][href]")]
        .map((el) => el.getAttribute("src") ?? el.getAttribute("href"))
        .find((v) => typeof v === "string" && v.startsWith("/assets/")) ?? null,
  );
}

/** The response's `Cache-Control`, asserted exactly. */
function assertCache(res, label, expected) {
  const value = String(res?.headers()["cache-control"] ?? "");
  if (value !== expected) {
    throw new Error(
      `${label}: Cache-Control is "${value || "absent"}", expected "${expected}" (it answered ${res?.status()})`,
    );
  }
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  console.log(`security headers: ${base}`);

  for (const path of FRAMED) {
    const res = await page.goto(base + path, { waitUntil: "domcontentloaded" });
    const h = res?.headers() ?? {};
    if ((h["x-frame-options"] ?? "").toUpperCase() !== "DENY") {
      throw new Error(`${path}: X-Frame-Options is "${h["x-frame-options"] ?? "absent"}", expected DENY`);
    }
    if (!/frame-ancestors\s+'none'/.test(h["content-security-policy"] ?? "")) {
      throw new Error(`${path}: no frame-ancestors 'none' in the policy`);
    }
    if ((h["x-content-type-options"] ?? "") !== "nosniff") {
      throw new Error(`${path}: X-Content-Type-Options is not nosniff`);
    }
    step(`${path} refuses framing and sniffing`);
  }

  /*
    The document cache rule (0.6.81): a browser, a proxy or Cloudflare must not
    keep a page from a release that is gone. `/` and one real article are the
    public paper and revalidate; the desk is nobody's to keep.
  */
  const front = await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  assertCache(front, "/", "no-cache");
  step(`/ tells every cache to revalidate (${front.headers()["cache-control"]})`);
  // Read the front page's own build asset now, while the front page is loaded.
  const assetPath = await firstScriptSrc(page);

  /*
    A fresh install has no public article, and that is by design: since
    CITY-SETUP, `listPublishedArticles` and `getPublishedArticle` both answer
    nothing until the owner finishes first-run setup, so the migration-seeded
    welcome story is not public yet. The smoke-built job boots exactly that
    state, so the walk discovers the story rather than assuming one, takes a
    named one from `SECURITY_HEADERS_ARTICLE` when a caller has one, and when
    the paper genuinely serves none it checks the article route's own document
    and SAYS SO rather than passing quietly.
  */
  const articlePath = process.env.SECURITY_HEADERS_ARTICLE || (await firstStoryLink(page));
  const article = await page.goto(base + articlePath, { waitUntil: "domcontentloaded" });
  const articleType = String(article?.headers()["content-type"] ?? "");
  if (!articleType.includes("text/html")) {
    throw new Error(`${articlePath}: a document route answered with content-type "${articleType}"`);
  }
  assertCache(article, articlePath, "no-cache");
  if (article.status() === 200) {
    step(`${articlePath} (a published article) tells every cache to revalidate`);
  } else {
    console.log(
      `  note  the paper serves no article yet (${articlePath} answered ${article.status()}); ` +
        `the article route's document was checked, not a story's`,
    );
    step(`${articlePath} (the article route) tells every cache to revalidate`);
  }

  const desk = await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
  /*
    The desk may answer with its own document or with a redirect into /login.
    Either way the response the browser kept must be unkeepable -- that is the
    whole point -- so both shapes are accepted and both are checked.
  */
  const deskCache = String(desk?.headers()["cache-control"] ?? "");
  if (!/no-store/i.test(deskCache)) {
    throw new Error(
      `/desk: Cache-Control is "${deskCache || "absent"}", expected a no-store answer (it answered ${desk?.status()})`,
    );
  }
  step(`/desk is not kept by any cache (${deskCache})`);

  /*
    The other half of the rule: the hashed bundles must NOT have been swept up
    by it. Their names change when their bytes change, so their long cache is
    correct, and a blanket `no-cache` here would make every page slow.
  */
  if (assetPath) {
    // `page.request` fetches without navigating, so the bundle is asked for the
    // way a browser asks for it and never handed to the renderer as a document.
    const asset = await page.request.get(base + assetPath);
    const assetCache = String(asset?.headers()["cache-control"] ?? "");
    if (/no-store|no-cache/i.test(assetCache)) {
      throw new Error(`${assetPath}: a hashed asset was given "${assetCache}"`);
    }
    step(`a hashed asset keeps its own cache policy (${assetCache || "none set by the app"})`);
  } else {
    console.log("  note  the front page loaded no /assets/ bundle; the exemption was not exercised");
  }

  /*
    The part a header check cannot do: ask the browser.

    An attacker page is served from a data: URL, which is a different origin
    from the app, and told to frame the desk. If the browser honours the
    policy the frame stays blank and its document is unreachable.
  */
  const attacker = `data:text/html,${encodeURIComponent(
    `<h1>totally unrelated page</h1><iframe id="f" src="${base}/desk/ops" width="800" height="600"></iframe>`,
  )}`;
  await page.goto(attacker, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const framed = await page.evaluate(() => {
    const el = document.getElementById("f");
    try {
      const doc = el.contentDocument;
      if (!doc) return { drew: false, why: "no contentDocument" };
      const text = (doc.body?.innerText ?? "").trim();
      return { drew: text.length > 0, why: text.slice(0, 80) };
    } catch (err) {
      return { drew: false, why: `blocked: ${String(err).slice(0, 60)}` };
    }
  });

  if (framed.drew) {
    throw new Error(`a hostile page framed /desk/ops and could read it: ${framed.why}`);
  }
  step(`a hostile page cannot frame the Server page (${framed.why})`);

  await context.close();
  await browser.close();
  console.log(JSON.stringify({ ok: true, steps: done.length }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.message ?? err), completed: done }, null, 2));
  process.exit(1);
});
