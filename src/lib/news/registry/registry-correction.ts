/**
 * The text a registry page puts in `/corrections?article=...` (Phase 4, P4-4).
 *
 * `/corrections` keeps at most 2000 characters of `article`, so the text is cut
 * here, in the name part, and the service URL at the end is kept whole: a
 * correction that arrives without its link cannot be traced to the entry.
 */

import { registryEntryHeading } from "./registry-entry-copy.ts";

export const CORRECTION_ARTICLE_MAX = 2000;

export function registryCorrectionArticle(input: {
  id: number;
  organizationName: string;
  serviceName: string;
  /** The full URL of `/registry/<id>`, or its path when the origin is unknown. */
  url: string;
}): string {
  const suffix = ` (${input.url})`;
  const name = registryEntryHeading(input.organizationName, input.serviceName);
  const head = wellFormed(`Community resource ${input.id}: ${name}`);
  if (head.length + suffix.length <= CORRECTION_ARTICLE_MAX) return `${head}${suffix}`;
  const room = CORRECTION_ARTICLE_MAX - suffix.length - 1;
  if (room < 1) return wellFormed(`${head}${suffix}`.slice(0, CORRECTION_ARTICLE_MAX));
  // Cut on a whole character: a cut between the two halves of an emoji leaves a
  // lone surrogate, and encodeURIComponent throws on that.
  let cut = room;
  const last = head.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return `${head.slice(0, cut)}…${suffix}`;
}

/** Text with each lone surrogate half replaced, so it can always be URL-encoded. */
function wellFormed(text: string): string {
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "\uFFFD",
  );
}

export function registryServicePath(id: number): string {
  return `/registry/${id}`;
}

export function registryCorrectionHref(article: string): string {
  return `/corrections?article=${encodeURIComponent(wellFormed(article))}`;
}

/** The most pages the public list and the API will ask the database for. */
export const REGISTRY_MAX_PAGE = 100000;
/** The largest service id the database holds (a 32-bit integer). */
export const REGISTRY_MAX_ID = 2147483647;

function plainText(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return typeof value === "string" ? value.trim() : "";
}

/** A category id from a URL or form: up to 9 digits, at least 1. Anything else is dropped (null). */
export function registryCategoryNumber(value: unknown): number | null {
  const text = plainText(value);
  if (!/^[0-9]{1,9}$/.test(text)) return null;
  const n = Number(text);
  return n > 0 ? n : null;
}

/** A page number: 1 when it is not a whole number, and never above REGISTRY_MAX_PAGE. */
export function registryPageNumber(value: unknown): number {
  const text = plainText(value);
  if (!/^[0-9]+$/.test(text)) return 1;
  const n = Number(text);
  return n >= 1 ? Math.min(n, REGISTRY_MAX_PAGE) : 1;
}

/** A service id in plain form: digits only, no leading zero, at most 2147483647. Otherwise null. */
export function registryServiceId(value: unknown): number | null {
  const text = plainText(value);
  if (!/^[1-9][0-9]{0,9}$/.test(text)) return null;
  const n = Number(text);
  return n <= REGISTRY_MAX_ID ? n : null;
}

/** The value when it is an http or https address, otherwise null. Used before a stored URL becomes a link. */
export function safeWebUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const protocol = new URL(value.trim()).protocol;
    return protocol === "http:" || protocol === "https:" ? value.trim() : null;
  } catch {
    return null;
  }
}
