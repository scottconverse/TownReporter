import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AddLeadBody } from "./editor-dialog-bodies.ts";
import { ChoiceDouble, ModelPickerDouble } from "./test-choice.ts";
import {
  ADD_LEAD_THENS,
  addLeadInitial,
  addLeadProblem,
  addLeadRequest,
  modelRowFor,
  type AddLeadState,
} from "./editor-dialog-forms.ts";

const named = modelRowFor("story").find((r) => r.value !== "auto");

const base = {
  state: addLeadInitial(),
  set: () => undefined,
  problem: null as string | null,
  note: null as string | null,
  Choice: ChoiceDouble,
  ModelPicker: ModelPickerDouble,
};

const render = (state: Partial<AddLeadState>) =>
  renderToStaticMarkup(createElement(AddLeadBody, { ...base, state: { ...base.state, ...state } }));

const state = (over: Partial<AddLeadState>): AddLeadState => ({ ...addLeadInitial(), ...over });

/** The one card the phase-0 component marks selected, as markup. */
const selectedCard = (html: string) => {
  const at = html.indexOf('class="astra-choice-card on"');
  return html.slice(at, at + 260);
};

describe("Add a lead dialog", () => {
  it("draws the lead controls and model picker for its default AI scoring action", () => {
    const html = render({});
    assert.match(html, /astra-field-label">Link or tip</);
    assert.match(html, /Paste a URL, or describe what you heard/);
    assert.match(html, /astra-field-label">Why it might matter<span class="astra-field-hint"> optional/);
    assert.match(html, /Optional note for the AI/);
    assert.match(html, /astra-choices-label">Then</);
    for (const t of ADD_LEAD_THENS) {
      assert.ok(html.includes(t.label), t.label);
      // React escapes the apostrophe in "you'll", so the note is matched with
      // either form rather than by `includes`.
      assert.match(html, new RegExp(t.note.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/&#x27;|'/g, "(?:&#x27;|')")), t.note);
    }
    assert.match(html, /aria-label="Model"/);
    assert.match(html, /aria-label="Effort"/);
  });

  it("marks the drawn default (Research and score it) as the selected card", () => {
    assert.match(selectedCard(render({})), /<b>Research and score it<\/b>/);
    assert.match(selectedCard(render({ then: "as-is" })), /<b>Just file it as-is<\/b>/);
    assert.match(selectedCard(render({ then: "draft" })), /<b>Research and draft a story now<\/b>/);
  });

  it("refuses a press with nothing to file, and accepts a real tip", () => {
    assert.match(addLeadProblem(state({})) ?? "", /Paste a URL, or describe what you heard/);
    assert.match(addLeadProblem(state({ paste: "http://" })) ?? "", /Paste a URL, or describe what you heard/);
    assert.equal(addLeadProblem(state({ paste: "A neighbor says the vote was 4-3" })), null);
  });

  it("sends what the editor typed to the add-lead call, with the then it chose", () => {
    const req = addLeadRequest(state({ paste: "  https://records.example/minutes  ", why: " The vote was 4-3 ", then: "draft" }));
    assert.equal(req.paste, "https://records.example/minutes");
    assert.equal(req.why, "The vote was 4-3");
    assert.equal(req.then, "draft");
    // An empty "why" is absent, not an empty string the server has to guess at.
    assert.equal(addLeadRequest(state({ paste: "a real tip here" })).why, undefined);
  });

  it("sends no model on the no-AI path, and the picked one on the AI paths", () => {
    assert.ok(named, "modelRowFor('story') offers a named model beside Automatic");
    const pick = { model: named!.value, effort: "high" };

    const asIs = addLeadRequest(state({ paste: "a real tip here", then: "as-is", ...pick }));
    assert.equal(asIs.then, "as-is");
    assert.ok(!("modelChoice" in asIs), JSON.stringify(asIs));
    assert.ok(!("modelEffort" in asIs));

    for (const then of ["score", "draft"] as const) {
      const ai = addLeadRequest(state({ paste: "a real tip here", then, ...pick }));
      assert.equal(ai.modelChoice, named!.value);
      assert.equal(ai.modelEffort, "high");
      // Automatic is an explicit editor choice and uses the recommended ladder.
      const auto = addLeadRequest(state({ paste: "a real tip here", then }));
      assert.equal(auto.modelChoice, "auto");
    }
  });

  it("never sends a model the desk does not offer for this surface", () => {
    const req = addLeadRequest(state({ paste: "a real tip here", then: "score", model: "not-a-real-model", effort: "high" }));
    assert.ok(!("modelChoice" in req));
  });

  it("keeps a cancelled dialog exactly as it opened", () => {
    assert.deepEqual(addLeadInitial(), addLeadInitial());
    const held = Object.freeze(state({ paste: "a real tip here", why: "why", then: "draft", model: named?.value ?? "auto", effort: "high" })) as AddLeadState;
    const snapshot = structuredClone(held);
    addLeadRequest(held);
    renderToStaticMarkup(createElement(AddLeadBody, { ...base, state: Object.freeze({ ...held }) }));
    assert.deepEqual(held, snapshot);
  });
});
