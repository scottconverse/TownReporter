// guards: an editor could see conflicting readiness states for the same saved draft on Story, Drafts and Today.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { parseHTML } from "linkedom";
import { moduleUrl } from "./dom-harness.mjs";
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
