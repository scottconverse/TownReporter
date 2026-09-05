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

/*
  Site notices: the banner readability throws away.

  The 2026-09-05 incident turned on this. The city's home page and its /news/
  page BOTH carried "Take the 2026 Community Satisfaction Survey... Open
  through September 7" in a banner, and both pages were captured. Readability
  strips banners, alerts and nav by design -- that is what this module is for
  -- so the single strongest piece of evidence in the whole capture never
  reached the model, and the story went on to say no such notice existed.

  So banners are kept, separately and clearly labelled, instead of being
  silently discarded. They are never merged into the article text: a banner is
  site furniture, and passing it off as article body is the bug this module
  was written to fix. Callers decide what to do with them (report.ts only
  shows notices from the paper's own city domains).
*/
const NOTICE_SELECTORS = [
  "[role='alert']",
  "[class*=alert]",
  "[class*=banner]",
  "[class*=notice]",
  "[id*=alert]",
  "[id*=banner]",
  "marquee",
];

const NOTICE_CAP = 1200;
const LEAD_TEXT_CHARS = 600;

export function extractSiteNotices(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const text = raw.replace(/\s+/g, " ").trim();
    if (text.length < 12) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    // A notice already contained in one we kept adds nothing.
    for (const had of seen) if (had.includes(key)) return;
    seen.add(key);
    out.push(text.slice(0, NOTICE_CAP));
  };
  try {
    const { document } = parseHTML(html);
    for (const sel of NOTICE_SELECTORS) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        push(htmlToPlainText((el as { innerHTML?: string }).innerHTML ?? ""));
      }
    }
    /*
      The first visible text of the page, before readability runs. On the city
      home page the survey banner sat above everything readability kept, and
      an alert class alone would not have caught it on every install.
    */
    const body = document.body as { innerHTML?: string } | null;
    if (body?.innerHTML) {
      const lead = htmlToPlainText(body.innerHTML).replace(/\s+/g, " ").trim();
      if (lead) push(lead.slice(0, LEAD_TEXT_CHARS));
    }
  } catch {
    /* a page whose markup will not parse simply has no notices */
  }
  let used = 0;
  const capped: string[] = [];
  for (const notice of out) {
    if (used + notice.length > NOTICE_CAP) break;
    capped.push(notice);
    used += notice.length;
  }
  return capped;
}
