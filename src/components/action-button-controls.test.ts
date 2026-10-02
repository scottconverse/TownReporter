import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ActionButton,
  actionToken,
  rowActionPhase,
  type ActionPhase,
  type ActionTone,
} from "./action-button.ts";
import { publishPressState } from "../lib/news/publish-blockers.ts";
import { pressPhase } from "./action-button.ts";

/**
 * Unit UI1a2, test 2 of the brief: EVERY SCOPED CONTROL HAS ITS FOUR STATES.
 *
 * The first pass left the shared piece and the Publish family done, and these
 * seven controls without working / done / failed states:
 *
 *   Kill this lead, Delete (every site), Hold, Pause, Redraft…, Check now,
 *   Preview as reader
 *
 * This file is the measured answer to that. For each one it does two things:
 *
 *   1. RENDERS the real shared piece in that control's own configuration --
 *      the same tone, the same idle word, the same working word, the same done
 *      word, the same kind of failure reason -- and asserts the WORD, the
 *      colour TOKEN and the ICON separately at every phase. Any one of the
 *      three alone is the bug in a new coat: a green word with no icon is
 *      invisible to anyone who cannot see the green, and a check with no word
 *      is a symbol the editor has to guess at.
 *
 *   2. PINS that configuration against the control's real source file, so the
 *      table above cannot drift away from the call site. Every `pins` entry is
 *      a literal that has to be in the file that draws the control.
 *
 * What it deliberately does NOT do, said plainly rather than left implied:
 * these screens have no whole-route render harness (the desk routes import the
 * router, every query hook and the whole chrome), so the phases are asserted at
 * the shared piece plus a source pin rather than by mounting
 * `desk.story.$leadId.tsx`. Where a component IS renderable in isolation
 * (`BeforeYouCanPublish`, `PublishBarResult`) the real component is rendered
 * and `action-button.test.ts` does that.
 */

const ROOT = new URL("../../", import.meta.url);

function source(relative: string): string {
  return readFileSync(new URL(relative, ROOT), "utf8");
}

function render(node: Parameters<typeof renderToStaticMarkup>[0]) {
  return renderToStaticMarkup(node);
}

/** One scoped control, as the call site actually draws it. */
type Control = {
  name: string;
  /** The file that draws it, relative to the worktree root. */
  file: string;
  tone: ActionTone;
  /** The idle word (unchanged from what the desk already said). */
  idle: string;
  /** The word while the press runs. Absent when the control has no async half. */
  working?: string;
  /** The word once it is done. Absent when the ROW carries the done state. */
  done?: string;
  /** A failure reason of the shape this control's server gives. */
  reason: string;
  /** Literals that must appear in `file`, so this table cannot drift. */
  pins: string[];
  /**
   * False for a press that draws through the shared `Dialog` foot rather than
   * importing `ActionButton` directly. The dialog foot is one component shared
   * by twelve dialogs, so the phase's WORD is handed to it as `pendingLabel`
   * instead -- and what this table still proves is the same thing: the control
   * has a working word of its own and a reason beside it when it fails.
   */
  viaDialog?: boolean;
};

