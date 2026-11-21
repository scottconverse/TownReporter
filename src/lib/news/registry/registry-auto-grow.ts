/**
 * The rules that let the community registry grow by itself (Scott, Nov 20 2026:
 * "It searches regularly, it follows links and adds things and becomes larger
 * and richer ... automatically.").
 *
 * This file is pure: no database, no fetches, no logging. It holds the numbers
 * and the decisions the scan and the daily planner share, so the tests can pin
 * them without a model or a page:
 *
 *  - how often a registry source is re-read even when its page did not change;
 *  - which links on a directory page are worth following into the registry;
 *  - how many new sources one day may add, and how large the registry may grow.
 *
 * The write side is `link-following.server.ts`. Keeping the choice here is what
 * makes "no search results, no redirectors, no social media" testable.
 */

import { kindFromSourceUrl } from "../desk-copy.ts";
import { assertHttpUrl, isSearchResultUrl, sourceIdentity } from "../url-guard.ts";

/** A registry source is re-read at least this often, changed or not. */
export const REGISTRY_REREAD_INTERVAL_MS = 7 * 86_400_000;

/** New sources one day may add by following directory links. */
export const MAX_LINKED_SOURCES_PER_DAY = 25;

/** The most registry sources one newsroom may hold. */
export const MAX_REGISTRY_SOURCES_TOTAL = 2000;

/**
 * True when a registry source is due for its weekly re-read: it has never been
 * read, or its last successful read is at least seven days old.
 *
 * `last_ok_at` is the only honest "we actually read it" fact: `last_fetched_at`
 * also moves on a failure. A non-date (a driver returning an unexpected shape)
 * counts as never read rather than as fresh, because the cost of one extra read
 * is smaller than a source that quietly goes unread forever.
 */
export function registryRereadDue(
  lastOkAt: string | Date | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (lastOkAt == null) return true;
  const at = lastOkAt instanceof Date ? lastOkAt.getTime() : Date.parse(lastOkAt);
  if (!Number.isFinite(at)) return true;
  return nowMs - at >= REGISTRY_REREAD_INTERVAL_MS;
}

/** The host of a URL, lower case and without a leading `www.`, or "". */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Same site: one host is the other, or a subdomain of it. */
export function sameSite(a: string, b: string): boolean {
  const hostA = hostOf(a);
  const hostB = hostOf(b);
  if (!hostA || !hostB) return false;
  return (
    hostA === hostB || hostA.endsWith(`.${hostB}`) || hostB.endsWith(`.${hostA}`)
  );
}

/**
 * A domain that is an official record or a public-service body.
 *
 * The order is "same-site or official domains". The official side is the
 * government, education, military and nonprofit public-service namespace --
 * `.gov`, `.us` (state/locality), `.edu`, `.mil` and `.org`. A directory page
 * linking to a nonprofit's own `.org` page is exactly the growth this feature
 * exists for; a link to somebody's blog or a shop is not.
 */
const OFFICIAL_TLDS = new Set(["gov", "us", "edu", "mil", "org"]);

export function isOfficialDomain(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  const tld = host.split(".").pop() ?? "";
  if (OFFICIAL_TLDS.has(tld)) return true;
  // The `.us` locality shape (`ci.longmont.co.us`) is covered by the tld check;
  // the explicit government kind covers any host the app already treats as an
  // official record (for example a PrimeGov portal on a .com domain).
  return kindFromSourceUrl(url) === "official";
}

/** Hosts whose only job is to bounce a reader somewhere else. Never a source. */
const REDIRECTOR_HOSTS = new Set([
  "bit.ly",
  "buff.ly",
  "goo.gl",
  "is.gd",
  "lnkd.in",
  "ow.ly",
  "rebrand.ly",
  "shorturl.at",
  "t.co",
  "tiny.cc",
  "tinyurl.com",
  "tr.im",
]);

/** A redirector by host, or by the path/query shape a bounce link uses. */
export function isRedirectorUrl(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (
    REDIRECTOR_HOSTS.has(host) ||
    [...REDIRECTOR_HOSTS].some((short) => host.endsWith(`.${short}`))
  ) {
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const path = parsed.pathname.toLowerCase();
  if (/^\/(redirect|redir|out|outbound|away|link)\b/.test(path)) return true;
  for (const key of ["url", "u", "target", "dest", "destination", "redirect"]) {
    if (parsed.searchParams.has(key)) return true;
  }
  return false;
}

/** Social media is never a registry source. Reuses the app's one social rule. */
export function isSocialUrl(url: string): boolean {
  return kindFromSourceUrl(url) === "social";
}

export type LinkedSourceRole = "organization" | "service";

export interface DirectoryLink {
  url: string;
  title?: string | null;
}

export interface DirectoryPageForLinks {
  /** The directory page the links were read from. */
  pageUrl: string;
  links: readonly DirectoryLink[];
}

export interface LinkSelectionInput {
  pages: readonly DirectoryPageForLinks[];
  /** `sourceIdentity` of every URL this newsroom already has. */
  existingIdentities: ReadonlySet<string>;
  /** How many new sources today's cap still allows. */
  dailyRemaining: number;
  /** How many registry sources the total cap still allows. */
  totalRemaining: number;
}

export interface LinkedSource {
  url: string;
  title: string;
  registryRole: LinkedSourceRole;
}

/**
 * The links on directory pages that become registry sources.
 *
 * A link is kept only when ALL of these hold:
 *  - it is a fetchable public http(s) page;
 *  - it is not a search-results page, a redirector, or social media;
 *  - it is on the directory's own site (role `service`) or on an official
 *    domain (role `organization`);
 *  - it names a page this newsroom does not already have, and no earlier link
 *    in this same pass named it.
 *
 * The two caps bound growth: at most `dailyRemaining` today, and never more than
 * `totalRemaining` in the whole registry. The result is in page order, with the
 * page's own link text as the title (falling back to the host).
 */
export function selectLinkedRegistrySources(input: LinkSelectionInput): LinkedSource[] {
  const out: LinkedSource[] = [];
  const seen = new Set(input.existingIdentities);
  let daily = Math.max(0, Math.floor(input.dailyRemaining));
  let total = Math.max(0, Math.floor(input.totalRemaining));

  for (const page of input.pages) {
    const pageIdentity = sourceIdentity(page.pageUrl);
    for (const link of page.links) {
      if (daily <= 0 || total <= 0) return out;
      const raw = typeof link.url === "string" ? link.url.trim() : "";
      if (!raw) continue;
      let url: string;
      try {
        url = assertHttpUrl(raw).toString();
      } catch {
        continue;
      }
      if (isSearchResultUrl(url)) continue;
      if (isRedirectorUrl(url)) continue;
      if (isSocialUrl(url)) continue;
      const onSite = sameSite(url, page.pageUrl);
      if (!onSite && !isOfficialDomain(url)) continue;
      const identity = sourceIdentity(url);
      if (!identity) continue;
      if (pageIdentity !== null && identity === pageIdentity) continue;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const title = (link.title ?? "").trim().slice(0, 200) || hostOf(url);
      out.push({
        url,
        title,
        registryRole: onSite ? "service" : "organization",
      });
      daily -= 1;
      total -= 1;
    }
  }
  return out;
}
