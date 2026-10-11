// guards: the Release I desk must show source evidence, safe duplicate matches,
// subject-bound research, truthful scan handoffs and honest follow-up outcomes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { screenModule } from "./screen-render-harness.mjs";
import { browserScreen } from "./bug-sweep-browser.harness.mjs";
import { React, createRoot, h as darkH, window, detail, Route as darkRoute } from "./dark-file-model-flow.harness.mjs";
import { composeScanHandoffSummary, nearDuplicate } from "../src/lib/news/desk-copy.ts";

const sourceScreen = await screenModule("src/routes/desk.sources.tsx", {
  createFileRoute: `() => options => ({ ...options, useSearch: () => ({ tab: "accepted", q: "" }) })`,
  dailyScanCounts: `() => []`,
}, ["@/lib/news/desk-copy"]);
const leadRows = await screenModule("src/components/desk-leads.tsx");
const followUpCard = await screenModule("src/components/follow-up-card.tsx", {}, [
  "@/lib/news/follow-up-copy",
]);

async function atOwnerWidths(render, verify) {
  for (const width of [390, 1440]) {
    const { page, close } = await browserScreen(render, { width });
    try {
      await verify(page, width);
    } finally {
      await close();
    }
  }
}

test("source evidence labels keep journalism in tier B and discovery in tier C (B05, FB20)", async () => {
  globalThis.screenData = {
    sources: {
      rows: [
        { id: 1, title: "Longmont Times-Call", url: "https://www.timescall.com/", kind: "news", tier: "B", status: "accepted", last_fetched_at: null, last_error: null },
        { id: 2, title: "Bing discovery", url: "https://www.bing.com/search?q=longmont", kind: "unclassified", tier: "C", status: "accepted", last_fetched_at: null, last_error: null },
      ],
      total: 2,
      counts: { accepted: 2, proposed: 0, rejected: 0 },
    },
    "editor-sections": [],
    scans: { rows: [], total: 0 },
    "my-desk": { ok: true, role: "owner" },
    "daily-scan-policy": { enabled: false, paused: false, localTime: "06:00" },
    leads: { rows: [], total: 0 },
    "desk-jobs": { jobs: [], activeJobs: [] },
  };
  await atOwnerWidths(sourceScreen.Route.component, async (page) => {
    const text = await page.locator("body").innerText();
    assert.match(text, /Longmont Times-Call[\s\S]*Kind: news · Tier: B/);
    assert.match(text, /Bing discovery[\s\S]*Kind: unclassified · Tier: C/);
  });
});

test("an unrelated lead row has no printed-duplicate kill controls (B02)", async () => {
  const lead = {
    id: 22,
    headline: "St. Vrain Valley Schools Schedules 2026 Open House Dates",
    why: "Families can review the new open-house schedule.",
    topic: "schools",
    status: "new",
    source_urls: "[]",
    evidence: null,
    newsworthiness: 4,
    created_at: "2026-10-08T12:00:00Z",
    dup_ai_printed_same: false,
  };
  const dup = nearDuplicate(lead, [{
    slug: "head-start-designation",
    headline: "Wild Plum Center Holds Head Start Designation for St. Vrain Valley, Serving Low-Income Children Birth to 5",
    topic: "schools",
    published_at: new Date().toISOString(),
  }], { city: "Longmont", state: "Colorado", county: "Boulder" });
  assert.equal(dup, null, "the screen must receive no match for a different St. Vrain Valley story");
  await atOwnerWidths(() => h(leadRows.LeadRowView, { lead, dup }), async (page) => {
    const text = await page.locator("body").innerText();
    assert.doesNotMatch(text, /≈ PRINTED|Kill .* as a duplicate|matches:/i);
  });
});

test("a failed subject search does not render as a checked no-change result (FC25)", async () => {
  const row = {
    id: 31,
    newsroom_id: 1,
    user_id: "editor",
    lead_id: 9,
    article_id: null,
    who: "",
    what: "Re-check published Boulder County permit phishing warning",
    due_on: null,
    status: "active",
    nudged_at: null,
    answered_at: null,
    reply_text: null,
    created_at: "2026-10-08T12:00:00Z",
    agent_kind: "search",
    targets_json: "[]",
    schedule: "daily",
    model_choice: "auto",
    last_run_at: "2026-10-11T18:00:00Z",
    next_run_at: null,
    last_state: "could-not-check",
    finding_json: JSON.stringify({ title: "Dictionary definitions", reason: "The search returned no result about the subject, so this check could not tell whether anything changed.", changed: false }),
    lead_headline: "Boulder County permit phishing warning",
  };
  await atOwnerWidths(() => h(followUpCard.FollowUpCard, { row, now: new Date("2026-10-11T19:00:00Z") }), async (page) => {
    const text = await page.locator("body").innerText();
    assert.match(text, /Could not check/);
    assert.doesNotMatch(text, /Checked · no change/);
    assert.match(text, /no result about the subject/);
  });
});

test("the investigation follow-up list retains only trails tied to its subject (B08, FC03)", async () => {
  detail.investigation.title = "September 1 Longmont City Council YouTube investigation";
  detail.investigation.ordinary_explanation = "Review the city council meeting recording published on YouTube.";
  detail.investigation.scope_json = '{"subject":"September 1 City Council meeting video"}';
  detail.frontier = [
    { id: 41, label: "UK aggregate businesses", why: "Search the United Kingdom companies register for ownership.", status: "open", kind: "record", priority: 1 },
    { id: 42, label: "Walton Road Kirby Le Soken / Frinton On Sea", why: "Check property records at the address.", status: "reopened", kind: "record", priority: 1 },
    { id: 43, label: "Trefoil technology", why: "Look up software business filings for Trefoil.", status: "deferred", kind: "record", priority: 1 },
    { id: 44, label: "September 1 City Council YouTube recording", why: "Review the meeting video for the named agenda item.", status: "open", kind: "video", priority: 1 },
  ];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(darkH(darkRoute.component)));
  try {
    assert.ok(container.querySelector(".fr-item"), container.textContent.slice(0, 500));
    await atOwnerWidths(() => h("div", { dangerouslySetInnerHTML: { __html: container.innerHTML } }), async (page) => {
      const list = await page.locator(".of-frontier").textContent();
      assert.match(list, /September 1 City Council YouTube recording/);
      assert.doesNotMatch(list, /UK aggregate businesses|Walton Road Kirby Le Soken|Trefoil technology/);
    });
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test("scan history narrative names actual filed leads rather than invented examples (FC18)", async () => {
  const actualSummary = composeScanHandoffSummary({
    sourcesAnalyzed: 14,
    analysisBatches: 4,
    batchesFailed: 0,
    candidateHandoffs: 12,
    filedHeadlines: ["Hover Street resurfacing begins Monday", "Main Street office closes for move", "Fall festival fundraiser opens Friday"],
  });
  await atOwnerWidths(() => h("p", { className: "wire-sum" }, actualSummary), async (page) => {
    const text = await page.locator(".wire-sum").innerText();
    assert.match(text, /Hover Street resurfacing begins Monday/);
    assert.match(text, /Main Street office closes for move/);
    assert.match(text, /Fall festival fundraiser opens Friday/);
    assert.doesNotMatch(text, /Museum grand-reopening/);
  });
});
