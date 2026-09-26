import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Render the real LeadRowView component (src/components/desk-leads.tsx) --
// specifically the "seen again ×N" resurfaced badge added for a killed lead
// the scanner rediscovered (see src/lib/news/lead-match.ts and the
// fileScanLeads loop in src/lib/news/desk.ts). Everything the real component
// imports besides React (router Link, desk-chrome chips/buttons, paper date
// formatting, the model picker, model-choice labels, Notice) is stubbed here
// with a minimal in-memory module, the same pattern model-picker-render.test.mjs
// uses, so this test exercises the real badge markup without a router, a
// paper context provider, or a live server.
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

const REACT_URL = import.meta.resolve("react");
const deskChromeUtils = moduleUrl(
  await readFile(new URL("../src/components/desk-chrome-utils.ts", import.meta.url), "utf8"),
  "desk-chrome-utils.ts",
);
const { leadOrigin } = await import(deskChromeUtils);

function inlineModule(source) {
  const rewritten = source.replaceAll('"react"', JSON.stringify(REACT_URL));
  return `data:text/javascript;base64,${Buffer.from(rewritten).toString("base64")}`;
}

const reactRouterStub = inlineModule(`
  import { createElement } from "react";
  // Unit AK item 5: params are rendered as a data attribute so a test can tell
  // WHICH lead a link targets -- the compare chip and the "possible duplicate
  // of" link share one route template, so href alone cannot tell them apart.
  export function Link({ to, params, children, ...rest }) {
    return createElement(
      "a",
      { href: String(to ?? "#"), "data-params": JSON.stringify(params ?? null), ...rest },
      children,
    );
  }
`);

const deskChromeStub = inlineModule(`
  import { createElement } from "react";
  // ariaLabel -> aria-label, matching the real InkButton (desk-chrome.tsx):
  // the accessible name of a press is part of what these tests pin, so the
  // stub must carry it through instead of dropping it.
  export function InkButton({ children, onClick, ariaLabel, disabled }) {
    return createElement(
      "button",
      { type: "button", onClick, "aria-label": ariaLabel, disabled: disabled || undefined },
      children,
    );
  }
  export function Score({ v }) {
    return createElement("span", { className: "score" }, String(v));
  }
  export function Chip({ s }) {
    return createElement("span", { className: "chip st-" + s }, s);
  }
  export function leadOrigin() {
    return "scan";
  }
`);

const paperStub = inlineModule(`
  export function formatAge() {
    return "2h ago";
  }
`);

const paperContextStub = inlineModule(`
  export function usePaperDateFormatters() {
    return { formatShortDate: () => "Sep 3" };
  }
`);

const modelPickerStub = inlineModule(`
  import { createElement } from "react";
  export function ModelPicker() {
    return createElement("div", { className: "model-picker-stub" });
  }
`);

const modelChoiceStub = inlineModule(`
  export function modelChoiceLabel() {
    return "Automatic";
  }
`);

const statesStub = inlineModule(`
  import { createElement } from "react";
  export function Notice({ children }) {
    return createElement("div", { className: "notice" }, children);
  }
`);

const providerRegistryStub = inlineModule(`
  export function defaultModelEffort() { return null; }
`);

/*
 * Unit AK items 2/4/6/7 (2026-09-26): the row's copy for a "looks already
 * printed" lead and for a lead that came back now comes from the real
 * desk-copy.ts -- printedDuplicateLine, cameBackLabel, killRecordLine and
 * DEVELOPING_LABEL. A stub would let the row and the Queue explainer drift
 * apart, which is the bug class this unit is about, so the real module is
 * loaded with its three own imports stubbed (it reaches preflight.ts,
 * lead-match.ts and paper.ts for other functions this row never calls).
 */
const preflightStub = inlineModule(`
  export function looksLikeProviderAuthFailure() { return false; }
  export function providerAuthTarget() { return ""; }
`);
const leadMatchStubForCopy = inlineModule(`
  export function nonStoplistedProperNouns() { return new Set(); }
`);
const paperModuleStub = inlineModule(`
  export const TOPICS = [];
`);
const deskCopy = moduleUrl(
  await readFile(new URL("../src/lib/news/desk-copy.ts", import.meta.url), "utf8"),
  "desk-copy.ts",
  {
    "./preflight.ts": preflightStub,
    "./lead-match.ts": leadMatchStubForCopy,
    "../paper.ts": paperModuleStub,
    react: import.meta.resolve("react"),
  },
);

