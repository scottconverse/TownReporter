import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { htmlToPlainText } from "./html-text.ts";

/**
 * Dark Desk F2: real main-content extraction.
 *
 * `htmlToPlainText` alone strips tags but keeps EVERYTHING — nav, mega-menus,
 * footers, subscribe widgets — so a "successful" capture used to be the
 * site's chrome, not the article (a finance-department page captured as
 * 9,674 chars of pure nav; a reddit page captured as the six-character word
 * "Reddit"). This module extracts the article body before any of that text
 * reaches storage or the render/classification decisions.
 *
 * Approach: Mozilla's Readability, running against a `linkedom` DOM (a
 * lightweight, server-safe implementation with no browser globals — safe to
 * import from Nitro/Node SSR code). Readability finds the article node by
 * content density the same way Firefox's reader mode does. When Readability
 * can't find an article (returns null, or a scrap of text that reads like a
 * mis-parse) we fall back to a hand-built boilerplate strip: remove
 * <nav>/<header>/<footer>/<aside>/<script>/<style>/<noscript>/<form> and
 * anything tagged `role="navigation"` or classed/id'd as nav/menu/footer/
 * header/sidebar/subscribe/cookie-ish, then prefer <main>/<article>, else
 * whatever's left of <body>. If THAT also comes up empty, we return an empty
 * result on purpose — an app-shell/nav-only page should extract to nothing,
 * not to its menu, so callers can treat "near-empty extraction" as the signal
 * to render the page with JS or classify the capture as failed.
 *
 * Deliberately never falls back to raw `htmlToPlainText(wholePage)` — that
 * whole-page strip is exactly the bug this module exists to fix.
 */

export type ExtractedArticle = {
  /** Plain text of the article body, or "" if none could be found. */
  text: string;
  /** Article title Readability found, if any. */
  title: string | null;
  /** Which path produced the result, for diagnostics. */
  method: "readability" | "heuristic" | "none";
};

const READABILITY_MIN_CHARS = 60;

const KILL_SELECTORS = [
  "nav",
  "header",
  "footer",
  "aside",
  "script",
  "style",
  "noscript",
  "form",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[aria-hidden='true']",
];

const BOILERPLATE_CLASS_ID = /\b(nav(bar)?|menu|main-?menu|site-?header|site-?footer|footer|header|sidebar|subscribe|newsletter|cookie|consent|breadcrumb|social-?share|site-?search|skip-?link|masthead|mega-?menu)\b/i;

function stripBoilerplate(document: {
  querySelectorAll: (sel: string) => Iterable<{
    getAttribute: (name: string) => string | null;
    remove: () => void;
  }>;
  querySelector: (sel: string) => { innerHTML?: string } | null;
  body: { innerHTML?: string } | null;
}): string {
  for (const sel of KILL_SELECTORS) {
    for (const el of Array.from(document.querySelectorAll(sel))) el.remove();
  }
  const candidates = Array.from(document.querySelectorAll("[class], [id]"));
  for (const el of candidates) {
    const cls = el.getAttribute("class") ?? "";
    const id = el.getAttribute("id") ?? "";
    if (BOILERPLATE_CLASS_ID.test(cls) || BOILERPLATE_CLASS_ID.test(id)) el.remove();
  }
  const main = document.querySelector("main") ?? document.querySelector("article");
  const root = main ?? document.body;
  return root?.innerHTML ?? "";
}

function looksLikeMisparse(text: string): boolean {
  // Readability occasionally "succeeds" on a scrap — a cookie banner or a
  // single nav label — that happens to clear its own internal threshold.
  // Treat a very short result as no result, same as null.
  return text.trim().length < READABILITY_MIN_CHARS;
}

export function extractArticleText(html: string, url?: string): ExtractedArticle {
  let readabilityTitle: string | null = null;
  try {
    const { document } = parseHTML(html);
    if (url) {
      try {
        const base = document.createElement("base");
        base.setAttribute("href", url);
        document.head?.appendChild(base);
      } catch {
        /* base tag is a nicety for relative-link resolution; skip if unsupported */
      }
    }
    const reader = new Readability(document, { charThreshold: 200 });
    const article = reader.parse();
    if (article?.content) {
      const text = htmlToPlainText(article.content);
      readabilityTitle = article.title ?? null;
      if (!looksLikeMisparse(text)) {
        return { text, title: readabilityTitle, method: "readability" };
      }
    }
  } catch {
    // Readability threw (malformed markup, etc.) — fall through to heuristic.
  }

  try {
    const { document } = parseHTML(html);
    const innerHtml = stripBoilerplate(document);
    const text = htmlToPlainText(innerHtml);
    if (text.trim().length > 0) {
      return { text, title: readabilityTitle, method: "heuristic" };
    }
  } catch {
    // Fall through to the empty result below.
  }

  return { text: "", title: readabilityTitle, method: "none" };
}
