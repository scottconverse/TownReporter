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
const { ReportingPackagePanel } = await screenModule("src/components/reporting-package-panel.tsx", {
  Link: `({to,params,children})=>h('a',{href:to.replace('$draftId',params.draftId),onClick:e=>{e.preventDefault();globalThis.openFiledDraft(e.currentTarget.getAttribute('href'));}},children)`,
  hasReportingPackage: "() => true",
  reportingRunState: "() => ({tone:'ok'})",
  reportingPackageHistory: "(row) => ({current:row,earlier:[]})",
  packageGaps: "() => []",
  SCORE_COMPONENTS: "[]",
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
