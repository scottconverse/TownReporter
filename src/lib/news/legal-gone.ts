import { getSql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";

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

export const LEGAL_GONE_TITLE = "This story was removed.";

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
 * The colours are the reader shell's own tokens copied by value
 * (`src/reader-astra.css`: --bg #fffdf7, --ink #111111, --a #ffd23f, --line
 * #d8d3c4). A stylesheet link cannot be used -- the built CSS has a hashed
 * name -- and an unstyled white page reads as broken rather than as the paper.
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
  body{margin:0;background:#fffdf7;color:#111111;font:400 17px/1.65 Georgia,serif}
  main{max-width:34rem;margin:0 auto;padding:12vh 1.5rem 6rem}
  h1{font-size:1.75rem;line-height:1.2;margin:0 0 .75rem}
  p{margin:0 0 1.25rem}
  a{color:#111111;font-weight:700}
  hr{border:0;border-top:1px solid #d8d3c4;margin:2rem 0}
  .links{display:flex;flex-wrap:wrap;gap:1.5rem}
</style>
</head>
<body>
<main>
<h1>${LEGAL_GONE_TITLE}</h1>
<p>This page is gone for good. It was removed from the paper, and the record of the story is no longer published here.</p>
<hr>
<nav class="links">
<a href="/">Back to the paper</a>
<a href="/corrections">Corrections log</a>
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
