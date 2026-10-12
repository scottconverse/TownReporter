// Walk E2 finding DHE2-4: a held lead on Today had "Release" and an icon-only
// menu, with no named "Kill", so a held lead could not be killed from Today.
// This mounts the real Today route, opens the Held segment, and presses the
// row's Kill. It must send the same kill the open row's Kill sends, and Release
// must stay on the row as it was.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { installDom, moduleUrl } from "./dom-harness.mjs";
import { screenModuleUrl } from "./screen-render-harness.mjs";

const { document, window } = installDom();

const real = [
  "@/lib/news/desk-drafts",
  "@/lib/news/draft-item",
  "@/lib/news/check-gates",
  "@/lib/news/desk-copy",
  "@/lib/news/story-readiness",
  "@/components/story-readiness-chip",
  "@/components/draft-item-boundary",
  "@/components/check-gates",
];
// The real kill presses and the triage legend, loaded as their own modules:
// the harness only maps "@/components/*" names to .tsx files.
const realComponents = {
  "@/components/fast-kill": await moduleUrl("src/components/fast-kill.ts", {}),
  "@/components/desk-triage": await moduleUrl("src/components/desk-triage.ts", {}),
};
const today = await import(
  await screenModuleUrl(
    "src/routes/desk.index.tsx",
    {
      // The Today status mutation is the one the row presses share; record what it is asked to send.
      useDeskMutation:
        "() => ({ mutate: (input) => { globalThis.heldKillCalls.push(input); }, mutateAsync: async (input) => { globalThis.heldKillCalls.push(input); }, isPending: false })",
      InkButton:
        "({ children, onClick, tone }) => h('button', { onClick, 'data-tone': tone }, children)",
      DeskMoreMenu: "() => null",
    },
    real,
    { imports: realComponents },
  )
);

const heldLead = {
  id: 471,
  headline: "Airport noise complaints rise after runway change",
  why: "Residents filed three complaints this week.",
  topic: "county-region",
  topic_unchosen: false,
  status: "held",
  source_urls: "[]",
  evidence: "[]",
  newsworthiness: 3,
  created_at: "2026-10-11T14:00:00Z",
  investigation_id: null,
  notes_json: null,
  possible_duplicate_of: null,
  possible_duplicate: null,
  meeting_video_id: null,
  meeting_lead_purpose: null,
};

function emptyData() {
  return {
    "my-desk": { role: "owner", newsroomId: 1, claimed: true },
    sources: [],
    leads: [heldLead],
    scans: [],
    "drafts-desk": [],
    "published-desk": [],
    memory: [],
    investigations: [],
    "worth-a-look": [],
    "follow-ups": [],
    "follow-up-findings": [],
  };
}

async function mountToday() {
  globalThis.screenData = emptyData();
  globalThis.heldKillCalls = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(today.Route.component));
  });
  const heldSegment = [...container.querySelectorAll("button")].find((b) =>
    /^Held · 1$/.test(b.textContent.trim()),
  );
  assert.ok(heldSegment, "the Held segment shows the held lead");
  await React.act(async () => {
    heldSegment.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  return { container, root };
}

function rowButtons(container) {
  return [...container.querySelectorAll(".today-lead-side button")];
}

test("a held lead on Today has a named Kill next to Release", async () => {
  const { container, root } = await mountToday();
  try {
    const labels = rowButtons(container).map((b) => b.textContent.trim());
    assert.ok(
      labels.some((t) => /^Release/.test(t)),
      `Release stays on the held row (saw: ${labels.join(" | ")})`,
    );
    assert.ok(
      labels.some((t) => /^Kill\b/.test(t)),
      `a named Kill is on the held row (saw: ${labels.join(" | ")})`,
    );
  } finally {
    await React.act(async () => root.unmount());
  }
});

test("pressing Kill on a held lead on Today sends the same kill as an open row", async () => {
  const { container, root } = await mountToday();
  try {
    const kill = rowButtons(container).find((b) => /^Kill\b/.test(b.textContent.trim()));
    assert.ok(kill, "a Kill button exists on the held row");
    await React.act(async () => {
      kill.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    assert.equal(globalThis.heldKillCalls.length, 1, "one kill is sent");
    const sent = globalThis.heldKillCalls[0];
    const payload = sent?.data ?? sent;
    assert.equal(payload.id, 471);
    assert.equal(payload.status, "killed");
  } finally {
    await React.act(async () => root.unmount());
  }
});
