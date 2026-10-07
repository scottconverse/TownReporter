import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AddToBody } from "./editor-dialog-bodies.ts";
import { ChoiceDouble, ModelPickerDouble } from "./test-choice.ts";
import { ADD_TO_MODES } from "../../lib/news/editor-dialog-logic.ts";
import {
  addToConfirm,
  addToInitial,
  addToMode,
  addToProblem,
  addToRequest,
  modelRowFor,
  type AddToState,
} from "./editor-dialog-forms.ts";

const named = modelRowFor("story").find((r) => r.value !== "auto");

const base = {
  state: addToInitial(),
  set: () => undefined,
  problem: null as string | null,
  note: null as string | null,
  review: null as { before: string; after: string } | null,
  documentNames: [] as string[],
  Choice: ChoiceDouble,
  ModelPicker: ModelPickerDouble,
};

const render = (
  over: Partial<AddToState>,
  extra: { review?: { before: string; after: string } | null; documentNames?: string[] } = {},
) =>
  renderToStaticMarkup(
    createElement(AddToBody, {
      ...base,
      review: extra.review ?? null,
      documentNames: extra.documentNames ?? [],
      state: { ...base.state, ...over },
    }),
  );

const state = (over: Partial<AddToState>): AddToState => ({ ...addToInitial(), ...over });

/** The one card the phase-0 component marks selected, as markup. */
const selectedCard = (html: string) => {
  const at = html.indexOf('class="astra-choice-card on"');
  return html.slice(at, at + 260);
};

describe("Add to story dialog", () => {
  it("draws the drop zone, material box, How cards and picker for AI weaving", () => {
    const html = render({});
    assert.match(html, /astra-drop-title">Drop new documents</);
    // Apostrophes are escaped by React, so the note is matched on a run of
    // words that has none.
    assert.match(html, /added to this story/);
    assert.match(html, /Choose files/);
    assert.match(html, /astra-field-label">New material</);
    assert.match(html, /Paste text, a link, or your own paragraph/);
    assert.match(html, /astra-choices-label">How</);
    for (const m of ADD_TO_MODES) {
      assert.ok(html.includes(m.label), m.label);
      assert.ok(html.includes(m.note), m.note);
    }
    assert.match(html, /aria-label="Model"/);
    assert.match(html, /aria-label="Effort"/);
    assert.match(selectedCard(html), /<b>AI weaves it in<\/b>/);
  });

  it("names the documents that were dropped, and says nothing when none were", () => {
    assert.ok(!render({}).includes("astra-msg ok"));
    const html = render({}, { documentNames: ["minutes.pdf", "budget.xlsx"] });
    assert.match(html, /class="astra-msg ok" role="status">Attached: minutes\.pdf, budget\.xlsx</);
  });

  it("draws the compare only after a review press, and never before one", () => {
    assert.ok(!render({ material: "something new" }).includes("astra-compare"));
    const html = render({ material: "something new" }, { review: { before: "The council met.", after: "The council met. It voted 4-3." } });
    assert.match(html, /astra-compare-head">Now</);
    assert.match(html, /astra-compare-para">The council met\.</);
    assert.match(html, /astra-compare-head">After your change</);
    assert.match(html, /astra-compare-para add">The council met\. It voted 4-3\.</);
    assert.match(html, /astra-compare-foot">Yellow: added or changed\. Nothing is saved until you press Add again\./);
    // An empty before is drawn as the desk's own word for it, not as nothing.
    assert.match(render({}, { review: { before: "", after: "x" } }), /astra-compare-para">\(empty\)</);
  });

  it("refuses the press with nothing to add", () => {
    assert.match(addToProblem(state({})) ?? "", /Paste something, or drop a document/);
    // A document alone is not enough: it is attached to the records, not woven
    // into the text, and the two modes that write text would write nothing.
    assert.match(addToProblem(state({ documentIds: ["doc-1"] })) ?? "", /Paste the material to add/);
    assert.equal(addToProblem(state({ material: "The vote was 4-3." })), null);
  });

  it("calls the write with the mode the editor chose, and only the two AI modes carry a model", () => {
    assert.ok(named, "modelRowFor('story') offers a named model beside Automatic");
    const pick = { model: named!.value, effort: "high" };

    const weave = addToRequest(state({ mode: "weave", material: "  The vote was 4-3.  ", ...pick }));
    assert.equal(weave.mode, "weave");
    assert.equal(weave.material, "The vote was 4-3.");
    assert.equal(weave.modelChoice, named!.value);
    assert.equal(weave.modelEffort, "high");
    assert.ok(!("documentIds" in addToRequest(state({ material: "x", documentIds: [] }))));
    assert.deepEqual(addToRequest(state({ material: "x", documentIds: ["doc-1"] })).documentIds, ["doc-1"]);

    for (const mode of ["update", "as-is"] as const) {
      const req = addToRequest(state({ mode, material: "The vote was 4-3.", ...pick }));
      assert.equal(req.mode, mode);
      assert.ok(!("modelChoice" in req), mode);
      assert.ok(!("modelEffort" in req), mode);
    }

    // An unknown mode falls back to the first the desk offers rather than
    // reaching the server as a fourth thing it has no branch for.
    assert.equal(addToMode("not-a-mode").key, ADD_TO_MODES[0].key);
    assert.equal(addToRequest(state({ mode: "not-a-mode" as AddToState["mode"], material: "x" })).mode, ADD_TO_MODES[0].key);
  });

  it("saves nothing until the editor has seen the bytes, then saves exactly those bytes", () => {
    assert.equal(addToConfirm(state({ material: "something new" })), null);
    assert.deepEqual(addToConfirm(state({ material: "something new", reviewed: "The council met. It voted 4-3." })), {
      saveText: "The council met. It voted 4-3.",
    });
  });

  it("keeps a cancelled dialog exactly as it opened", () => {
    assert.deepEqual(addToInitial(), addToInitial());
    const held = Object.freeze(
      state({ mode: "weave", material: "The vote was 4-3.", documentIds: ["doc-1"], reviewed: "shown", model: named?.value ?? "auto", effort: "high" }),
    ) as AddToState;
    const snapshot = structuredClone(held);
    addToRequest(held);
    addToConfirm(held);
    renderToStaticMarkup(
      createElement(AddToBody, { ...base, state: Object.freeze({ ...held }), review: { before: "a", after: "b" }, documentNames: ["d.pdf"] }),
    );
    assert.deepEqual(held, snapshot);
  });
});
