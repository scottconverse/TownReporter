import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DarkFileBody } from "./editor-dialog-bodies.ts";
import { ChoiceDouble } from "./test-choice.ts";
import { DARK_LIMITS, hopsForLimit } from "../../lib/news/editor-dialog-logic.ts";
import {
  darkFileFromSeed,
  darkFileInitial,
  darkProblem,
  darkRequest,
  modelRowFor,
  type DarkFileState,
} from "./editor-dialog-forms.ts";

const models = modelRowFor("story");
const named = models.find((r) => r.value !== "auto");

const base = {
  state: darkFileInitial(),
  set: () => undefined,
  problem: null as string | null,
  note: null as string | null,
  models,
  Choice: ChoiceDouble,
};

const render = (over: Partial<DarkFileState>) =>
  renderToStaticMarkup(createElement(DarkFileBody, { ...base, state: { ...base.state, ...over } }));

const state = (over: Partial<DarkFileState>): DarkFileState => ({ ...darkFileInitial(), ...over });

/** The one card the phase-0 component marks selected, as markup. */
const selectedCard = (html: string) => {
  const at = html.indexOf('class="astra-choice-card on"');
  return html.slice(at, at + 300);
};

describe("Start a Dark Desk file dialog", () => {
  it("draws the three boxes the reference draws, including the one that rules the story out", () => {
    const html = render({});
    assert.match(html, /astra-field-label">The question</);
    assert.match(html, /What are you trying to find out\?/);
    assert.match(html, /astra-field-label">The tip or starting point</);
    assert.match(html, /Link, document, post or what you heard/);
    assert.match(html, /astra-field-label">The ordinary explanation<span class="astra-field-hint"> rule it out first</);
    assert.match(html, /What would make this a non-story\?/);
  });

  it("draws the Limits dial as the three drawn dials, starting on Standard", () => {
    const html = render({});
    assert.match(html, /astra-choices-label">Limits</);
    for (const l of DARK_LIMITS) {
      assert.ok(html.includes(l.label), l.label);
      // The copy the design draws: records and hours, not hops.
      assert.match(html, new RegExp(l.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(selectedCard(html), /Standard · up to 30 records, 2 hours or \$3/);
    assert.match(selectedCard(render({ limit: "deep" })), /Deep · up to 100 records, 8 hours or \$15/);
  });

  it("draws a model row and no effort select, because the run takes a model and no effort", () => {
    const html = render({});
    assert.match(html, /aria-label="Model"/);
    assert.ok(!html.includes('aria-label="Effort"'), "darkRunInput takes no effort");
    assert.match(html, /Automatic, per job in Server → Models/);
  });

  it("refuses the press until the question and the starting point are real", () => {
    assert.match(darkProblem(state({})) ?? "", /Say what you are trying to find out/);
    assert.match(darkProblem(state({ question: "Short" })) ?? "", /Say what you are trying to find out/);
    assert.match(darkProblem(state({ question: "Where did the money go?" })) ?? "", /Give the file a starting point/);
    // The ordinary explanation is optional in the drawn dialog: it is the box
    // the editor rules the story out with, not a third thing to fill in.
    assert.equal(darkProblem(state({ question: "Where did the money go?", tip: "The 2024 audit" })), null);
  });

  it("opens the file with the dial as hops, and runs it with the same starting point", () => {
    const req = darkRequest(state({ question: "Where did the money go?", tip: "The 2024 audit", limit: "deep" }));
    assert.equal(req.limit, "deep");
    assert.equal(req.open.title, "Where did the money go?");
    assert.equal(req.open.paste, "The 2024 audit");
    assert.equal(req.open.budget, hopsForLimit("deep"));
    assert.equal(req.run.paste, "The 2024 audit");
    assert.ok(!("modelChoice" in req.run) || req.run.modelChoice === undefined);
  });

  it("carries the ordinary explanation into the material rather than dropping it", () => {
    const req = darkRequest(
      state({ question: "Where did the money go?", tip: "The 2024 audit", explanation: "  A typo in the ledger.  " }),
    );
    assert.equal(req.open.paste, "The 2024 audit\n\nThe ordinary explanation, to rule out first: A typo in the ledger.");
    // The run re-seeds from the starting point alone, so the extra paragraph is
    // not sent twice.
    assert.equal(req.run.paste, "The 2024 audit");
  });

  it("sends a model only when the editor named one", () => {
    assert.ok(named, "modelRowFor offers a named model beside Automatic");
    const picked = darkRequest(state({ question: "Where did the money go?", tip: "The 2024 audit", model: named!.value, effort: "high" }));
    assert.equal(picked.run.modelChoice, named!.value);
    // No effort anywhere: the run's input has no such field.
    assert.ok(!("modelEffort" in picked.run));
    const auto = darkRequest(state({ question: "Where did the money go?", tip: "The 2024 audit" }));
    assert.equal(auto.run.modelChoice, undefined);
  });

  it("falls back to Standard for a limit the desk does not offer", () => {
    const req = darkRequest(state({ question: "Where did the money go?", tip: "The 2024 audit", limit: "not-a-dial" }));
    assert.equal(req.limit, "standard");
    assert.equal(req.open.budget, hopsForLimit("standard"));
    // And the dial it falls back to is the one this dialog opens on.
    assert.equal(req.limit, darkFileInitial().limit);
    assert.equal(hopsForLimit("not-a-dial"), 5);
  });

  it("opens a handed-over hypothesis as the question and the material, keeping the dial defaults", () => {
    const seed = "Where did the money go?\n\nThe 2024 audit, page 12.";
    const seeded = darkFileFromSeed(seed);
    // The first line is the question, which is how the screen's paste box
    // titled files before this dialog replaced it.
    assert.equal(seeded.question, "Where did the money go?");
    // The whole paste is the material: nothing the editor wrote is dropped.
    assert.equal(seeded.tip, seed);
    assert.equal(seeded.explanation, "");
    assert.deepEqual(
      { limit: seeded.limit, model: seeded.model, effort: seeded.effort },
      { limit: darkFileInitial().limit, model: "auto", effort: null },
    );
    // And it is a real, pressable file rather than one the dialog refuses.
    assert.equal(darkProblem(seeded), null);
    assert.equal(darkRequest(seeded).open.title, "Where did the money go?");
    // A one-line seed is its own question, with no trailing blank line.
    assert.equal(darkFileFromSeed("Costco rebate cap").question, "Costco rebate cap");
  });

  it("keeps a canceled dialog exactly as it opened", () => {
    assert.deepEqual(darkFileInitial(), darkFileInitial());
    const held = Object.freeze(
      state({ question: "Where did the money go?", tip: "The 2024 audit", explanation: "A typo.", limit: "quick", model: named?.value ?? "auto", effort: "high" }),
    ) as DarkFileState;
    const snapshot = structuredClone(held);
    darkRequest(held);
    renderToStaticMarkup(createElement(DarkFileBody, { ...base, state: Object.freeze({ ...held }) }));
    assert.deepEqual(held, snapshot);
  });
});
