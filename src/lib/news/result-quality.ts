/**
 * What a search result or a captured page has to be before the desk may use it.
 *
 * Unit U25, B2 and B3. Both defects in the stand-in walkthrough of 2026-09-30
 * were the desk treating "something came back" as "something relevant came
 * back":
 *
 *   B2 -- the adversarial verifier recorded the FIRST raw hit of a query as the
 *   source that answered it (`dark-verify.ts`, `hits[0]?.url`), and for four of
 *   the good Kid City USA queries that was `https://www.youtubekids.com/`.
 *   Bing matched "kid" and returned an app landing page; nothing downstream
 *   asked whether a landing page could answer a question about a daycare.
 *
 *   B3 -- the handoff carried `leads.source_urls` from `artifacts` with no
 *   predicate at all beyond `order by id desc limit 12` (`dark.ts`, both
 *   handoff writers). The file's last twelve captures were a movie-ordering
 *   listicle, four courier-services sites, three phone-water-damage blogs,
 *   `unicode.org` and an Outlook sign-in page -- and those became the drafted
 *   story's "Sources on the lead", with the one real source (the r/Longmont
 *   thread) absent from the list.
 *
 * The reasons are named and returned, rather than collapsed into a boolean, so
 * a run file, a lead or a test can say WHICH rule refused a page. Nothing here
 * needs a database or a network: it judges a URL and a title.
 */

import { queryTokens } from "./retrieve.ts";

/**
 * Hosts whose pages are a word's definition rather than a record about the
 * question. A query that names a word ("under", "after", "kid") will always
 * match these, and their content never answers a civic question.
 */
const DICTIONARY_HOSTS = [
  "merriam-webster.com",
  "dictionary.com",
  "dictionary.cambridge.org",
  "thesaurus.com",
  "collinsdictionary.com",
  "oxfordlearnersdictionaries.com",
  "vocabulary.com",
  "yourdictionary.com",
  "wordreference.com",
  "wiktionary.org",
  "englishfortheplanet.com",
];

/**
 * Landing pages for an app or a store listing. `youtubekids.com` is the one
 * measured: it was the single source recorded for four good queries because
 * the query contained the word "Kid".
 *
 * `youtube.com` is deliberately NOT on this list. The desk treats a captured
 * meeting video as a full record of how people talked in the room (see
 * DARK_SYSTEM), and blanket-refusing the host would throw away the meeting
 * recordings the desk is built to read. `youtubekids.com` is a different site
 * with a different job: it is the landing page for a children's app.
 */
const APP_LANDING_HOSTS = ["youtubekids.com", "play.google.com", "apps.apple.com"];

/**
 * A search engine's own pages. An engine answering with itself is not an
 * answer, and `support.google.com/youtube` -- which came back as the top hit
 * for `"SITION" RFP Longmont` -- is a help centre, not a record.
 */
const SEARCH_ENGINE_HOSTS = [
  "bing.com",
  "duckduckgo.com",
  "search.brave.com",
  "support.google.com",
  "baidu.com",
  "yandex.com",
];

/**
 * A consent wall, a captcha or a redirect interstitial is not the article.
 *
 * M2 of the batch-6 pre-merge audit: the trailing `\b` matched a segment that
 * merely STARTS with one of these words, so `/city-council/consent-agenda` --
 * a real council agenda -- was refused as a consent page. The segment has to BE
 * the interstitial, not begin with it: the word, then the end of the path or a
 * query string. `/cityclerk/consent/2024.pdf` is a document filed under a
 * directory named `consent`, and it survives for the same reason.
 */
const INTERSTITIAL_PATH = /\/(?:consent|cookie|cookies|sorry|redirect|captcha|login|signin|sign-in)\/?$/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Google is the one host that is both a search engine and a document store.
 *
 * M2 of the batch-6 pre-merge audit: `google.com` sat in `SEARCH_ENGINE_HOSTS`,
 * and `onList` matches a host that ends with `.google.com` -- so Docs, Drive,
 * Sites and News, which the desk reads on purpose (a council packet shared from
 * Drive is a record), were all refused as "another search engine's own page".
 * The search surface is the bare host, or `/search`; nothing else on the domain
 * is the engine answering with itself.
 */
function isGoogleSearchSurface(host: string, pathname: string): boolean {
  if (host !== "google.com") return false;
  const path = pathname.replace(/\/+$/, "");
  return path === "" || path === "/search" || path.startsWith("/search/");
}


const onList = (host: string, list: readonly string[]) =>
  list.some((entry) => host === entry || host.endsWith(`.${entry}`));

/**
 * Why this page may not be used as a source, or `null` if it may.
 *
 * Only shapes a reader would agree are not the article: a dictionary entry, an
 * app landing page, a search engine's own page, a consent/redirect wall. It
 * deliberately does NOT decide whether a real page is on the question -- that
 * is `leadSourceRefusalReason` below, which needs the lead's own words.
 */
export function boilerplatePageReason(url: string): string | null {
  const host = hostOf(url);
  if (!host) return "the address could not be read";
  const pathname = new URL(url, "https://x/").pathname;
  if (onList(host, DICTIONARY_HOSTS)) return "a dictionary entry, not a record";
  if (onList(host, APP_LANDING_HOSTS)) return "an app or video landing page, not a record";
  if (onList(host, SEARCH_ENGINE_HOSTS) || isGoogleSearchSurface(host, pathname))
    return "another search engine's own page";
  if (INTERSTITIAL_PATH.test(pathname)) return "a consent, sign-in or redirect page, not the article";
  return null;
}

