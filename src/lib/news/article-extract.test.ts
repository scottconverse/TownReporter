import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractArticleText } from "./article-extract.ts";

describe("extractArticleText", () => {
  it("returns the article body, not the nav, on a gov-style CMS page", () => {
    const navLinks = Array.from(
      { length: 40 },
      (_, i) => `<li><a href="/dept-${i}">Department ${i} services and information</a></li>`,
    ).join("");
    const html = `<!DOCTYPE html><html><head><title>Finance Department</title></head>
      <body>
        <header>
          <nav id="main-nav" class="mega-menu">
            <ul>${navLinks}</ul>
          </nav>
        </header>
        <main>
          <article>
            <h1>Council approves 2027 budget</h1>
            <p>The city council voted 5-2 Tuesday night to approve the 2027 budget, which
            includes a modest increase to the parks and recreation fund.</p>
            <p>Finance director Pat Alvarez said the plan keeps the reserve fund above the
            required threshold while funding two new road projects next spring.</p>
          </article>
        </main>
        <footer class="site-footer">
          <p>Accessibility — Ensuring accessible government services for all residents.</p>
          <p>Contact us | Privacy policy | Terms of use | Sitemap</p>
        </footer>
      </body></html>`;

    const nav = htmlLength(navLinks);
    const result = extractArticleText(html, "https://example-gov.example/finance");

    assert.match(result.text, /Council approves 2027 budget/);
    assert.match(result.text, /2027 budget/);
    assert.match(result.text, /Finance director Pat Alvarez/);
    assert.doesNotMatch(result.text, /Department \d+ services/);
    assert.doesNotMatch(result.text, /Accessibility — Ensuring accessible/);
    assert.ok(result.text.length < nav, "extracted article should be far shorter than the raw nav markup");
    assert.notEqual(result.method, "none");
  });

  it("extracts near-empty text from a nav-only app-shell page", () => {
    const html = `<!DOCTYPE html><html><head><title>Reddit</title></head>
      <body>
        <div id="root">
          <nav>
            <a href="/">Home</a>
            <a href="/popular">Popular</a>
            <a href="/explore">Explore</a>
            <a href="/login">Log In</a>
          </nav>
        </div>
      </body></html>`;

    const result = extractArticleText(html, "https://www.reddit.com/r/longmont/comments/abc123/");

    assert.ok(result.text.trim().length < 40, `expected near-empty text, got: ${JSON.stringify(result.text)}`);
  });

  it("extracts the full body of a normal, boilerplate-light article page", () => {
    const html = `<!DOCTYPE html><html><head><title>Longmont Times</title></head>
      <body>
        <article>
          <h1>Reservoir levels stay steady into fall</h1>
          <p>Boulder County water managers say reservoir levels are holding steady heading
          into fall, a welcome change after last year's late-summer drawdown.</p>
          <p>"We're in a much better position than this time last year," said watershed
          manager Dana Kim, pointing to a wetter spring and lower irrigation demand.</p>
          <p>The county plans to publish its full fall outlook next month, including
          projections for the winter snowpack season.</p>
        </article>
      </body></html>`;

    const result = extractArticleText(html, "https://times.example/reservoir-levels");

    // Readability drops a duplicate <h1> whose text equals the parsed title,
    // so the headline is checked via `title`, not in the body text.
    assert.match(result.title ?? "", /Reservoir levels stay steady into fall/);
    assert.match(result.text, /reservoir levels are holding steady/);
    assert.match(result.text, /Dana Kim/);
    assert.match(result.text, /fall outlook next month/);
    assert.doesNotMatch(result.text, /<article|<p>/);
  });
});

function htmlLength(html: string): number {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}
