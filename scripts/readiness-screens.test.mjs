// guards: an editor could see conflicting readiness states for the same saved draft on Story, Drafts and Today.
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { parseHTML } from "linkedom";
import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";
import { screenModule } from "./screen-render-harness.mjs";
const { storyReadiness } = await import(await moduleUrl("src/lib/news/story-readiness.ts"));
const real = [
  "@/lib/news/desk-drafts",
  "@/lib/news/check-gates",
  "@/lib/news/desk-copy",
  "@/lib/news/story-readiness",
  "@/components/story-readiness-chip",
  "@/components/check-gates",
  "@/components/publish-blockers",
  "@/lib/news/writer-bar",
];
const story = await screenModule(
  "src/routes/desk.story.$leadId.tsx",
  { showsPublishPrep: "()=>true" },
  real,
);
const drafts = await screenModule("src/routes/desk.drafts.tsx", {}, real);
const today = await screenModule("src/routes/desk.index.tsx", {}, real);
const { publishBlockers, publishGateNote } = await import(
  await moduleUrl("src/lib/news/publish-blockers.ts", {
    "./desk-copy.ts": stubUrl("export const editorActionError = () => '';"),
  })
);
globalThis.readinessPublishBlockers = publishBlockers;
globalThis.readinessPublishGateNote = publishGateNote;
const publishStory = await screenModule(
  "src/routes/desk.story.$leadId.tsx",
  {
    publishBlockers:
      "state => (globalThis.readinessBlockers = globalThis.readinessPublishBlockers(state))",
    publishGateNote: "blockers => globalThis.readinessPublishGateNote(blockers)",
    useMutation:
      "({mutationFn}) => ({mutate(){}, isPending: Boolean(globalThis.readinessDecisionPending && /decision/.test(String(mutationFn)))})",
    ActionButton: "({children, disabled}) => h('button', {disabled}, children)",
    RedraftDialog:
      "({writerStatus}) => h('span', {'data-writer-status':true, title:writerStatus.reason}, writerStatus.label)",
    stripReporterNotebook: "body => body",
  },
  real,
);

