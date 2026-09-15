import { parseHTML } from "linkedom";

export type RedlibComment = {
  id: string | null;
  canonicalUrl: string | null;
  author: string | null;
  score: number | null;
  bodyText: string;
};

export type RedlibThread = {
  id: string;
  canonicalUrl: string;
  title: string;
  author: string | null;
  createdAt: string | null;
  bodyText: string | null;
  score: number | null;
  upvoteRatio: number | null;
  reportedCommentCount: number | null;
  retrievedCommentCount: number;
  comments: RedlibComment[];
  coverage: "complete" | "partial" | "unknown";
  warnings: string[];
};

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function intFromText(value: string | null | undefined): number | null {
  const match = cleanText(value).toLowerCase().replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*([km]?)/);
  if (!match) return null;
  const multiplier = match[2] === "k" ? 1_000 : match[2] === "m" ? 1_000_000 : 1;
  return Math.trunc(Number(match[1]) * multiplier);
}

export function redditThreadId(value: string): string | null {
  try {
    const path = new URL(value, "https://www.reddit.com").pathname;
    return path.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** A durable Reddit permalink. Redlib's local address never leaves the adapter. */
export function canonicalRedditThreadUrl(value: string): string | null {
  try {
    const source = new URL(value, "https://www.reddit.com");
    if (!redditThreadId(source.toString())) return null;
    const path = source.pathname.endsWith("/") ? source.pathname : `${source.pathname}/`;
    return new URL(path, "https://www.reddit.com").toString();
  } catch {
    return null;
  }
}

function ownElement(root: Element, selector: string): Element | null {
  return Array.from(root.querySelectorAll(selector)).find((node) => node.closest(".comment") === root) ?? null;
}

/**
 * Parse one saved Redlib thread page. The structure checks deliberately fail
 * closed: an error/challenge page must never be mistaken for a discussion.
 */
export function parseRedlibThreadHtml(html: string, requestedUrl: string): RedlibThread {
  const requestedId = redditThreadId(requestedUrl);
  if (!requestedId) throw new Error("parse_failure: requested URL is not a Reddit thread");

  const { document } = parseHTML(html);
  const description = document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
  const identifiesRedlib = document.title.toLowerCase().includes("redlib") || description.toLowerCase().includes("redlib");
  const post = document.querySelector("div.post.highlighted");
  const titleNode = post?.querySelector(".post_title");
  if (!identifiesRedlib || !post || !titleNode) {
    throw new Error("parse_failure: expected Redlib thread structure is absent");
  }

  const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute("content") ?? requestedUrl;
  const canonicalUrl = canonicalRedditThreadUrl(ogUrl);
  if (!canonicalUrl || redditThreadId(canonicalUrl) !== requestedId) {
    throw new Error("parse_failure: returned thread does not match requested thread");
  }

  const footer = cleanText(post.querySelector(".post_footer")?.textContent);
  const ratioMatch = footer.match(/(\d+(?:\.\d+)?)\s*%\s*upvoted/i);
  const countNode = document.querySelector("#comment_count, .comment_count");
  const reportedCommentCount = intFromText(countNode?.textContent);
  const comments: RedlibComment[] = [];

  for (const node of Array.from(document.querySelectorAll(".comment"))) {
    if (node.classList.contains("post")) continue;
    const bodyNode = ownElement(node, ".comment_body");
    const bodyText = cleanText(bodyNode?.textContent);
    if (!bodyText) continue;
    const id = node.getAttribute("id") || null;
    const author = cleanText(ownElement(node, ".comment_author")?.textContent).replace(/^u\//, "") || null;
    const scoreNode = ownElement(node, ".comment_score");
    comments.push({
      id,
      canonicalUrl: id ? `${canonicalUrl}${id}/` : null,
      author,
      score: intFromText(scoreNode?.getAttribute("title") || scoreNode?.textContent),
      bodyText,
    });
  }

  const warnings: string[] = [];
  const omitted = document.querySelector(".more") !== null ||
    (reportedCommentCount !== null && comments.length < reportedCommentCount);
  if (omitted) warnings.push("Reddit reported comments not present in the retrieved HTML");

  return {
    id: requestedId,
    canonicalUrl,
    title: cleanText(titleNode.textContent),
    author: cleanText(post.querySelector(".post_author")?.textContent).replace(/^u\//, "") || null,
    createdAt: post.querySelector(".created")?.getAttribute("title") || null,
    bodyText: cleanText(post.querySelector(".post_body")?.textContent) || null,
    score: intFromText(post.querySelector(".post_score")?.getAttribute("title") || post.querySelector(".post_score")?.textContent),
    upvoteRatio: ratioMatch ? Number(ratioMatch[1]) / 100 : null,
    reportedCommentCount,
    retrievedCommentCount: comments.length,
    comments,
    coverage: omitted ? "partial" : reportedCommentCount === comments.length ? "complete" : "unknown",
    warnings,
  };
}