const { LeadRowView } = await import(
  moduleUrl(
    await readFile(new URL("../src/components/desk-leads.tsx", import.meta.url), "utf8"),
    "desk-leads.tsx",
    {
      "@tanstack/react-router": reactRouterStub,
      "@/components/desk-chrome": deskChromeStub,
      "@/components/desk-chrome-utils": deskChromeUtils,
      "@/lib/paper": paperStub,
      "@/lib/paper-context": paperContextStub,
      "@/lib/paper-context-state": paperContextStub,
      "@/components/model-picker": modelPickerStub,
      "@/lib/news/model-choice": modelChoiceStub,
      "@/lib/news/provider-registry": providerRegistryStub,
      "@/lib/news/desk-copy": deskCopy,
      "@/components/states": statesStub,
      react: import.meta.resolve("react"),
      "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    },
  )
);

function baseLead(overrides = {}) {
  return {
    id: 1,
    headline: "Longmont council has two closed-door executive sessions on the books",
    why: "Because it does",
    topic: "council",
    status: "killed",
    source_urls: "[]",
    evidence: null,
    newsworthiness: 8,
    created_at: new Date().toISOString(),
    resurfaced_count: 0,
    last_resurfaced_at: null,
    possible_duplicate_of: null,
    ...overrides,
  };
}

test("a lead with resurfaced_count > 0 shows the came-back badge with its count and date, in the lead-flags badge rail (not the muted meta line)", () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, {
      lead: baseLead({ resurfaced_count: 3, last_resurfaced_at: "2026-09-03T12:00:00.000Z" }),
    }),
  );
  // Unit AK item 7: the count is the same fact, in words. "seen again ×3" was
  // shorthand an editor had to decode; the row says "Came back 3 times".
  assert.match(html, /Came back 3 times/);
  assert.doesNotMatch(html, /seen again/);
  assert.match(html, /Sep 3/);
  assert.match(html, /class="chip seen-again"/);
  // The badge lives in the same "lead-flags" rail as the KILLED/PRINTED
  // chips, not the muted "meta" line -- it must be a real bordered pill an
  // editor notices, not bookkeeping text scrolled past. Assert ordering:
  // the status chip (lead-flags opens with it) comes before seen-again,
  // and the meta line's "seen again" text is gone from that <p>.
  const flagsIdx = html.indexOf('class="lead-flags"');
  const statusChipIdx = html.indexOf('class="chip st-killed"');
  const seenAgainIdx = html.indexOf('class="chip seen-again"');
  assert.ok(flagsIdx >= 0 && flagsIdx < statusChipIdx && statusChipIdx < seenAgainIdx);
  const metaIdx = html.indexOf('class="meta"');
  assert.ok(
    metaIdx >= 0 && metaIdx < flagsIdx,
    "meta line should render before the lead-flags rail",
  );
});

test("a lead with resurfaced_count of 0 shows no came-back badge", () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, {
      lead: baseLead({ resurfaced_count: 0, last_resurfaced_at: null }),
    }),
  );
  assert.doesNotMatch(html, /Came back/);
});

test("an open (non-killed) lead with a resurfaced stamp still shows the badge", () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, {
      lead: baseLead({
        status: "new",
        resurfaced_count: 1,
        last_resurfaced_at: "2026-09-01T00:00:00.000Z",
      }),
    }),
  );
  assert.match(html, /Came back 1 time/);
});

// QA-1 round 3: matchStrength's "possible" tier files the new lead linked to
// the existing one it resembles (possible_duplicate_of) instead of silently
// discarding or merging it -- this chip is the editor's only way to see that
// link without opening the lead. See lib/news/lead-match.ts's matchStrength
// and lib/news/lead-filing.ts's fileScanLeads.
test("a NEW lead with an available possible duplicate shows its prior headline, disposition, and comparison link", () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, {
      lead: baseLead({
        status: "new",
        possible_duplicate_of: 42,
        possible_duplicate: {
          id: 42,
          headline: "Earlier council executive-session lead",
          status: "killed",
        },
      }),
    }),
  );
  assert.match(html, /Possible duplicate of/);
  assert.match(html, /Earlier council executive-session lead/);
  assert.match(html, /· killed/);
  assert.match(html, /Possible duplicate · compare/);
  const chipIdx = html.indexOf("chip maybe-same");
  assert.ok(chipIdx >= 0, "expected a chip with the maybe-same class");
  // It must be a real link an editor can click through to the other lead,
  // not inert text -- assert the anchor and its target are both present.
  const tagStart = html.lastIndexOf("<a", chipIdx);
  assert.ok(tagStart >= 0, "the maybe-same chip should render as an <a> link");
  const tagEnd = html.indexOf(">", chipIdx);
  const openingTag = html.slice(tagStart, tagEnd + 1);
  assert.match(openingTag, /href="\/desk\/story\/\$leadId"/);
});

