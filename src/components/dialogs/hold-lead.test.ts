import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HoldBody } from "./editor-dialog-bodies.ts";
import { ChoiceDouble } from "./test-choice.ts";
import { HOLD_CHOICES } from "../../lib/news/kill-reasons.ts";
import { HOLD_NONE, holdInitial, holdProblem, holdRequest, type HoldState } from "./editor-dialog-forms.ts";

const base = {
  state: holdInitial(),
  set: () => undefined,
  problem: null as string | null,
  note: null as string | null,
  Choice: ChoiceDouble,
};

const render = (over: Partial<HoldState>) =>
  renderToStaticMarkup(createElement(HoldBody, { ...base, state: { ...base.state, ...over } }));

const state = (over: Partial<HoldState>): HoldState => ({ ...holdInitial(), ...over });

/** The one card the phase-0 component marks selected, as markup. */
const selectedCard = (html: string) => {
  const at = html.indexOf('class="astra-choice-card on"');
  return html.slice(at, at + 300);
};

describe("Hold dialog", () => {
  it("draws the reasons the desk already has, and a note field", () => {
    const html = render({});
    assert.match(html, /astra-choices-label">Why \(optional\)</);
    for (const c of HOLD_CHOICES) {
      assert.ok(html.includes(c.label), c.label);
      if (c.note) assert.ok(html.includes(c.note), c.note);
    }
    assert.match(html, /astra-field-label">Note<span class="astra-field-hint"> optional</);
    assert.equal(HOLD_CHOICES.length, 3);
    // The reasons are the desk's own list, not a second copy written here.
    assert.match(selectedCard(html), new RegExp(`<b>${HOLD_CHOICES[0]!.label}</b>`));
  });

  it("holds with no reason when the plain press is used, whatever the state carries", () => {
    const req = holdRequest(state({ choice: "follow-up", note: "Waiting on the audit" }), false);
    assert.deepEqual(req, { choice: HOLD_NONE, note: undefined });
    assert.equal(HOLD_NONE, "none");
    assert.equal(holdProblem(state({ choice: "follow-up" }), false), null);
  });

  it("holds with the reason the editor picked and its note when the reason press is used", () => {
    const req = holdRequest(state({ choice: "follow-up", note: "  Waiting on the audit  " }), true);
    assert.deepEqual(req, { choice: "follow-up", note: "Waiting on the audit" });
    // An empty note is absent, not an empty string the server has to guess at.
    assert.deepEqual(holdRequest(state({ choice: "not-now" }), true), { choice: "not-now", note: undefined });
  });

  it("refuses a hold that names a reason the desk does not have", () => {
    assert.match(holdProblem(state({ choice: "not-a-reason" }), true) ?? "", /Pick a reason, or press Hold, no reason\./);
    assert.equal(holdProblem(state({ choice: "not-now" }), true), null);
  });

  it("keeps a cancelled dialog exactly as it opened", () => {
    assert.deepEqual(holdInitial(), holdInitial());
    assert.equal(holdInitial().choice, HOLD_CHOICES[0]!.key);
    const held = Object.freeze(state({ choice: "record-or-date", note: "Waiting on the minutes" })) as HoldState;
    const snapshot = structuredClone(held);
    holdRequest(held, false);
    holdRequest(held, true);
    renderToStaticMarkup(createElement(HoldBody, { ...base, state: Object.freeze({ ...held }) }));
    assert.deepEqual(held, snapshot);
  });
});
