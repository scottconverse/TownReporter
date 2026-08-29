/**
 * Reading a subreddit as a tip line.
 *
 * A local subreddit is the closest thing a town has to a scanner feed: people
 * post the road closure, the water bill, the notice taped to the door, days
 * before any of it reaches a public record. It is a source of *questions*, not
 * of facts — nothing here is ever a citation, only a reason to go look.
 *
 * Access is the awkward part. Reddit blocks almost every automated path: search
 * engines carry little of it, reader proxies are blocked, and the `.json` API
 * refuses anonymous clients. The `.rss` feeds still answer a browser-like
 * request, and that is the whole technique. It survives only if it is used
 * gently — see `reddit.server.ts` for the pacing.
 *
 * This module is the pure half: URLs, parsing, and deciding what is civic.
 */

export type RedditPost = {
  title: string;
  url: string;
  /** ISO timestamp from the feed, or "" when the feed omitted it. */
  updated: string;
  author: string;
  /** Feed excerpt with markup removed. Reddit truncates these to ~400 chars. */
  excerpt: string;
};

/** `https://www.reddit.com/r/longmont/new/.rss` */
export function subredditNewFeed(sub: string): string {
  return `https://www.reddit.com/r/${encodeURIComponent(sub)}/new/.rss`;
}

/** Search within one subreddit, newest first. */
export function subredditSearchFeed(sub: string, query: string, sort: "new" | "relevance" = "new"): string {
  const q = encodeURIComponent(query);
  return (
    `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.rss` +
    `?q=${q}&restrict_sr=on&sort=${sort}`
  );
}

/** The comments of one thread, as a feed. The substance is usually here. */
export function threadFeed(permalink: string): string {
  const clean = permalink.split("?")[0]!.replace(/\/+$/, "");
  return `${clean}/.rss`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Ampersand last, so a single pass cannot resurrect an entity.
    .replace(/&amp;/g, "&");
}

/**
 * Decode first, then strip.
 *
 * Reddit escapes the HTML inside `<content>`, so the markup arrives as
 * `&lt;div&gt;` rather than `<div>`. Stripping before decoding therefore finds
 * no tags at all, and the decode step then turns the escaped ones back into
 * real angle brackets — the excerpt reached the desk with `<div>` still in it.
 */
function stripTags(s: string): string {
  return decodeEntities(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tagText(block: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  if (!m) return "";
  const inner = m[1]!.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
  return stripTags(inner);
}

/**
 * Parse Reddit's Atom feed.
 *
 * Hand-written rather than run through an XML parser on purpose: Reddit puts
 * unescaped HTML inside `<content>`, which strict parsers either reject or
 * hand back as an element rather than a string. This only has to find five
 * fields, and it degrades to skipping an entry rather than failing the feed.
 */
export function parseRedditFeed(xml: string): RedditPost[] {
  const out: RedditPost[] = [];
  const seen = new Set<string>();
  for (const m of String(xml).matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const block = m[1]!;
    const href = /<link[^>]*\bhref="([^"]+)"/i.exec(block)?.[1] ?? "";
    const url = decodeEntities(href).trim();
    if (!/^https?:\/\/(www\.|old\.)?reddit\.com\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      title: tagText(block, "title"),
      url,
      updated: (/<updated>([^<]+)<\/updated>/i.exec(block)?.[1] ?? "").trim(),
      author: tagText(block, "name"),
      excerpt: tagText(block, "content").slice(0, 600),
    });
    if (out.length >= 40) break;
  }
  return out;
}

/**
 * What marks a post as a matter of public record rather than conversation.
 *
 * Patterns, not plain words, because word endings are where this went wrong
 * the first time: the list held "closure" and the real post said "will close",
 * so a road-closure story this paper had already published scored 3 out of 20
 * and would have been filtered out by its own threshold. Calibrated against a
 * real day of the subreddit, kept as a fixture beside the tests.
 */
const STRONG: RegExp[] = [
  /\b(city )?council\b/,
  /\bplanning commission\b/,
  /\bre?zon(e|ed|ing)\b/,
  /\bvariance\b/,
  /\bordinance\b/,
  /\bresolution\b/,
  /\bballot\b|\belection\b|\bvote[ds]?\b/,
  /\bbudget\b|\blevy\b|\bbond\b|\bmill levy\b/,
  /\btax(es|ed|ation)?\b|\bfee\b|\bsurcharge\b/,
  /\bpermit(s|ted|ting)?\b/,
  /\bcode enforcement\b|\bviolation\b|\bcitation\b|\bfine[ds]?\b/,
  /\bevict(ion|ed)\b|\blandlord\b|\brent (went up|increase|hike)\b/,
  /\bannex(ation|ed)\b/,
  /\bpublic hearing\b|\bagenda\b|\bminutes\b/,
  /\bopen records\b|\bcora\b|\bfoia\b/,
  /\blawsuit\b|\bsettlement\b|\baudit\b|\bsubpoena\b/,
  /\bcontract\b|\brfp\b|\bbid\b|\bprocurement\b/,
  /\bcity manager\b|\bmayor\b|\bcity attorney\b/,
  /\bpolice report\b|\barrest(ed)?\b|\bcharged with\b/,
  /\butility\b|\bwater rate\b|\belectric rate\b|\bnextlight\b/,
  /\brtd\b|\bcdot\b|\bschool board\b|\bsvvsd\b/,
  /\bhousing authority\b|\burban renewal\b|\bmoratorium\b/,
  /\bboil order\b|\boutage\b|\bspill\b|\brecall\b/,
  // Roads: the closure vocabulary in every tense, plus highway designations.
  /\bclos(e|es|ed|ing|ure|ures)\b/,
  /\bdetour(s|ed)?\b/,
  /\bconstruct(ion|ing)\b/,
  /\b(co|us|sh)[ -]?\d{1,3}\b/,
  /\bleft turns?\b|\blane closure\b|\broad work\b/,
];

