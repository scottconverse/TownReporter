import { createServerFn } from "@tanstack/react-start";
import { getSql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { publicSlug } from "./request-input.ts";

/**
 * The public page for a story that was LEGALLY removed.
 *
 * `removeLegally` deletes the row, so the story page's own read finds nothing
 * and the route used to answer 404 -- the same answer it gives a mistyped
 * address. A legal removal is not a mistyped address. It is a decision the
 * desk made, recorded in `legal_removal_slugs`, and the removal dialog the
 * owner confirms says so on the record: "Removed now; the URL returns 410
 * Gone" (design/redesign-review, `dialog-15-legal.png`; README Dialogs table,
 * "public page -> 410 Gone"). A promise the UI makes about a URL has to be
 * true of the URL, so the page says 410 and the words stay as drawn.
 *
 * 410 rather than 404 because the two mean different things to the reader and
 * to a crawler: 404 is "there is nothing here, try again later", 410 is "it
 * was here and it is gone for good". A removed story is the second. Google
 * drops a 410 sooner and stops re-crawling it, which is the point of a legal
 * removal.
 *
 * Nothing about the story is on this page. Not the headline, not the dek, not
 * the byline, not one word of the text: the whole reason for the removal is
 * that the desk may not publish it, and a "removed" page that repeats the
 * headline would republish it under a different URL. The page is generated
 * from the URL alone, never from a stored row.
 */

/**
 * Was this slug legally removed in the paper's own newsroom?
 *
 * Scoped to `DEFAULT_NEWSROOM_ID` because that is the newsroom the public
 * reader serves (`getPublishedArticle`, `listReaderArticles`): a removal in
 * some other room must not change what this paper's front page does.
 *
 * A read that fails is not a 410. The public surface's rule everywhere else
 * (see `public.ts`) is that a database hiccup must not take a page down, and
 * guessing "removed" on an error would tell a reader a story is gone when it
 * is only unreachable -- so the failure falls through to the ordinary render.
 */
export async function isLegallyRemovedSlug(slug: string): Promise<boolean> {
  try {
    const sql = await getSql();
    const rows = await sql`
      select 1 from legal_removal_slugs
      where newsroom_id = ${DEFAULT_NEWSROOM_ID} and slug_hash = md5(${slug})
      limit 1
    `;
    return rows.length > 0;
  } catch (err) {
    console.error("[paper] isLegallyRemovedSlug failed", err);
    return false;
  }
}

/**
 * The same question, asked by the BROWSER.
 *
 * The 410 above is an answer about a URL, and it only exists when a request is
 * made for one. A reader who is already inside the app never makes that
 * request: the route's loader runs in the browser, there is no HTTP response to
 * re-status, and the page is whatever React renders. Before this, that reader
 * got the router's ordinary "not in this edition" panel -- the answer a
 * mistyped address gets -- and, worse, kept the removed story's own share-card
 * head (`og:title`, `og:description`, `article:published_time`, `twitter:*`)
 * because a loader that throws leaves the previous match's data in place for
 * the route's `head` to read. A removal the desk confirmed has to be true on
 * that path too: the removal words, none of the story, and `noindex`.
 *
 * A `createServerFn` because the loader is client code and `isLegallyRemovedSlug`
 * reaches the database: the read has to happen on the server, at the reader's
 * own request, exactly as `getPublishedArticle` does. `publicSlug` is the same
 * bound `public.ts` puts on that read -- and the loader calls it second, after
 * `getPublishedArticle` has already validated the same slug, so nothing new can
 * be rejected here.
 */
export const isLegallyRemovedForReader = createServerFn({ method: "GET" })
  .validator((slug: string) => publicSlug.parse(slug))
  .handler(async ({ data: slug }) => isLegallyRemovedSlug(slug));

export const LEGAL_GONE_TITLE = "This story was removed.";

/**
 * The sentence under the heading, in one place because it is said in two: the
 * hand-written 410 page below, and the panel the in-app path renders. They are
 * the same words on purpose -- a reader should not be able to tell which door
 * they came through -- and a test asserts this string is in the 410 page so the
 * two cannot drift apart.
 */
export const LEGAL_GONE_BODY =
  "This page is gone for good. It was removed from the paper, and the record of the story is no longer published here.";

/**
 * The page itself, as one string.
 *
 * Hand-written HTML rather than the React shell, and that is a constraint of
 * the framework, not a preference: SSR here streams, so the status head goes
 * out before the loader has resolved and no component can change it (the same
 * reason `articles.$slug.tsx` uses `notFound()` for its 404). The status and
 * the body have to be decided together, before the first byte -- which in this
 * app means the route's own `server.handlers.GET`, returning a `Response`,
 * exactly as `feed.ts` and `sitemap[.]xml.ts` do.
 *
 * The colours are the Bulletin reader tokens copied by value
 * (`src/reader-astra.css`, light and dark). A stylesheet link cannot be used --
 * the built CSS has a hashed name -- and an unstyled page reads as broken
 * rather than as the paper.
 */
export function legalGonePageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${LEGAL_GONE_TITLE}</title>
<style>
  :root{color-scheme:light dark;--bg:#ffffff;--card:#ffffff;--line:#dfe3ea;--ctl:#c8cfda;--ink:#0e1726;--ink2:#3d4656;--acc:#1f48a8;--acctx:#1f48a8;--onacc:#ffffff}
  @media (prefers-color-scheme:dark){:root{--bg:#0f141c;--card:#1b2330;--line:#2a3442;--ctl:#3a4658;--ink:#e6eaf1;--ink2:#aab4c3;--acc:#3a66d4;--acctx:#8fadff;--onacc:#ffffff}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:400 16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  main{max-width:640px;margin:0 auto;padding:80px clamp(16px,3.75vw,48px) 96px;display:flex;flex-direction:column;gap:14px;align-items:flex-start}
  .kicker{font-size:14px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--acctx)}
  h1{margin:0;font-size:clamp(30px,3.6vw,44px);font-weight:800;letter-spacing:-.02em;line-height:1.05}
  p{margin:0;font-size:19px;color:var(--ink2);line-height:1.5}
  .links{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
  a{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:6px;font-size:15px;font-weight:700;text-decoration:none}
  a.primary{background:var(--acc);color:var(--onacc)}
  a.secondary{border:1px solid var(--ctl);color:var(--ink)}
  a:focus-visible{outline:3px solid var(--acctx);outline-offset:2px}
</style>
</head>
<body>
<main>
<span class="kicker">Archive</span>
<h1>${LEGAL_GONE_TITLE}</h1>
<p>${LEGAL_GONE_BODY}</p>
<nav class="links">
<a class="primary" href="/">Back to the paper</a>
<a class="secondary" href="/corrections">Corrections log</a>
</nav>
</main>
</body>
</html>
`;
}

/** The 410 itself: the page above, with the status on the wire. */
export function legalGoneResponse(): Response {
  return new Response(legalGonePageHtml(), {
    status: 410,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Same reason as the feed: a removed story must not sit in a cache and
      // keep answering after the case is over (or before it is).
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
