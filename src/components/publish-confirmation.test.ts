import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublishConfirmation } from "./publish-confirmation.ts";
import {
  publishBlockers,
  publishConfirmation,
  type PublishBlockerState,
} from "../lib/news/publish-blockers.ts";

/**
 * ── WHAT THE EDITOR ACTUALLY SEES AT THE CONFIRM PRESS (unit OH) ──────────────
 *
 * The pure test next door proves which reasons are hard and which are warnings.
 * This one renders the dialog and proves the consequences a person meets:
 *
 *   - a warning does not disable the button, and its sentence is DRAWN above
 *     the confirm press;
 *   - a hard reason disables the button;
 *   - with no warnings the dialog keeps the desk's own unchanged words;
 *   - a held or killed draft keeps a live bar and says what the one press does;
 *   - a warning the SERVER returned and this page did not know about is drawn,
 *     so a stale tab cannot press again without seeing it.
 *
 * Rendered with `renderToStaticMarkup`, the same way `publish-blockers.test.ts`
 * renders the list, so the assertions are about the document and not about a
 * function's return value.
 */

const CLEAN: PublishBlockerState = {
  headline: "Council approves the budget",
  dek: "The 5-2 vote funds the pilot program.",
  body: "The council approved the budget on Tuesday night after a short debate.",
  sectionReady: true,
  openClaims: 0,
  namedOutlets: [],
  unreviewedClaims: 0,
  unreviewedAccepted: false,
  evidenceStale: false,
  reviewingEvidence: false,
  reconcileActive: false,
  publishing: false,
};

/**
 * ── ONE PATCH PER WARNING KEY, AND THE SENTENCE IT MUST DRAW (unit OH) ───────
 *
 * The request is that EVERY warning key be exercised through the ACTUAL dialog,
 * not just the pure function: each one must leave the confirm press ENABLED, put
 * its own sentence above the press, and carry the "Publish anyway" label. This
 * table is the state that produces each warning key; the test below renders it
 * and asserts the three consequences a person meets. Keyed by the blocker key so
 * a new warning with no row here is a visible gap, not a silent one.
 *
 * `outlet:<name>` is spelled out because the key carries the name.
 */
const WARNING_CASES: { key: string; patch: Partial<PublishBlockerState>; sentence: RegExp }[] = [
  {
    key: "dek",
    patch: { dek: "" },
    sentence: /The dek is empty\./,
  },
  {
    key: "section",
    patch: { sectionReady: false },
    sentence: /No section has been chosen for this story\./,
  },
  {
    key: "outlet:Longmont Leader",
    patch: { namedOutlets: ["Longmont Leader"] },
    sentence: /The body names Longmont Leader and this draft/,
  },
  {
    key: "claims",
    patch: { openClaims: 2 },
    sentence: /2 claims of absence have not been confirmed\./,
  },
  {
    key: "claims-unreviewed",
    patch: { unreviewedClaims: 7, contradictedClaims: 3 },
    sentence: /7 claims need review \(3 contradicted by the record\)\./,
  },
  {
    key: "evidence-stale",
    patch: { evidenceStale: true },
    sentence: /The story changed after its evidence was checked/,
  },
  {
    key: "readiness",
    patch: { readiness: "not-ready", readinessReason: "This story is not ready to publish." },
    sentence: /This story is not ready to publish\./,
  },
  {
    key: "evidence-loading",
    patch: { evidenceLoading: true },
    sentence: /Loading evidence judgments\./,
  },
  {
    key: "meeting-citation-stale",
    patch: { meetingCitationNotice: "The meeting citation no longer matches the record." },
    sentence: /The meeting citation no longer matches the record\./,
  },
  {
    key: "lead-held",
    patch: { leadStatus: "held" },
    sentence: /on hold/,
  },
  {
    key: "lead-killed",
    patch: { leadStatus: "killed" },
    sentence: /killed/,
  },
];

function render(
  patch: Partial<PublishBlockerState>,
  extra: {
    sectionName?: string;
    refusedWarnings?: { key: string; sentence: string }[];
    publishing?: boolean;
  } = {},
) {
  const blockers = publishBlockers({ ...CLEAN, ...patch });
  const html = renderToStaticMarkup(
    createElement(PublishConfirmation, {
      blockers,
      sectionName: extra.sectionName ?? "Council",
      refusedWarnings: extra.refusedWarnings,
      publishing: extra.publishing,
      onConfirm: () => {},
      onCancel: () => {},
    }),
  );
  return {
    html,
    blockers,
    decision: publishConfirmation(blockers, extra.sectionName ?? "Council"),
  };
}