const WEAK: RegExp[] = [
  /\blongmont\b/, /\bboulder county\b/, /\bcity\b/, /\bcounty\b/, /\bstate\b/,
  /\bpublic\b/, /\bmeeting\b/, /\broad\b/, /\bstreet\b/, /\btraffic\b/,
  /\bwater\b/, /\bsewer\b/, /\bpower\b/, /\bschool\b/, /\blibrary\b/,
  /\bpark\b/, /\btransit\b/, /\bbus\b/, /\brent\b/, /\bneighborhood\b/,
  /\bfire\b/, /\bpolice\b/, /\bnotice\b/,
];

/**
 * Conversation, not record.
 *
 * Penalised rather than excluded: "my rent went up $300 and the notice says
 * it's a utility recovery fee" is somebody asking for advice AND a housing
 * story, and a hard exclusion would lose it.
 */
const CHATTER: RegExp[] = [
  /\brecommendation(s)?\b|\brecommend\b/,
  /\bbest place\b|\bbest .{0,20}\b(in|around) longmont\b/,
  /\bwhere can i\b|\banyone know a good\b|\blooking for a\b/,
  /\bmoving to\b|\bapartment advice\b/,
  /\brestaurant\b|\bcoffee\b|\bpizza\b|\bappetizer\b|\bbrunch\b/,
  /\bdentist\b|\bhaircut\b|\bgym\b|\bplumber\b|\bmechanic\b/,
  /\bdog park\b|\bhiking\b|\bweather\b|\beclipse\b|\bmoon\b/,
  /\blost (cat|dog)\b|\bfor sale\b|\bshoutout\b/,
  /\bopen discussion\b|\brant,? and rave\b|\bweekly .{0,12}thread\b/,
];

function countMatches(hay: string, patterns: RegExp[]): number {
  let n = 0;
  for (const re of patterns) if (re.test(hay)) n += 1;
  return n;
}

/**
 * How much this post looks like something with a record behind it.
 *
 * Returns 0–20. On a real day of r/longmont the civic posts land at 7+ and the
 * small talk at 0–2, which is where the threshold sits. The number is carried
 * through to the editor rather than collapsed into a boolean, so a thin result
 * is explainable instead of mysterious.
 */
export function civicScore(post: Pick<RedditPost, "title" | "excerpt">): number {
  const hay = `${post.title} ${post.excerpt}`.toLowerCase();
  if (!hay.trim()) return 0;
  const strong = countMatches(hay, STRONG);
  const weak = countMatches(hay, WEAK);
  const chatter = countMatches(hay, CHATTER);
  // A date, a dollar figure or a file number is the shape of a record.
  const specifics =
    (/\$\s?[\d,]{3,}/.test(hay) ? 2 : 0) +
    (/\b(ordinance|resolution|case|permit|file|measure)\s*(no\.?|#)?\s*[\w-]*\d/.test(hay) ? 3 : 0) +
    (/\b\d{1,2}-\d{1,2}\b/.test(hay) ? 1 : 0);
  const score = strong * 3 + weak + specifics - chatter * 3;
  return Math.max(0, Math.min(20, score));
}

/** Posts worth an editor's attention, best first. */
export function pickCivicPosts(posts: RedditPost[], minScore = 6, limit = 8): RedditPost[] {
  return posts
    .map((p) => ({ p, s: civicScore(p) }))
    .filter((x) => x.s >= minScore)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.p);
}

export type RedditAnomaly = {
  kind: string;
  summary: string;
  url: string;
  details: string;
};

/**
 * A post, written up the way the desk stores everything else it noticed.
 *
 * The wording matters more than it looks. Anything filed here becomes a card
 * an editor may act on, so it has to read as a claim someone made on the
 * internet — never as something the paper knows.
 */
export function redditAnomaly(post: RedditPost, sub: string): RedditAnomaly {
  const when = post.updated ? post.updated.slice(0, 10) : "undated";
  return {
    kind: "reddit-tip",
    summary: `r/${sub}: ${post.title}`.slice(0, 300),
    url: post.url,
    details: [
      `Posted ${when}${post.author ? ` by ${post.author}` : ""} on r/${sub}.`,
      "UNVERIFIED — a resident's account, not a record. Find the document before writing anything.",
      post.excerpt ? `They wrote: ${post.excerpt}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 2000),
  };
}