test("an unavailable possible duplicate never leaks a removed headline or turns into a comparison link", () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, { lead: baseLead({ status: "new", possible_duplicate_of: 42 }) }),
  );
  assert.match(html, /earlier lead is unavailable/i);
  assert.match(html, /Possible duplicate · unavailable/);
  assert.doesNotMatch(html, /href="\/desk\/story\/\$leadId"[^>]*>Possible duplicate · unavailable/);
});

test("a lead with no possible_duplicate_of shows no possible-duplicate chip", () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, { lead: baseLead({ possible_duplicate_of: null }) }),
  );
  assert.doesNotMatch(html, /Possible duplicate/);
  assert.doesNotMatch(html, /maybe-same/);
});

// Unit P item 1: a General Scan can name no section this newsroom files
// under, and the leads.topic column still needs a value -- schema.ts falls
// back to the first allowed key and records the fallback in topic_unchosen.
// That fallback is not a decision. On the Queue the row must say so, in the
// badge rail an editor actually reads, so nobody writes or publishes on a
// section the model never picked (see lib/news/schema.ts's parseScanResult,
// migrations/0087_lead_topic_unchosen.sql).
test("a lead filed under a section the scan never chose says so on the Queue row", () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, {
      lead: baseLead({ status: "new", topic_unchosen: true }),
    }),
  );
  assert.match(html, /Section not chosen — pick one/);
  assert.match(html, /class="chip topic-unchosen"/);
  // Same rail as the status chip, after the meta line: a dashed pill an editor
  // notices, not bookkeeping text scrolled past.
  const metaIdx = html.indexOf('class="meta"');
  const flagsIdx = html.indexOf('class="lead-flags"');
  const chipIdx = html.indexOf('class="chip topic-unchosen"');
  assert.ok(
    metaIdx >= 0 && metaIdx < flagsIdx && flagsIdx < chipIdx,
    "the not-chosen notice belongs in the lead-flags rail, after the meta line",
  );
});

test("a lead whose section the scan did choose shows no not-chosen notice", () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, { lead: baseLead({ status: "new", topic_unchosen: false }) }),
  );
  assert.doesNotMatch(html, /Section not chosen/);
  assert.doesNotMatch(html, /topic-unchosen/);
});

test("batch selection is separated from the headline and writing keeps its primary action visible", () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, {
      lead: baseLead({ status: "new" }),
      onBatchSelect() {},
      onDraft() {},
    }),
  );
  assert.match(html, /Include in batch draft/);
  assert.match(html, /aria-label="Include Longmont council[^"]+ in the batch draft"/);
  assert.ok(
    html.indexOf('class="hl-link"') < html.indexOf('type="checkbox"'),
    "the batch checkbox should follow the headline instead of touching or preceding it",
  );
  const draftIndex = html.indexOf(">Draft with AI</button>");
  const detailsIndex = html.indexOf("<details>");
  assert.ok(draftIndex >= 0, "the primary Draft with AI action should remain visible");
  assert.ok(detailsIndex > draftIndex, "only model configuration should be inside the disclosure");
  assert.match(html, /<summary class="meta">Model: Automatic · change<\/summary>/);
  assert.ok(
    html.indexOf('class="model-picker-stub"') > detailsIndex,
    "the model picker should remain available inside the disclosure",
  );
});

test("a held possible duplicate keeps the held-review prefix and names the actual prior disposition", () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, {
      lead: baseLead({
        status: "held",
        possible_duplicate_of: 42,
        possible_duplicate: {
          id: 42,
          headline: "Earlier council executive-session lead",
          status: "killed",
        },
      }),
      onDraft() {},
    }),
  );
  assert.match(html, /Held for review —/);
  assert.match(html, /Earlier council executive-session lead/);
  assert.match(html, /· killed/);
});