/** The confirm press is the primary button; its `disabled` is the question. */
function confirmDisabled(html: string): boolean {
  const match = html.match(/<button[^>]*class="action-btn btn solid[^"]*"[^>]*>/);
  assert.ok(match, "the dialog must draw a primary confirm press");
  return /disabled/.test(match![0]);
}

function confirmLabel(html: string): string {
  const match = html.match(
    /<button[^>]*class="action-btn btn solid[^"]*"[\s\S]*?<span class="action-label">([\s\S]*?)<\/span>/,
  );
  assert.ok(match, "the confirm press must carry its word");
  return match![1]!;
}

describe("OH: the confirm dialog draws every warning and stays pressable", () => {
  it("keeps the button enabled and prints the section warning above the press", () => {
    const { html, blockers } = render({ sectionReady: false });
    assert.deepEqual(
      blockers.map((b) => b.key),
      ["section"],
    );
    assert.equal(confirmDisabled(html), false, "a warning must not disable the confirm press");
    assert.equal(confirmLabel(html), "Publish anyway in Council");
    assert.match(
      html,
      /No section has been chosen for this story\./,
      "the warning sentence is drawn",
    );
    assert.match(html, /class="astra-publish-warning"/);
  });

  it("draws the contradicted-claims warning the editor is overruling", () => {
    const { html } = render({ unreviewedClaims: 7, contradictedClaims: 3 });
    assert.equal(confirmDisabled(html), false);
    assert.match(html, /7 claims need review \(3 contradicted by the record\)\./);
    assert.match(html, /the record contradicts 3 of them/);
  });

  it("disables the button when a hard reason is present, and does not draw it as a warning", () => {
    const { html } = render({ headline: "", sectionReady: false });
    assert.equal(confirmDisabled(html), true, "an empty headline is a hard stop");
    assert.match(
      html,
      /No section has been chosen for this story\./,
      "the warning is still drawn beside the disabled press",
    );
    assert.doesNotMatch(
      html,
      /The headline is empty, so there is nothing to print\./,
      "a hard reason is the button's business, not a sentence to accept",
    );
  });

  it("keeps the desk's own words when there is nothing to warn about", () => {
    const { html, decision } = render({});
    assert.equal(decision.enabled, true);
    assert.equal(confirmLabel(html), "Yes, print it in Council");
    assert.match(
      html,
      /This puts the story on the public paper and in the feed, under your name, now\./,
    );
    assert.match(html, /Corrections are published, not silent edits\./);
    assert.doesNotMatch(html, /class="astra-publish-warning"/, "no warnings, no warning list");
  });

  it("draws a warning the server returned that this page did not know about", () => {
    const { html, decision } = render(
      { sectionReady: false },
      {
        refusedWarnings: [
          {
            key: "meeting-citation-stale",
            sentence: "The meeting citation no longer matches the record.",
          },
        ],
      },
    );
    assert.equal(decision.enabled, true);
    assert.match(
      html,
      /The meeting citation no longer matches the record\./,
      "a stale tab must see the desk's own new warning before pressing again",
    );
    assert.match(
      html,
      /No section has been chosen for this story\./,
      "and its own warning is still drawn",
    );
  });

  it("does not draw a server warning twice when the page already lists it", () => {
    const { html } = render(
      { sectionReady: false },
      {
        refusedWarnings: [
          { key: "section", sentence: "No section has been chosen for this story." },
        ],
      },
    );
    const rows = html.match(/class="astra-publish-warning"/g) ?? [];
    assert.equal(rows.length, 1, "the same reason said twice is one row");
  });

  it("takes the server's own sentence for a key the page already lists", () => {
    const { html } = render(
      { unreviewedClaims: 7, contradictedClaims: 3 },
      {
        refusedWarnings: [
          {
            key: "claims-unreviewed",
            sentence:
              "9 claims need review (5 contradicted by the record). The record contradicts 5 of them.",
          },
        ],
      },
    );
    assert.match(html, /9 claims need review \(5 contradicted by the record\)\./);
    assert.doesNotMatch(
      html,
      /7 claims need review/,
      "a stale count must not stand once the desk has answered with the current one",
    );
    const rows = html.match(/class="astra-publish-warning"/g) ?? [];
    assert.equal(rows.length, 1);
  });

  it("gets the warning label and stays enabled from a CLEAN page plus one server warning", () => {
    const { html, blockers } = render(
      {},
      {
        refusedWarnings: [
          {
            key: "meeting-citation-stale",
            sentence: "The meeting citation no longer matches the record.",
          },
        ],
      },
    );
    assert.deepEqual(blockers, [], "the client's own list is clean");
    assert.equal(confirmDisabled(html), false, "a server warning does not disable the press");
    assert.equal(
      confirmLabel(html),
      "Publish anyway in Council",
      "the label is decided from the merged list, not the clean client list alone",
    );
    assert.match(html, /The meeting citation no longer matches the record\./);
  });
});

