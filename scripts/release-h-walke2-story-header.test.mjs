// Walk E2 finding DHE2-1: a published lead's Story page header said "Section not
// chosen" and the page still drew "No section has been chosen… Pick a section" and
// "Before you can publish N warnings". The story is already in print, so the header
// names the section it printed in and the publish prep list is not drawn. An
// unpublished story keeps today's header and warnings exactly.
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { installDom } from "./dom-harness.mjs";
import { screenModule } from "./screen-render-harness.mjs";

const screen = await screenModule(
  "src/routes/desk.story.$leadId.tsx",
  {
    useEditorSections:
      "() => ({ sections: [{ key: 'county-region', name: 'County region' }, { key: 'government', name: 'Council' }] })",
  },
  [
    "@/lib/news/desk-drafts",
    "@/lib/news/check-gates",
    "@/lib/news/desk-copy",
    "@/lib/news/story-readiness",
    "@/components/story-readiness-chip",
    "@/components/publish-blockers",
    "@/lib/news/writer-bar",
  ],
);

function fixture(status, extra = {}) {
  return {
    lead: {
      lead: {
        id: 468,
        headline: "Council votes",
        topic: "government",
        status,
        source_urls: "[]",
      },
      draft: {
        id: 8,
        headline: "Council votes",
        dek: "A plan",
        body: "Council approved the plan.",
        topic: "government",
        research_json: null,
      },
      topicConfirmed: null,
      namedOutlets: [],
      outletOverrides: [],
      uncheckedRecordedClaims: 0,
      uncheckedEvidenceChecked: true,
      uncheckedStoryAcknowledged: false,
      uncheckedExempt: false,
      ...extra,
    },
    sources: [],
    memory: [],
  };
}

async function mountStory(data) {
  globalThis.screenData = data;
  const { document } = installDom();
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(h(screen.Route.component)));
  return { document, root };
}

test("a published story's header names the section it printed in, and shows no publish prep", async () => {
  const { document, root } = await mountStory(
    fixture("published", {
      articleId: 31,
      articleHeadline: "Council votes",
      articleDek: "A plan",
      articleBody: "Council approved the plan.",
      articleTopic: "government",
    }),
  );
  try {
    const text = document.body.textContent;
    assert.match(text, /Story from lead · Council/, "the header names the printed section");
    assert.doesNotMatch(text, /Section not chosen/, "no 'Section not chosen' on a printed story");
    assert.doesNotMatch(text, /No section has been chosen/, "no section warning on a printed story");
    assert.doesNotMatch(text, /Before you can publish/, "no publish prep list on a printed story");
    assert.doesNotMatch(text, /Pick a section/, "no 'Pick a section' press on a printed story");
  } finally {
    await act(async () => root.unmount());
  }
});

test("an unpublished story keeps its header as it was", async () => {
  const { document, root } = await mountStory(fixture("drafted"));
  try {
    const text = document.body.textContent;
    assert.match(text, /Story from lead · Section not chosen/, "an unpublished story without a section says so");
  } finally {
    await act(async () => root.unmount());
  }
});
