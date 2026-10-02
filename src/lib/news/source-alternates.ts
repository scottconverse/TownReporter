/**
 * Reading a site's own signposts (unit SH0-5).
 *
 * WHAT THIS IS. When the desk cannot read a page an editor is watching, the
 * page itself usually still says where its content lives: a `<link
 * rel="alternate" type="application/rss+xml">` in the head, a `<link
 * rel="canonical">`, a `Sitemap:` line in `robots.txt`, a sitemap full of
 * `/agenda` and `/minutes`. This module is the PURE half of reading those --
 * strings in, strings out, no network, no database, no model -- so the rules
 * can be pinned with fixtures before anything is ever fetched.
 *
 * WHY IT EXISTS AT ALL, given `ingest.ts` already reads a feed pointer.
 * `ingest.ts` reads one, with a regex that requires `rel=` to come before
 * `type=` AND `type=` before `href=`:
 *
 *     /rel=["']alternate["'][^>]*type=["']application\/(rss|atom)\+xml["'][^>]*href=["']([^"']+)/i
 *
 * `<link type="application/rss+xml" rel="alternate" href="…">` is the same
 * declaration in a different order, and every site that writes it that way is
 * invisible to the desk. This module parses the TAG instead of the character
 * sequence, so the order cannot matter -- which is the mutation this unit's
 * test is built to catch.
 *
 * READING `robots.txt` HERE IS NOT OBEDIENCE. The owner's decision (addendum
 * item 2) is that the reader never consults robots.txt to decide what it may
 * fetch. It is read for ONE thing -- the `Sitemap:` lines a publisher puts
 * there on purpose, to be found -- and nothing in this file can refuse a fetch.
 *
 * NO PLACE NAMES, NO PAPER SETTINGS. Nothing here knows what town this is.
 * The caller supplies the host; `probePlanFor` returns step NAMES, never URLs,
 * so the caller keeps the rule that a probe never leaves a watched host.
 */

/** One step of a probe, in the order it is taken. Names, not URLs: the caller
 *  resolves them against the host it already watches. */
export type ProbeStep = "site-root" | "robots";

/** The paths a civic site files its public record under, from `discoverDocLinks`
 *  (`ingest.ts`). Kept here rather than imported because `ingest.ts` is not
 *  loadable by a plain `node --test`, and pinned against it by
 *  `source-alternates.test.ts` so the two cannot quietly drift apart. */
export const DOC_PATH_WORDS = [
  "agenda",
  "minutes",
  "packet",
  "staff report",
  "ordinance",
  "resolution",
  "budget",
  "attachment",
] as const;

const DOC_PATH =
  /\.pdf(?:$|[?#])|agenda|minutes|packet|staff.?report|ordinance|resolution|budget|attachment/i;

/** How many `Sitemap:` lines are worth following: the first three, and no
 *  more. A robots.txt listing forty sitemaps is a site that does not want to
 *  be walked, and this is a repair job, not a crawl. */
export const SITEMAP_CAP = 3;

/** How many child sitemaps are taken out of a sitemap INDEX. Same reasoning:
 *  an index with two hundred children is not a signpost, it is a directory. */
export const SITEMAP_CHILD_CAP = 3;

/** How many document links one sitemap may contribute. */
export const SITEMAP_LOC_CAP = 10;

/** The whole plan for one press, however many steps it names: the owner's
 *  bound is three requests and none of the plans here reaches it. */
export const PROBE_MAX_STEPS = 3;

/** A `<link>` tag's attributes, lower-cased. */
type LinkAttrs = Record<string, string>;

/**
 * Every `<link …>` in a document, as attribute maps.
 *
 * WHY TAG-FIRST AND NOT REGEX-FIRST. The bug this whole unit grew from is a
 * regex that assumed an attribute ORDER. Parsing the tag and then asking about
 * its attributes makes order, spacing and quoting all irrelevant -- the three
 * things that actually vary between one CMS and the next.
 *
 * Comments are stripped first, because a commented-out `<link rel="alternate">`
 * is not a declaration a reader can use, and a `>` inside an attribute value
 * ends a tag only in a parser that does not know about quotes.
 */
function linkTags(html: string): LinkAttrs[] {
  const out: LinkAttrs[] = [];
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, "");
  const tag = /<link\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(cleaned))) {
    const attrs: LinkAttrs = {};
    const attr =
      /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
    let a: RegExpExecArray | null;
    while ((a = attr.exec(m[1]!))) {
      attrs[a[1]!.toLowerCase()] = (a[2] ?? a[3] ?? a[4] ?? "").trim();
    }
    out.push(attrs);
  }
  return out;
}

/** Does this `rel` list contain the token? `rel="alternate home"` is a real
 *  spelling and the token is what the spec matches on, not the whole string. */
function hasRel(attrs: LinkAttrs, token: string): boolean {
  return (attrs.rel ?? "")
    .toLowerCase()
    .split(/\s+/)
    .includes(token);
}

