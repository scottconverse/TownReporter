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
]);
const { MeetingLedgerPanel } = await screenModule("src/components/meeting-ledger-panel.tsx", {}, [
  "@/lib/news/meeting-impact",
]);
test("story header has no score and ledger explains its impact total", () => {
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