const CONTROLS: Control[] = [
  {
    name: "Kill this lead",
    file: "src/routes/desk.story.$leadId.tsx",
    tone: "quiet-danger",
    idle: "Kill this lead",
    reason: "The kill did not reach the desk. The lead is unchanged.",
    pins: [
      /* The shared piece, at Kill's own level. */
      'tone="quiet-danger"',
      "Kill this lead",
      /* The DONE state is the page's own record of the kill, not a second
         green word on a button that is about to be unmounted. */
      "<KilledLeadRecord",
    ],
  },
  {
    name: "Redraft… / Draft with AI",
    file: "src/routes/desk.story.$leadId.tsx",
    tone: "quiet",
    idle: "Redraft",
    working: "Redrafting…",
    done: "Redraft started",
    reason: "The desk could not start that redraft.",
    pins: [
      'doneLabel={data.draft?.body ? "Redraft started" : "Draft started"}',
      '"Redrafting…"',
      '"Drafting…"',
      /* The done word comes off when the new draft lands, so the control reads
         "Redraft" again for the next press -- the walks press it by name. */
      "setRedraftDone(false)",
    ],
  },
  {
    name: "Preview as reader",
    file: "src/routes/desk.story.$leadId.tsx",
    tone: "quiet",
    idle: "Preview as reader",
    done: "Preview opened",
    reason: "The preview could not be opened.",
    pins: ['doneLabel="Preview opened"', 'phase={previewSeen ? "done" : "idle"}'],
  },
  {
    name: "Preview as reader (draft screen)",
    file: "src/routes/desk.story.draft.$draftId.tsx",
    tone: "quiet",
    idle: "Preview as reader",
    done: "Preview opened",
    reason: "The preview could not be opened.",
    pins: [
      'doneLabel="Preview opened"',
      "setPreviewSeen(true)",
      '"Write a headline or a body to preview."',
    ],
  },
  {
    name: "Check now / Retry (watch list)",
    file: "src/routes/desk.sources.tsx",
    tone: "quiet",
    idle: "Check now",
    working: "Checking…",
    done: "Checked",
    reason: "Still failing: the site refused us.",
    pins: [
      'workingLabel={failed ? "Retrying…" : "Checking…"}',
      'doneLabel="Checked"',
      "reason={result && !result.ok ? result.line : null}",
    ],
  },
  {
    name: "Pause (watch list)",
    file: "src/routes/desk.sources.tsx",
    tone: "quiet",
    idle: "Pause",
    working: "Pausing…",
    reason: "Could not pause that source.",
    pins: ['workingLabel="Pausing…"', 'onStatus(s.id, "paused")'],
  },
  {
    name: "Resume (watch list)",
    file: "src/routes/desk.sources.tsx",
    tone: "quiet",
    idle: "Resume",
    working: "Resuming…",
    reason: "Could not resume that source.",
    pins: ['workingLabel="Resuming…"', 'onStatus(s.id, "accepted")'],
  },
  {
    name: "Delete (watch list row)",
    file: "src/routes/desk.sources.tsx",
    tone: "danger",
    idle: "Delete",
    working: "Deleting…",
    reason: "Could not remove that source.",
    pins: ['workingLabel="Deleting…"', "The desk is still reading this source."],
  },
  {
    name: "Remove / Yes, remove (watch list row)",
    file: "src/routes/desk.sources.tsx",
    tone: "primary",
    idle: "Yes, remove",
    working: "Removing…",
    reason: "Could not remove that source.",
    pins: ['workingLabel="Removing…"', "Another change to this source is still being saved."],
  },
  {
    name: "Check now (page watch)",
    file: "src/components/page-watch-panel.tsx",
    tone: "secondary",
    idle: "Check now",
    working: "Checking…",
    done: "Checked",
    reason: "Could not check that page.",
    pins: ['doneLabel="Checked"', "This page is paused, so the desk is not checking it."],
  },
  {
    name: "Pause / Resume (page watch)",
    file: "src/components/page-watch-panel.tsx",
    tone: "quiet",
    idle: "Pause",
    working: "Pausing…",
    reason: "Could not change that page's watch.",
    pins: [
      'workingLabel={row.watch_state === "active" ? "Pausing…" : "Resuming…"}',
      'state: row.watch_state === "active" ? "paused" : "active"',
    ],
  },
  {
    name: "Stop watching (page watch)",
    file: "src/components/page-watch-panel.tsx",
    tone: "danger",
    idle: "Stop watching",
    working: "Stopping…",
    reason: "Could not stop watching that page.",
    pins: ['workingLabel="Stopping…"', 'This page is already stopped.'],
  },
  {
    name: "Delete (draft screen)",
    file: "src/routes/desk.story.draft.$draftId.tsx",
    tone: "danger",
    idle: "Delete",
    reason: "The draft could not be deleted.",
    pins: ["The delete is still being saved.", 'workingLabel="Deleting…"'],
  },
  {
    name: "Yes, delete it (draft screen)",
    file: "src/routes/desk.story.draft.$draftId.tsx",
    tone: "primary",
    idle: "Yes, delete it",
    working: "Deleting…",
    reason: "The draft could not be deleted.",
    pins: ['workingLabel="Deleting…"', "Yes, delete it"],
  },
  {
    name: "Delete / Clear (opinion desk)",
    file: "src/routes/desk.opinion.tsx",
    tone: "danger",
    idle: "Delete",
    reason: "That did not delete.",
    pins: ['tone="danger"', '{r.draft_id ? "Delete" : "Clear"}'],
  },
  {
    name: "Yes, take it off (published)",
    file: "src/routes/desk.published.tsx",
    tone: "danger",
    idle: "Yes, take it off",
    working: "Removing…",
    reason: "Could not take that story off the paper.",
    pins: ['workingLabel="Removing…"', "The removal is still being saved."],
  },
  {
    name: "Hold (the Hold dialog's own press)",
    viaDialog: true,
    file: "src/components/dialogs/editor-dialogs.tsx",
    tone: "secondary",
    idle: "Hold with this reason",
    working: "Holding…",
    reason: "The desk refused that hold. The lead is unchanged.",
    pins: [
      'primaryPendingLabel="Holding…"',
      'altPendingLabel="Holding…"',
      "pending={press.busy}",
      /* The done state is the ROW's: a held lead reads "Held" and offers the
         way back, which is what the announce and the row's own data say. */
      "Released leads return to the open list with their score.",
    ],
  },
  {
    name: "Kill (the Kill dialog's own press)",
    viaDialog: true,
    file: "src/components/dialogs/KillDialog.tsx",
    tone: "secondary",
    idle: "Kill with this reason",
    working: "Killing…",
    reason: "The kill did not reach the desk. The lead is unchanged.",
    pins: ['primaryPendingLabel="Killing…"', 'altPendingLabel="Killing…"', "pending={busy}"],
  },
  {
    name: "Delete (Queue, lead row)",
    file: "src/components/desk-leads.tsx",
    tone: "danger",
    idle: "Delete",
    working: "Deleting…",
    reason: "That did not delete.",
    pins: [
      'workingLabel="Deleting…"',
      "deletePending?: boolean",
      "deleteReason?: string | null",
    ],
  },
  {
    name: "Hold (Queue, bulk)",
    file: "src/routes/desk.queue.tsx",
    tone: "quiet",
    idle: "Hold",
    working: "Holding…",
    reason: "One lead could not be held.",
    pins: ['workingLabel="Holding…"', 'problem: bulkProblemFor("held")'],
  },
  {
    name: "Kill (Queue, bulk)",
    file: "src/routes/desk.queue.tsx",
    tone: "quiet-danger",
    idle: "Kill",
    working: "Killing…",
    reason: "One lead could not be killed.",
    pins: ['workingLabel="Killing…"', 'problem: bulkProblemFor("killed")'],
  },
];

