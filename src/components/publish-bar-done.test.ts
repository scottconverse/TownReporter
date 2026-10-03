import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublishBarDone, PublishBarResult } from "./publish-bar-result.ts";
import { ActionButton } from "./action-button.ts";
import { pressPhase } from "./action-button.ts";
import { publishPressState } from "../lib/news/publish-blockers.ts";

/**
 * UNIT UI1b-2. Scott's own words, relayed by the auditor:
 *
 *   "These all need actionable interface elements that are obvious and that
 *    provide feedback once used (click a publish button, it publishes and then
 *    CHANGES to say 'Published' with, say, a green color vs. the yellow red it
 *    was before)."
 *
 * The auditor tested PR 171 on the owner's real story: after "Yes, print it"
 * the Publish button was GONE and the bar held only the "Published." banner.
 * Unit UI1a's rule -- ONE confirmation per action, and here the banner was the
 * one -- meant a print took the control away, because a print makes
 * `canPublish` false. The owner's request changes that rule on purpose: the
 * control's own done state AND the banner both show, in the same slot, and the
 * done state STAYS for as long as the story is on the paper.
 *
 * The properties, each asserted on its own so none can hide behind another:
 *
 *   1. after a print the bar draws a "Published" ActionButton in the done
 *      phase -- the WORD, the green TOKEN and the check ICON separately -- AND
 *      the banner is still drawn beside it;
 *   2. the done state survives the post-publish refresh and is drawn for a
 *      story that loads already on the paper, where there was no press at all;
 *   3. a refused press draws no Published state;
 *   4. while the request is in flight BOTH presses say "Publishing…", are
 *      disabled and carry the spinner;
 *   5. the done state is not pressable, and it does not read as a faded dead
 *      control either -- a settled green edge at full strength.
 *
 * SOURCE-SHAPE where a browser is required. The story route is a ~3,800-line
 * client component (`desk.story.$leadId.tsx`) with no render harness in this
 * repo; what the route decides is pinned against its own source, exactly as
 * `publish-bar-result.test.ts` and `story-publish-refresh-order.test.mjs`
 * already do for this file. Everything the bar DRAWS is rendered for real
 * through `PublishBarDone`, so the words, the tokens and the icons are
 * measured rather than guessed.
 */

function render(node: Parameters<typeof renderToStaticMarkup>[0]) {
  return renderToStaticMarkup(node);
}

/** The bar's own on-paper body, as the route draws it. */
function bar(result: ReturnType<typeof publishPressState>) {
  return render(createElement(PublishBarDone, { result }));
}

/** Only the <button>…</button>, so the banner beside it cannot answer for it. */
function buttonPart(html: string): string {
  const end = html.indexOf("</button>");
  return end < 0 ? "" : html.slice(0, end + "</button>".length);
}

const PUBLISHED = { kind: "published", slug: "council-adopts-budget" } as const;
const IDLE = { kind: "idle" } as const;

describe("UI1b-2: the Publish button's own done state, and it stays", () => {
  it("test 1: after a print the slot holds a green 'Published' control with the check", () => {
    const html = bar(PUBLISHED);
    const button = buttonPart(html);
    assert.match(button, /class="action-label">Published</, "the WORD changed to Published");
    assert.match(
      button,
      /data-phase="done"/,
      "the phase is done -- this is the press's own finished state",
    );
    assert.match(button, /data-token="ok"/, "the green done TOKEN, not the idle level's");
    assert.match(button, /action-icon-check/, "the check ICON");
    assert.match(button, /action-btn/, "still a button, not plain text");
  });

  it("test 1: AND the banner is still drawn, with its own words and both ways on", () => {
    const html = bar(PUBLISHED);
    assert.match(html, /Published\./, "the banner's sentence, which the walks pin");
    assert.match(html, /href="\/articles\/council-adopts-budget"/);
    assert.match(html, /Read it on the paper/);
    assert.match(html, /See it under Published/);
    assert.match(html, /publish-done/, "the banner's own class, which the walks pin");
    assert.match(html, /id="astra-publish-bar"/, "both live in the bar's own place");
  });

  it("test 1: the button and the banner are two different things, saying the same thing", () => {
    const html = bar(PUBLISHED);
    const button = buttonPart(html);
    const rest = html.replace(button, "");
    assert.doesNotMatch(button, /Read it on the paper/, "the way to the paper is the banner's");
    assert.match(rest, /Read it on the paper/);
    /*
      The done control is not the banner repainted: the banner's own sentence
      ("Published.") is outside the button, so a walk reading the button's
      innerText gets the word "Published" and nothing else.
    */
    assert.doesNotMatch(button, /Published\./);
  });

  it("test 2: the done state is still drawn once the press's own answer is gone", () => {
    /*
      The refresh that follows a print re-renders this page many times, and a
      story opened later has no press behind it at all -- `press` is idle. The
      slot is a fact about the STORY, so it is driven by `onPaper`, not by the
      last answer: the button stays, the banner goes.
    */
    const html = bar(IDLE);
    assert.match(buttonPart(html), /class="action-label">Published</);
    assert.match(buttonPart(html), /data-token="ok"/);
    assert.match(buttonPart(html), /action-icon-check/);
    assert.doesNotMatch(
      html,
      /class="note[^"]*publish-done/,
      "no banner when there was no press just now",
    );
    assert.doesNotMatch(html, /Read it on the paper/);
    assert.doesNotMatch(html, /Published\./, "and none of the banner's sentence");
  });

  it("test 5: the done state is not pressable", () => {
    const button = buttonPart(bar(PUBLISHED));
    assert.match(button, /disabled/, "a finished press offers no second press");
    assert.match(button, /data-phase="done"/);
    /* The phase is drawn as a settled control, not as a bare sentence. */
    assert.match(button, /class="action-btn btn/);
  });
});

