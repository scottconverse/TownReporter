# Access adapters and normalized schema

Read this reference when constructing requests, parsing Reddit/Redlib responses, or comparing coverage between adapters.

## Capability snapshot

Verified against Redlib `main` and its public instance registry on 2026-09-14. Recheck current project state before changing parser assumptions.

| Capability | Reddit RSS | Redlib HTML |
|---|---|---|
| Search posts | Yes | Yes |
| Full long OP | Often truncated | Usually present |
| Post score and upvote ratio | Generally absent | Present when Reddit exposes them |
| Comment scores | Generally absent | Present or marked hidden |
| Nested replies | Weak or flattened | Nested HTML |
| Omitted-comment signal | Weak | `more` placeholders may be rendered |
| Structured format | Atom XML | Server-rendered HTML |

Redlib has operational JSON such as `/info.json`, but it does not currently expose a supported JSON API for Reddit search or thread content. It internally consumes Reddit JSON and renders HTML. Treat HTML selectors as versioned parser contracts.

Authoritative project sources:

- Repository and deployment/configuration: https://github.com/redlib-org/redlib
- Routes: https://github.com/redlib-org/redlib/blob/main/src/main.rs
- Search implementation/template: https://github.com/redlib-org/redlib/blob/main/src/search.rs and https://github.com/redlib-org/redlib/blob/main/templates/search.html
- Thread parsing/templates: https://github.com/redlib-org/redlib/blob/main/src/post.rs, https://github.com/redlib-org/redlib/blob/main/templates/post.html, and https://github.com/redlib-org/redlib/blob/main/templates/comment.html
- Instance registry: https://github.com/redlib-org/redlib-instances

The registry's machine-readable source is `https://raw.githubusercontent.com/redlib-org/redlib-instances/main/instances.json`. It supplies URLs, locations, versions, and optional Cloudflare/SFW notes. Its `updated` field is freshness metadata, not an uptime guarantee.

## Reddit RSS routes

Send a descriptive browser-like User-Agent and percent-encode query values.

| Goal | URL |
|---|---|
| Search all Reddit | `https://www.reddit.com/search.rss?q=<query>&sort=<new-or-relevance>` |
| Search one subreddit | `https://www.reddit.com/r/<sub>/search.rss?q=<query>&restrict_sr=on&sort=<sort>` |
| Subreddit listing | `https://www.reddit.com/r/<sub>/.rss` |
| New listing | `https://www.reddit.com/r/<sub>/new/.rss` |
| Top listing | `https://www.reddit.com/r/<sub>/top/.rss?t=<day-week-month-year-all>` |
| Thread/comments | append `.rss` to the canonical thread permalink |

Parse Atom `<entry>` values for title, link, updated, author, and content. Content is embedded HTML; depending on the XML library, request inner text rather than stringifying an element object. Abort further requests if a first-entry parse invariant fails.

The bundled parser ignores subreddit suggestions, removes HTML markup from post/comment prose, and groups comment permalinks under their parent thread. RSS does not establish reply depth or parent-comment identity, so those fields remain null. Code indentation and table column order are retained. The CLI reads stdin and writes JSON as UTF-8, including on Windows.

## Redlib routes

Use an explicitly configured base URL, with no trailing slash.

| Goal | Route |
|---|---|
| Health/configuration | `/info.json` |
| Search all Reddit | `/search?q=<query>&sort=<relevance-hot-top-new-comments>&t=<hour-day-week-month-year-all>` |
| Search subreddit | `/r/<sub>/search?q=<query>&restrict_sr=on&sort=<sort>&t=<time>` |
| Thread | canonical Reddit path, optionally with `?sort=<confidence-top-new-controversial-old>` |

Before parsing a Redlib content page, require an HTTP success, an HTML content type, a Redlib-shaped title or expected structural elements, and absence of a visible error page. `/info.json` can identify the crate version, git commit, deployment time, and whether RSS is enabled.

Real thread titles can omit the word Redlib. The parser accepts Redlib's description metadata together with the required post structure. In search headings, skip flair anchors and choose the discussion permalink. On thread pages the heading can be plain text; use the page's canonical metadata or requested thread URL. Comment totals use `id="comment_count"`, and comment permalinks may be on the timestamp anchor. Check these structures against real saved pages, not only simplified fixtures.

Useful current selectors include:

- Search post: `div.post[id]`
- Title/permalink: `.post_title a`
- Community: `.post_subreddit`
- Author: `.post_author`
- Creation time: `.created[title]`
- Score: `.post_score[title]`
- Comment count/link: `.post_comments`
- Preview/full post body: `.post_body`
- Thread wrapper: `.thread`
- Comment body: `.comment_body`
- Comment score, author, timestamp, and permalink: parse within each comment container rather than by document-wide position

Save the Redlib version with parsed records. If selectors fail, return a parse failure instead of guessing from arbitrary text.

## Normalized records

Represent missing values as `null`, not zero or an empty claim.

```json
{
  "query": "string or null",
  "source_adapter": "reddit-rss | redlib-html",
  "source_instance": "host or null",
  "fetched_at": "RFC 3339 timestamp",
  "coverage": "complete | partial | unknown",
  "warnings": [],
  "threads": [
    {
      "id": "string or null",
      "canonical_reddit_url": "https://www.reddit.com/r/.../comments/.../",
      "subreddit": "string or null",
      "title": "string or null",
      "author": "string or null",
      "created_at": "string or null",
      "body_text": "string or null",
      "score": "integer or null",
      "upvote_ratio": "number or null",
      "reported_comment_count": "integer or null",
      "retrieved_comment_count": "integer",
      "comments": [
        {
          "id": "string or null",
          "canonical_reddit_url": "https://www.reddit.com/r/.../comments/.../comment-id/",
          "parent_id": "string or null",
          "depth": "integer or null",
          "author": "string or null",
          "created_at": "string or null",
          "edited_at": "string or null",
          "score": "integer or null",
          "score_hidden": "boolean",
          "body_text": "string or null",
          "removed": "boolean"
        }
      ]
    }
  ]
}
```

## Failure categories

Use one of these categories in warnings or diagnostic output:

- `rate_limited`: HTTP 429; retain retry information.
- `forbidden_or_challenged`: HTTP 401/403 or an HTML challenge/login page.
- `not_found`: HTTP 404 after route validity is established.
- `upstream_failure`: Redlib reports a Reddit-side failure, or the server returns 5xx.
- `transport_failure`: timeout, DNS, TLS, or connection failure.
- `content_type_mismatch`: response type is not what the adapter expects.
- `parse_failure`: expected XML/HTML structure is absent or malformed.
- `empty_result`: valid response with no matching items.

Do not collapse these into “Reddit has no results.”

## Public-instance policy

The machine-readable registry supplies URLs, locations, versions, and sometimes Cloudflare/SFW notes. It is not a search API and does not guarantee current uptime. If public instances are allowed, select at most one from the current registry, inspect `/info.json`, and fail back to RSS rather than cycling through the fleet. Never send credentials or private material through a public instance.