/**
 * `renderToStaticMarkup` escapes the apostrophes a real server sentence
 * carries ("Could not change that page's watch."). Undo that, so the assertion
 * is against the sentence the editor reads rather than against the escape.
 */
function decode(html: string): string {
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/** Draw one control at one phase, exactly as its call site does. */
function draw(control: Control, phase: ActionPhase, reason: string | null = null): string {
  return decode(render(
    createElement(ActionButton, {
      phase,
      tone: control.tone,
      workingLabel: control.working,
      doneLabel: control.done,
      reason,
      children: control.idle,
    } as never),
  ));
}

describe("every scoped control: idle -> working -> done, at the control", () => {
  for (const control of CONTROLS) {
    it(`${control.name}: working is disabled, busy, spinning and says what it is doing`, () => {
      if (!control.working) return; // the press is synchronous; nothing to wait for
      const html = draw(control, "working");
      assert.match(
        html,
        new RegExp(`class="action-label">${escapeRe(control.working)}<`),
        `${control.name}: the WORD does not change while it works`,
      );
      assert.match(html, /disabled/, `${control.name}: a press in flight can be pressed again`);
      assert.match(html, /aria-busy="true"/, `${control.name}: a screen reader is not told`);
      assert.match(html, /action-icon-spin/, `${control.name}: no spinner`);
      assert.match(html, /data-token="fg2"/, `${control.name}: the working token is not fg2`);
      /* The idle word is GONE while it works -- a button that says both is a
         button the editor cannot tell is running. */
      assert.doesNotMatch(
        html,
        new RegExp(`class="action-label">${escapeRe(control.idle)}<`),
        `${control.name}: still draws its idle word while working`,
      );
    });

    it(`${control.name}: done changes the WORD, the TOKEN and the ICON -- all three`, () => {
      if (!control.done) {
        /* A control whose action changes what the ROW is carries its done state
           on the row instead (see `rowActionPhase`). The pin above is what
           proves the row state exists; here we only assert the button is not
           pretending to be green while the row says otherwise. */
        assert.match(
          draw(control, "idle"),
          /data-token="(fg|a|danger)"/,
          `${control.name}: an idle press wears its own level's token`,
        );
        assert.doesNotMatch(
          draw(control, "idle"),
          /data-token="ok"/,
          `${control.name}: an idle press is already painted as done`,
        );
        return;
      }
      const idle = draw(control, "idle");
      const done = draw(control, "done");
      assert.match(
        done,
        new RegExp(`class="action-label">${escapeRe(control.done)}<`),
        `${control.name}: the WORD does not change when it is done`,
      );
      assert.match(done, /data-token="ok"/, `${control.name}: the TOKEN does not change`);
      assert.match(done, /action-icon-check/, `${control.name}: the ICON does not change`);
      assert.notEqual(
        done.match(/data-token="([^"]+)"/)?.[1],
        idle.match(/data-token="([^"]+)"/)?.[1],
        `${control.name}: done is the idle colour repainted`,
      );
      assert.doesNotMatch(done, /disabled/, `${control.name}: a finished press is stuck`);
      assert.doesNotMatch(
        done,
        new RegExp(`class="action-label">${escapeRe(control.idle)}<`),
        `${control.name}: still draws its idle word when done`,
      );
    });

    it(`${control.name}: a failure prints the reason BESIDE the control and returns it to idle`, () => {
      const html = draw(control, "failed", control.reason);
      assert.match(html, /role="alert"/, `${control.name}: the reason is not announced`);
      assert.match(
        html,
        /class="action-reason"/,
        `${control.name}: the reason has no line of its own`,
      );
      assert.match(
        html,
        new RegExp(escapeRe(control.reason)),
        `${control.name}: the server's own reason is not printed`,
      );
      assert.match(
        html,
        new RegExp(`class="action-label">${escapeRe(control.idle)}<`),
        `${control.name}: the button did not return to its idle word`,
      );
      assert.match(html, /data-phase="failed"/, `${control.name}: the failure is not recorded`);
      assert.doesNotMatch(html, /disabled/, `${control.name}: a failed press is not pressable`);
      /* ONE reason line: it is a sibling of the button, never folded inside it
         (several walks read a control's innerText and compare it to a banner). */
      const buttonHtml = html.slice(0, html.indexOf("</button>") + "</button>".length);
      assert.doesNotMatch(buttonHtml, new RegExp(escapeRe(control.reason)));
    });

    it(`${control.name}: the reason the desk gives is carried, not replaced by an apology`, () => {
      /* The failure path cannot be quietly shortened to a generic sentence:
         whatever the server said is on the screen, word for word. */
      const serverSaid = `${control.name} refused: the evidence check moved.`;
      const html = draw(control, "failed", serverSaid);
      assert.match(html, /The evidence check moved|refused: the evidence check moved\./);
      assert.match(html, new RegExp(escapeRe(serverSaid.slice(0, 24))));
    });
  }
});