/**
 * Test 4, the in-flight state, at the control. `publishing: true` is what
 * `publish.isPending` is for as long as the request is outstanding -- the
 * request is held open here rather than answered, which is the case that used
 * to look like a dead button.
 */
describe("UI1b-2: both presses that print say 'Publishing…' while the request is open", () => {
  const pending = publishPressState({ publishing: true, refusal: "", publishedSlug: null });

  /** One of the two presses, as the route's call site configures it. */
  function press(word: string, isPending: boolean) {
    return render(
      createElement(ActionButton, {
        tone: "primary",
        phase: pressPhase(isPending ? "publishing" : "idle"),
        disabled: isPending,
        workingLabel: "Publishing…",
        children: word,
      } as never),
    );
  }

  for (const word of ["Publish in Council", "Yes, print it in Council"]) {
    it(`"${word}" says Publishing…, disabled, with a spinner, while the request is open`, () => {
      const html = press(word, true);
      assert.match(html, /class="action-label">Publishing…</, "the word");
      assert.match(html, /disabled/, "a press in flight cannot be pressed again");
      assert.match(html, /aria-busy="true"/);
      assert.match(html, /action-icon-spin/, "the spinner");
      assert.doesNotMatch(
        html,
        new RegExp(`class="action-label">${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`),
        "the idle word is gone while it works",
      );
    });
  }

  it("the phase the bar hands both presses is the pending one", () => {
    assert.equal(pressPhase(pending.kind), "working");
  });

  it("and the bar's own sentence agrees, with the same spinner", () => {
    const html = render(createElement(PublishBarResult, { state: pending }));
    assert.match(html, /Publishing…/);
    assert.match(html, /action-icon-spin/);
    assert.match(html, /data-phase="working"/);
  });
});

