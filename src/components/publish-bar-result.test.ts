import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublishBarResult } from "./publish-bar-result.ts";
import { publishPressState } from "../lib/news/publish-blockers.ts";

/**
 * UNIT PUB1, the drawn half: the bar says what happened to the press.
 *
 * The owner pressed Publish, nothing visibly happened, and he pressed again.
 * These are the three things the bar can now show at the button it was pressed
 * from: it is working, the server refused (in the server's own words), or the
 * story is on the paper with the way to read it.
 */

function render(state: ReturnType<typeof publishPressState>) {
  return renderToStaticMarkup(createElement(PublishBarResult, { state }));
}

describe("PublishBarResult", () => {
  it("draws nothing when there is nothing to say", () => {
    assert.equal(render({ kind: "idle" }), "");
  });

  it("says the press is running while it is", () => {
    const html = render({ kind: "publishing" });
    assert.match(html, /Publishing…/, "the bar's own word for a press in flight");
    assert.match(html, /role="status"/, "queued, not shouted -- nothing has gone wrong yet");
    assert.doesNotMatch(html, /publish-blocked/);
  });

  it("draws a refusal in the bar, in the server's own words and the danger style", () => {
    const html = render({
      kind: "refused",
      message:
        "5 claims from the evidence check have not been reviewed. Review them in the workbench, or accept them explicitly to print anyway.",
    });
    assert.match(html, /5 claims from the evidence check have not been reviewed\./);
    assert.match(
      html,
      /Review them in the workbench, or accept them explicitly to print anyway\./,
      "the next step travels with the refusal",
    );
    assert.match(html, /publish-blocked/, "the same style the page's other refusals use");
    assert.match(html, /role="alert"/, "the answer to a press is announced");
  });

  it("says the story is on the paper, with the way to read it", () => {
    const html = render({ kind: "published", slug: "council-adopts-budget" });
    assert.match(html, /Published\./);
    assert.match(html, /href="\/articles\/council-adopts-budget"/);
    assert.match(html, /Read it on the paper/);
    assert.match(html, /publish-done/);
  });

  it("still says it is published when the article link is not known", () => {
    const html = render({ kind: "published", slug: null });
    assert.match(html, /Published\./);
    assert.doesNotMatch(html, /Read it on the paper/);
  });
});

/**
 * The page's half. A refusal that is only drawn is half the fix: the stale
 * state that produced it has to be refreshed too, or the bar goes on saying
 * "Nothing blocks Publish" beside the refusal.
 */
describe("the story page draws every publish answer at the bar", () => {
  const source = readFileSync(
    new URL("../routes/desk.story.$leadId.tsx", import.meta.url),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  it("derives the bar's answer from one value, not from three latched booleans", () => {
    assert.match(source, /publishPressState\(\{/);
    assert.match(source, /<PublishBarResult state=\{press\} \/>/);
  });

  it("draws 'Publishing…' on the button and keeps it disabled while the press runs", () => {
    assert.match(source, /publish\.isPending \? "Publishing…" : /);
    assert.match(source, /disabled=\{publish\.isPending \|\| blockers\.length > 0\}/);
  });

  it("refreshes the lead query on a refusal and on a thrown error, so the bar cannot keep saying nothing blocks Publish", () => {
    /* Both paths that end in a refusal, each with the invalidation that makes
       the blocker list and the "Publish anyway" button the server's answer. */
    /* The refusals, and the refresh that goes with each: the answer is written
       to the BAR's state (not to `msg`, which is the body Notice the owner
       never saw), and the lead the bar reads is refetched so the blocker list
       stops saying "Nothing blocks Publish". */
    assert.match(
      source,
      /const refuse = async \(text: string\) => \{[\s\S]{0,160}?setPublishRefusal\(text\);[\s\S]{0,160}?queryKey: \["lead", id\]/,
      "the refusal writes the bar's state and refreshes the lead query",
    );
    assert.match(source, /refuse\(NO_ANSWER\)/, "the desk not answering is a refusal to report");
    assert.match(source, /refuse\(result\.error\)/, "so is the server's own refusal");
    assert.match(
      source,
      /setPublishRefusal\([\s\S]{0,120}?editorActionError\(err instanceof Error \? err\.message : "", "publish that story"\)[\s\S]{0,160}?queryKey: \["lead", id\]/,
      "a thrown error is said in a person's words and refreshes the same query",
    );
    assert.match(source, /setPublishRefusal\(""\)/, "the next press replaces the last answer");
    assert.doesNotMatch(
      source,
      /setMsg\(result\.error\)/,
      "the publish refusal is not also written to the body Notice the owner never found",
    );
  });

  it("keeps the green 'On the paper.' visible for a story published from this page", () => {
    assert.match(source, /draftProblem && \(!onPaper \|\| Boolean\(publishedSlug\)\)/);
  });

  it("gives the printed banner the bar's own place, because a print takes the bar away", () => {
    assert.match(source, /press\.kind === "published" \? \(/);
    assert.match(source, /className="astra-publish-bar astra-publish-done"/);
    assert.match(source, /id="astra-publish-bar"[\s\S]{0,120}PublishBarResult state=\{press\}/);
  });

  it("only welcomes a story that printed here and now", () => {
    /* A page opened on an already-published story seeds `publishedSlug` from
       the loader, so the banner cannot be drawn from it: a green "Published."
       bar on every visit would claim a press nobody made. */
    assert.match(source, /const \[justPublished, setJustPublished\] = useState\(false\)/);
    assert.match(source, /setJustPublished\(true\)/);
    assert.match(source, /publishedSlug: justPublished \? publishedSlug : null/);
  });
});