// The "≈ PRINTED" chip used to say only a date on hover -- an editor could
// not judge a duplicate without opening the lead and guessing. nearDuplicate
// (desk-copy.ts) now carries the matched published story's headline, and the
// chip row must name it and link to the real published story so it's
// judgeable in one click (see PrintedDup in src/lib/news/desk-copy.ts).
// Unit AK item 4 (2026-09-26): the owner's complaint opened this unit -- a
// lead stayed NEW behind a badge reading "≈ PRINTED", which named no story and
// offered no press. The chip now says "Looks already printed: <headline>" and
// links the published piece it means, and the row carries a one-press "Kill as
// duplicate" that records why.
test('a lead with a printed-duplicate match says "Looks already printed: <headline>" and links the piece', () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, {
      lead: baseLead({ status: "new" }),
      dup: {
        slug: "bohn-farm-rezoning",
        publishedAt: "2026-08-19T12:00:00Z",
        note: "Bohn Farm rezoning heads to planning board with staff blessing",
        headline: "Bohn Farm rezoning heads to planning board with staff blessing",
      },
    }),
  );
  assert.match(html, /class="chip dup"/);
  assert.match(
    html,
    /Looks already printed: Bohn Farm rezoning heads to planning board with staff blessing/,
  );
  assert.doesNotMatch(html, /≈ printed/, "the badge that said nothing must be gone");
  // The matched headline must appear as real, readable text near the chip...
  assert.match(html, /Bohn Farm rezoning heads to planning board with staff blessing/);
  assert.match(html, /published/);
  // ...and the chip itself must be a real link to the published story, not
  // color-only text with a date on hover.
  const chipIdx = html.indexOf('class="chip dup"');
  const tagStart = html.lastIndexOf("<a", chipIdx);
  assert.ok(tagStart >= 0, "the printed chip should render as an <a> link");
  const tagEnd = html.indexOf(">", chipIdx);
  const openingTag = html.slice(tagStart, tagEnd + 1);
  assert.match(openingTag, /href="\/articles\/\$slug"/);
});

test("a lead with no dup shows no printed chip and no matched-story line", () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, { lead: baseLead({ status: "new" }), dup: null }),
  );
  assert.doesNotMatch(html, /chip dup/);
  assert.doesNotMatch(html, /matches:/);
});

test("a printed-duplicate match offers one press that kills it as a duplicate, with an accessible name", () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, {
      lead: baseLead({ status: "new" }),
      dup: {
        slug: "bohn-farm-rezoning",
        publishedAt: "2026-08-19T12:00:00Z",
        note: "Bohn Farm rezoning heads to planning board with staff blessing",
        headline: "Bohn Farm rezoning heads to planning board with staff blessing",
      },
      onKillAsDuplicate: async () => {},
    }),
  );
  assert.match(html, />Kill as duplicate</);
  assert.match(
    html,
    /aria-label="Kill Longmont council has two closed-door executive sessions on the books as a duplicate of Bohn Farm rezoning heads to planning board with staff blessing"/,
  );
});

test("a killed lead shows no kill-as-duplicate press, and a lead with no match shows none either", () => {
  const dup = {
    slug: "bohn-farm-rezoning",
    publishedAt: "2026-08-19T12:00:00Z",
    note: "Bohn Farm rezoning heads to planning board with staff blessing",
    headline: "Bohn Farm rezoning heads to planning board with staff blessing",
  };
  const killed = renderToStaticMarkup(
    createElement(LeadRowView, {
      lead: baseLead({ status: "killed" }),
      dup,
      onKillAsDuplicate: async () => {},
    }),
  );
  assert.doesNotMatch(killed, /Kill as duplicate/, "a killed lead cannot be killed again");
  const unmatched = renderToStaticMarkup(
    createElement(LeadRowView, {
      lead: baseLead({ status: "new" }),
      dup: null,
      onKillAsDuplicate: async () => {},
    }),
  );
  assert.doesNotMatch(unmatched, /Kill as duplicate/);
});

