import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NewStoryBody } from "./editor-dialog-bodies.ts";
import { ChoiceDouble } from "./test-choice.ts";
import {
  NEW_STORY_TABS,
  PASTE_MODES,
  fillStepId,
  firstSourceUrl,
  modelRowFor,
  newStoryInitial,
  newStoryProblem,
  newStoryRequest,
  pastedHeadline,
  type NewStoryState,
  type NewStoryStep,
} from "./editor-dialog-forms.ts";

const models = modelRowFor("story");

/** A real, named row (index 0 is always the injected "Automatic"). */
const named = models.find((r) => r.value !== "auto");

/** The input of a step that has one. `checkEvidence` is the only one that does not. */
function inputOf(step: NewStoryStep): Record<string, unknown> {
  if (step.call === "checkEvidence") throw new Error("checkEvidence carries no input");
  return step.input;
}

const base = {
  state: newStoryInitial(),
  set: () => undefined,
  problem: null as string | null,
  note: null as string | null,
  models,
  Choice: ChoiceDouble,
};

const render = (state: Partial<NewStoryState>) =>
  renderToStaticMarkup(createElement(NewStoryBody, { ...base, state: { ...base.state, ...state } }));

const state = (over: Partial<NewStoryState>): NewStoryState => ({ ...newStoryInitial(), ...over });