describe("UI1b-2: a refused press is never the Published state", () => {
  it("test 3: a refusal is drawn as the failure it is, with no done control in it", () => {
    const refused = publishPressState({
      publishing: false,
      refusal: "5 claims from the evidence check have not been reviewed.",
      publishedSlug: null,
    });
    assert.equal(pressPhase(refused.kind), "failed");
    const html = render(createElement(PublishBarResult, { state: refused }));
    assert.match(html, /publish-blocked/);
    assert.doesNotMatch(html, /action-btn/, "a refusal draws no control at all");
    assert.doesNotMatch(html, /Published/);
    assert.doesNotMatch(html, /action-icon-check/, "and never the green check");
  });

  it("test 3: a refusal leaves the story off the paper, which is what the slot reads", () => {
    /*
      `onPaper` is the record's own answer, and neither refusal path writes a
      slug into it -- `setPublishedSlug` is on the success path only.
    */
    const route = storySource();
    assert.match(
      route,
      /const onPaper = data\.lead\.status === "published" \|\| Boolean\(publishedSlug\)/,
    );
    assert.match(route, /const refuse = \(text: string\) => \{\s*setMsg\(""\);/);
    assert.doesNotMatch(
      route,
      /const refuse = \(text: string\) => \{[\s\S]{0,200}?setPublishedSlug/,
      "a refusal must never put the story on the paper",
    );
  });
});

/**
 * The route's half. Everything above draws the bar; this is the one condition
 * that decides whether it is drawn at all, read off the route's own source.
 */
function storySource(): string {
  return readFileSync(new URL("../routes/desk.story.$leadId.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("UI1b-2: the story page draws the slot from the story, not from the last press", () => {
  const source = storySource();

  it("test 3: draws the on-paper bar exactly when the story is on the paper", () => {
    /*
      `onPaper` alone, with nothing about the last press OR'd into it. This is
      the pin mutation (b) breaks: `{onPaper || press.kind === "failed" ? (`
      would draw a green "Published" over a story the server had just refused.
    */
    assert.match(
      source,
      /\{onPaper \? \(\s*<PublishBarDone result=\{press\} \/>/,
      "the slot is a fact about the story: on the paper, it is drawn",
    );
  });

  it("no longer takes the bar away when the press's own answer is the only thing left", () => {
    /*
      The rule UI1a implemented and this unit replaces: `press.kind ===
      "published"` drew the banner alone, and `canPublish` -- false the moment
      the lead printed -- took the button away. Both conditions are gone from
      the bar's own slot.
    */
    assert.doesNotMatch(source, /press\.kind === "published" \? \(/);
  });

  it("draws the on-paper bar in exactly one place, and it is the on-paper one", () => {
    assert.equal(
      (source.match(/<PublishBarDone/g) ?? []).length,
      1,
      "a second call site could draw the Published state for a refused press",
    );
    /*
      One bar for a story still being published (drawn here), and one for a
      story on the paper -- which is the one `PublishBarDone` draws, so the
      route holds exactly one of the two `#astra-publish-bar`s.
    */
    assert.equal((source.match(/id="astra-publish-bar"/g) ?? []).length, 1);
    const done = readFileSync(new URL("./publish-bar-result.ts", import.meta.url), "utf8");
    assert.equal((done.match(/id: "astra-publish-bar"/g) ?? []).length, 1);
  });

  it("keeps the bar's other states exactly: idle, the confirm bar, working and refused", () => {
    /* Test 4's second half: BOTH presses carry the working word, the same
       disabled rule and the spinner, and neither hand-rolls the word as its
       own child. */
    assert.equal(
      (source.match(/workingLabel="Publishing…"/g) ?? []).length,
      2,
      "both the first press and the confirm press are configured to say it",
    );
    assert.equal(
      (source.match(/phase=\{publish\.isPending \? "working" : "idle"\}/g) ?? []).length,
      2,
    );
    assert.equal(
      (source.match(/disabled=\{publish\.isPending \|\| blockers\.length > 0\}/g) ?? []).length,
      2,
    );
    assert.match(source, /Yes, print it in \$\{sectionNameNow\}/, "the confirm bar is unchanged");
    assert.match(source, /`Publish in \$\{sectionNameNow\}`/, "and so is the first press");
  });

  it("keeps the banner exactly, and the banner still carries the refusal and the press", () => {
    assert.match(source, /<PublishBarResult state=\{press\} \/>/);
    assert.match(source, /publishPressState\(\{/);
    assert.match(source, /setPublishRefusal\(/);
  });
});

/**
 * The green edge has to survive being disabled, in BOTH themes.
 *
 * A settled control is `disabled` (test 5), and the desk's own rule for a
 * disabled button is `opacity: 0.5` -- a faded green edge is the "greyed
 * button with nothing said" problem in a new colour. And `.btn.solid` is
 * repainted `#111` by the night block at a specificity the done token's own
 * rule does not beat, so without the second rule below the night theme would
 * draw near-black "Published" on a transparent ground.
 */
describe("UI1b-2: the done control keeps its green edge, in both themes", () => {
  const css = readFileSync(new URL("../desk-astra.css", import.meta.url), "utf8");

  it("a disabled done control is not faded", () => {
    assert.match(
      css,
      /\.action-btn\[data-phase="done"\]:disabled[\s\S]{0,200}?opacity:\s*1/,
      "opacity 0.5 turns the green edge into a grey one",
    );
  });

  it("the night theme paints the done control green, not the solid level's ink", () => {
    assert.match(
      css,
      /\.desk-ltr\.astra\.night \.action-btn\[data-(?:phase="done"|token="ok")\][\s\S]{0,200}?var\(--ok\)/,
      "the night block's `.btn.solid` colour rule is more specific than the token rule",
    );
    assert.match(css, /^\s*--ok:\s*#1e6b34;/m, "the light theme's success green");
    assert.match(css, /^\s*--ok:\s*#9fd4a8;/m, "and the night theme's");
  });
});
