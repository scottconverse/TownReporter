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
      useLoaderData: () => undefined,
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
  export function ProvenanceBlock({ items }) {
    return createElement("div", { className: "provenance" }, String((items ?? []).length));
  }
`);
const beaconStub = inlineModule(`export function ViewBeacon() { return null; }`);
const deskChromeUtilsStub = inlineModule(`export const inkGhost = "";`);
const publicStub = inlineModule(`
  export async function getPublishedArticle() { return null; }
  export async function listPublishedArticles() { return []; }
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
  "@/components/desk-chrome-utils": deskChromeUtilsStub,
  "@/lib/news/public": publicStub,
  "@/lib/paper": paperStub,
  "@/lib/paper-context-state": paperContextStub,
  "@/lib/paper-identity": paperIdentityStub,
  "@/lib/use-sections": sectionsStub,
  "@/lib/reader": readerStub,
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

test("an article page states the AI disclosure, above the sources it names", () => {
  const html = renderArticle();
  assert.match(html, new RegExp(AI_LINE.replace(/\./g, "\\.")));
  // It belongs with the records it points at, not buried at the foot of the page.
  const sourcesIdx = html.indexOf('id="sources"');
  const lineIdx = html.indexOf("A person reviewed and edited this story.");
  assert.ok(sourcesIdx >= 0 && lineIdx > sourcesIdx, "the line should render inside the sources section");
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