// Unit AK item 2's UI half: a finding filed HELD against a KILLED lead because
// it carries facts the killed lead did not have (dup_kind === "developing").
// The row has to say that in plain words, name the lead it is linked to, and
// carry the old kill reason so the editor judging it does not have to open the
// other lead to find out what was killed and why.
test("a developing finding says so in words, links the killed lead, and carries the old kill reason", () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, {
      lead: baseLead({
        status: "held",
        dup_kind: "developing",
        possible_duplicate_of: 42,
        possible_duplicate: {
          id: 42,
          headline: "Police investigate a fight reported in northwest Longmont",
          status: "killed",
          killed_at: new Date(2026, 8, 22, 12, 0).toISOString(),
          kill_reason: "Duplicate of Council OKs the budget",
        },
      }),
    }),
  );
  assert.match(html, /Developing: new facts on a story you killed/);
  assert.match(html, /new facts against/);
  assert.match(html, /Police investigate a fight reported in northwest Longmont/);
  assert.match(html, /Killed Sep 22, 2026 — Duplicate of Council OKs the budget/);
  assert.match(html, /New facts · compare/);
  // The old "possible duplicate" wording would be a lie about this row: it is
  // not a maybe-same, it is a story that came back with more to it.
  assert.doesNotMatch(html, /Possible duplicate/);
  assert.doesNotMatch(html, /Held for review —/);
});

test("a held possible duplicate that is not a development keeps the held-review prefix", () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, {
      lead: baseLead({
        status: "held",
        dup_kind: "possible",
        possible_duplicate_of: 42,
        possible_duplicate: {
          id: 42,
          headline: "Earlier council executive-session lead",
          status: "killed",
        },
      }),
    }),
  );
  assert.match(html, /Held for review —/);
  assert.match(html, /possible duplicate of/);
  assert.match(html, /Possible duplicate · compare/);
  assert.doesNotMatch(html, /Developing:/);
});

// Unit AK item 5: the compare chip must open THIS lead's page -- the page that
// has both sides of the pair loaded -- not the other lead's page, which is
// where the old chip went and why it landed an editor on a page that said
// "This lead was killed. Nothing to draft."
test("the compare chip opens this lead's own page, where both sides are loaded", () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, {
      lead: baseLead({
        id: 77,
        status: "held",
        possible_duplicate_of: 42,
        possible_duplicate: { id: 42, headline: "Earlier council executive-session lead", status: "killed" },
      }),
    }),
  );
  const chipIdx = html.indexOf("chip maybe-same");
  const tagStart = html.lastIndexOf("<a", chipIdx);
  const openingTag = html.slice(tagStart, html.indexOf(">", chipIdx) + 1);
  assert.match(openingTag, /href="\/desk\/story\/\$leadId"/);
  // lead 77 is this row; 42 is the prior lead the row is linked to. The chip
  // must point at 77.
  assert.match(openingTag, /data-params="\{&quot;leadId&quot;:&quot;77&quot;\}"/);
  assert.match(html, /Possible duplicate · compare/);
  // And the "possible duplicate of <headline>" sentence still points at the
  // other lead, so an editor can open either one.
  const contextIdx = html.indexOf("possible duplicate of");
  const contextTagStart = html.lastIndexOf("<a", contextIdx);
  const contextTag = html.slice(contextTagStart, html.indexOf(">", contextIdx) + 1);
  assert.match(contextTag, /data-params="\{&quot;leadId&quot;:&quot;42&quot;\}"/);
});

