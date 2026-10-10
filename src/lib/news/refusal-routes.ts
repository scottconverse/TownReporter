import { parseHTML } from "linkedom";
import { assertHttpUrl } from "./url-guard.ts";

export const BLOCKED_AFTER_RENDER_MESSAGE =
  "This public site refused even a normal browser. Try its newsletter or another public route.";

const BOT_PHRASES = [
  "access denied",
  "forbidden",
  "verify you are human",
  "checking your browser",
  "are you a robot",
  "enable javascript and cookies",
  "too many requests",
  "you have been blocked",
  "bot protection",
  "enable javascript and cookies to continue",
  "just a moment",
  "verifying you are human",
  "attention required",
  "cf-browser-verification",
  "checking your browser before accessing",
  "ddos protection by cloudflare",
  "please verify you are a human",
  "unusual traffic from your computer network",
];

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export function looksLikeBotWall(html: string, text?: string): boolean {
  const { document } = parseHTML(
    /<html[\s>]/i.test(html) ? html : `<html><body>${html}</body></html>`,
  );
  const title = normalize(document.querySelector("title")?.textContent ?? "");
  const headings: string[] = [];
  document
    .querySelectorAll("h1, h2, h3")
    .forEach((el) => headings.push(normalize(el.textContent ?? "")));
  const primaryText =
    text ??
    document.querySelector('article, main, [role="main"]')?.textContent ??
    document.body?.textContent ??
    html.replace(/<[^>]*>/g, " ");
  const bodyText = normalize(document.body?.textContent ?? "");
  const primaryNorm = normalize(primaryText);
  const shortPrimary = primaryNorm.length > 0 && primaryNorm.length < 400;
  for (const phrase of BOT_PHRASES) {
    if (title.includes(phrase)) return true;
    for (const h of headings) if (h.includes(phrase)) return true;
  }
  if (shortPrimary) {
    for (const phrase of BOT_PHRASES) if (primaryNorm.includes(phrase)) return true;
  }
  const bodyLooksWall = bodyText.length < 1500 && bodyText.includes("access denied");
  if (bodyLooksWall) return true;
  const hasCfChallenge =
    document.querySelector("script[src*='challenges.cloudflare.com']") !== null;
  if (hasCfChallenge) {
    if (title.includes("just a moment") || title.includes("attention required")) return true;
    if (
      document.querySelector(".cf-browser-verification, #cf-challenge-running, #cf-please-wait") !==
      null
    ) {
      return true;
    }
  }
  return false;
}

function resolve(raw: string, base: string): string | null {
  try {
    const u = assertHttpUrl(new URL(raw, base).toString());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

const NEWSLETTER_TEXT = /newsletter|subscribe|mailing[\s-]*list/i;

export function publicPageRoutes(
  html: string,
  base: string | URL,
): { feeds: string[]; newsletterUrl?: string } {
  const { document } = parseHTML(
    /<html[\s>]/i.test(html) ? html : `<html><body>${html}</body></html>`,
  );
  const feeds: string[] = [];
  const seen = new Set<string>();
  document.querySelectorAll("link").forEach((link) => {
    const type = link.getAttribute("type") ?? "";
    const rel = link.getAttribute("rel") ?? "";
    const href = link.getAttribute("href") ?? "";
    if (!href) return;
    if (!/alternate/i.test(rel)) return;
    if (!/^application\/(rss|atom)\+xml$/i.test(type)) return;
    const resolved = resolve(href, base.toString());
    if (!resolved || resolved.startsWith("mailto:")) return;
    if (!seen.has(resolved)) {
      seen.add(resolved);
      feeds.push(resolved);
    }
  });
  let newsletterUrl: string | undefined;
  document.querySelectorAll("a").forEach((a) => {
    if (newsletterUrl) return;
    const href = a.getAttribute("href") ?? "";
    if (!href) return;
    if (/^mailto:/i.test(href)) return;
    const resolved = resolve(href, base.toString());
    if (!resolved) return;
    const text = normalize(a.textContent ?? "");
    const ariaLabel = normalize(a.getAttribute("aria-label") ?? "");
    if (NEWSLETTER_TEXT.test(text) || NEWSLETTER_TEXT.test(ariaLabel)) {
      newsletterUrl = resolved;
    }
  });
  if (!newsletterUrl) {
    document.querySelectorAll("form").forEach((form) => {
      if (newsletterUrl) return;
      const action = form.getAttribute("action") || base.toString();
      const resolved = resolve(action, base.toString());
      if (!resolved) return;
      const actionNorm = resolved.toLowerCase();
      const formText = normalize(
        (form.textContent ?? "") +
          Array.from(form.querySelectorAll("input, button"))
            .map(
              (el) =>
                (el.getAttribute("value") ?? "") +
                " " +
                (el.getAttribute("name") ?? "") +
                " " +
                (el as Element).textContent,
            )
            .join(" "),
      );
      if (
        /newsletter|subscribe|mailing[\s-]*list/.test(actionNorm) ||
        NEWSLETTER_TEXT.test(formText)
      ) {
        newsletterUrl = resolved;
      }
    });
  }
  return { feeds, ...(newsletterUrl ? { newsletterUrl } : {}) };
}

const PRIVATE_PHRASES = [
  "please sign in to continue",
  "sign in to continue reading",
  "subscribe to read this article",
  "subscribers only",
  "this content is for subscribers",
  "you must be a subscriber",
  "create a free account to continue",
  "register to continue reading",
  "log in to your account to continue",
];

export function isPrivatePage(html: string): boolean {
  const { document } = parseHTML(
    /<html[\s>]/i.test(html) ? html : `<html><body>${html}</body></html>`,
  );
  const title = normalize(document.querySelector("title")?.textContent ?? "");
  for (const phrase of PRIVATE_PHRASES) {
    if (title.includes(phrase)) return true;
  }
  const body = normalize(document.body?.textContent ?? "");
  const shortBody = body.length < 2000;
  const hasPassword =
    document.querySelector("input[type='password'], input[name*='password' i]") !== null;
  const hasLoginForm =
    document.querySelector(
      "form[action*='login' i], form[action*='signin' i], form[action*='sign-in' i]",
    ) !== null;
  const wallPhrase = PRIVATE_PHRASES.some((p) => body.includes(p));
  if (hasPassword && hasLoginForm) return true;
  if (hasPassword && shortBody && wallPhrase) return true;
  if (wallPhrase && shortBody) return true;
  const paywallMarker =
    document.querySelector("[class*='paywall' i], [id*='paywall' i], [class*='piano' i]") !== null;
  if (paywallMarker && wallPhrase) return true;
  return false;
}
