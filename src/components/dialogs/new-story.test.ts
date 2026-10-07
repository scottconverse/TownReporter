import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NewStoryBody } from "./editor-dialog-bodies.ts";
import { ChoiceDouble, ModelPickerDouble } from "./test-choice.ts";
import { SECTION_REQUIRED } from "../../lib/news/import-review.ts";
import {
  NEW_STORY_SCOPES,
  NEW_STORY_TABS,
  PASTE_MODES,
  fillStepId,
  firstSourceUrl,
  modelRowFor,
  newStoryInitial,
  newStoryProblem,
  newStoryRequest,
  pastedBody,
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
  ModelPicker: ModelPickerDouble,
  sections: [
    { key: "council", name: "Council" },
    { key: "schools", name: "Schools" },
  ],
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
    assert.match(html, /Automatic \(Recommended\)/);
    /*
      Unit BW3: the scope row, drawn on tab (a) because `writeStoryInput`
      carries `researchScope` and the server reads an absent one as "public"
      (`desk.ts:1588`). Both scopes are drawn with the desk's own values, so a
      press can say "supplied" and no search runs for material the editor
      handed over themselves.
    */
    assert.match(html, /aria-label="Research scope"/);
    for (const c of NEW_STORY_SCOPES) {
      assert.match(html, new RegExp(`<option value="${c.value}"[^>]*>${c.label}</option>`), c.value);
    }
    assert.match(html, /<option value="public" selected="">Research public sources/);
    // Only tab (a) is about research; the other two have nothing to scope.
    assert.ok(!render({ tab: "self" }).includes('aria-label="Research scope"'));
    assert.ok(!render({ tab: "paste" }).includes('aria-label="Research scope"'));
  });

  it("sends the scope tab (a) shows, and it only carries a scope", () => {
    const send = (researchScope: NewStoryState["researchScope"]) => {
      const step = newStoryRequest(
        state({ tab: "ai", assignment: "A whole assignment", researchScope }),
      ).steps[0]!;
      return inputOf(step);
    };
    assert.equal(send("public").researchScope, "public");
    assert.equal(send("supplied").researchScope, "supplied");
    // The default is the desk's own: an absent scope is "public" server-side,
    // so the dialog opens on the default rather than on a narrower scope the
    // editor never chose.
    assert.equal(newStoryInitial().researchScope, "public");
    // Tabs (b) and (c) save the editor's own text; there is nothing to scope.
    for (const tab of ["self", "paste"] as const) {
      const steps = newStoryRequest(
        state({ tab, headline: "A real headline", summary: "Why it matters", story: "y".repeat(40), pastedStory: "z".repeat(60) }),
      ).steps;
      for (const step of steps) {
        if (step.call === "checkEvidence") continue;
        assert.ok(!("researchScope" in inputOf(step)), `${tab}/${step.call}`);
      }
    }
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
    /*
      Unit BW3: the import screen's way in, on the tab that is about a story
      written elsewhere. It is the only link this dialog carries, so it is
      asserted with its own href rather than by wording alone.
    */
    assert.match(paste, /<a class="inline-link" href="\/desk\/import">Import many finished stories →<\/a>/);
    assert.match(paste, /class="inline-link"[^>]*href="\/desk\/import"/);
    assert.ok(!self.includes("/desk/import"), "the write-it-myself tab does not carry the import link");
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
    /*
      Unit BW3: an attached document is material. The composer this tab
      replaced shut the press only on short text AND no document
      (`desk.index.tsx:1236-1240`), so an editor who uploaded a packet and typed
      nothing could press it -- and the drawn tab could not, which is what
      stopped three CI walks. `newStoryRequest` already hands the drafter the
      same documents as `documentIds`.
    */
    assert.equal(newStoryProblem(state({ tab: "ai", assignment: "A full assignment sentence" }), 1), null);
    assert.match(newStoryProblem(state({ tab: "ai", assignment: "A full assignment sentence" })) ?? "", /Paste the material/);

    assert.match(newStoryProblem(state({ tab: "self" })) ?? "", /Headline needs a full sentence/);
    assert.match(newStoryProblem(state({ tab: "self", headline: "A real headline" })) ?? "", /why this is news/i);
    assert.match(
      newStoryProblem(state({ tab: "self", headline: "A real headline", summary: "Why it matters" })) ?? "",
      /story needs some text/,
    );
    assert.equal(
      newStoryProblem(state({ tab: "self", headline: "A real headline", summary: "Why it matters", story: "y".repeat(40), section: "council" })),
      null,
    );
    // The section is the last thing asked for, and it is asked for: a draft
    // cannot be saved without one (see the row test below).
    assert.equal(
      newStoryProblem(state({ tab: "self", headline: "A real headline", summary: "Why it matters", story: "y".repeat(40) })),
      SECTION_REQUIRED,
    );

    assert.match(newStoryProblem(state({ tab: "paste" })) ?? "", /Paste the story text/);
    assert.match(
      newStoryProblem(state({ tab: "paste", pastedStory: "z".repeat(50), pasteMode: "clean", originalLink: "example.com/story" })) ?? "",
      /has to start with http/,
    );
    // The same bad link is harmless when the press spends nothing on it.
    assert.equal(
      newStoryProblem(state({ tab: "paste", pastedStory: "z".repeat(50), pasteMode: "nothing", originalLink: "example.com/story" })),
      SECTION_REQUIRED,
    );
  });

  it("draws the Section row on both tabs that save the editor's own text, and files under it", () => {
    /*
      Unit BW3, measured: a draft cannot be written without a section.
      `saveDraftForEditor` writes `topic` on every save (`draft-edit.server.ts:48`
      update, `:61` insert) and `resolve_story_section` raises "Section not
      found in this newsroom: " for any key that is not a row of
      `newsroom_sections`, the empty string included (`sections.server.ts:38`,
      fired by the trigger at `:47`). Tabs (b) and (c) planned `topic: ""` and
      drew no control for it, so both tabs' save was a 500.
    */
    for (const tab of ["self", "paste"] as const) {
      const html = render({ tab });
      assert.match(html, /astra-field-label">Section/, tab);
      assert.match(html, new RegExp(`<option value=""[^>]*>${SECTION_REQUIRED}</option>`), tab);
      for (const s of base.sections) {
        assert.match(html, new RegExp(`<option value="${s.key}"[^>]*>${s.name}</option>`), `${tab}/${s.key}`);
      }
    }
    // Tab (a) files nothing itself -- it sends the AI off to write -- so it
    // draws no section to file under.
    assert.ok(!render({ tab: "ai" }).includes('aria-label="Section"'));
    // A newsroom whose sections could not load offers nothing to file under,
    // rather than a guessed default: the row says so and the save stays shut.
    const unloaded = renderToStaticMarkup(
      createElement(NewStoryBody, { ...base, sections: [], state: state({ tab: "paste" }) }),
    );
    assert.match(unloaded, /sections could not load/);
    assert.match(unloaded, /<select class="astra-input" aria-label="Section" disabled=""/);

    // The chosen section is what BOTH writes carry, on both tabs: the lead is
    // not filed under one section and the draft saved under another.
    const paste = newStoryRequest(state({ tab: "paste", pastedStory: "z".repeat(60), section: "schools" }));
    assert.deepEqual(paste.steps.map((s) => s.call), ["fileLead", "saveDraft"]);
    for (const step of paste.steps) assert.equal(inputOf(step).topic, "schools");
    const self = newStoryRequest(
      state({ tab: "self", headline: "A real headline", summary: "Why it matters", story: "y".repeat(40), section: "council" }),
    );
    for (const step of self.steps) assert.equal(inputOf(step).topic, "council");
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
        pastedStory: `Council delays the budget

The council voted to delay it until November ([minutes](https://records.example/minutes)).`,
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
    /*
      Unit BW3: the pages the story itself cites travel with the filing, and so
      does who wrote it. The reader sees the DRAFT's `source_urls` and
      `disclosure_text` (`publishLead`, `desk.ts:3659`), so without these two a
      story pasted this way published with an empty Sources section and the
      paper's own AI line, on a page that promises "Sources shown" -- the same
      defect the hand-filed lead had (`desk.ts:486-493`). "A person" is the old
      one-story paste panel's default (`paste-one-story.ts:49`).
    */
    assert.deepEqual(file.urls, ["https://records.example/minutes"]);
    assert.equal(file.disclosureKey, "person");
    /*
      Unit BW3: and it is an editor's paste, not model prose. Unmarked, the
      desk's evidence gate (`draft-evidence.ts:36`) stops the publish of a
      pasted story the moment an editor corrects a sentence in it -- which is
      what the walk does before printing it. The import path marks its drafts
      the same way (`import-stories.server.ts:432`).
    */
    assert.equal(file.importedText, true);
    /*
      Unit BW5: and it is filed as the import path filed it. The Queue draws its
      Imported chip off `leads.origin === "import"` (`desk-leads.tsx:516`), and
      the one-story paste panel this tab replaces wrote that word through
      `importFinishedStories` (`import-stories.server.ts:402`). Without it,
      every paste that panel marked Imported arrives unmarked.
    */
    assert.equal(file.origin, "import");
    assert.equal(save.dek, "Reprinted with permission");
    assert.match(press.done, /evidence check is running/);
  });

  it("marks only the paste tab's lead with the import origin", () => {
    /*
      The other half of the assertion above, and the reason it is not simply a
      default on `fileLead`: "Write it myself" is the desk's own story, typed
      here, and the Imported chip says "read out of a report you pasted, not
      written by the desk". A default would put that sentence on the editor's
      own work.
    */
    const self = newStoryRequest(
      state({ tab: "self", headline: "Council delays the budget", summary: "Why", story: "The council voted." }),
    );
    const ai = newStoryRequest(state({ tab: "ai", assignment: "A whole assignment" }));
    assert.ok(!("origin" in inputOf(self.steps[0]!)), "the write-it-myself tab files an origin");
    assert.equal(ai.steps[0]!.call, "writeStory");
    assert.ok(!("origin" in inputOf(ai.steps[0]!)), "the AI tab files an origin");
  });

  it("draws the duplicate warning with the saved-state words and the panel's link, after the save", () => {
    /*
      Unit BW5. The one-story paste panel warned, once the story was added,
      that it looked like one the paper already had, with a link to the story
      it means (`desk.index.tsx:1532-1551` before the redesign). The drawn tab
      saved the story and said nothing, so the warning went with the panel.
      Both halves are asserted here -- the words, and that they arrive WITH the
      save rather than instead of it.

      Unit CA, note 6: the words are the saved-state ones now. The review
      screen's "Import it anyway if it is different — you decide" asks for a
      decision the editor has already made by the time this draws.
    */
    const printed = render({
      tab: "paste",
      pastedStory: "Council delays the budget\n\nThe council voted.",
    });
    // Nothing was asked, so nothing is drawn: the warning is the server's
    // answer about one particular paste, never a guess the body makes.
    assert.ok(
      !printed.includes("Kill one if they are the same"),
      "a warning is drawn with no answer to draw",
    );

    const withWarning = renderToStaticMarkup(
      createElement(NewStoryBody, {
        ...base,
        state: { ...base.state, tab: "paste", pastedStory: "Council delays the budget\n\nThe council voted." },
        note: "Saved as your draft. The credit line and link stay on the published page.",
        duplicate: { headline: "Council delays the budget", slug: "council-delays-the-budget" },
      }),
    );
    assert.match(withWarning, /already on the paper/);
    assert.match(withWarning, /It looks like “Council delays the budget”, already on the paper\./);
    assert.match(withWarning, /Kill one if they are the same\./);
    assert.doesNotMatch(withWarning, /Import it anyway|you decide/);
    assert.match(withWarning, /Saved as your draft/, "the warning replaced the confirmation");
    assert.match(withWarning, /href="\/articles\/council-delays-the-budget"/);
    assert.match(withWarning, /Read the printed one/);
    // Role status, the same live region the confirmation speaks through: the
    // old panel drew both in one such paragraph, and a screen reader reads the
    // warning where the editor reads it.
    assert.match(withWarning, /role="status"/);

    // A match that is a lead and not a printed story: the panel's other link.
    const onTheDesk = renderToStaticMarkup(
      createElement(NewStoryBody, {
        ...base,
        state: { ...base.state, tab: "paste", pastedStory: "Council delays the budget\n\nThe council voted." },
        note: "Saved as your draft.",
        duplicate: { headline: "Council delays the budget", leadId: 42 },
      }),
    );
    assert.match(onTheDesk, /already in the Queue/);
    assert.match(onTheDesk, /It looks like “Council delays the budget”, already in the Queue\./);
    assert.match(onTheDesk, /href="\/desk\/story\/42"/);
    assert.match(onTheDesk, /Open the one on the desk/);
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
    assert.equal(inputOf(newStoryRequest(state({ tab: "ai", assignment: "A whole assignment" })).steps[0]!).modelChoice, "auto");

    // The paste tab's row has a reader: the step it plans carries the pick, so
    // the editor's choice is not a control the desk ignores.
    const clean = newStoryRequest(state({ tab: "paste", pastedStory: "q".repeat(60), pasteMode: "clean", ...pick }));
    assert.deepEqual(clean.steps.map((s) => s.call), ["fileLead", "saveDraft", "suggestHeadlines"]);
    assert.equal(inputOf(clean.steps[2]!).modelChoice, named!.value);
    assert.equal(inputOf(clean.steps[2]!).modelEffort, "high");
    assert.deepEqual(inputOf(newStoryRequest(state({ tab: "paste", pastedStory: "q".repeat(60), pasteMode: "clean" })).steps[2]!), { modelChoice: "auto" });
  });

  it("sends a saved custom connection the static registry does not carry", () => {
    /*
      Unit BW3: the row merges the editor's own saved connections from the
      database (the shell does the same merge `model-picker.tsx:299-311` does),
      and the server resolves `custom:<id>` -- so the press must carry it even
      though `modelRowFor("story")` has no such row. Reaching for a built-in
      instead would be the editor pinning their newsroom's connection and the
      desk spending something else.
    */
    const id = "custom:11111111-2222-3333-4444-555555555555";
    const custom = newStoryRequest(state({ tab: "ai", assignment: "A whole assignment", model: id })).steps[0]!;
    assert.equal(inputOf(custom).modelChoice, id);
    assert.equal(newStoryRequest(state({ tab: "ai", assignment: "A whole assignment", model: id })).steps[0]!.call, "writeStory");
    // Nothing but that prefix is let through: a value the row cannot carry is
    // still dropped rather than sent to a server that cannot resolve it.
    const bogus = newStoryRequest(state({ tab: "ai", assignment: "A whole assignment", model: "customish" })).steps[0]!;
    assert.ok(!("modelChoice" in inputOf(bogus)));
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

  it("takes the headline line off the body it saves, and only when it was the headline", () => {
    /*
      Step G: the paste's first line becomes the headline (`fileLead`'s
      `headline`), so it must not be repeated as the body's first line either --
      that is what an editor saw in the story editor for every paste
      (`paste-one-story.ts:87`).
    */
    assert.equal(
      pastedBody("Council delays the budget\n\nThe council voted.\n\nStaff agreed."),
      "The council voted.\n\nStaff agreed.",
    );
    // The blank lines between the headline and the first paragraph go with it.
    assert.equal(pastedBody("A headline worth reading\n\n\nBody."), "Body.");
    // A first line too short to be a headline is a paragraph, not a headline:
    // the headline is a sentence the desk derived, and the paste is all body.
    assert.equal(
      pastedBody("Stub\nThe budget was delayed until November."),
      "Stub\nThe budget was delayed until November.",
    );
    assert.equal(pastedBody(""), "");
  });

  it("files only the first URL a Sources box holds, and takes none when there is none", () => {
    assert.equal(firstSourceUrl("a note\nhttps://one.example/x\nhttps://two.example/y"), "https://one.example/x");
    assert.equal(firstSourceUrl("https://one.example/x, https://two.example/y"), "https://one.example/x");
    assert.equal(firstSourceUrl("no links here"), undefined);
  });
});
