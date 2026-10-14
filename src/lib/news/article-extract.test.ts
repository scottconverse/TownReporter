import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { extractArticleText } from "./article-extract.ts";
import { htmlToPlainText } from "./html-text.ts";

describe("extractArticleText", () => {
  it("keeps meaningful expandable council panels when Readability drops them", () => {
    const html = `<!doctype html><html><head><meta property="og:type" content="article"><title>Mayor and City Council</title></head><body>
      <header><nav>Departments Services Search</nav></header>
      <main id="main-content">
        <div class="page-template-default-side-menu side-menu"><nav>Unrelated department menu</nav>
        <h1>Mayor and City Council</h1>
        <button class="accordion-button" aria-expanded="false" aria-controls="mayor-panel">Mayor Julia Hidalgo</button>
        <div id="mayor-panel" class="accordion-content_content">Contact Mayor Hidalgo about city policy and council matters.</div>
        <div class="contact">City Hall contact information and office hours.</div>
        </div>
      </main><footer>Privacy Sitemap</footer></body></html>`;
    const result = extractArticleText(html, "https://city.example.gov/mayor-city-council");
    assert.match(result.text, /Julia Hidalgo/);
    assert.match(result.text, /city policy and council matters/);
    assert.doesNotMatch(result.text, /Unrelated department menu/);
  });

  it("keeps the normal article path when an article contains an expandable control", () => {
    const body = "The council approved a transportation plan after a public hearing. The plan funds safer crossings and a new bus shelter.";
    const html = `<html><head><title>Transportation plan approved</title></head><body><article>
      <h1>Transportation plan approved</h1><button aria-controls="details" aria-expanded="false">Show details</button>
      <p>${body}</p><div id="details">Additional meeting context.</div>
    </article></body></html>`;
    const result = extractArticleText(html, "https://news.example.org/transportation-plan-approved");
    assert.equal(result.method, "readability");
    assert.match(result.text, /transportation plan/);
  });

  it("does not trigger expandable-panel recovery for a plain generic main", () => {
    const html = `<html><head><title>City contacts</title></head><body><main>
      <h1>City contacts</h1><p>Call the clerk's office for general information about permits, public meetings, records requests, accessibility services and general questions from residents.</p>
    </main></body></html>`;
    const result = extractArticleText(html, "https://city.example.gov/contacts");
    assert.equal(result.method, "readability");
    assert.match(result.text, /clerk's office/);
  });

  it("does not trigger expandable-panel recovery for details outside main", () => {
    const html = `<!doctype html><html><body>
      <details><summary>Navigation</summary><p>Hidden navigation content.</p></details>
      <main><h1>City contacts</h1><p>The city clerk accepts public-record requests during ordinary business hours by email, phone, or in person at the municipal office.</p></main>
    </body></html>`;
    const result = extractArticleText(html, "https://example.test/contacts");
    assert.equal(result.method, "readability");
    assert.match(result.text, /city clerk/i);
  });

  it("recovers dated static news cards when Readability keeps only listing controls", () => {
    // Reduced from the public /news response observed 2026-09-09: the cards
    // already exist in server HTML; the loading-more marker is not an empty app.
    const html = `<html><head><title>News archive</title></head><body><main id="main-content" class="main h-header--mobile">
      <div>Filter<p>Department</p>All Departments<p>Category</p>All Categories<p>Type</p>All
        <div>Email Signup<p>Sign up for our emails to receive the latest news and alerts.</p>Sign Up</div>
      </div><div role="region" aria-live="polite">3018 results found</div>
      <label>Sort news by</label><select><option>Newest to Oldest</option></select>
      <div id="news-article-container">
        <div class="card-article"><a href="/news/clean-air/">
          <div>Longmont Recognized as a Clean Air Champion</div><div class="card-article__date">September 8, 2026</div></a></div>
        <div class="card-article"><a href="/news/cooling-parks/">
          <div>New Cooling Features at Three City Parks</div><div class="card-article__date">August 31, 2026</div></a></div>
      </div><div id="archive-news-article-loading"><span>Loading more news &amp; alerts...</span></div>
    </main></body></html>`;
    const result = extractArticleText(html, "https://example.test/news/");
    assert.match(result.text, /Clean Air Champion/);
    assert.match(result.text, /September 8, 2026/);
    assert.match(result.text, /Cooling Features/);
    assert.match(result.text, /August 31, 2026/);
  });

  it("keeps genuine article prose discussing loading results and sorting", () => {
    const body = "The library is loading more news into its historical archive. Researchers found 3018 results from its first collection and can sort the results by date. The project opens Tuesday and includes records donated by local families.";
    const result = extractArticleText(`<html><head><title>Library archive</title></head><body><article><p>${body}</p></article></body></html>`);
    assert.equal(result.text, body);
    assert.equal(result.method, "readability");
  });
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

// Saved public pages from the October 9 research capture, trimmed offline.
// Scripts/styles are removed; the larger pages also lose image-only markup
// and unused attributes. Expected text was captured before the extractor edit.
// Fixture-local attributes preserve its whitespace through Windows/Linux Git.
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/article-extract/${name}`, import.meta.url), "utf8");

describe("saved list pages", () => {
  // Count whole, distinct cards, not date words in chrome or partial cards.
  const downtownCards = (html: string) => [...new Set(
    Array.from(parseHTML(html).document.querySelectorAll("a.evcard"))
      .map((card) => htmlToPlainText(card.innerHTML)),
  )];
  const inWindow = (text: string, cards: string[]) =>
    cards.filter((card) => text.slice(0, 14_000).includes(card)).length;

  it("puts more complete dated Downtown cards inside the unchanged reader window", () => {
    const html = fixture("chk-downtown-events.html");
    const cards = downtownCards(html);
    const result = extractArticleText(html);
    // Measured on 47e11c69: 116 of 197 distinct cards already fit in this
    // trimmed saved fixture. A 3x gain here would exceed its entire inventory.
    assert.ok(inWindow(result.text, cards) > 116);
    assert.ok(result.text.startsWith(cards.join("\n\n")), "keep every card's text and page order");
    for (const card of cards) assert.equal(result.text.split(card).length - 1, 1);
  });

  it("at least triples dated cards in a crowded variant of the saved Downtown page", () => {
    const html = fixture("chk-downtown-events.html");
    const { document } = parseHTML(html);
    // Deliberately synthetic undated link blocks reproduce window crowding;
    // the saved page and every one of its event cards remain unchanged.
    const information = document.createElement("section");
    information.innerHTML = Array.from({ length: 22 }, (_, i) =>
      `<div class="information"><a href="/info-${i}">Community information ${i}: ${"Learn about downtown businesses and community services. ".repeat(10)}${i === 0 ? " More community information.".repeat(7) : ""}</a></div>`,
    ).join("");
    const grid = document.querySelector("a.evcard")!.parentElement!.parentElement!;
    grid.parentElement!.insertBefore(information, grid);
    const result = extractArticleText(document.toString());
    // Before the change, this variant admits exactly two complete dated cards.
    assert.ok(inWindow(result.text, downtownCards(html)) >= 3 * 2);
    assert.ok(result.text.slice(0, 14_000).includes("Lunch Bunch"));
    assert.ok(result.text.includes("Community information 21:"));
  });

  it("stably prioritizes date and time items, removes exact duplicates, and preserves item text", () => {
    const undated = ["Marching band community registration", "Sunny community activity information", "Undated community activity information"];
    const dated = [
      "Workshop on October 12 with local artists",
      "Community workshop on Oct. 12 with artists",
      "Community workshop Monday with artists",
      "Community workshop Thu. with artists",
      "Community workshop 10/12 with artists",
      "Community workshop 6:30 pm with artists",
      "Community workshop 12pm with artists",
      "Community workshop at 18:30 with artists",
      "Community workshop on MAY 12 with artists",
    ];
    const nearDuplicate = dated[0].toLowerCase();
    const item = (text: string) => `<li><a href="/event">${text}</a></li>`;
    const formatted = "Workshop\n\nTuesday\n\n6:30 pm\n\nOriginal evidence, unchanged.";
    const html = `<html><body><main><article><p>A community calendar introduces the available activities and helps residents find local workshops and gatherings.</p></article></main>
      <ul>${item(undated[0])}${dated.slice(0, 5).map(item).join("")}${item(undated[1])}</ul>
      <section><ul>${item(undated[2])}${dated.slice(5).map(item).join("")}${item(dated[0])}${item(nearDuplicate)}<li><h3>Workshop</h3><div>Tuesday</div><div>6:30 pm</div><p>Original evidence, unchanged.</p></li></ul></section>
      <footer>Unrelated footer links</footer></body></html>`;
    const result = extractArticleText(html);
    assert.equal(result.method, "heuristic");
    const expected = [...dated, nearDuplicate, formatted, ...undated];
    assert.ok(result.text.startsWith(expected.join("\n\n")), result.text);
    assert.equal(result.text.split(dated[0]).length - 1, 1);
    assert.ok(result.text.includes("A community calendar introduces"));
    assert.doesNotMatch(result.text, /Unrelated footer links/);
  });

  it("preserves whole outer cards when nested sibling lists also qualify", () => {
    const cards = Array.from({ length: 12 }, (_, i) => `<div class="card"><a href="/workshop-${i}"><h2>October workshop ${i}</h2><ul>${Array.from({ length: 6 }, (_, j) => `<li>Community session ${i}/${j} details for participants</li>`).join("")}</ul></a></div>`);
    const html = `<html><body><main><article><p>This calendar introduces community activities, workshops and sessions for residents who want to learn new skills.</p></article></main><section>${cards.join("")}</section></body></html>`;
    const result = extractArticleText(html);
    const expected = cards.map((card) => htmlToPlainText(card));
    assert.equal(result.method, "heuristic");
    assert.ok(result.text.startsWith(expected.join("\n\n")), result.text);
    for (const card of expected) assert.equal(result.text.split(card).length - 1, 1);
  });

  it("keeps exact saved article and non-recovered calendar text including dates and times", () => {
    for (const name of ["lpm-events", "timescall-loc-longmont"]) {
      const result = extractArticleText(fixture(`${name}.html`));
      assert.equal(result.method, "readability");
      assert.equal(result.text, fixture(`${name}.expected.txt`));
    }
  });

  it("guards: Downtown calendar event cards must not disappear behind its introduction", () => {
    const result = extractArticleText(fixture("chk-downtown-events.html"));
    assert.ok(result.text.length >= 10_000, `only ${result.text.length} characters survived`);
    for (const title of [
      "$3 Beers on Fridays!",
      "Discovery Days: Art with Ms. Leigh and Henry",
      "Lunch Bunch",
      "Friday Afternoon Concert: Mariachi Las Dahlias",
      "AWW Presents THAT EIGHTIES BAND - Rewind to the 80s Party!",
    ]) assert.ok(result.text.includes(title), `missing ${title}`);
    assert.doesNotMatch(result.text, /Privacy Policy|Toggle navigation/i);
  });

  it("guards: a huge repeated menu must not crowd out one article", () => {
    const menu = Array.from({ length: 500 }, (_, i) =>
      `<li><a href="/department-${i}">Department ${i} meetings October 9, 2026</a></li>`,
    ).join("");
    const body = "The council approved safer crossings after residents described dangerous intersections. The transportation plan funds two new bus shelters and improvements to the community trail.";
    const result = extractArticleText(`<html><body><header><nav><ul>${menu}</ul></nav></header><main><article><p>${body}</p></article></main><footer>Privacy policy</footer></body></html>`);
    assert.equal(result.text, body);
    assert.equal(result.method, "readability");
  });

  for (const name of ["lpm-events", "timescall-loc-longmont"]) {
    it(`guards: ${name} must retain its exact pre-change extraction`, () => {
      assert.equal(extractArticleText(fixture(`${name}.html`)).text, fixture(`${name}.expected.txt`));
    });
  }

  it("guards: index rows outside the intro article must survive without site furniture", () => {
    const body = "Browse the latest community stories, events and announcements from local organizations throughout the city.";
    const rows = Array.from({ length: 12 }, (_, i) => `<li><a href="/story-${i}">Community story ${i}: local artists open their studios this weekend</a></li>`).join("");
    const html = `<html><body><div class="mega-menu">${rows.replaceAll("Community story", "Menu item")}</div><main><article><p>${body}</p></article></main><section><ul>${rows}</ul></section><div class="cookie">Accept cookies</div><footer>Footer links</footer></body></html>`;
    const result = extractArticleText(html);
    assert.match(result.text, /Community story 11/);
    assert.doesNotMatch(result.text, /Menu item|Accept cookies|Footer links/);
    assert.equal(result.method, "heuristic");
  });

  it("guards: low retained share alone must not replace a genuine article with one long link", () => {
    const body = "The council approved safer crossings after residents described dangerous intersections. The plan funds two new bus shelters.";
    const background = `<section><a href="/background">${"General background about the community. ".repeat(200)}</a></section>`;
    const result = extractArticleText(`<html><body><main><article><p>${body}</p></article></main>${background}</body></html>`);
    assert.equal(result.text, body);
    assert.equal(result.method, "readability");
  });
});
