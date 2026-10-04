import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublishBarDone, PublishBarResult } from "./publish-bar-result.ts";
import { pressPhase } from "./action-button.ts";
import { publishPressState } from "../lib/news/publish-blockers.ts";

/* The owner's request: after a publish, the Publish button turns into a green "Published" that STAYS
   (the banner shows as well). The route's 3,800-line story page has no render harness, so what it decides
   is read from its source; what the bar DRAWS is rendered for real. */
const bar = (result: Parameters<typeof PublishBarDone>[0]["result"]) =>
  renderToStaticMarkup(createElement(PublishBarDone, { result }));
const buttonOf = (html: string) => html.slice(0, html.indexOf("</button>") + "</button>".length);
const route = readFileSync(new URL("../routes/desk.story.$leadId.tsx", import.meta.url), "utf8");

it("after a print, and for a story already on the paper, the bar holds a green Published control that stays", () => {
  /* Bug caught: a print took the Publish button away and left only a banner, so nothing said what had happened at the control. */
  for (const result of [{ kind: "published", slug: "council-adopts-budget" }, { kind: "idle" }] as const) {
    const button = buttonOf(bar(result));
    assert.match(button, /class="action-label">Published</);
    assert.match(button, /data-phase="done"/);
    assert.match(button, /data-token="ok"/);
    assert.match(button, /action-icon-check/);
    assert.match(button, /disabled/, "a finished press offers no second press");
  }
  assert.match(bar({ kind: "published", slug: "x" }), /Read it on the paper/, "the banner is drawn right after a print");
  assert.doesNotMatch(bar({ kind: "idle" }), /Read it on the paper/, "and not for a story opened later");
});

it("a refused press never draws the Published state", () => {
  /* Bug caught: a refusal drawn as the green Published control over a story the server had just refused. */
  const refused = publishPressState({ publishing: false, refusal: "5 claims have not been reviewed.", publishedSlug: null });
  assert.equal(pressPhase(refused.kind), "failed");
  const html = renderToStaticMarkup(createElement(PublishBarResult, { state: refused }));
  assert.doesNotMatch(html, /action-btn|Published|action-icon-check/);
  assert.match(route, /\{onPaper \? \(\s*<PublishBarDone result=\{press\} \/>/, "the slot is drawn from the story, not from the last press");
  assert.equal((route.match(/<PublishBarDone/g) ?? []).length, 1, "a second call site could draw Published for a refusal");
});
