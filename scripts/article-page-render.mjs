import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

/*
  The article page, rendered from the real route module, for tests that read
  what a reader gets out of `src/routes/articles.$slug.tsx`.

  WHY A SHARED HARNESS AND NOT A COPY IN EACH TEST. Rendering this page needs
  twenty-odd stubs -- the router, the query, the chrome, the reader controls,
  the dates panel -- and the page gains imports over time. Two test files each
  holding their own copy of that list is how a stub map rots: the page adds an
  import, one file is updated, the other fails with "does not provide an
  export named ..." and the usual fix is to patch the copy, so the same
  knowledge is maintained twice and drifts. This module holds it once.

  It was `scripts/ai-disclosure-render.test.mjs`'s own top half until unit
  U14b needed the same page for a different property (the chip that marks a
  machine-written correction on the story). That file's assertions did not
  change when the harness moved out; only where the stubs live did.

  WHAT IS REAL AND WHAT IS NOT. The route module itself is real, transpiled
  as it is; so are the modules that decide what the page says --
  `@/components/ai-disclosure`, `@/components/story-body`, `@/components/
  correction-origin-mark` and `@/lib/news/correction-origin` -- because a
  stubbed version of any of them could not tell a test anything. Everything
  else is a minimal in-memory module, exactly as scripts/lead-badge-render
  .test.mjs does it.

  The article the page shows comes from the query stub, which is the seam
  `renderArticle` writes through.
*/

/**
 * Transpile one module's source and point its named imports somewhere else.
 * `imports` maps a specifier as written in the source (`"@/components/x"`) to
 * the URL that should replace it.
 */
export function moduleUrl(source, fileName, imports = {}) {
  let output = ts.transpileModule(source, {
    fileName,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [name, url] of Object.entries(imports)) {
    output = output.replaceAll(JSON.stringify(name), JSON.stringify(url));
  }
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

/** A stub written as source, with its one bare `react` import pointed at the real one. */
export function inlineModule(source) {
  const rewritten = source.replaceAll('"react"', JSON.stringify(import.meta.resolve("react")));
  return `data:text/javascript;base64,${Buffer.from(rewritten).toString("base64")}`;
}

export const REACT = import.meta.resolve("react");
export const JSX = import.meta.resolve("react/jsx-runtime");

export const pageImports = {
  react: REACT,
  "react/jsx-runtime": JSX,
  "lucide-react": import.meta.resolve("lucide-react"),
};

/** A REAL component or module, loaded with only its bare imports redirected. */
export async function realModule(relativePath, imports = pageImports) {
  return moduleUrl(
    await readFile(new URL(relativePath, import.meta.url), "utf8"),
    relativePath.split("/").pop(),
    imports,
  );
}

const aiDisclosureUrl = await realModule("../src/components/ai-disclosure.tsx");
const storyBodyUrl = await realModule("../src/components/story-body.tsx");

/*
  Unit U11b3: the reader's source list -- records first, then the cited URLs no
  record already names, deduplicated by URL identity. Real, not stubbed: the
  band it builds is one of the things the renders above assert on, and its
  identity rule (`canonicalPublicUrl`) is the thing the defect was in. Its own
  one relative import is redirected to the real module, the same way
  `correction-origin-mark` is pointed at `correction-origin`.
*/
const fetchOutcomeUrl = await realModule("../src/lib/news/fetch-outcome.ts");
const readerProvenanceUrl = await realModule("../src/lib/news/reader-provenance.ts", {
  ...pageImports,
  "./fetch-outcome.ts": fetchOutcomeUrl,
});

/* 0.6.80 (CK): the article page prints its dek through `dekOrFallback`. The
   helper is pure and imports nothing, so the real module loads here. */
const dekFallbackUrl = await realModule("../src/lib/news/dek-fallback.ts");

/* The chip that marks a machine-written correction, and the module that says
   which rows are automatic. Real, and pointed at each other, for the same
   reason: a stub could not tell a test whether a page labels the row or not.
   Exported because `/corrections` renders the same chip and must be handed the
   SAME module instances -- two copies of the source in one test process would
   pass while the two pages were labelling rows differently only if the sources
   differed, which is exactly the drift this pairing exists to catch. */
/* F4: the pages' blank-city sentences come from this pure module (no imports),
   so it loads real, exactly as the sentences print. */
const paperPhrasesUrl = await realModule("../src/lib/paper-phrases.ts");
export const correctionOriginUrl = await realModule("../src/lib/news/correction-origin.ts");
export const correctionMarkUrl = await realModule("../src/components/correction-origin-mark.tsx", {
  ...pageImports,
  "@/lib/news/correction-origin": correctionOriginUrl,
});

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
  is what the tests below are made of, so it is stubbed the way every other
  non-page import here is: "not legally removed", which is the answer an
  ordinary article gets. The three exports added by unit BH6
  (`isLegallyRemovedForReader` and the removal page's two strings, which the
  route prints when it does answer "removed") are here for the same reason: a
  `data:` module that does not export a name the route imports fails to load.
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
   `isMiscTopic`; neither the disclosure line nor the correction chip depends
   on it. */
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
  "@/components/correction-origin-mark": correctionMarkUrl,
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
  "@/lib/news/correction-origin": correctionOriginUrl,
  "@/lib/paper-phrases": paperPhrasesUrl,
  "@/lib/news/story-dates-public": storyDatesPublicStub,
  "@/lib/news/section-types": sectionTypesStub,
  "@/lib/news/reader-provenance": readerProvenanceUrl,
  "@/lib/story-dates": storyDatesStub,
  "@/lib/paper": paperStub,
  "@/lib/paper-context-state": paperContextStub,
  "@/lib/paper-identity": paperIdentityStub,
  "@/lib/use-sections": sectionsStub,
  "@/lib/reader": readerStub,
  "@/lib/news/dek-fallback": dekFallbackUrl,
};

const routeWith = (file) => readFile(new URL(file, import.meta.url), "utf8");

export const articleRoute = await import(
  moduleUrl(await routeWith("../src/routes/articles.$slug.tsx"), "articles.$slug.tsx", routeImports)
);
export const howRoute = await import(
  moduleUrl(await routeWith("../src/routes/how-we-report.tsx"), "how-we-report.tsx", routeImports)
);

const { __setArticle } = await import(reactQueryStub);

/** The article every assertion about this page starts from; override what the test is about. */
export const SAMPLE_ARTICLE = {
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
};

/** Render the real article page with `overrides` on top of `SAMPLE_ARTICLE`. */
export function renderArticle(overrides = {}) {
  __setArticle({ ...SAMPLE_ARTICLE, ...overrides });
  return renderToStaticMarkup(createElement(articleRoute.Route.options.component));
}