export type CapturedPage = {
  url: string;
  title?: string | null;
  /** `artifacts.fetch_status`: the HTTP status the capture got. */
  fetchStatus?: number | null;
  /** `artifacts.fetch_outcome`: `classifyFetchedPage`'s answer for that capture. */
  fetchOutcome?: string | null;
  /** The captured text, when the caller has it. */
  text?: string | null;
};

/**
 * Outcomes that mean the desk got the article. Everything else -- a 403, a
 * 404, a soft-404, a nav-only page that extracted to nothing -- is a capture
 * that failed, and `desk.dark.tsx` already prints it as "Capture failed (200)
 * — not the article" for the `parse-failed` case.
 */
const USABLE_OUTCOMES = new Set(["fetched", "unchanged", "changed"]);

/**
 * How much of a captured page the relevance test reads.
 *
 * Unit B7R, item 2. The test looked at the title, the host and the address
 * only, so a real record behind an opaque address was refused for saying
 * nothing about the lead: a council packet titled "Agenda Packet" at
 * `longmontcolorado.gov/sites/default/files/packet.pdf` shares no term with
 * the lead in any of those three, and its own captured text names the lead in
 * the first line. The capture the desk already made is the evidence, and this
 * is how much of it counts -- bounded because a dictionary or courier page is
 * long and its body would otherwise drown the test in incidental words.
 */
const RELEVANCE_SAMPLE = 20_000;

/**
 * Why this captured page may not be listed as a source on a lead or a draft,
 * or `null` if it may.
 *
 * `leadWords` is the lead's own language -- its headline, and the entities and
 * places on its file. A page that shares no meaningful term with it is not a
 * source of anything the lead says; it is a page some query happened to reach.
 * That is the whole of the measured defect: the courier, dictionary and
 * water-damage pages share no term with "Kid City USA daycare closing on one
 * week's notice", and the r/Longmont thread shares several.
 */
export function leadSourceRefusalReason(page: CapturedPage, leadWords: string): string | null {
  const boilerplate = boilerplatePageReason(page.url);
  if (boilerplate) return boilerplate;
  const outcome = (page.fetchOutcome ?? "").trim().toLowerCase();
  if (outcome && !USABLE_OUTCOMES.has(outcome)) return "the capture did not get the article";
  if (!outcome && page.fetchStatus != null && (page.fetchStatus < 200 || page.fetchStatus >= 300))
    return "the capture did not get the article";
  if (page.text != null && page.text.trim().length === 0 && outcome === "fetched")
    return "the capture has no readable text";
  const lead = new Set(queryTokens(leadWords));
  if (!lead.size) return null;
  const page_ = new Set(
    queryTokens(
      `${page.title ?? ""} ${hostOf(page.url)} ${page.url} ${(page.text ?? "").slice(0, RELEVANCE_SAMPLE)}`,
    ),
  );
  for (const token of lead) if (page_.has(token)) return null;
  return "nothing in this page is about the lead";
}

/** The pages that survive both judges, in the order they were given. */
export function usableLeadSources<T extends CapturedPage>(pages: readonly T[], leadWords: string): T[] {
  return pages.filter((page) => leadSourceRefusalReason(page, leadWords) === null);
}

/**
 * Why a page may not come BACK to the desk as new material, or `null` if it may.
 *
 * Unit U25, C1. After the dig, the Dark Desk's front page listed "Courier
 * Delivery Service", "Dark Desk encountered this again while reviewing a
 * Jetdelivery page", "…a Californiacourierservices page", "…a Englishfortheplanet
 * page" and "…a Dictionary page", every one of them badged "New material.
 * Nobody has opened it yet."
 *
 * None was new. The mechanism was `persistDiscovery`'s reopen path: a frontier
 * item the desk had already fetched and marked `resolved` was re-discovered
 * later in the same run, the re-discovery arrived carrying the page's own URL
 * as its "evidence", and `newEvidence` -- which only asked whether the string
 * was ≥8 characters and not already present -- said yes. A page coming round
 * again is not a finding about the page.
 *
 * Two things are refused: an item whose "evidence" is nothing but an address,
 * and a page whose host is boilerplate to begin with (see
 * `boilerplatePageReason`). Both are named, so the desk can say which rule
 * kept an item parked instead of silently dropping it.
 */
export function resurfaceRefusalReason(input: {
  url?: string | null;
  /** The text offered as the new evidence, or the item's own `why` note. */
  evidence?: string | null;
}): string | null {
  const url = (input.url ?? "").trim();
  const evidence = (input.evidence ?? "").trim();
  const address = [url, evidence].find((value) => /^https?:\/\//i.test(value));
  if (address) {
    const boilerplate = boilerplatePageReason(address);
    if (boilerplate) return boilerplate;
  }
  /*
    An address offered as evidence says the page exists, which the desk already
    knew -- it fetched it. `why` text and page titles are evidence; a URL is a
    location.
  */
  if (evidence && /^https?:\/\//i.test(evidence)) return "the new evidence is the page's own address";
  return null;
}
