
import sanitizeHtml from "sanitize-html";
import { parseHTML } from "linkedom";

export type NewsletterLink = { text: string; url: string };

export type SanitizedNewsletter = {
  /** Sanitised plain text; an anchor reads as `label (url)`. */
  text: string;
  /** Every HTTP(S) anchor in document order, deduped by URL. */
  links: NewsletterLink[];
  /** Always the SUBJECT, not the HTML <title>. */
  title: string;
};

export function senderIsAllowed(
  senderEmail: string,
  senderField: string | null | undefined,
): boolean {
  const sender = normalizeEmail(senderEmail);
  const field = (senderField ?? "").trim().toLowerCase();
  if (!sender || !field) return false;
  if (field.includes("@")) return sender === field;
  const at = sender.lastIndexOf("@");
  if (at <= 0 || at === sender.length - 1) return false;
  return sender.slice(at + 1) === field.replace(/^@/, "");
}

/** Lowercase, trim, and reduce `Name <a@b>` to the address. */
export function normalizeEmail(raw: string): string {
  const value = (raw ?? "").trim();
  const angle = value.match(/<([^>]+)>/);
  const address = (angle ? angle[1] : value).trim().toLowerCase();
  if (!address || !address.includes("@") || /\s/.test(address)) return "";
  return address;
}

/**
 * Message-ID dedupe key, case-SENSITIVE. Two ids differing only in case are
 * two messages. A missing or blank id returns null: the caller skips/counts
 * rather than inventing an identity that could collide.
 */
export function messageDedupeKey(messageId: string | null | undefined): string | null {
  if (typeof messageId !== "string") return null;
  const trimmed = messageId.trim();
  return trimmed.length ? trimmed : null;
}

export type Cursor = { uid: bigint | null; uidValidity: bigint | null };

/** Where a resumed read starts. A UIDVALIDITY change resets to the beginning. */
export function cursorStart(input: {
  storedUid: bigint | null;
  storedUidValidity: bigint | null;
  mailboxUidValidity: bigint | null;
}): { fromUid: bigint; reset: boolean } {
  const reset =
    input.storedUidValidity != null &&
    input.mailboxUidValidity != null &&
    input.storedUidValidity !== input.mailboxUidValidity;
  if (reset || input.storedUid == null) return { fromUid: 0n, reset };
  return { fromUid: input.storedUid, reset: false };
}

/** A message larger than this is refused BEFORE its whole body is fetched. */
export const NEWSLETTER_MESSAGE_CAP_BYTES = 5 * 1024 * 1024;

export function withinMessageCap(byteSize: number | null | undefined): boolean {
  if (byteSize == null || !Number.isFinite(byteSize)) return false;
  return byteSize >= 0 && byteSize <= NEWSLETTER_MESSAGE_CAP_BYTES;
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "a", "p", "br", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th",
    "blockquote", "pre", "code", "strong", "em", "b", "i", "u", "hr",
  ],
  // `href` only: no `src`, so no remote image is retained, and no `style`.
  allowedAttributes: { a: ["href"] },
  allowedSchemes: ["http", "https"],
  // Drop disallowed elements (scripts, styles, images, iframes) with their
  // contents rather than escaping them into the text.
  disallowedTagsMode: "discard",
};

export function sanitizeNewsletterHtml(html: string, subject: string): SanitizedNewsletter {
  const clean = sanitizeHtml(html ?? "", SANITIZE_OPTIONS);
  const { document } = parseHTML(`<html><body>${clean}</body></html>`);
  const links: NewsletterLink[] = [];
  const seen = new Set<string>();
  for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
    const href = (anchor.getAttribute("href") ?? "").trim();
    if (!isHttpUrl(href)) continue;
    const label = (anchor.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!seen.has(href)) links.push({ text: label || href, url: href });
    seen.add(href);
    // Inline the URL so a reader of the plain text sees where the label goes.
    anchor.replaceWith(document.createTextNode(` ${label || href} (${href}) `));
  }
  for (const block of Array.from(document.querySelectorAll("p,div,li,br,tr,h1,h2,h3,h4,h5,h6,blockquote,pre,hr"))) {
    block.appendChild(document.createTextNode("\n"));
  }
  const text = (document.body?.textContent ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, links, title: (subject ?? "").trim() };
}

/**
 * A safe confirmation link an editor may open themselves. Only for an allowed
 * sender whose subject reads like a subscription confirmation; the desk never
 * follows it, it renders it.
 */
export function confirmationLinks(subject: string, links: NewsletterLink[]): NewsletterLink[] {
  const confirm = /confirm|verify|activate|double.?opt|complete your subscription/i;
  const safe = links.filter(l => isHttpUrl(l.url) && !/unsubscribe|opt.?out/i.test(`${l.text} ${l.url}`));
  const explicit = safe.filter(l => confirm.test(`${l.text} ${l.url}`));
  return (explicit.length ? explicit : confirm.test(subject) ? safe : []).slice(0, 6);
}

/** Strip NUL for Postgres (captured evidence: NUL -> U+FFFD). */
export function newsletterStorableText(value: string): string {
  return (value ?? "").split("\u0000").join("\uFFFD");
}

/** HTTP(S) only, and no embedded username/password. */
export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return !u.username && !u.password;
  } catch {
    return false;
  }
}
