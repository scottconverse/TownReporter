import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ActionButton,
  ActionIcon,
  actionToken,
  mutationPhase,
  pressPhase,
  type ActionPhase,
} from "./action-button.ts";
import { BeforeYouCanPublish } from "./publish-blockers.ts";
import { PublishBarResult } from "./publish-bar-result.ts";
import { publishPressState, type PublishBlocker } from "../lib/news/publish-blockers.ts";

/**
 * UI1a, tests 2, 3 and 4: every scoped control has four states, a disabled
 * control says why, and no scoped control is drawn as bare text.
 *
 * Scott pressed a control he could not tell was a control. The three things
 * that make one are asserted here, SEPARATELY, because any one of them alone
 * is the same bug in a new coat:
 *
 *   - the WORD changes ("Publish in Council" -> "Publishing…" -> "Published."),
 *   - the colour TOKEN changes (read off `data-token`, which the stylesheet
 *     resolves -- not a computed colour, so there is no second list of hexes
 *     to drift),
 *   - the ICON appears (the check for done, the spinner for working).
 */

const deskCss = readFileSync(new URL("../desk-astra.css", import.meta.url), "utf8");

function render(node: Parameters<typeof renderToStaticMarkup>[0]) {
  return renderToStaticMarkup(node);
}

function button(label = "Delete") {
  return (phase: ActionPhase, extra: Record<string, unknown> = {}) =>
    render(
      createElement(ActionButton, {
        phase,
        tone: "secondary",
        workingLabel: "Deleting…",
        doneLabel: "Deleted",
        ...extra,
        children: label,
      } as never),
    );
}