function absolute(href: string | undefined, base: URL): string | null {
  const raw = (href ?? "").trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("data:")) return null;
  try {
    const url = new URL(raw, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function asBase(base: URL | string): URL {
  return typeof base === "string" ? new URL(base) : base;
}

/**
 * The site's own news list, if the page declares one.
 *
 * Both feed XML types count (`application/rss+xml`, `application/atom+xml`),
 * in either attribute order, with either quoting style, and the `href` may be
 * relative -- it is resolved against the page it was found on.
 */
export function feedFromHtml(html: string, base: URL | string): string | null {
  const b = asBase(base);
  for (const attrs of linkTags(html)) {
    if (!hasRel(attrs, "alternate")) continue;
    if (!/^application\/(rss|atom)\+xml/i.test(attrs.type ?? "")) continue;
    const href = absolute(attrs.href, b);
    if (href) return href;
  }
  return null;
}

/**
 * The page's canonical address, if it declares one.
 *
 * This is the one signpost that says "you are reading the wrong URL", which is
 * exactly what a soft 404 or a moved section looks like from outside.
 */
export function canonicalFromHtml(html: string, base: URL | string): string | null {
  const b = asBase(base);
  for (const attrs of linkTags(html)) {
    if (!hasRel(attrs, "canonical")) continue;
    const href = absolute(attrs.href, b);
    if (href) return href;
  }
  return null;
}

/**
 * The `Sitemap:` lines a robots.txt offers, in the order it lists them.
 *
 * Only lines that start with the directive count -- a `#` comment mentioning a
 * sitemap is not a declaration -- and only absolute http(s) addresses, because
 * a relative one in robots.txt names nothing a reader could fetch. Duplicates
 * are dropped and the list is capped at `SITEMAP_CAP`.
 */
export function sitemapsFromRobots(text: string, cap = SITEMAP_CAP): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(raw);
    if (!m) continue;
    const url = m[1]!;
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= cap) break;
  }
  return out;
}

/** Does this address look like a public document rather than another page? */
export function looksLikeDocumentPath(url: string): boolean {
  try {
    const u = new URL(url);
    return DOC_PATH.test(u.pathname + u.search);
  } catch {
    return false;
  }
}

export type SitemapLocs = {
  /** A sitemap INDEX names other sitemaps; a URLSET names pages. The two are
   *  read differently and the caller has to know which it is holding. */
  kind: "index" | "urlset";
  locs: string[];
};

/**
 * The `<loc>` entries of a sitemap, read by kind.
 *
 * AN INDEX YIELDS ITS CHILDREN, capped at `SITEMAP_CHILD_CAP`. Following an
 * index to one more level of index is how a "read a sitemap" job becomes a
 * crawl, and this is a repair job.
 *
 * A URLSET IS FILTERED, not merely capped: only addresses that look like
 * documents (`/agenda`, `/minutes`, the `budget` PDF) come back, which is what
 * makes a sitemap useful here at all -- a city's sitemap is mostly press
 * releases and dog-park pages, and the editor wants the record.
 */
export function locsFromSitemap(xml: string, cap = SITEMAP_LOC_CAP): SitemapLocs {
  const text = String(xml ?? "");
  const kind: SitemapLocs["kind"] = /<sitemapindex[\s>]/i.test(text) ? "index" : "urlset";
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi)) {
    const url = m[1]!.trim().replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  if (kind === "index") return { kind, locs: urls.slice(0, SITEMAP_CHILD_CAP) };
  return { kind, locs: urls.filter(looksLikeDocumentPath).slice(0, cap) };
}

/**
 * WHAT ONE EDITOR PRESS SHOULD TRY, given why the source reads as failing.
 *
 * The table is the owner-facing promise of this feature: the desk never
 * re-fetches the page that just refused it, and it never leaves the host it
 * already watches. Every plan below is therefore either empty or aimed at
 * signposts (`site-root`, `robots.txt`) -- never at the failing address.
 *
 *   - DNS failure and timeout: EMPTY. The address itself did not answer, so
 *     there is nothing to read and nothing worth retrying now. The editor is
 *     told that, which is a real answer.
 *   - Too many redirects: the site root alone. The address is a loop; the
 *     house number still exists.
 *   - Blocked (401/403/429, a bot wall, a challenge page): site root, then
 *     robots.txt. Both are the two requests a blocked site most often answers
 *     -- and both are cheap, static and cacheable, so this is also the polite
 *     order.
 *   - Gone (404/410, a soft 404, a page with no readable text) ONLY when the
 *     source has read successfully before: the same two steps, because a page
 *     that used to work has moved rather than vanished. With no prior success
 *     the address was simply wrong, and the plan is empty rather than hopeful.
 */
export function probePlanFor(
  lastError: string | null | undefined,
  hasPriorSuccess: boolean,
): ProbeStep[] {
  const raw = String(lastError ?? "").trim();
  if (!raw) return [];
  // The address never answered, or answered too slowly to be a signpost
  // problem. Nothing here can help and nothing is fetched.
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|could not be resolved|name lookup|DNS|timed?\s*out|ETIMEDOUT/i.test(raw))
    return [];
  if (/too many redirects|redirect loop/i.test(raw)) return ["site-root"];
  if (
    /401|403|429|forbidden|unauthor|rate.?limit|slow\s*down|bot wall|bot-wall|captcha|cdn-cgi|challenge/i.test(
      raw,
    )
  )
    return ["site-root", "robots"];
  if (/404|410|not found|had almost no readable text|almost no readable text/i.test(raw))
    return hasPriorSuccess ? ["site-root", "robots"] : [];
  return [];
}