// guards: a pasted story without an AI fact-check memo must still be publishable.
test("a pasted story with its section confirmed can be published", async () => {
  const draft = {
    id: 8,
    lead_id: 22,
    headline: "Council votes",
    dek: "A new plan.",
    body: "Council approves the plan.",
    topic: "government",
    research_json: null,
  };
  globalThis.screenData = {
    lead: {
      lead: {
        id: 22,
        headline: draft.headline,
        topic: draft.topic,
        status: "drafted",
        source_urls: "[]",
      },
      draft,
      topicConfirmed: draft.topic,
      namedOutlets: [],
      outletOverrides: [],
    },
    sources: [],
    memory: [],
  };
  const { document } = installDom();
  const { createRoot } = await import("react-dom/client");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let key = 0;
  const draw = async () => {
    await act(async () => root.render(h(publishStory.Route.component, { key: key++ })));
    return document;
  };
  const button = (document) =>
    [...document.querySelectorAll("button")].find((b) => /^Publish in /.test(b.textContent));
  try {
    await draw();
    assert.ok(button(document), "the story must offer Publish in its section");
    assert.equal(button(document).hasAttribute("disabled"), false);
    assert.equal(document.querySelectorAll("[data-story-readiness]").length, 1);
    for (const [state, openCount] of [
      ["to-check", 1],
      ["not-ready", 4],
      ["checking", 0],
    ]) {
      draft.research_json = JSON.stringify({
        storyReadiness: {
          version: 1,
          state,
          openCount,
          totalCount: 4,
          reason: "A reporting check is open.",
        },
      });
      assert.equal(
        button(await draw()).hasAttribute("disabled"),
        true,
        `${state} must block Publish`,
      );
    }
    draft.research_json = null;
    globalThis.readinessDecisionPending = true;
    assert.equal(
      button(await draw()).hasAttribute("disabled"),
      true,
      "a pending evidence decision must block Publish",
    );
    assert.ok(
      globalThis.readinessBlockers.some((blocker) => blocker.key === "evidence-review-saving"),
    );
  } finally {
    globalThis.readinessDecisionPending = false;
    await act(async () => root.unmount());
    host.remove();
  }
});
test("Story, Drafts and Today show one matching chip for all four readiness states", () => {
  for (const [openCount, checking, label] of [
    [0, true, "Checking facts"],
    [0, false, "Verified"],
    [2, false, "2 to check"],
    [4, false, "Not ready"],
  ]) {
    const readiness = storyReadiness({
      headline: "Council votes",
      body: "Council approves the plan.\n\nWorkers will build the bridge.",
      claims: Array.from({ length: openCount }, () => ({
        text: "Workers will build the bridge.",
        status: "UNVERIFIED",
      })),
      checking,
    });
    const row = {
      id: 8,
      lead_id: 22,
      headline: "Council votes",
      body: "Council approves the plan.",
      dek: "A new plan.",
      topic: "government",
      has_body: true,
      headline_source: "model",
      model_headline: "Council votes",
      lead_status: "drafted",
      job_status: null,
      names_unresolved: 0,
      evidence_required: false,
      research_json: JSON.stringify({ storyReadiness: { version: 1, ...readiness } }),
      story_readiness: { version: 1, ...readiness },
    };
    const lead = {
      id: 22,
      headline: row.headline,
      why: "Local spending",
      topic: row.topic,
      status: "drafted",
      source_urls: "[]",
    };
    globalThis.screenData = {
      lead: { lead, draft: row, namedOutlets: [], outletOverrides: [] },
      "drafts-desk": { rows: [row], total: 1, counts: { all: 1 } },
      sources: [],
      leads: [],
      "published-desk": [],
      memory: [],
      investigations: [],
      "worth-a-look": [],
      "follow-ups": [],
      "follow-up-findings": [],
    };
    for (const [name, screen] of [
      ["Story", story],
      ["Drafts", drafts],
      ["Today", today],
    ]) {
      if (name === "Today") globalThis.screenData["drafts-desk"] = [row];
      const html = render(h(screen.Route.component));
      const { document } = parseHTML(html);
      const chips = document.querySelectorAll("[data-story-readiness]");
      assert.equal(chips.length, 1, `${name}: ${label} must appear once`);
      assert.ok(chips[0].textContent.includes(label), `${name} must agree with the saved draft`);
      assert.doesNotMatch(
        html,
        /Ready to check|\bClear\b|Lead score|● Ready|Evidence check not decided|Names not checked|Tier [123].*(?:ready|print)/i,
      );
    }
  }
});

// guards: zero open facts must not hide a held item or block an ordinary pasted story.
test("Publish and the Writer agree for a missing memo and a saved held item with zero open facts", async () => {
  const heldReason = "Airport future charges: The future charge amount needs checking.";
  for (const [memo, label, blocked] of [
    [null, "Ready", false],
    [
      JSON.stringify({
        storyReadiness: {
          version: 1,
          state: "not-ready",
          openCount: 0,
          totalCount: 0,
          reason: heldReason,
        },
      }),
      "Not ready",
      true,
    ],
  ]) {
    globalThis.screenData = {
      lead: {
        lead: {
          id: 22,
          headline: "Airport policy",
          topic: "government",
          status: "drafted",
          source_urls: "[]",
        },
        draft: {
          id: 8,
          lead_id: 22,
          headline: "Airport policy",
          dek: "Policy approved",
          body: "Council approved the airport policy.",
          topic: "government",
          research_json: memo,
        },
        topicConfirmed: "government",
        namedOutlets: [],
        outletOverrides: [],
      },
      sources: [],
      memory: [],
    };
    const { document } = installDom();
    const { createRoot } = await import("react-dom/client");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(h(publishStory.Route.component)));
      const button = [...document.querySelectorAll("button")].find((b) =>
        /^Publish in /.test(b.textContent),
      );
      assert.ok(button);
      assert.equal(button.hasAttribute("disabled"), blocked);
      assert.ok(document.querySelector("[data-story-readiness]").textContent.includes(label));
      assert.ok(host.textContent.includes(`● ${label}`));
      const blocker = globalThis.readinessBlockers.find((item) => item.key === "readiness");
      if (blocked) {
        assert.equal(blocker?.sentence, heldReason);
        assert.equal(host.querySelector("[data-writer-status]").getAttribute("title"), heldReason);
        assert.ok(host.textContent.includes(heldReason));
      } else {
        assert.equal(blocker, undefined);
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  }
});
