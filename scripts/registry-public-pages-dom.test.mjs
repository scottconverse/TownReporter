/*
  The public registry pages, rendered from the real route files (Phase 4, job B).

  WHAT THIS PROVES. `/registry` fills its search form from the URL, says how many
  services were found, shows the empty states, shows Previous and Next only when
  there is somewhere to go, links each service name to `/registry/<id>`, and
  builds the correction link's `article` text exactly. `/registry/<id>` shows
  each field group in order, leaves out an empty one, keeps a place's own hours,
  phones and accessibility with that place, and answers "not listed" (a thrown
  `notFound()`, which the framework sends as 404) and "unavailable" separately.

  The server functions are stubs (a `.server` module cannot load here); what they
  read is measured in registry-public-*.server.test.ts. The route files, the
  correction-text helper and the verify-method words are the real ones.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";

installDom();

const state = { search: {}, data: null, calls: [] };
globalThis.__registryState = state;

const routerUrl = stubUrl(`
export function createFileRoute(path) {
  return (options) => ({
    path,
    options,
    useSearch: () => globalThis.__registryState.search,
    useLoaderData: () => globalThis.__registryState.data,
  });
}
export function notFound() { const e = new Error("NOT_FOUND"); e.isNotFound = true; return e; }
`);
const chromeUrl = stubUrl(`export function PaperShell({ children }) { return children; }`);
const contextUrl = stubUrl(
  `export function usePaperDateFormatters() { return { formatShortDate: () => "Sep 1, 2026" }; }`,
);
const identityUrl = stubUrl(`export const DEFAULT_PAPER_IDENTITY = { name: "The Paper" };`);
const publicUrl = stubUrl(`
export async function searchPublicRegistryPage({ data }) {
  globalThis.__registryState.calls.push(["search", data]);
  return globalThis.__registryState.searchAnswer;
}
export async function getPublicRegistryServicePage({ data }) {
  globalThis.__registryState.calls.push(["service", data]);
  return globalThis.__registryState.serviceAnswer;
}
export async function getPublicRegistryOrigin() { return "https://paper.example"; }
`);
const correctionUrl = await moduleUrl("src/lib/news/registry/registry-correction.ts");
const copyUrl = await moduleUrl("src/lib/news/registry/registry-entry-copy.ts");
const methodsUrl = await moduleUrl("src/lib/news/registry/registry-verify-methods.ts");
// The 988/211 phone links are drawn by the real component (F18/F19); its only
// import is the pure `telHref` helper, which is loaded for real too.
const phoneUrl = await moduleUrl("src/components/registry-phone.tsx", {
  "@/lib/news/registry/registry-phone": await moduleUrl("src/lib/news/registry/registry-phone.ts"),
});
const imports = {
  "@tanstack/react-router": routerUrl,
  "@/components/paper-chrome": chromeUrl,
  "@/components/registry-phone": phoneUrl,
  "@/lib/paper-context-state": contextUrl,
  "@/lib/paper-identity": identityUrl,
  "@/lib/news/registry/registry-public": publicUrl,
  "@/lib/news/registry/registry-correction": correctionUrl,
  "@/lib/news/registry/registry-entry-copy": copyUrl,
  "@/lib/news/registry/registry-verify-methods": methodsUrl,
};
const { Route: listRoute } = await import(await moduleUrl("src/routes/registry.tsx", imports));
const { Route: detailRoute } = await import(await moduleUrl("src/routes/registry_.$id.tsx", imports));

const ORIGIN = "https://paper.example";

function entry(overrides = {}) {
  return {
    serviceId: 7,
    hsdsId: "hs-7",
    directory: "county-211",
    status: "active",
    fees: null,
    applicationProcess: null,
    serviceUrl: null,
    serviceEmails: [],
    eligibility: [],
    requiredDocuments: [],
    accessibility: [],
    sources: [],
    organizationName: "Helping Hands",
    serviceName: "Food pantry",
    description: null,
    organizationPhones: [],
    servicePhones: [],
    serviceHours: [],
    locations: [],
    languages: [],
    lastVerifiedAt: null,
    verifiedAt: null,
    verifiedMethod: null,
    robotCheckedAt: null,
    robotCheckedSite: null,
    sourceUrl: null,
    sourceTitle: null,
    editorNote: null,
    categoryId: null,
    categoryName: null,
    ...overrides,
  };
}

function okResult(overrides = {}) {
  return {
    status: "ok",
    entries: [entry()],
    categories: [
      { id: 2, name: "Food" },
      { id: 3, name: "Housing" },
    ],
    languages: ["Spanish", "Vietnamese"],
    total: 1,
    page: 1,
    pageSize: 25,
    ...overrides,
  };
}

function renderList(result, search = {}) {
  state.search = search;
  state.data = { result, origin: ORIGIN };
  return renderToStaticMarkup(createElement(listRoute.options.component));
}

function renderDetail(result) {
  state.data = { result, origin: ORIGIN };
  return renderToStaticMarkup(createElement(detailRoute.options.component));
}

const articleFor = (id, org, svc) =>
  `Community resource ${id}: ${org} — ${svc} (${ORIGIN}/registry/${id})`;

test("the search form is a labelled GET form that fills from the URL", () => {
  const html = renderList(okResult(), { q: "food", category: 3, language: "Spanish" });
  assert.match(html, /<form[^>]*action="\/registry"[^>]*method="get"/);
  assert.match(html, /<label for="registry-q">Search<\/label>/);
  assert.match(html, /<label for="registry-category">Category<\/label>/);
  assert.match(html, /<label for="registry-language">Language<\/label>/);
  assert.match(html, /<input[^>]*id="registry-q"[^>]*name="q"[^>]*value="food"/);
  assert.match(html, /<option value="3" selected="">Housing<\/option>/);
  assert.match(html, /<option value="Spanish" selected="">Spanish<\/option>/);
  assert.match(html, /<button[^>]*type="submit"[^>]*>Search<\/button>/);
  // A language in the URL that is not in the list is still offered, so the form
  // never silently drops the reader's choice.
  const odd = renderList(okResult(), { language: "Navajo" });
  assert.match(odd, /<option value="Navajo" selected="">Navajo<\/option>/);
});

test("the route validates its search, and reads with them", async () => {
  const v = listRoute.options.validateSearch;
  assert.deepEqual(v({ q: "  food  ", category: "3", language: "Spanish", page: "2" }), {
    q: "food",
    category: 3,
    language: "Spanish",
    page: 2,
  });
  assert.deepEqual(v({ q: "", category: "abc", language: "", page: "0" }), {});
  assert.equal(v({ q: "x".repeat(500) }).q.length, 200);
  state.calls.length = 0;
  state.searchAnswer = okResult();
  const deps = listRoute.options.loaderDeps({ search: { q: "food", page: 2 } });
  assert.deepEqual(deps, { q: "food", category: null, language: "", page: 2 });
  const loaded = await listRoute.options.loader({ deps });
  assert.equal(loaded.origin, ORIGIN);
  assert.deepEqual(state.calls[0], ["search", deps]);
});

test("the count line, the empty states and the clear link", () => {
  assert.match(renderList(okResult()), /1 service(?!s)/);
  const many = okResult({ entries: [entry()], total: 3 });
  assert.match(renderList(many), /3 services/);

  const none = renderList(okResult({ entries: [], total: 0 }), { q: "zzz" });
  assert.match(none, /No services match your search\./);
  assert.match(none, /<a href="\/registry">Clear the search<\/a>/);

  const bare = renderList(okResult({ entries: [], total: 0 }));
  assert.match(bare, /No entries are published yet\./);
  assert.doesNotMatch(bare, /No services match your search/);

  const unavailable = renderList({ status: "unavailable" });
  assert.match(unavailable, /could not be loaded just now/);
  assert.doesNotMatch(unavailable, /No entries are published yet/);
});

test("Previous and Next appear only when there is somewhere to go", () => {
  const link = (html, rel) => html.match(new RegExp(`<a[^>]*rel="${rel}"[^>]*href="([^"]*)"`))?.[1];
  const one = renderList(okResult({ total: 25 }), { q: "food" });
  assert.doesNotMatch(one, /Next page|Previous page/);
  const first = renderList(okResult({ total: 26 }), { q: "food" });
  assert.equal(link(first, "next"), "/registry?q=food&amp;page=2");
  assert.doesNotMatch(first, /Previous page/);
  const last = renderList(okResult({ total: 26, page: 2 }), { q: "food", page: 2 });
  assert.equal(link(last, "prev"), "/registry?q=food");
  assert.doesNotMatch(last, /Next page/);
  const middle = renderList(okResult({ total: 60, page: 2 }), { category: 2, page: 2 });
  assert.equal(link(middle, "prev"), "/registry?category=2");
  assert.equal(link(middle, "next"), "/registry?category=2&amp;page=3");
});

test("each service name links to its own page, and the list keeps what it showed", () => {
  const html = renderList(
    okResult({
      entries: [
        entry({
          description: "Free groceries.",
          languages: ["Spanish"],
          editorNote: "Call first.",
          sourceUrl: "https://county.example/food",
          sourceTitle: "County list",
          locations: [
            { locationId: 1, name: "Main site", address: "1 Main St", phones: ["555-0100"], hours: ["Mon 9-5"], accessibility: [] },
          ],
        }),
      ],
    }),
  );
  assert.match(html, /<h3><a[^>]*href="\/registry\/7"[^>]*>Helping Hands — Food pantry<\/a><\/h3>/);
  for (const text of [
    "Free groceries.",
    "Phone at this location: ",
    "Hours at this location: Mon 9-5",
    "Languages: Spanish",
    "Not verified yet",
    "Editor&#x27;s note:",
    "County list",
    "Something wrong here?",
  ])
    assert.ok(html.includes(text), `list still shows ${text}`);
  // The phone is a tappable `tel:` link, and the printed text is unchanged (F18).
  assert.match(html, /Phone at this location: <a[^>]*href="tel:5550100"[^>]*>555-0100<\/a>/);
});

test("the correction link carries the id, the names and the full service URL, exactly", () => {
  const html = renderList(okResult());
  const href = html.match(/<a[^>]*href="(\/corrections\?article=[^"]*)"/)?.[1];
  assert.equal(
    href,
    `/corrections?article=${encodeURIComponent(articleFor(7, "Helping Hands", "Food pantry"))}`,
  );
  // Too long: cut in the name part, the URL and the closing bracket stay, and the
  // whole is within the 2000 characters /corrections keeps.
  const long = renderList(okResult({ entries: [entry({ serviceName: "S".repeat(3000) })] }));
  const longHref = long.match(/<a[^>]*href="(\/corrections\?article=[^"]*)"/)[1];
  const article = decodeURIComponent(longHref.slice("/corrections?article=".length));
  assert.equal(article.length, 2000);
  assert.ok(article.endsWith(` (${ORIGIN}/registry/7)`));
  assert.ok(article.startsWith("Community resource 7: Helping Hands — SSS"));
});

const fullEntry = () =>
  entry({
    status: "active",
    description: "Groceries for families.",
    fees: "Free",
    applicationProcess: "Walk in with ID.",
    serviceUrl: "https://pantry.example",
    serviceEmails: ["help@pantry.example"],
    eligibility: ["Lives in the county"],
    requiredDocuments: [
      { document: "Photo ID", description: "Any state ID", required: true },
    ],
    accessibility: ["Step-free entrance (service)"],
    languages: ["Spanish", "Vietnamese"],
    locations: [
      {
        locationId: 1,
        name: "North site",
        address: "1 North St, Town, CO 80000",
        phones: ["555-0101"],
        hours: ["Mon 9-5"],
        accessibility: ["Ramp at north door"],
      },
      {
        locationId: 2,
        name: "South site",
        address: "2 South St, Town, CO 80000",
        phones: ["555-0202"],
        hours: ["Sat 10-2"],
        accessibility: ["Elevator"],
      },
    ],
    servicePhones: ["555-0300"],
    serviceHours: ["Weekdays 8-4"],
    organizationPhones: ["555-0400"],
    sources: [
      { url: "https://county.example/food", title: "County list", appliesTo: "service" },
      { url: "https://org.example", title: "Org page", appliesTo: "organization" },
    ],
    verifiedAt: "2026-09-01T12:00:00.000Z",
    verifiedMethod: "phone",
    editorNote: "Closed on holidays.",
    categoryName: "Food",
  });

test("the detail page shows every field group, in order", () => {
  const html = renderDetail({ status: "ok", entry: fullEntry() });
  const order = [
    "<b>Organization:</b> Helping Hands",
    "<b>Service:</b> Food pantry",
    "<b>Status:</b> Active",
    "Groceries for families.",
    "<b>Fees:</b> Free",
    "Walk in with ID.",
    'href="https://pantry.example"',
    'href="mailto:help@pantry.example"',
    "Lives in the county",
    "Photo ID (required): Any state ID",
    "Languages: Spanish, Vietnamese",
    "North site",
    "1 North St, Town, CO 80000",
    "Phone for this service: ",
    "Hours for this service: Weekdays 8-4",
    "Main phone of Helping Hands: ",
    "County list",
    "Org page",
    "Verified Sep 1, 2026",
    "Closed on holidays.",
  ];
  let at = -1;
  for (const text of order) {
    const found = html.indexOf(text);
    assert.ok(found > at, `${text} appears, after the field before it`);
    at = found;
  }
  assert.match(html, /<h1>Helping Hands — Food pantry<\/h1>/);
  // Each phone is a `tel:` link that keeps the number as it was printed (F18).
  for (const [label, phone] of [
    ["Phone for this service: ", "5550300"],
    ["Main phone of Helping Hands: ", "5550400"],
    ["Phone at this location: ", "5550101"],
  ])
    assert.match(
      html,
      new RegExp(`${label}<a[^>]*href="tel:${phone}"[^>]*>${phone.replace(/^(\d{3})(\d{4})$/, "$1-$2")}</a>`),
    );
});

test("an empty field is left out, not shown blank", () => {
  const html = renderDetail({ status: "ok", entry: entry() });
  for (const text of [
    "Fees:",
    "How to apply:",
    "Website:",
    "Email:",
    "Who can use it",
    "What to bring",
    "Languages",
    "Places",
    "For the whole service",
    "Main phone of",
    "Sources",
    "Editor&#x27;s note",
    "Category:",
  ])
    assert.ok(!html.includes(text), `${text} is not shown when empty`);
  assert.match(html, /Not verified yet/);
  assert.match(html, /<b>Organization:<\/b> Helping Hands/);
});

test("each place keeps its own address, phones, hours and accessibility", () => {
  const html = renderDetail({ status: "ok", entry: fullEntry() });
  const north = html.slice(html.indexOf("North site"), html.indexOf("South site"));
  const south = html.slice(html.indexOf("South site"), html.indexOf("For the whole service"));
  assert.ok(north.includes("555-0101") && north.includes("Mon 9-5") && north.includes("Ramp at north door"));
  assert.ok(!north.includes("555-0202") && !north.includes("Elevator") && !north.includes("Sat 10-2"));
  assert.ok(south.includes("555-0202") && south.includes("Sat 10-2") && south.includes("Elevator"));
  assert.ok(!south.includes("555-0101") && !south.includes("Ramp at north door"));
});

test("an unknown, unpublished or removed id is 'not listed' (404); an unreadable read is 'unavailable'", async () => {
  state.calls.length = 0;
  state.serviceAnswer = { status: "ok", entry: null };
  await assert.rejects(
    () => detailRoute.options.loader({ params: { id: "999" } }),
    (e) => e.isNotFound === true,
    "the loader throws notFound() so the framework answers 404",
  );
  assert.deepEqual(state.calls[0], ["service", { id: "999" }]);
  const notListed = renderToStaticMarkup(createElement(detailRoute.options.notFoundComponent));
  assert.match(notListed, /This service is not listed\./);
  assert.match(notListed, /<a[^>]*href="\/registry"/);

  state.serviceAnswer = { status: "unavailable" };
  const loaded = await detailRoute.options.loader({ params: { id: "7" } });
  assert.equal(loaded.result.status, "unavailable", "unreadable is not turned into 404");
  const html = renderDetail(loaded.result);
  assert.match(html, /could not be loaded just now/);
  assert.doesNotMatch(html, /This service is not listed/);
});

test("the detail page's correction link and the sentence about where it goes", () => {
  const html = renderDetail({ status: "ok", entry: fullEntry() });
  const href = html.match(/<a[^>]*href="(\/corrections\?article=[^"]*)"/)?.[1];
  assert.equal(
    href,
    `/corrections?article=${encodeURIComponent(articleFor(7, "Helping Hands", "Food pantry"))}`,
  );
  assert.match(html, /opens an email in your own email program, addressed to the editor/);
});

test("the detail page's title and description", () => {
  const head = detailRoute.options.head({
    loaderData: { result: { status: "ok", entry: fullEntry() } },
    match: { context: {} },
  });
  assert.equal(head.meta[0].title, "Helping Hands — Food pantry — The Paper");
  assert.equal(head.meta[1].content, "Groceries for families.");
  const none = detailRoute.options.head({ loaderData: undefined, match: { context: {} } });
  assert.equal(none.meta[0].title, "Community resources — The Paper");
});

// ---- Fix 2 audit: input limits, long names, empty states, unsafe links, old eyes ----

const helpers = await import(correctionUrl);

test("an out-of-range page is clamped and an out-of-range category is dropped, in the route validator", () => {
  const v = listRoute.options.validateSearch;
  assert.deepEqual(v({ page: "100000000" }), { page: 100000 });
  assert.deepEqual(v({ page: 100000000 }), { page: 100000 });
  assert.deepEqual(v({ page: "9".repeat(400) }), { page: 100000 });
  assert.deepEqual(v({ category: "99999999999" }), {});
  assert.deepEqual(v({ category: 99999999999 }), {});
  assert.deepEqual(v({ category: "999999999" }), { category: 999999999 });
  assert.equal(helpers.registryPageNumber("100000"), 100000);
  assert.equal(helpers.registryPageNumber("2.5"), 1);
});

test("a service id must be in plain form, at most 2147483647", () => {
  for (const bad of ["1e3", "1.0", "01", "2147483648", "0", "-1", " ", "", "abc", "99999999999", null, undefined, 1e21])
    assert.equal(helpers.registryServiceId(bad), null, `${String(bad)} is not listed`);
  assert.equal(helpers.registryServiceId("1000"), 1000);
  assert.equal(helpers.registryServiceId("2147483647"), 2147483647);
  assert.equal(helpers.registryServiceId(7), 7);
});

test("a very long name never breaks the correction link", () => {
  const service = "a".repeat(1942) + "😀😀😀";
  const article = helpers.registryCorrectionArticle({
    id: 7,
    organizationName: "O",
    serviceName: service,
    url: `${ORIGIN}/registry/7`,
  });
  assert.ok(article.length <= 2000, `article is ${article.length} characters`);
  assert.ok(article.endsWith(` (${ORIGIN}/registry/7)`));
  assert.doesNotThrow(() => helpers.registryCorrectionHref(article));
  // Every cut point near the end of a run of emoji builds a link.
  for (let n = 1900; n < 1990; n++) {
    const text = helpers.registryCorrectionArticle({
      id: 7,
      organizationName: "O",
      serviceName: "a".repeat(n) + "😀".repeat(10),
      url: `${ORIGIN}/registry/7`,
    });
    assert.ok(text.length <= 2000);
    assert.doesNotThrow(() => helpers.registryCorrectionHref(text), `n=${n}`);
  }
  // A lone surrogate that is already stored does not break the link either.
  assert.doesNotThrow(() =>
    helpers.registryCorrectionHref(
      helpers.registryCorrectionArticle({ id: 7, organizationName: "O\ud83d", serviceName: "x", url: "/registry/7" }),
    ),
  );
  const html = renderList(okResult({ entries: [entry({ serviceName: service })] }));
  assert.match(html, /href="\/corrections\?article=/);
});

test("a category-only empty result shows the category sentence alone", () => {
  const html = renderList(okResult({ entries: [], total: 0 }), { category: 3 });
  assert.match(html, /No published entries are filed under Housing yet\./);
  assert.doesNotMatch(html, /No services match your search/);
  const unknown = renderList(okResult({ entries: [], total: 0 }), { category: 99 });
  assert.match(unknown, /filed under this category yet/);
  assert.doesNotMatch(unknown, /No services match your search/);
});

test("an empty result with a search word or a language shows the search sentence", () => {
  for (const search of [{ category: 3, q: "zzz" }, { category: 3, language: "Spanish" }, { language: "Spanish" }]) {
    const html = renderList(okResult({ entries: [], total: 0 }), search);
    assert.match(html, /No services match your search\./);
    assert.doesNotMatch(html, /No published entries are filed under/);
  }
});

test("only http and https values become links; the stored value is still shown as text", () => {
  const bad = renderDetail({
    status: "ok",
    entry: entry({
      serviceUrl: "javascript:alert(1)",
      sources: [
        { url: "hsds://p4-verify", title: "Odd source", appliesTo: "service" },
        { url: "https://ok.example/s", title: "Good source", appliesTo: "service" },
      ],
    }),
  });
  assert.doesNotMatch(bad, /href="javascript:/i);
  assert.doesNotMatch(bad, /href="hsds:/i);
  assert.ok(bad.includes("javascript:alert(1)"), "the value is shown as plain text");
  assert.ok(bad.includes("Odd source"));
  assert.match(bad, /href="https:\/\/ok\.example\/s"/);
  const list = renderList(
    okResult({ entries: [entry({ sourceUrl: "hsds://p4-verify", sourceTitle: "Odd source" })] }),
  );
  assert.doesNotMatch(list, /href="hsds:/i);
  assert.ok(list.includes("Odd source"));
  const good = renderList(
    okResult({ entries: [entry({ sourceUrl: "http://county.example/a", sourceTitle: "County" })] }),
  );
  assert.match(good, /href="http:\/\/county\.example\/a"/);
  for (const value of ["javascript:alert(1)", " JaVaScRiPt:x", "data:text/html,x", "hsds://x", "example.com", "//x.example", ""])
    assert.equal(helpers.safeWebUrl(value), null, value);
  assert.equal(helpers.safeWebUrl("https://a.example"), "https://a.example");
});

test("the service link, the correction links, the search box and the Search button are 16px (text-base and the registry rule)", () => {
  const html = renderList(okResult());
  assert.match(html, /<input[^>]*class="[^"]*\btext-base\b[^"]*\bregistry-text\b[^"]*"[^>]*id="registry-q"|<input[^>]*id="registry-q"[^>]*class="[^"]*\bregistry-text\b/);
  assert.match(html, /<button[^>]*class="[^"]*\bregistry-text\b[^"]*"[^>]*type="submit"/);
  assert.match(html, /<h3><a[^>]*class="[^"]*\bregistry-text\b[^"]*"[^>]*href="\/registry\/7"/);
  assert.match(html, /<a[^>]*class="[^"]*\bregistry-text\b[^"]*"[^>]*href="\/corrections\?article=/);
  const detail = renderDetail({ status: "ok", entry: fullEntry() });
  assert.match(detail, /<a[^>]*class="[^"]*\bregistry-text\b[^"]*"[^>]*href="\/corrections\?article=/);
});

test("a robot recheck says when it was last checked and against which site, never 'verified'", () => {
  const html = renderDetail({
    status: "ok",
    entry: entry({
      robotCheckedAt: "2026-11-18T12:00:00.000Z",
      robotCheckedSite: "county.example",
      sourceUrl: "https://county.example/food",
    }),
  });
  assert.match(html, /Last checked .* — checked against county\.example/);
  assert.doesNotMatch(html, /Verified/);
  assert.doesNotMatch(html, /Not verified yet/);
});

test("the newer of the editor's check and the robot's recheck is the one shown", () => {
  // An editor checked it after the robot did: the editor's "Verified" stands.
  const editorNewer = renderDetail({
    status: "ok",
    entry: entry({
      verifiedAt: "2026-11-19T12:00:00.000Z",
      verifiedMethod: "phone",
      robotCheckedAt: "2026-11-18T12:00:00.000Z",
      robotCheckedSite: "county.example",
    }),
  });
  assert.match(editorNewer, /Verified .*\(by phone\)/);
  assert.doesNotMatch(editorNewer, /Last checked/);

  // Only the robot has checked it: no "verified" claim anywhere.
  const robotOnly = renderDetail({
    status: "ok",
    entry: entry({ robotCheckedAt: "2026-11-18T12:00:00.000Z", robotCheckedSite: "county.example" }),
  });
  assert.match(robotOnly, /Last checked .* — checked against county\.example/);
  assert.doesNotMatch(robotOnly, /Verified/);
});
