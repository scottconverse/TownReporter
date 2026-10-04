import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