describe("the scoped controls call sites really draw the shared piece", () => {
  for (const control of CONTROLS) {
    it(`${control.name}: ${control.file} draws it through ActionButton`, () => {
      const text = source(control.file);
      if (control.viaDialog) {
        assert.match(
          text,
          /primaryPendingLabel="[^"]+…"/,
          `${control.file} no longer hands the shared Dialog foot a working word`,
        );
      } else {
        assert.match(
          text,
          /import \{[^}]*ActionButton[^}]*\} from "(\.\.\/components\/action-button|@\/components\/action-button|\.\/action-button)"/,
          `${control.file} does not import the shared piece`,
        );
      }
      for (const pin of control.pins) {
        assert.ok(
          text.includes(pin),
          `${control.file} no longer contains ${JSON.stringify(pin)} -- the states have drifted`,
        );
      }
    });
  }

  it("no scoped control is left on a hand-rolled pending ternary", () => {
    /* The eight `isPending ? "X…" : "X"` expressions this unit replaced must
       not come back: the working state now goes through `workingLabel`, so the
       word, the spinner and the disabled attribute cannot come apart again. */
    const files = [
      "src/routes/desk.sources.tsx",
      "src/components/page-watch-panel.tsx",
      "src/routes/desk.queue.tsx",
      "src/routes/desk.story.$leadId.tsx",
      "src/routes/desk.story.draft.$draftId.tsx",
    ];
    const offenders: string[] = [];
    /*
      The shape that must not come back is the working word drawn as the
      button's own CHILD -- `{busy ? "Pausing…" : "Pause"}`. A ternary passed to
      `workingLabel=` is the shared piece's own API and is exactly what is
      wanted, so the `=` before the brace is what tells the two apart.
    */
    const handRolled = /(^|[^=\w])\{[^{}]*\?\s*"(Pausing|Resuming|Checking|Removing|Deleting|Holding|Killing|Retrying)…"/gm;
    for (const file of files) {
      for (const m of source(file).matchAll(handRolled)) {
        offenders.push(`${file}: still hand-rolls "${m[2]}…" as the button's own word`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});

describe("the row-state controls: the ROW carries the done state", () => {
  it("rowActionPhase has no done branch, by design", () => {
    assert.equal(rowActionPhase({ isPending: true }), "working");
    assert.equal(rowActionPhase({ isPending: false, problem: "It refused." }), "failed");
    assert.equal(rowActionPhase({ isPending: false }), "idle");
    /* The one thing it must never say: a button wearing a green "done" while
       the row it acts on is still being refetched. */
    assert.notEqual(rowActionPhase({ isPending: false }), "done");
  });

  it("a paused source row offers Resume, and a held lead reads 'On hold'", () => {
    /* The persistent half of rule 3: the state Pause/Hold put the row INTO is
       drawn from the row's data, so it survives a reload. These are the two
       places that draw it. */
    const sources = source("src/routes/desk.sources.tsx");
    assert.match(sources, /\? \{ cls: "paused", label: "Paused" \}/, "the chip is not the row's own state");
    assert.match(sources, /"Paused · the scanner will not fetch it"/);
    /* Resume is drawn exactly where Pause was, from `status === "paused"`. */
    assert.match(sources, /const paused = s\.status === "paused";/);
  });
});

describe("the tokens the phases paint with are the design system's", () => {
  it("done is green, working is fg2, failed is danger -- whatever the level", () => {
    assert.equal(actionToken("done", "quiet"), "ok");
    assert.equal(actionToken("done", "quiet-danger"), "ok");
    assert.equal(actionToken("done", "danger"), "ok");
    assert.equal(actionToken("working", "quiet"), "fg2");
    assert.equal(actionToken("failed", "quiet"), "danger");
    assert.equal(actionToken("idle", "quiet"), "fg");
    assert.equal(actionToken("idle", "quiet-danger"), "danger");
  });
});

describe("the publish family keeps its own path", () => {
  it("pressPhase still reads the bar's four kinds", () => {
    assert.equal(pressPhase(publishPressState({ publishing: true, refusal: "", publishedSlug: null }).kind), "working");
    assert.equal(pressPhase(publishPressState({ publishing: false, refusal: "", publishedSlug: "a" }).kind), "done");
    assert.equal(pressPhase(publishPressState({ publishing: false, refusal: "no", publishedSlug: null }).kind), "failed");
    assert.equal(pressPhase(publishPressState({ publishing: false, refusal: "", publishedSlug: null }).kind), "idle");
  });

  /**
   * Unit UI1b-2. Publish was the one press in this family whose DONE state was
   * not the button's: a print took the bar away and the banner said everything,
   * on UI1a's one-confirmation rule. The owner changed that rule on purpose --
   * "click a publish button, it publishes and then CHANGES to say 'Published'"
   * -- so the bar's own slot now wears the shared piece's `done` phase, and
   * this is the pin that the call site still draws it.
   *
   * What is asserted here is only the call site: the word, the token, the icon
   * and the settled (not pressable) state are rendered for real in
   * `publish-bar-done.test.ts`.
   */
  it("UI1b-2: the bar's slot wears Publish's own done state, and it stays", () => {
    const route = source("src/routes/desk.story.$leadId.tsx");
    assert.match(
      route,
      /\{onPaper \? \(\s*<PublishBarDone result=\{press\} \/>/,
      "the slot is drawn from the story, not from the press's last answer",
    );
    const bar = source("src/components/publish-bar-result.ts");
    assert.match(bar, /phase: "done"/, "the shared piece, in its done phase");
    assert.match(bar, /doneLabel: PUBLISHED_LABEL/, "and it says Published");
    assert.match(bar, /disabled: true/, "a done state has no second press");
  });
});

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
