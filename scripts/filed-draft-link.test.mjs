// guards: the editor could follow a reporting run's draft link into a dead page or the wrong version.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installDom } from "./dom-harness.mjs";
import { screenModule } from "./screen-render-harness.mjs";
installDom();
const React = await import("react"),
  { createRoot } = await import("react-dom/client");
const report = { stories: [], actions: [], held: [], sources: [], score: null, run: {}, gaps: [] };
globalThis.screenData = {
  "reporting-package": { requestId: 1, draftId: 8, pkg: report },
  "reporting-observations": [],
  "filed-draft": {
    id: 8,
    lead_id: 22,
    headline: "The run's saved headline",
    dek: "Saved summary",
    body: "The original filed draft.",
  },
};
/*
  FC20 (Release I, ae1b0c1d) made the panel call `packagePlainSummary` and read
  `.heading` off the result. Every other import from
  `@/lib/news/reporting-package-view` is rendered straight to text, so the
  harness defaulting unstubbed exports to `() => null` was harmless -- but this
  one is dereferenced, and the default turned into "Cannot read properties of
  null (reading 'heading')".

  The real `packagePlainSummary` is NOT loaded here, because this fixture drives
  the panel with a minimal `report` (empty arrays, no `unknowns`) and the real
  sibling helpers in the same module (`packageGaps`, which iterates
  `report.unknowns`) demand the full shape. The fixture already stubs those to
  the shapes its report has; `packagePlainSummary` is stubbed the same way: a
  fixed summary object, which is all the panel dereferences. This fixture is
  about the filed-draft link, not the summary wording.
*/
const { ReportingPackagePanel } = await screenModule("src/components/reporting-package-panel.tsx", {
  Link: `({to,params,children})=>h('a',{href:to.replace('$draftId',params.draftId),onClick:e=>{e.preventDefault();globalThis.openFiledDraft(e.currentTarget.getAttribute('href'));}},children)`,
  hasReportingPackage: "() => true",
  reportingRunState: "() => ({tone:'ok'})",
  reportingPackageHistory: "(row) => ({current:row,earlier:[]})",
  packageGaps: "() => []",
  SCORE_COMPONENTS: "[]",
  packagePlainSummary:
    "() => ({heading:'The reporting run finished',read:'',established:'',stillToCheck:'',nextAction:''})",
});
test("reporting run opens its filed draft and omits the link when none was filed", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await React.act(async () =>
      root.render(React.createElement(ReportingPackagePanel, { leadId: 22 })),
    );
    const link = [...container.querySelectorAll("a")].find((a) =>
      a.textContent.includes("draft this run"),
    );
    assert.equal(link?.getAttribute("href"), "/desk/filed-draft/8");
    const { Route } = await screenModule("src/routes/desk.filed-draft.$draftId.tsx", {
      createFileRoute: "() => options => ({...options,useParams:()=>({draftId:'8'})})",
      StoryBody: "({body})=>h('p',null,body)",
    });
    globalThis.openFiledDraft = (href) => {
      assert.equal(href, "/desk/filed-draft/8");
      root.render(React.createElement(Route.component));
    };
    await React.act(async () => link.click());
    assert.match(container.textContent, /The original filed draft\./);
    globalThis.screenData["reporting-package"].draftId = null;
    await React.act(async () =>
      root.render(React.createElement(ReportingPackagePanel, { leadId: 22 })),
    );
    assert.match(container.textContent, /This run filed no draft/);
    assert.equal(
      [...container.querySelectorAll("a")].some((a) => a.textContent.includes("draft this run")),
      false,
    );
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});