// Owner audit, 2026-09-05: "held", "aside", "closed" and "exhausted" used to
// collapse onto the same "set aside" label (or, for "held", no dedicated
// label at all) -- an editor could not tell a lead that is coming back
// (held) from one that is done (aside/closed/exhausted) without opening it.
// This exercises the REAL Chip() component from desk-chrome.tsx (the
// LeadRowView tests above stub Chip away, since they're testing the row
// around it), so it needs its own module stubs for desk-chrome.tsx's other
// imports -- none of which Chip touches, but the module can't load without
// them resolving to something.
const reactRouterStubForChrome = inlineModule(`
  import { createElement } from "react";
  export function Link({ to, children, ...rest }) {
    return createElement("a", { href: String(to ?? "#"), ...rest }, children);
  }
  export function useMatchRoute() { return () => false; }
  export function useNavigate() { return () => {}; }
  export function useRouterState() { return "/"; }
`);
const reactQueryStub = inlineModule(`
  export function useQuery() { return { data: [] }; }
  export function useMutation() { return { mutate() {}, isPending: false, isError: false }; }
  export function useQueryClient() { return { invalidateQueries: async () => {} }; }
`);
const paperContextStubForChrome = inlineModule(`
  export function usePaper() { return { name: "The Paper", city: "Longmont" }; }
  export function usePaperDateFormatters() { return { formatDate: () => "" }; }
`);
const authGatesStub = inlineModule(`
  import { createElement } from "react";
  export function UserButton() { return createElement("span"); }
`);
const authClientStub = inlineModule(`
  export async function signOut() {}
`);
const currentUserStub = inlineModule(`
  export function useCurrentUserState() { return { user: null, isPending: false }; }
`);
const claimStub = inlineModule(`
  export async function leaveEditor() { return { ok: true }; }
`);
const deskCopyStub = inlineModule(`
  export function createEditorCopy() { return {}; }
`);
// Chip() does not touch the appearance context, but desk-chrome.tsx imports it
// (Light/Dark and Normal/Large moved there -- src/lib/appearance-context.ts),
// so the module cannot load without it resolving.
const appearanceContextStub = inlineModule(`
  export function useAppearance() {
    return {
      appearance: { desk: "light", size: "normal", reader: "light" },
      surface: "light",
      setDesk: () => {},
      refreshReader: () => {},
    };
  }
  export function useHydrated() { return false; }
`);

const { Chip } = await import(
  moduleUrl(
    await readFile(new URL("../src/components/desk-chrome.tsx", import.meta.url), "utf8"),
    "desk-chrome.tsx",
    {
      "@tanstack/react-router": reactRouterStubForChrome,
      "@tanstack/react-query": reactQueryStub,
      "@/lib/paper-context": paperContextStubForChrome,
      "@/lib/paper-context-state": paperContextStubForChrome,
      "@/lib/auth/gates": authGatesStub,
      "@/lib/auth/client": authClientStub,
      "@/lib/auth/use-current-user": currentUserStub,
      "@/lib/news/claim": claimStub,
      "@/lib/news/desk-copy": deskCopyStub,
      "@/components/desk-chrome-utils": deskChromeUtils,
      "@/lib/appearance-context": appearanceContextStub,
      "lucide-react": import.meta.resolve("lucide-react"),
      "@/lib/news/desk": inlineModule("export async function listLeads() { return []; }"),
      "@/lib/news/opinion": inlineModule("export async function listEditorials() { return []; }"),
      react: import.meta.resolve("react"),
      "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    },
  )
);

test("a zero-score lead with a persisted scan run is labelled as scanner-filed", () => {
  assert.equal(leadOrigin({ scan_run_id: 20, newsworthiness: 0 }), "from the scanner");
});

test("Dark Desk provenance wins over a persisted scan run", () => {
  assert.equal(
    leadOrigin({ investigation_id: 7, scan_run_id: 20, newsworthiness: 0 }),
    "from Dark Desk",
  );
});

test("a genuinely manual zero-score lead remains labelled as editor-filed", () => {
  assert.equal(leadOrigin({ scan_run_id: null, newsworthiness: 0 }), "filed by you");
});

test("a held lead renders the HELD chip with the st-held class", () => {
  const html = renderToStaticMarkup(createElement(Chip, { s: "held" }));
  assert.match(html, /class="chip st-held"/);
  // The visible word comes from the .chip CSS uppercase transform, not the
  // markup itself, so the rendered text is lowercase "held" -- assert that
  // rather than "HELD", and rely on the CSS text-transform (unit-tested by
  // styles.css's own uppercase declaration on .chip) for the capitalization.
  assert.match(html, />held</);
});

test("set-aside, closed, and exhausted leads each render their own labelled, styled chip -- none falls through to the unstyled default", () => {
  const cases = [
    { s: "aside", cls: "st-aside", label: "set aside" },
    { s: "closed", cls: "st-closed", label: "closed" },
    { s: "exhausted", cls: "st-exhausted", label: "exhausted" },
  ];
  for (const { s, cls, label } of cases) {
    const html = renderToStaticMarkup(createElement(Chip, { s }));
    assert.match(
      html,
      new RegExp(`class="chip ${cls}"`),
      `expected ${s} to render class chip ${cls}`,
    );
    assert.match(html, new RegExp(`>${label}<`), `expected ${s} to render the label "${label}"`);
  }
});