describe("ActionButton: the four states of one press", () => {
  it("idle: the level's own word, the level's own token, no icon", () => {
    const html = button()("idle");
    assert.match(html, /class="action-label">Delete</);
    assert.match(html, /data-phase="idle"/);
    assert.match(html, /data-token="fg"/, "an idle secondary wears the ink token");
    assert.doesNotMatch(html, /action-icon/, "an idle button carries no glyph");
    assert.doesNotMatch(html, /disabled/, "and it is pressable");
    assert.doesNotMatch(html, /action-reason/);
  });

  it("working: disabled, busy, a spinner, and the working word", () => {
    const html = button()("working");
    assert.match(html, /class="action-label">Deleting…</, "the word changes");
    assert.match(html, /disabled/, "a press in flight cannot be pressed again");
    assert.match(html, /aria-busy="true"/, "and a screen reader is told so");
    assert.match(html, /action-icon-spin/, "the icon changes");
    assert.match(html, /aria-hidden="true"/, "the glyph is decoration; the word carries it");
  });

  it("done: the word, the colour TOKEN and the icon all change -- asserted separately", () => {
    const idle = button()("idle");
    const done = button()("done");
    assert.match(done, /class="action-label">Deleted</, "the WORD changed");
    assert.match(done, /data-token="ok"/, "the TOKEN changed");
    assert.match(done, /action-icon-check/, "the ICON changed");
    assert.notEqual(
      done.match(/data-token="([^"]+)"/)?.[1],
      idle.match(/data-token="([^"]+)"/)?.[1],
      "done cannot be the idle token repainted",
    );
    assert.doesNotMatch(done, /disabled/, "a finished press is not stuck");
    assert.match(done, /action-icon/, "done is never colour alone");
  });

  it("failed: the reason is printed beside the control, in red, and the button is back to idle", () => {
    const html = button("Publish in Council")("failed", {
      reason: "5 claims from the evidence check have not been reviewed.",
    });
    assert.match(html, /role="alert"/, "the answer to a press is announced, not queued");
    assert.match(html, /class="action-reason"/);
    assert.match(html, /5 claims from the evidence check have not been reviewed\./);
    assert.match(
      html,
      /data-phase="failed"/,
      "the failure is still on the control, even though the button is not wearing it",
    );
    assert.match(
      html,
      /class="action-label">Publish in Council</,
      "the button returns to its idle word, ready to press again",
    );
    assert.doesNotMatch(html, /disabled/, "and it is pressable");
    assert.match(html, /action-reason[\s\S]*?<\/span>$/, "the reason sits after the button");
  });

  it("the reason line is a SIBLING of the button, never inside it", () => {
    /* Several walks read a control's `innerText` and compare it against the
       bar's own sentence; a reason folded into the button would silently
       rewrite the name they ask for. */
    const html = button("Delete")("failed", { reason: "Could not delete that." });
    const buttonHtml = html.slice(0, html.indexOf("</button>") + "</button>".length);
    assert.doesNotMatch(buttonHtml, /Could not delete that\./);
    assert.match(html.replace(buttonHtml, ""), /Could not delete that\./);
  });

  it("disabled: it looks disabled AND says why beside it", () => {
    const html = button("Publish in Council")("idle", {
      disabled: true,
      disabledReason: "Write a dek to publish.",
    });
    assert.match(html, /disabled/);
    assert.match(html, /action-reason">Write a dek to publish\.</);
    assert.doesNotMatch(html, /role="alert"/, "a standing gate is not an alert");
  });

  it("the tokens and the icons come from the one place", () => {
    assert.equal(actionToken("idle", "primary"), "a");
    assert.equal(actionToken("idle", "secondary"), "fg");
    assert.equal(actionToken("idle", "danger"), "danger");
    assert.equal(actionToken("working", "secondary"), "fg2");
    assert.equal(actionToken("done", "danger"), "ok", "done is green whatever the level");
    assert.equal(actionToken("failed", "secondary"), "danger");
    /* The stylesheet resolves those names to real tokens, in both themes. */
    assert.match(deskCss, /\.action-btn\[data-token="ok"\][\s\S]{0,80}var\(--ok\)/);
    assert.match(deskCss, /\.action-reason[\s\S]{0,200}var\(--danger\)/);
    assert.match(deskCss, /\.action-icon-spin[\s\S]{0,120}animation:/);
  });

  it("primary and danger draw the level the design system names", () => {
    const primary = render(
      createElement(ActionButton, { phase: "idle", tone: "primary", children: "Publish" } as never),
    );
    assert.match(primary, /class="action-btn btn solid/);
    assert.match(primary, /data-token="a"/);
    const danger = render(
      createElement(ActionButton, { phase: "idle", tone: "danger", children: "Delete" } as never),
    );
    assert.match(danger, /class="action-btn btn danger/);
    assert.match(danger, /data-token="danger"/);
  });

  it("the icon set is the two glyphs, both inert", () => {
    for (const phase of ["working", "done"] as const) {
      const html = renderToStaticMarkup(createElement(ActionIcon, { phase }));
      assert.match(html, /aria-hidden="true"/);
      assert.match(html, /focusable="false"/);
    }
    assert.equal(renderToStaticMarkup(createElement(ActionIcon, { phase: "idle" })), "");
    assert.equal(renderToStaticMarkup(createElement(ActionIcon, { phase: "failed" })), "");
  });

  it("mutationPhase reads a React Query mutation's answer", () => {
    assert.equal(mutationPhase({ isPending: true }), "working");
    assert.equal(mutationPhase({ isPending: false, done: true }), "done");
    assert.equal(mutationPhase({ isPending: false, problem: "It refused." }), "failed");
    assert.equal(mutationPhase({ isPending: false }), "idle");
  });
});

describe("Publish: idle -> working -> done / failed, at the control", () => {
  const phaseOf = (input: Parameters<typeof publishPressState>[0]) =>
    pressPhase(publishPressState(input).kind);

  it("idle before the press, and the bar says nothing", () => {
    assert.equal(phaseOf({ publishing: false, refusal: "", publishedSlug: null }), "idle");
    assert.equal(
      render(createElement(PublishBarResult, { state: { kind: "idle" } })),
      "",
    );
  });

  it("working: the bar and the button say the same thing, with a spinner", () => {
    const state = publishPressState({ publishing: true, refusal: "", publishedSlug: null });
    assert.equal(pressPhase(state.kind), "working");
    const html = render(createElement(PublishBarResult, { state }));
    assert.match(html, /Publishing…/, "the word");
    assert.match(html, /action-icon-spin/, "the icon");
    assert.match(html, /data-phase="working"/);
    assert.match(html, /role="status"/);
    assert.doesNotMatch(html, /publish-blocked/);
  });

  it("done: 'Published.' in the success green, with the check, and the two ways on", () => {
    const state = publishPressState({
      publishing: false,
      refusal: "",
      publishedSlug: "council-adopts-budget",
    });
    assert.equal(pressPhase(state.kind), "done");
    const html = render(createElement(PublishBarResult, { state }));
    assert.match(html, /Published\./, "the WORD");
    assert.match(html, /data-token="ok"/, "the TOKEN");
    assert.match(html, /action-icon-check/, "the ICON");
    assert.match(html, /publish-done/);
    assert.match(html, /href="\/articles\/council-adopts-budget"/);
    assert.match(html, /Read it on the paper/);
    assert.match(html, /See it under Published/);
  });

  it("failed: the server's reason in the bar's danger style, and the phase agrees", () => {
    const state = publishPressState({
      publishing: false,
      refusal: "5 claims from the evidence check have not been reviewed.",
      publishedSlug: null,
    });
    assert.equal(pressPhase(state.kind), "failed");
    const html = render(createElement(PublishBarResult, { state }));
    assert.match(html, /5 claims from the evidence check have not been reviewed\./);
    assert.match(html, /publish-blocked/);
    assert.match(html, /role="alert"/);
  });
});

/**
 * The "Publish anyway" row -- the control Scott actually pressed.
 */
const CLAIMS_BLOCKER: PublishBlocker = {
  key: "claims-unreviewed",
  sentence: "3 claims need review. The evidence check raised them and no one has judged them.",
  action: { label: "Review the claims", target: { kind: "evidence-review" } },
  altAction: {
    label: "Publish anyway — I accept these claims are unreviewed",
    target: { kind: "accept-unreviewed" },
  },
};

function renderBlockers(props: Record<string, unknown> = {}) {
  return render(
    createElement(BeforeYouCanPublish, {
      blockers: [CLAIMS_BLOCKER],
      onAct: () => {},
      ...props,
    } as never),
  );
}

describe("the publish-blocker rows: a real button, and it says what it is doing", () => {
  it("'Publish anyway' is a real button at a real level, not a text string", () => {
    const html = renderBlockers();
    assert.match(html, /class="action-btn btn astra-blocker-act"/, "the secondary level, not bare text");
    assert.match(html, /Publish anyway — I accept these claims are unreviewed/);
    assert.match(html, /Review the claims/, "and the row's other press is there too");
  });

  it("the accept press runs, then says Accepted with a check", () => {
    const working = renderBlockers({ busyTarget: "accept-unreviewed", failureReason: null });
    assert.match(working, /Accepting…/, "the word while it runs");
    assert.match(working, /action-icon-spin/);
    assert.match(working, /disabled/);

    const done = renderBlockers({ doneTarget: "accept-unreviewed" });
    assert.match(done, /class="action-label">Accepted</, "the word");
    assert.match(done, /data-token="ok"/, "the token");
    assert.match(done, /action-icon-check/, "the icon");
  });

  it("a refused accept prints the server's reason beside that row", () => {
    const html = renderBlockers({
      failedTarget: "accept-unreviewed",
      failureReason: "The evidence check has moved since you looked at it. Review it again.",
    });
    assert.match(html, /role="alert"/);
    assert.match(html, /The evidence check has moved since you looked at it\. Review it again\./);
    assert.match(html, /class="action-label">Publish anyway — I accept these claims are unreviewed</, "the button is back to idle");
  });

  it("a gated Publish says the reason beside the button (rule 4)", () => {
    const html = renderBlockers({
      blockers: [{ ...CLAIMS_BLOCKER, altAction: undefined }],
    });
    /* The row's own sentence is already beside the press -- and the button is
       not disabled behind it, because "Review the claims" is the press that
       clears it. What rule 4 forbids is a greyed control with nothing said. */
    assert.match(html, /3 claims need review\./);
    assert.doesNotMatch(html, /action-reason/, "an actionable row needs no second reason line");
  });
});

/**
 * Test 4: the guard. No scoped control is drawn as bare text.
 *
 * Rendered where a harness exists (every button inside the blocker list and
 * the publish bar carries a level class), and read off the source where one
 * does not -- the scoped labels are pinned by name in the desk routes, and any
 * of them drawn on a `<button>` with no `className` is the exact bug Scott
 * reported.
 */
describe("no scoped control is drawn as bare text", () => {
  const SCOPED = [
    "Publish",
    "Publish anyway",
    "Kill this lead",
    "Delete",
    "Hold",
    "Pause",
    "Redraft",
    "Check now",
    "Preview as reader",
    "Review the claims",
  ];

  it("every button the blocker list draws carries a level class", () => {
    const html = renderBlockers();
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    assert.ok(buttons.length >= 2, "sanity: the row draws two presses");
    for (const tag of buttons) {
      assert.match(
        tag,
        /class="[^"]*\bbtn\b/,
        `a blocker button is drawn without a button level: ${tag}`,
      );
    }
  });

  it("no desk route or component draws a scoped label on a classless <button>", () => {
    const dirs = [
      new URL("../routes/", import.meta.url),
      new URL("../components/", import.meta.url),
    ];
    const files: string[] = [];
    for (const dir of dirs) {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".tsx")) continue;
        if (dir.pathname.includes("routes") && !/^desk.*\.tsx$/.test(name)) continue;
        files.push(new URL(name, dir).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
      }
    }
    assert.ok(files.length > 30, `sanity: scanned ${files.length} desk files`);

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of source.matchAll(/<button\b([^>]*)>([\s\S]{0,400}?)<\/button>/g)) {
        const [, attrs, inner] = m;
        if (/\bbtn\b/.test(attrs)) continue;
        if (/\bclassName=\{/.test(attrs)) continue; /* a computed class list */
        const text = inner.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        const hit = SCOPED.find((label) => text.startsWith(label) || text === label);
        if (hit) offenders.push(`${file.split(/[\\/]/).pop()}: <button> says "${hit}" with no class`);
      }
    }
    assert.deepEqual(offenders, [], "these controls read as text, not as buttons");
  });

  it("Story titles in lists stay links, and links are always underlined", () => {
    /* Rule 2: a plain text link is allowed for going to another page, and then
       it is ALWAYS underlined. One rule, in both stylesheets. */
    const appCss = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    assert.match(appCss, /\.desk-ltr \.inline-link \{[^}]*text-decoration:\s*underline/);
    assert.match(deskCss, /\.desk-ltr\.astra a \{[^}]*text-decoration-thickness/);
  });
});