describe("New story dialog", () => {
  it("renders the three drawn tabs and the AI tab's drop zone and fields", () => {
    const html = render({});
    for (const t of NEW_STORY_TABS) assert.ok(html.includes(t.label), t.label);
    assert.match(html, /class="astra-tab on"[^>]*>AI drafts from material/);
    assert.match(html, /astra-drop-title">Drop documents here/);
    assert.match(html, /up to 20 files, 100 MB each/);
    assert.match(html, /Choose files/);
    assert.match(html, /astra-field-label">Links<span class="astra-field-hint"> optional/);
    assert.match(html, /astra-field-label">Source text<span class="astra-field-hint"> optional/);
    assert.match(html, /astra-field-label">Assignment</);
    assert.match(html, /aria-label="Model"/);
    assert.match(html, /aria-label="Effort"/);
    assert.match(html, /Automatic, per job in Server/);
  });

  it("renders the write-it-myself and paste tabs from the same component", () => {
    const self = render({ tab: "self" });
    for (const label of ["Headline", "Summary", "Story", "Sources"]) {
      assert.ok(self.includes(`astra-field-label">${label}`), label);
    }
    assert.ok(!self.includes("astra-drop-title"));

    const paste = render({ tab: "paste" });
    for (const label of ["Original link", "Credit line", "Story text"]) {
      assert.ok(paste.includes(`astra-field-label">${label}`), label);
    }
    assert.match(paste, /What should the AI do\?/);
    for (const m of PASTE_MODES) assert.ok(paste.includes(m.label), m.label);
    // The mode the dialog opens on is the one that spends nothing, and it is
    // the card the phase-0 component marks selected.
    assert.ok(
      paste.includes(
        'class="astra-choice-card on"><span class="astra-choice-mark" aria-hidden="true"></span>' +
          '<span class="astra-choice-text"><b>Nothing: keep it exactly as pasted</b>',
      ),
      paste.slice(paste.indexOf("astra-choice-card"), paste.indexOf("astra-choice-card") + 260),
    );
  });

  it("draws the model row on the paste tab only when a mode can spend a model", () => {
    assert.ok(!render({ tab: "paste", pasteMode: "nothing" }).includes('aria-label="Model"'));
    assert.ok(render({ tab: "paste", pasteMode: "clean" }).includes('aria-label="Model"'));
    assert.ok(render({ tab: "paste", pasteMode: "check" }).includes('aria-label="Model"'));
    // No mode, no picker -- and the pick the state carries is dropped rather
    // than sent, so a mode that spends nothing cannot be charged for a model.
    const nothing = newStoryRequest(
      state({ tab: "paste", pastedStory: "x".repeat(60), pasteMode: "nothing", model: named?.value ?? "auto", effort: "high" }),
    );
    assert.deepEqual(nothing.steps.map((s) => s.call), ["fileLead", "saveDraft"]);
    for (const s of nothing.steps) assert.ok(!("modelChoice" in inputOf(s)), s.call);
  });

  it("refuses the press until each tab has what it needs", () => {
    assert.match(newStoryProblem(state({ tab: "ai" })) ?? "", /Paste the material or point at it/);
    assert.match(newStoryProblem(state({ tab: "ai", sourceText: "something to read" })) ?? "", /Say what the story is/);
    assert.equal(newStoryProblem(state({ tab: "ai", sourceText: "s", assignment: "A full assignment sentence" })), null);

    assert.match(newStoryProblem(state({ tab: "self" })) ?? "", /Headline needs a full sentence/);
    assert.match(newStoryProblem(state({ tab: "self", headline: "A real headline" })) ?? "", /why this is news/i);
    assert.match(
      newStoryProblem(state({ tab: "self", headline: "A real headline", summary: "Why it matters" })) ?? "",
      /story needs some text/,
    );
    assert.equal(
      newStoryProblem(state({ tab: "self", headline: "A real headline", summary: "Why it matters", story: "y".repeat(40) })),
      null,
    );

    assert.match(newStoryProblem(state({ tab: "paste" })) ?? "", /Paste the story text/);
    assert.match(
      newStoryProblem(state({ tab: "paste", pastedStory: "z".repeat(50), pasteMode: "clean", originalLink: "example.com/story" })) ?? "",
      /has to start with http/,
    );
    // The same bad link is harmless when the press spends nothing on it.
    assert.equal(
      newStoryProblem(state({ tab: "paste", pastedStory: "z".repeat(50), pasteMode: "nothing", originalLink: "example.com/story" })),
      null,
    );
  });

  it("plans the AI tab as one writeStory carrying the box, and the documents it was given", () => {
    const press = newStoryRequest(
      state({ tab: "ai", assignment: "What the council did", links: "https://a.example/x", sourceText: "Long text" }),
      "primary",
      ["doc-1", "doc-2"],
    );
    assert.equal(press.steps.length, 1);
    const step = press.steps[0]!;
    assert.equal(step.call, "writeStory");
    assert.equal(inputOf(step).text, "What the council did\n\nhttps://a.example/x\n\nLong text");
    assert.deepEqual(inputOf(step).documentIds, ["doc-1", "doc-2"]);
    assert.match(press.done, /Drafting started/);
    // No documents dropped: no empty documentIds key pretending otherwise.
    assert.ok(!("documentIds" in inputOf(newStoryRequest(state({ tab: "ai", assignment: "A whole assignment" })).steps[0]!)));
  });

  it("plans the self tab as fileLead then saveDraft, and fills the id the filing returns", () => {
    const press = newStoryRequest(
      state({
        tab: "self",
        headline: "Council delays the budget",
        summary: "Because the numbers moved",
        story: "The council voted on Tuesday.",
        sources: "not a link\nhttps://records.example/budget\nhttps://other.example/x",
      }),
    );
    assert.deepEqual(press.steps.map((s) => s.call), ["fileLead", "saveDraft"]);
    const file = inputOf(press.steps[0]!);
    const save = inputOf(press.steps[1]!);
    assert.equal(file.headline, "Council delays the budget");
    assert.equal(file.why, "Because the numbers moved");
    assert.equal(file.url, "https://records.example/budget");
    assert.equal(file.topic, "");
    assert.ok(!("leadId" in save));
    assert.deepEqual(inputOf(fillStepId(press.steps[1]!, 42)), {
      headline: "Council delays the budget",
      dek: "Because the numbers moved",
      body: "The council voted on Tuesday.",
      topic: "",
      leadId: 42,
    });
    // A step that is not a save is handed back untouched.
    assert.deepEqual(fillStepId(press.steps[0]!, 42), press.steps[0]);
    assert.match(press.done, /It is in Drafts under your headline/);
  });

  it("plans the alt press as the same two steps plus the evidence check", () => {
    const press = newStoryRequest(
      state({ tab: "self", headline: "Council delays the budget", summary: "Why it matters", story: "The council voted." }),
      "alt",
    );
    assert.deepEqual(press.steps.map((s) => s.call), ["fileLead", "saveDraft", "checkEvidence"]);
    assert.match(press.done, /evidence check is running/);
  });

  it("files a pasted story under a headline taken from the paste, not an empty one", () => {
    const press = newStoryRequest(
      state({
        tab: "paste",
        pastedStory: "Council delays the budget\n\nThe council voted to delay it until November.",
        originalLink: "https://firstpublished.example/story",
        creditLine: "Reprinted with permission",
        pasteMode: "check",
      }),
    );
    assert.deepEqual(press.steps.map((s) => s.call), ["fileLead", "saveDraft", "checkEvidence"]);
    const file = inputOf(press.steps[0]!);
    const save = inputOf(press.steps[1]!);
    assert.equal(file.headline, "Council delays the budget");
    assert.match(String(file.why), /Pasted in full from https:\/\/firstpublished\.example\/story/);
    assert.equal(file.url, "https://firstpublished.example/story");
    assert.equal(save.dek, "Reprinted with permission");
    assert.match(press.done, /evidence check is running/);
  });

  it("maps the paste tab's mode onto the desk's own suggestions and check", () => {
    const mode = (pasteMode: NewStoryState["pasteMode"]) =>
      newStoryRequest(state({ tab: "paste", pastedStory: "w".repeat(60), pasteMode })).steps.map((s) => s.call);
    assert.deepEqual(mode("nothing"), ["fileLead", "saveDraft"]);
    assert.deepEqual(mode("clean"), ["fileLead", "saveDraft", "suggestHeadlines"]);
    assert.deepEqual(mode("check"), ["fileLead", "saveDraft", "checkEvidence"]);
  });

  it("sends a model only when the editor named one, on every AI path", () => {
    assert.ok(named, "modelRowFor('story') offers a named model beside Automatic");
    const pick = { model: named!.value, effort: "high" };

    const ai = newStoryRequest(state({ tab: "ai", assignment: "A whole assignment", ...pick })).steps[0]!;
    assert.equal(inputOf(ai).modelChoice, named!.value);
    assert.equal(inputOf(ai).modelEffort, "high");
    assert.ok(!("modelChoice" in inputOf(newStoryRequest(state({ tab: "ai", assignment: "A whole assignment" })).steps[0]!)));

    // The paste tab's row has a reader: the step it plans carries the pick, so
    // the editor's choice is not a control the desk ignores.
    const clean = newStoryRequest(state({ tab: "paste", pastedStory: "q".repeat(60), pasteMode: "clean", ...pick }));
    assert.deepEqual(clean.steps.map((s) => s.call), ["fileLead", "saveDraft", "suggestHeadlines"]);
    assert.equal(inputOf(clean.steps[2]!).modelChoice, named!.value);
    assert.equal(inputOf(clean.steps[2]!).modelEffort, "high");
    assert.deepEqual(inputOf(newStoryRequest(state({ tab: "paste", pastedStory: "q".repeat(60), pasteMode: "clean" })).steps[2]!), {});
  });

  it("keeps a cancelled dialog exactly as it opened", () => {
    const first = newStoryInitial();
    const second = newStoryInitial();
    assert.deepEqual(first, second);
    assert.notEqual(first, second);

    // Nothing a press plans may write to the state it was handed: a cancel
    // after any of these must find the dialog pristine. Frozen, so a write
    // throws here rather than passing quietly.
    const held = Object.freeze(
      state({
        tab: "self",
        headline: "Council delays the budget",
        summary: "Why it matters",
        story: "The council voted.",
        sources: "https://records.example/x",
        model: named ? named.value : "auto",
        effort: "high",
      }),
    ) as NewStoryState;
    const snapshot = structuredClone(held);
    newStoryRequest(held, "primary", ["doc-1"]);
    newStoryRequest(held, "alt");
    for (const tab of ["ai", "self", "paste"] as const) {
      newStoryRequest({ ...held, tab });
      renderToStaticMarkup(createElement(NewStoryBody, { ...base, state: Object.freeze({ ...held, tab }) }));
    }
    assert.deepEqual(held, snapshot);
  });

  it("takes the pasted headline from the first line, and a sentence when the first line is a stub", () => {
    assert.equal(pastedHeadline("Council delays the budget\n\nMore."), "Council delays the budget");
    assert.equal(pastedHeadline("Stub\nThe budget was delayed until November."), "Stub\nThe budget was delayed until November.");
    assert.equal(pastedHeadline(""), "");
  });

  it("files only the first URL a Sources box holds, and takes none when there is none", () => {
    assert.equal(firstSourceUrl("a note\nhttps://one.example/x\nhttps://two.example/y"), "https://one.example/x");
    assert.equal(firstSourceUrl("https://one.example/x, https://two.example/y"), "https://one.example/x");
    assert.equal(firstSourceUrl("no links here"), undefined);
  });
});
