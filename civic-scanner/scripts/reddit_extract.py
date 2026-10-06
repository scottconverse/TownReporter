#!/usr/bin/env python3
"""Build Reddit/Redlib URLs and normalize saved RSS or Redlib HTML.

The helper intentionally performs no network access. Fetching remains under the
agent's request budget, pacing, privacy, and authorization controls.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse


def now_rfc3339() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def clean_text(value: str) -> str:
    return " ".join(html.unescape(value or "").split())


def int_from_text(value: str) -> Optional[int]:
    value = clean_text(value).lower().replace(",", "")
    match = re.search(r"(-?\d+(?:\.\d+)?)\s*([km]?)", value)
    if not match:
        return None
    number = float(match.group(1))
    number *= {"k": 1_000, "m": 1_000_000}.get(match.group(2), 1)
    return int(number)


def canonical_reddit_url(value: str) -> str:
    if not value:
        return ""
    parsed = urlparse(value)
    path = parsed.path
    query = parsed.query
    kept = [(k, v) for k, v in parse_qsl(query) if k in {"context"}]
    return urlunparse(("https", "www.reddit.com", path, "", urlencode(kept), ""))


def thread_id(url: str) -> Optional[str]:
    match = re.search(r"/comments/([a-z0-9]+)/", url, re.I)
    return match.group(1) if match else None


def make_url(args: argparse.Namespace) -> str:
    if args.kind == "rss-search":
        root = "https://www.reddit.com"
        path = f"/r/{args.subreddit}/search.rss" if args.subreddit else "/search.rss"
        params = {"q": args.query, "sort": args.sort}
        if args.subreddit:
            params["restrict_sr"] = "on"
        return root + path + "?" + urlencode(params)
    if args.kind == "rss-thread":
        base = canonical_reddit_url(args.url).rstrip("/")
        return base + "/.rss"
    base = args.base.rstrip("/")
    if args.kind == "redlib-search":
        path = f"/r/{args.subreddit}/search" if args.subreddit else "/search"
        params = {"q": args.query, "sort": args.sort, "t": args.time}
        if args.subreddit:
            params["restrict_sr"] = "on"
        return base + path + "?" + urlencode(params)
    if args.kind == "redlib-thread":
        path = urlparse(canonical_reddit_url(args.url)).path
        return base + path + "?" + urlencode({"sort": args.sort})
    raise ValueError(f"Unknown URL kind: {args.kind}")


@dataclass
class Node:
    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    children: list["Node"] = field(default_factory=list)
    data: list[str] = field(default_factory=list)
    content: list = field(default_factory=list)
    parent: Optional["Node"] = None

    @property
    def classes(self) -> set[str]:
        return set(self.attrs.get("class", "").split())

    def render(self, pre: bool = False, exclude: tuple = ()) -> str:
        if self.tag in {"script", "style"} or any(c in self.classes for c in exclude):
            return ""
        pre = pre or self.tag == "pre"
        body = "".join(
            item.render(pre, exclude) if isinstance(item, Node)
            else (item if pre else re.sub(r"\s+", " ", item))
            for item in self.content
        )
        if self.tag == "br":
            return "\n"
        if self.tag in {"td", "th"}:
            return body.strip() + "\t"
        if self.tag in {"p", "div", "pre", "li", "blockquote", "tr", "h1", "h2", "h3", "table"}:
            return "\n" + body + "\n"
        return body

    def text(self, exclude: tuple = ()) -> str:
        return self.render(exclude=exclude).strip()

    def descendants(self) -> Iterable["Node"]:
        for child in self.children:
            yield child
            yield from child.descendants()

    def first(self, *, tag: Optional[str] = None, cls: Optional[str] = None) -> Optional["Node"]:
        for node in self.descendants():
            if (tag is None or node.tag == tag) and (cls is None or cls in node.classes):
                return node
        return None

    def all(self, *, tag: Optional[str] = None, cls: Optional[str] = None) -> list["Node"]:
        return [n for n in self.descendants() if (tag is None or n.tag == tag) and (cls is None or cls in n.classes)]


class TreeParser(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = Node("document")
        self.stack = [self.root]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        node = Node(tag, {k: v or "" for k, v in attrs}, parent=self.stack[-1])
        self.stack[-1].children.append(node)
        self.stack[-1].content.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.stack.pop()

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return

    def handle_data(self, data: str) -> None:
        self.stack[-1].data.append(data)
        self.stack[-1].content.append(data)


def parse_html_document(raw: str) -> Node:
    parser = TreeParser()
    parser.feed(raw)
    return parser.root


def node_value(node: Node, cls: str, attr: Optional[str] = None) -> Optional[str]:
    found = node.first(cls=cls)
    if not found:
        return None
    value = found.attrs.get(attr, "") if attr else found.text()
    return (clean_text(value) if attr else value.strip()) or None


def link_value(node: Node, cls: str) -> Optional[str]:
    found = node.first(tag="a", cls=cls) or node.first(cls=cls)
    return found.attrs.get("href") if found else None


def base_result(adapter: str, source_instance: Optional[str]) -> dict:
    return {
        "query": None,
        "source_adapter": adapter,
        "source_instance": source_instance,
        "fetched_at": now_rfc3339(),
        "coverage": "unknown",
        "warnings": [],
        "threads": [],
    }


def parse_rss(raw: str, source_url: Optional[str]) -> dict:
    result = base_result("reddit-rss", "www.reddit.com")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise ValueError(f"parse_failure: invalid XML: {exc}") from exc
    entries = [e for e in root.iter() if e.tag.rsplit("}", 1)[-1] in {"entry", "item"}]
    threads = {}
    for entry in entries:
        values: dict[str, str] = {}
        link = ""
        author = ""
        for child in entry.iter():
            name = child.tag.rsplit("}", 1)[-1]
            if name == "link" and not link:
                link = child.attrib.get("href") or (child.text or "")
            elif name == "name" and not author:
                author = clean_text(child.text or "")
            elif name in {"title", "published", "updated", "pubDate", "content", "description"} and name not in values:
                if name == "content" and child.attrib.get("type") == "xhtml":
                    values[name] = "".join(ET.tostring(c, encoding="unicode") for c in child)
                else:
                    values[name] = "".join(child.itertext())
        canonical = canonical_reddit_url(link)
        match = re.match(r"^(https://www\.reddit\.com/r/[^/]+/comments/([a-z0-9]+)/[^/]+/)([a-z0-9]+)?/?(?:\?.*)?$", canonical, re.I)
        if not match:
            continue  # Search feeds can also contain subreddit suggestions.
        thread_url, tid, cid = match.groups()
        content = parse_html_document(values.get("content") or values.get("description") or "")
        body_node = content.first(cls="md") or content
        body = body_node.text() or None
        date = clean_text(values.get("published") or values.get("pubDate") or values.get("updated") or "") or None
        record = {
            "id": tid,
            "canonical_reddit_url": thread_url,
            "subreddit": (re.search(r"/r/([^/]+)/", canonical, re.I).group(1) if re.search(r"/r/([^/]+)/", canonical, re.I) else None),
            "title": clean_text(values.get("title", "")) or None,
            "author": author.removeprefix("/u/").removeprefix("u/") or None,
            "created_at": date,
            "body_text": body,
            "score": None,
            "upvote_ratio": None,
            "reported_comment_count": None,
            "retrieved_comment_count": 0,
            "comments": [],
        }
        if cid:
            if tid not in threads:
                threads[tid] = dict(record, title=None, author=None, created_at=None, body_text=None)
            threads[tid]["comments"].append({
                "id": cid, "canonical_reddit_url": canonical,
                "parent_id": None, "depth": None, "author": record["author"],
                "created_at": date, "edited_at": None, "score": None,
                "score_hidden": False, "body_text": body,
                "removed": bool(body and body.lower().startswith(("[removed]", "[deleted]"))),
            })
        else:
            record["comments"] = threads.get(tid, {}).get("comments", [])
            threads[tid] = record
    result["threads"] = list(threads.values())
    for thread in result["threads"]:
        thread["retrieved_comment_count"] = len(thread["comments"])
    if not result["threads"]:
        result["warnings"].append("empty_result")
    if source_url and "/comments/" in source_url:
        result["coverage"] = "partial"
        result["warnings"].append("RSS thread feeds may omit or flatten comments and long original posts")
    return result


def parse_search_post(node: Node, source_url: Optional[str] = None) -> dict:
    title_node = node.first(cls="post_title")
    title_link = next((a for a in title_node.all(tag="a")
                       if "post_flair" not in a.classes and thread_id(a.attrs.get("href", ""))), None) if title_node else None
    permalink = title_link.attrs.get("href", "") if title_link else (source_url or "")
    if not thread_id(permalink):
        raise ValueError("parse_failure: post has no discussion permalink")
    score_raw = node_value(node, "post_score", "title") or node_value(node, "post_score")
    comments = node.first(cls="post_comments")
    return {
        "id": thread_id(permalink),
        "canonical_reddit_url": canonical_reddit_url(permalink) or None,
        "subreddit": (node_value(node, "post_subreddit") or "").removeprefix("r/") or None,
        "title": clean_text(title_link.text() if title_link else title_node.text(exclude=("post_flair",))) if title_node else None,
        "author": (node_value(node, "post_author") or "").removeprefix("u/") or None,
        "created_at": node_value(node, "created", "title"),
        "body_text": node_value(node, "post_body"),
        "score": int_from_text(score_raw or ""),
        "upvote_ratio": None,
        "reported_comment_count": int_from_text((comments.attrs.get("title", "") if comments else "") or (comments.text() if comments else "")),
        "retrieved_comment_count": 0,
        "comments": [],
    }


def identifies_redlib(root: Node) -> bool:
    title = root.first(tag="title")
    return bool((title and "redlib" in title.text().lower()) or any(
        n.attrs.get("name") == "description" and "redlib" in n.attrs.get("content", "").lower()
        for n in root.all(tag="meta")
    ))


def parse_redlib_search(raw: str, source_url: str) -> dict:
    root = parse_html_document(raw)
    result = base_result("redlib-html", urlparse(source_url).netloc)
    if not identifies_redlib(root):
        raise ValueError("parse_failure: page does not identify itself as Redlib")
    for post in root.all(tag="div", cls="post"):
        if post.attrs.get("id"):
            result["threads"].append(parse_search_post(post))
    if not result["threads"]:
        page_text = root.text().lower()
        if "no posts were found" in page_text:
            result["warnings"].append("empty_result")
        else:
            raise ValueError("parse_failure: no Redlib post structures found")
    return result


def comment_depth(node: Node) -> int:
    depth = 0
    parent = node.parent
    while parent:
        if "comment" in parent.classes:
            depth += 1
        parent = parent.parent
    return depth


def parse_redlib_thread(raw: str, source_url: str) -> dict:
    root = parse_html_document(raw)
    result = base_result("redlib-html", urlparse(source_url).netloc)
    highlighted = next((n for n in root.all(tag="div", cls="post") if "highlighted" in n.classes), None)
    if not identifies_redlib(root) or not highlighted or not highlighted.first(cls="post_title"):
        raise ValueError("parse_failure: expected Redlib thread structure is absent")
    og_url = next((n.attrs.get("content") for n in root.all(tag="meta") if n.attrs.get("property") == "og:url"), None)
    permalink = canonical_reddit_url(og_url or source_url)
    if thread_id(permalink) != thread_id(source_url):
        raise ValueError("parse_failure: returned thread does not match requested thread")
    thread = parse_search_post(highlighted, permalink)
    ratio_text = node_value(highlighted, "post_footer") or ""
    ratio_match = re.search(r"(\d+(?:\.\d+)?)\s*%", ratio_text)
    thread["upvote_ratio"] = float(ratio_match.group(1)) / 100 if ratio_match else None
    count_node = next((n for n in root.descendants() if n.attrs.get("id") == "comment_count" or "comment_count" in n.classes), None)
    count_text = count_node.text() if count_node else ""
    thread["reported_comment_count"] = int_from_text(count_text)
    comments = []
    for node in root.all(cls="comment"):
        if "post" in node.classes:
            continue
        cid = node.attrs.get("id") or None
        # Nested replies must never supply missing fields for their parent.
        def own_nodes(parent):
            for child in parent.children:
                if "comment" in child.classes:
                    continue
                yield child
                yield from own_nodes(child)

        fields = list(own_nodes(node))

        def own_value(cls, attr=None):
            found = next((n for n in fields if cls in n.classes), None)
            if found is None:
                return None
            return (found.attrs.get(attr) if attr else found.text()) or None

        body = own_value("comment_body")
        if not body:
            continue
        score_text = own_value("comment_score", "title") or own_value("comment_score") or ""
        author = (own_value("comment_author") or "").removeprefix("u/") or None
        link = own_value("comment_link", "href") or own_value("created", "href") or ""
        if not thread_id(link) and cid:
            link = thread["canonical_reddit_url"].rstrip("/") + "/" + cid + "/"
        parent = node.parent
        while parent and "comment" not in parent.classes:
            parent = parent.parent
        comments.append({
            "id": cid,
            "canonical_reddit_url": canonical_reddit_url(link) or None,
            "parent_id": parent.attrs.get("id") if parent else thread["id"],
            "depth": comment_depth(node),
            "author": author,
            "created_at": own_value("created", "title"),
            "edited_at": own_value("edited", "title"),
            "score": int_from_text(score_text),
            "score_hidden": "hidden" in score_text.lower() or "•" in score_text,
            "body_text": body,
            "removed": body.lower().startswith("[removed]") or body.lower().startswith("[deleted]"),
        })
    thread["comments"] = comments
    thread["retrieved_comment_count"] = len(comments)
    more_nodes = [n for n in root.descendants() if "more" in n.classes]
    if more_nodes or (thread["reported_comment_count"] is not None and len(comments) < thread["reported_comment_count"]):
        result["coverage"] = "partial"
        result["warnings"].append("Reddit reported comments not present in the retrieved HTML")
    else:
        result["coverage"] = "complete" if thread["reported_comment_count"] == len(comments) else "unknown"
    result["threads"].append(thread)
    return result


def read_input(path: Optional[str]) -> str:
    return Path(path).read_text(encoding="utf-8") if path else sys.stdin.read()


def main() -> int:
    # Windows pipes otherwise inherit a legacy code page and fail on Reddit text.
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    url_parser = sub.add_parser("url", help="construct a Reddit RSS or Redlib URL")
    url_parser.add_argument("kind", choices=["rss-search", "rss-thread", "redlib-search", "redlib-thread"])
    url_parser.add_argument("--query")
    url_parser.add_argument("--subreddit")
    url_parser.add_argument("--sort", default="relevance")
    url_parser.add_argument("--time", default="all")
    url_parser.add_argument("--url")
    url_parser.add_argument("--base")

    parse_parser = sub.add_parser("parse", help="normalize a saved response or stdin")
    parse_parser.add_argument("kind", choices=["rss", "redlib-search", "redlib-thread"])
    parse_parser.add_argument("--input")
    parse_parser.add_argument("--source-url", required=True)

    args = parser.parse_args()
    try:
        if args.command == "url":
            required = {
                "rss-search": ["query"],
                "rss-thread": ["url"],
                "redlib-search": ["base", "query"],
                "redlib-thread": ["base", "url"],
            }[args.kind]
            missing = [name for name in required if not getattr(args, name)]
            if missing:
                raise ValueError("missing required option(s): " + ", ".join("--" + n for n in missing))
            print(make_url(args))
            return 0
        raw = read_input(args.input)
        if args.kind == "rss":
            result = parse_rss(raw, args.source_url)
        elif args.kind == "redlib-search":
            result = parse_redlib_search(raw, args.source_url)
        else:
            result = parse_redlib_thread(raw, args.source_url)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    except (OSError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
