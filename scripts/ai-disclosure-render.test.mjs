import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

/*
  The reader-facing disclosure line, rendered from the real pages.

  - src/routes/articles.$slug.tsx  (every article page)
  - src/routes/how-we-report.tsx   (the standing "How we report" page)

  Both route modules are transpiled as they are and loaded with their
  non-page imports stubbed (router, query, chrome, controls) -- the same
  pattern scripts/lead-badge-render.test.mjs uses. The two modules that
  actually decide the sentence are real: @/components/ai-disclosure, and the
  article's own body renderer.
*/
function moduleUrl(source, fileName, imports = {}) {
  let output = ts.transpileModule(source, {
    fileName,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [name, url] of Object.entries(imports)) {
    output = output.replaceAll(JSON.stringify(name), JSON.stringify(url));
  }
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

function inlineModule(source) {
  const rewritten = source.replaceAll('"react"', JSON.stringify(import.meta.resolve("react")));
  return `data:text/javascript;base64,${Buffer.from(rewritten).toString("base64")}`;
}

const REACT = import.meta.resolve("react");
const JSX = import.meta.resolve("react/jsx-runtime");

const pageImports = {
  react: REACT,
  "react/jsx-runtime": JSX,
  "lucide-react": import.meta.resolve("lucide-react"),
};

const aiDisclosureUrl = moduleUrl(
  await readFile(new URL("../src/components/ai-disclosure.tsx", import.meta.url), "utf8"),
  "ai-disclosure.tsx",
  pageImports,
);

const storyBodyUrl = moduleUrl(
  await readFile(new URL("../src/components/story-body.tsx", import.meta.url), "utf8"),
  "story-body.tsx",
  pageImports,
);

/* 0.6.80 (CK): the article page prints its dek through `dekOrFallback`. The
   helper is pure and imports nothing, so the real module loads here. */
const dekFallbackUrl = moduleUrl(
  await readFile(new URL("../src/lib/news/dek-fallback.ts", import.meta.url), "utf8"),
  "dek-fallback.ts",
  pageImports,
);

/* The article the page is showing. The route reads it through useQuery, so
   the query stub is the seam that lets a test set the story. */
const reactQueryStub = inlineModule(`
  let article = null;
  export function __setArticle(a) { article = a; }
  export function useQuery(input) {
    return { data: input && input.queryKey && input.queryKey[0] === "article" ? article : [], isPending: false };
  }
`);

const reactRouterStub = inlineModule(`
  import { createElement } from "react";
  export function createFileRoute(path) {
    return (options) => ({
      options,
      useParams: () => ({ slug: "the-story" }),
      /*
        The route's loader always returns an object -- article, dates and
        legalGone, the last being whether the desk removed this slug on legal
        advice (BH6). The stub used to hand back undefined, which the component
        read as loaded?.article; now that the component asks loaded.legalGone
        before anything else, the stub has to answer the way the real router
        does. The article the page shows still comes from the query stub,
        exactly as before.
      */
      useLoaderData: () => ({ article: null, dates: null, legalGone: false }),
    });
  }
  export function notFound() { return new Error("not found"); }
  export function Link({ to, children, ...rest }) {
    return createElement("a", { href: String(to ?? "#"), ...rest }, children);
  }
`);

const chromeStub = inlineModule(`
  import { createElement } from "react";
  export function PaperShell({ children }) { return createElement("div", { className: "reader" }, children); }
`);
const statesStub = inlineModule(`
  import { createElement } from "react";
  export function EmptyState() { return createElement("div"); }
  export function StorySkeleton() { return createElement("div"); }
`);
const controlsStub = inlineModule(`
  import { createElement } from "react";
  export function ReaderRow() { return createElement("div"); }
  export function SaveStory() { return createElement("span"); }
  export function ShareStory() { return createElement("span"); }
  export function ReadingButton() { return createElement("span"); }
  export function CopyButton() { return createElement("span"); }
`);
const provenanceStub = inlineModule(`
  import { createElement } from "react";
  /* The real block carries the \`#sources\` anchor itself (unit DA2); it used to
     be wrapped in a \`<section id="sources">\` here. The stub honours the prop so
     the page this test renders has the same anchor the product's has. */
  export function ProvenanceBlock({ id, items }) {
    return createElement("div", { className: "provenance", id }, String((items ?? []).length));
  }
`);
const beaconStub = inlineModule(`export function ViewBeacon() { return null; }`);
const readBeaconStub = inlineModule(`export function ReadBeacon() { return null; }`);
const deskChromeUtilsStub = inlineModule(`export const inkGhost = "";`);
const publicStub = inlineModule(`
  export async function getPublishedArticle() { return null; }
  export async function listPublishedArticles() { return []; }
`);
/*
  This route gained a legality check of its own -- a slug that was removed on
  legal advice answers 410 Gone before the page renders, on a full load by the
  route's own handler and in the browser by this check in the loader. None of it
  is what the disclosure line is made of, so it is stubbed the way every other
  non-page import here is: "not legally removed", which is the answer an
  ordinary article gets. The three exports added by unit BH6
  (`isLegallyRemovedForReader` and the removal page's two strings, which the
  route prints when it does answer "removed") are here for the same reason: a
  `data:` module that does not export a name the route imports fails to load.
  The assertions below are untouched.
*/
const legalGoneStub = inlineModule(`
  export async function isLegallyRemovedSlug() { return false; }
  export async function isLegallyRemovedForReader() { return false; }
  export function legalGoneResponse() { return new Response(null, { status: 410 }); }
  export const LEGAL_GONE_TITLE = "This story was removed.";
  export const LEGAL_GONE_BODY = "This page is gone for good. It was removed from the paper, and the record of the story is no longer published here.";
`);
const paperStub = inlineModule(`
  export function parseUrlList(value) { try { const p = JSON.parse(value || "[]"); return Array.isArray(p) ? p : []; } catch { return []; } }
  export function siteUrl(path) { return String(path); }
`);
const paperContextStub = inlineModule(`
  export function usePaper() { return { name: "The Paper", city: "Longmont" }; }
  export function usePaperDateFormatters() { return { formatDate: () => "September 1, 2026" }; }
`);
const paperIdentityStub = inlineModule(`
  export const DEFAULT_PAPER_IDENTITY = { name: "The Paper", city: "Longmont" };
`);
const sectionsStub = inlineModule(`export function usePublicSections() { return { sections: [] }; }`);
const readerStub = inlineModule(`export function readMinutes() { return 3; }`);
const storyDatesPublicStub = inlineModule(`
  export async function articleDates() { return []; }
  export async function thisWeekDates() { return []; }
`);
const storyDatesStub = inlineModule(`
  export function storyDateRows(items) {
    return (items ?? []).map((i) => ({ dow: "", day: "", what: i.what }));
  }
`);
const datesPanelStub = inlineModule(`
  import { createElement } from "react";
  export function DatesPanel({ title }) { return createElement("aside", null, title); }
`);
/* 0.6.78 (BX item 4): the article page hides a "misc" tag from readers through
   `isMiscTopic`; the disclosure line does not depend on it. */
const sectionTypesStub = inlineModule(`
  export function isMiscTopic(topic) { return /^misc(ellaneous)?\\.?$/i.test(String(topic ?? "").trim()); }
`);
const sectionTagStub = inlineModule(`
  import { createElement } from "react";
  export function SectionTag({ children }) { return createElement("span", null, children); }
`);

const routeImports = {
  ...pageImports,
  "@tanstack/react-router": reactRouterStub,
  "@tanstack/react-query": reactQueryStub,
  "@/components/ai-disclosure": aiDisclosureUrl,
  "@/components/story-body": storyBodyUrl,
  "@/components/paper-chrome": chromeStub,
  "@/components/states": statesStub,
  "@/components/reader-controls": controlsStub,
  "@/components/provenance": provenanceStub,
  "@/components/view-beacon": beaconStub,
  "@/components/read-beacon": readBeaconStub,
  "@/components/desk-chrome-utils": deskChromeUtilsStub,
  "@/components/paper/dates-panel": datesPanelStub,
  "@/components/paper/section-tag": sectionTagStub,
  "@/lib/news/public": publicStub,
  "@/lib/news/legal-gone": legalGoneStub,
  "@/lib/news/story-dates-public": storyDatesPublicStub,
  "@/lib/news/section-types": sectionTypesStub,
  "@/lib/story-dates": storyDatesStub,
  "@/lib/paper": paperStub,
  "@/lib/paper-context-state": paperContextStub,
  "@/lib/paper-identity": paperIdentityStub,
  "@/lib/use-sections": sectionsStub,
  "@/lib/reader": readerStub,
  "@/lib/news/dek-fallback": dekFallbackUrl,
};

const articleRoute = await import(
  moduleUrl(
    await readFile(new URL("../src/routes/articles.$slug.tsx", import.meta.url), "utf8"),
    "articles.$slug.tsx",
    routeImports,
  )
);
const howRoute = await import(
  moduleUrl(
    await readFile(new URL("../src/routes/how-we-report.tsx", import.meta.url), "utf8"),
    "how-we-report.tsx",
    routeImports,
  )
);
const { __setArticle } = await import(reactQueryStub);

const AI_LINE =
  "A person reviewed and edited this story. AI tools helped find records and write the first draft. The records we used are listed under Sources.";

function renderArticle(overrides = {}) {
  __setArticle({
    id: 1,
    slug: "the-story",
    headline: "Council approves the plan",
    dek: "A short summary.",
    body: "The council approved the plan on Tuesday.",
    topic: "council",
    source_urls: '["https://example.org/agenda"]',
    status: "published",
    published_at: "2026-09-01T12:00:00.000Z",
    provenance_json: "[]",
    provenance: [],
    findings: [],
    form: "reported",
    found_note: "[]",
    unanswered: "[]",
    corrections: [],
    routine_notice: false,
    ...overrides,
  });
  return renderToStaticMarkup(createElement(articleRoute.Route.options.component));
}

test("an article page states the AI disclosure, in the story column above the records", () => {
  const html = renderArticle();
  assert.match(html, new RegExp(AI_LINE.replace(/\./g, "\\.")));
  /*
    It closes the story body -- the drawing's last `<p>` inside `<article>` --
    and the records it points at are the band below it. So the order asserted
    here is: the body's anchor, the sentence, then the records' anchor. It used
    to be the other way round (the line was the head of `#sources`) because the
    evidence block lived inside the story column; unit DA2 moved the block out
    to a page-wide band and the sentence stayed with the story, where
    `Article Daily.dc.html` has it. The claim is unchanged: the line must not
    be buried at the foot of the page, and it must still be on the page that
    names the records.
  */
  const bodyIdx = html.indexOf('id="story-body"');
  const lineIdx = html.indexOf("A person reviewed and edited this story.");
  const sourcesIdx = html.indexOf('id="sources"');
  assert.ok(
    bodyIdx >= 0 && lineIdx > bodyIdx && sourcesIdx > lineIdx,
    "the line should render in the story column, above the sources band",
  );
});

test("a routine-notice roundup does NOT claim AI wrote it, and says what did", () => {
  const html = renderArticle({ routine_notice: true, topic: "council" });
  assert.doesNotMatch(
    html,
    /AI tools helped find records/,
    "a fixed-template roundup must not carry the story disclosure",
  );
  assert.match(html, /A fixed template assembled this routine notice from owner-approved public sources/);
  assert.match(html, /No AI wrote it/);
});

test("/how-we-report states the same disclosure sentence, word for word", () => {
  const html = renderToStaticMarkup(createElement(howRoute.Route.options.component));
  assert.match(html, new RegExp(AI_LINE.replace(/\./g, "\\.")));
});
