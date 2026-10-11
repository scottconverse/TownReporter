import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HeadlineBody } from "./editor-dialog-bodies.ts";
import { ChoiceDouble, ModelPickerDouble } from "./test-choice.ts";
import {
  headlineChoice,
  headlineInitial,
  headlineProblem,
  headlineSuggestRequest,
  modelRowFor,
  type HeadlineState,
} from "./editor-dialog-forms.ts";

const models = modelRowFor("story");
const named = models.find((r) => r.value !== "auto");

const CURRENT = "Council delays the budget";
const SUGGESTED = ["Council votes 4-3 to delay the budget", "Budget delayed until November"];

const base = {
  state: headlineInitial(CURRENT),
  set: () => undefined,
  problem: null as string | null,
  note: null as string | null,
  Choice: ChoiceDouble,
  ModelPicker: ModelPickerDouble,
};

const render = (over: Partial<HeadlineState>) =>
  renderToStaticMarkup(
    createElement(HeadlineBody, { ...base, state: { ...base.state, ...over } }),
  );

const state = (over: Partial<HeadlineState>): HeadlineState => ({ ...headlineInitial(CURRENT), ...over });

/** The one card the phase-0 component marks selected, as markup. */
const selectedCard = (html: string) => {
  const at = html.indexOf('class="astra-choice-card on"');
  return html.slice(at, at + 300);
};

describe("Headline dialog", () => {
  it("says there is nothing yet until the desk has suggested, and offers no choice set", () => {
    const html = render({});
    assert.match(html, /class="astra-msg" role="status">No suggestions yet\. Press Suggest 3 more\.</);
    assert.ok(!html.includes("astra-choices-label\">Choose one"));
    assert.match(html, /astra-field-label">Or write a new one</);
    assert.match(html, /Type a headline here; it replaces the choice above/);
  });

  it("draws Keep mine first, then each suggestion, with no angle the desk did not compute", () => {
    const html = render({ suggestions: SUGGESTED });
    assert.match(html, /astra-choices-label">Choose one</);
    assert.match(html, /<b>Keep mine: Council delays the budget<\/b>/);
    assert.match(html, /<b>Council votes 4-3 to delay the budget<\/b><span class="astra-choice-note">Suggested</);
    assert.match(html, /<b>Budget delayed until November<\/b><span class="astra-choice-note">Suggested</);
    // The drawing's per-row angles describe the design's own mock rows.
    // `suggestHeadlines` answers bare strings, so no row may claim an angle --
    // including the first, which is not special.
    assert.ok(!html.includes("leads with the conflict"), "no suggestion claims an angle");
    assert.ok(!html.includes("reader-first"));
    assert.match(html, /<b>Keep mine: Council delays the budget<\/b><span class="astra-choice-note">Your current headline</);
    // The dialog opens on Keep mine, which is a real press: it undoes a
    // suggestion the editor clicked without saving.
    assert.match(selectedCard(html), /<b>Keep mine: Council delays the budget<\/b>/);
    assert.match(selectedCard(render({ suggestions: SUGGESTED, choice: SUGGESTED[0]! })), new RegExp(`<b>${SUGGESTED[0]}</b>`));
  });

  it("draws the model row the reference draws, carrying the pick Suggest 3 more sends", () => {
    assert.match(render({ suggestions: SUGGESTED }), /aria-label="Model"/);
    assert.match(render({ suggestions: SUGGESTED }), /aria-label="Effort"/);
    assert.match(render({ suggestions: SUGGESTED }), /aria-label="Model"/);

    assert.ok(named, "modelRowFor('story') offers a named model beside Automatic");
    const picked = headlineSuggestRequest(state({ model: named!.value, effort: "low" }));
    assert.equal(picked.headline, CURRENT);
    assert.equal(picked.modelChoice, named!.value);
    assert.equal(picked.modelEffort, "low");
    // Automatic is explicit; an empty current headline is absent rather than
    // an empty string.
    const auto = headlineSuggestRequest(headlineInitial(""));
    assert.equal(auto.headline, undefined);
    assert.equal(auto.modelChoice, "auto");
  });

  it("saves the typed line first, then Keep mine, then the chosen suggestion", () => {
    const chosen = state({ suggestions: SUGGESTED, choice: SUGGESTED[0]! });
    assert.equal(headlineChoice(chosen), SUGGESTED[0]!);
    assert.equal(headlineChoice({ ...chosen, written: "  A better one entirely  " }), "A better one entirely");
    assert.equal(headlineChoice({ ...chosen, choice: "keep" }), CURRENT);
    // Keep every typed character so the server can warn and save after consent.
    assert.equal(headlineChoice({ ...chosen, written: "x".repeat(400) }), "x".repeat(400));
  });

  it("refuses a press with nothing long enough to be a headline", () => {
    assert.match(headlineProblem(state({ choice: "keep", current: "" })) ?? "", /Write a headline, or pick one of the suggestions\./);
    assert.match(headlineProblem(state({ choice: "", current: "" })) ?? "", /Write a headline/);
    assert.equal(headlineProblem(state({ choice: "keep" })), null);
    assert.equal(headlineProblem(state({ choice: "", current: "", written: "A real headline" })), null);
  });

  it("keeps a cancelled dialog exactly as it opened", () => {
    assert.deepEqual(headlineInitial(CURRENT), headlineInitial(CURRENT));
    assert.equal(headlineInitial(CURRENT).choice, "keep");
    assert.deepEqual(headlineInitial(CURRENT).suggestions, []);
    const held = Object.freeze(
      state({ suggestions: SUGGESTED, choice: SUGGESTED[1]!, written: "A third option", model: named?.value ?? "auto", effort: "high" }),
    ) as HeadlineState;
    const snapshot = structuredClone(held);
    headlineSuggestRequest(held);
    headlineChoice(held);
    renderToStaticMarkup(createElement(HeadlineBody, { ...base, state: Object.freeze({ ...held }) }));
    assert.deepEqual(held, snapshot);
  });
});