describe("OH: a held or killed draft keeps a live bar and says what the press does", () => {
  it("draws the un-hold sentence and stays pressable on a held draft", () => {
    const { html } = render({ leadStatus: "held" });
    assert.equal(confirmDisabled(html), false);
    assert.equal(confirmLabel(html), "Publish anyway in Council");
    assert.match(html, /hold/i);
    assert.match(html, /publish/i);
  });

  it("draws the restore sentence and stays pressable on a killed draft", () => {
    const { html } = render({ leadStatus: "killed" });
    assert.equal(confirmDisabled(html), false);
    assert.equal(confirmLabel(html), "Publish anyway in Council");
    assert.match(html, /killed/i);
    assert.match(html, /restore|reopen|un-kill/i);
  });
});

it("preserves the editorial confirmation words with no warnings", () => {
  const consequenceText =
    "This puts the piece on the public paper and in the feed, as the paper's own position. Corrections are published, not silent edits.";
  const html = renderToStaticMarkup(
    createElement(PublishConfirmation, {
      blockers: [],
      sectionName: "Opinion",
      consequenceText,
      onConfirm: () => {},
      onCancel: () => {},
    }),
  );
  assert.ok(html.includes(consequenceText.replace("'", "&#x27;")));
  assert.equal(confirmLabel(html), "Yes, print it in Opinion");
  assert.equal(confirmDisabled(html), false);
});

describe("OH: EVERY warning key is enabled, listed above the press, and labelled (actual dialog)", () => {
  /*
    The request in one loop: for each warning key, the dialog the editor really
    opens must (1) keep the confirm press ENABLED, (2) draw that key's own
    sentence above the press, and (3) read "Publish anyway in <section>". The
    loop is the assertion; the table is the coverage, so a dropped warning key
    fails here rather than passing a pure-function test about a list nobody drew.
  */
  for (const { key, patch, sentence } of WARNING_CASES) {
    it(`draws and does not disable "${key}"`, () => {
      const { html, blockers } = render(patch);
      assert.ok(
        blockers.some((b) => b.key === key),
        `this state must actually produce the "${key}" warning`,
      );
      assert.equal(
        confirmDisabled(html),
        false,
        `"${key}" is a warning and must not disable the press`,
      );
      assert.equal(confirmLabel(html), "Publish anyway in Council");
      assert.match(html, sentence);
      assert.match(html, /class="astra-publish-warning"/);
      const pressAt = html.indexOf('class="action-btn btn solid');
      const warningAt = html.indexOf('class="astra-publish-warning"');
      assert.ok(
        warningAt !== -1 && warningAt < pressAt,
        `"${key}"'s sentence must be drawn ABOVE the confirm press`,
      );
    });
  }

  it("accepts a hand-built warning from another surface (editorial-sources) and draws it", () => {
    /*
      The editorial surface adds its OWN synthetic warning (`editorial-sources`,
      owned by the server/editorial worker). It is a plain `PublishBlocker` with
      `kind: "warning"`, and it must behave exactly like the built-in ones -- it
      is not enumerated in `publishBlockers`, so it is passed in directly here.
    */
    const synthetic = {
      key: "editorial-sources",
      kind: "warning" as const,
      sentence: "The editorial desk flagged the sourcing on this story.",
      action: { label: "Review the sourcing", target: { kind: "add-source" as const } },
    };
    const html = renderToStaticMarkup(
      createElement(PublishConfirmation, {
        blockers: [...publishBlockers(CLEAN), synthetic],
        sectionName: "Council",
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    assert.equal(
      confirmDisabled(html),
      false,
      "a warning added by another surface does not disable the press",
    );
    assert.equal(confirmLabel(html), "Publish anyway in Council");
    assert.match(html, /The editorial desk flagged the sourcing on this story\./);
  });
});
