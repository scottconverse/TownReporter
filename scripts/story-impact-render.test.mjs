// guards: the story header could mistake newsworthiness for readiness and the ledger could show an unexplained score.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { screenModule } from "./screen-render-harness.mjs";

globalThis.screenData = {
  lead: {
    lead: {
      id: 22,
      headline: "Council budget",
      why: "Local spending",
      topic: "government",
      status: "new",
      source_urls: "[]",
    },
    draft: null,
    namedOutlets: [],
  },
};
const { Route } = await screenModule("src/routes/desk.story.$leadId.tsx", {}, [
  "@/lib/news/desk-copy",
  "@/lib/news/story-readiness",
  "@/lib/news/lead-score",
]);
const { MeetingLedgerPanel } = await screenModule("src/components/meeting-ledger-panel.tsx", {}, [
  "@/lib/news/meeting-impact",
]);
test("story header has no score and ledger explains its impact total", () => {
  // A lead that was never scored shows no score at all -- never "0/20".
  assert.doesNotMatch(render(h(Route.component)), /Lead score|\d+\/20/);
  const impact = { immediacy: 4, impact: 5, conflict: 3, novelty: 3 };
  const html = render(
    h(MeetingLedgerPanel, {
      leadId: 22,
      locked: true,
      rewritePhase: "idle",
      accounting: {
        draftId: 8,
        meetingNotes: "",
        claims: [],
        ledger: [
          { id: 1, itemNo: 1, title: "Budget", status: "lead", reason: "", evidence: [], impact },
        ],
      },
    }),
  );
  assert.match(html, /Impact 15 of 20/);
  assert.match(html, /four.*5/i);
});

// Scott, Nov 15 2026: "Show me the overall score, and each individual score,
// per story." A scored lead shows its total, the four parts and each reason
// on the story page; it is labelled a score, never a readiness word.
test("a scored lead shows its total, its four parts and its reasons on the story page", () => {
  const lead = globalThis.screenData.lead.lead;
  const before = { ...lead };
  Object.assign(lead, {
    newsworthiness: 11,
    score_parts: {
      immediacy: 4,
      impact: 3,
      conflict: 1,
      novelty: 3,
      reasons: { immediacy: "The meeting is this week.", impact: "", conflict: "", novelty: "" },
    },
  });
  try {
    const html = render(h(Route.component));
    assert.match(html, /Score 11\/20/);
    assert.match(html, /Immediacy 4 · Impact 3 · Conflict 1 · Novelty 3/);
    assert.match(html, /Immediacy: The meeting is this week\./);
    assert.doesNotMatch(html, /Impact: </);
    assert.doesNotMatch(html, /Lead score/);
  } finally {
    for (const key of Object.keys(lead)) delete lead[key];
    Object.assign(lead, before);
  }
});
