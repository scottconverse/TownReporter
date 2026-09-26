import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HEADLINE_MAX,
  SUGGESTION_MAX,
  cleanHeadline,
  editorOwnsHeadline,
  headlineEditRecord,
  headlineForRedraft,
  headlineSourceAfterEdit,
  headlineSuggestionPrompt,
  parseHeadlineSuggestions,
  sectionOverrideDetail,
  sectionOverridden,
} from "./headline-control.ts";

/**
 * The three headline decisions and the section-override rule, tested directly.
 *
 * These are pure functions over plain values on purpose: the rules live here
 * rather than in `desk.ts` (which opens a database at import time and cannot be
 * loaded by `node --experimental-strip-types`), so the rule that decides who
 * owns a headline can be tested for what it decides instead of only through a
 * running server.
 */

describe("who owns the headline", () => {
  it("reads the recorded flag when the desk recorded one", () => {
    assert.equal(editorOwnsHeadline({ headline: "A", model_headline: "A", headline_source: "editor" }), true);
    assert.equal(editorOwnsHeadline({ headline: "A", model_headline: "A", headline_source: "model" }), false);
  });

  it("reads a headline that differs from the model's as the editor's, flag or no flag", () => {
    // The case the editor actually hit: a row edited by a path that did not
    // stamp the flag, or written between the migration and this rule.
    assert.equal(editorOwnsHeadline({ headline: "The editor's line", model_headline: "The model's line" }), true);
    assert.equal(editorOwnsHeadline({ headline: "Same line", model_headline: "Same line" }), false);
  });

  it("does not claim to know who wrote a headline from before this release", () => {
    // No model headline recorded: only the flag can speak, and it reads model.
    assert.equal(editorOwnsHeadline({ headline: "Anything at all" }), false);
    assert.equal(editorOwnsHeadline({ headline: "Anything", headline_source: "model" }), false);
    assert.equal(editorOwnsHeadline(null), false);
    assert.equal(editorOwnsHeadline(undefined), false);
  });

  it("ignores whitespace when comparing the two headlines", () => {
    assert.equal(editorOwnsHeadline({ headline: "  Same line  ", model_headline: "Same line" }), false);
  });
});

describe("a redraft's headline", () => {
  it("keeps the editor's words and files the model's attempt beside them", () => {
    const kept = headlineForRedraft(
      { headline: "The editor's line", model_headline: "The model's line", headline_source: "editor" },
      "A newer model line",
    );
    assert.deepEqual(kept, {
      headline: "The editor's line",
      modelHeadline: "A newer model line",
      source: "editor",
    });
  });

  it("takes the model's line when the model still owns it", () => {
    assert.deepEqual(
      headlineForRedraft({ headline: "Old model line", model_headline: "Old model line" }, "New model line"),
      { headline: "New model line", modelHeadline: "New model line", source: "model" },
    );
  });

  it("never leaves the row without a headline", () => {
    // The model returned nothing: keep what is on the row, whatever it is.
    assert.deepEqual(headlineForRedraft({ headline: "Keep me" }, ""), {
      headline: "Keep me",
      modelHeadline: "Keep me",
      source: "model",
    });
  });

  it("does not adopt an editor's empty headline over the model's", () => {
    const kept = headlineForRedraft({ headline: "   ", model_headline: "The model's" }, "A new model line");
    assert.equal(kept.headline, "A new model line");
    assert.equal(kept.source, "model");
  });
});

describe("the flag an editor's save writes", () => {
  it("says editor only when the headline is not the model's", () => {
    assert.equal(headlineSourceAfterEdit({ model_headline: "The model's" }, "The model's"), "model");
    assert.equal(headlineSourceAfterEdit({ model_headline: "The model's" }, "The editor's"), "editor");
  });

  it("marks an unrecorded row as the editor's for any headline it shows", () => {
    // A draft from before 0.6.67: the desk cannot show the editor a headline
    // and then claim the model wrote it.
    assert.equal(headlineSourceAfterEdit({ headline: "Something" }, "Something"), "editor");
  });

  it("keeps an editor's flag when the save carries an empty headline", () => {
    assert.equal(headlineSourceAfterEdit({ headline: "x", headline_source: "editor" }, ""), "editor");
    assert.equal(headlineSourceAfterEdit({ headline: "x", headline_source: "model" }, ""), "model");
  });
});

describe("the record of a published headline change", () => {
  it("records the old words, the new ones and who changed them", () => {
    assert.deepEqual(
      headlineEditRecord({ headline: "What it said" }, "What it says now", "editor@example.com"),
      { oldHeadline: "What it said", newHeadline: "What it says now", changedBy: "editor@example.com" },
    );
  });

  it("writes nothing when the headline did not change", () => {
    assert.equal(headlineEditRecord({ headline: "Same" }, "Same", "editor@example.com"), null);
    assert.equal(headlineEditRecord({ headline: "Same" }, "  Same  ", "editor@example.com"), null);
    assert.equal(headlineEditRecord({ headline: "Same" }, "   ", "editor@example.com"), null);
  });
});

describe("the headline that would be stored", () => {
  it("collapses a paste into one line and clips to the desk's ceiling", () => {
    assert.equal(cleanHeadline("  Two\n  lines\there "), "Two lines here");
    assert.equal(cleanHeadline(""), null);
    assert.equal(cleanHeadline(null), null);
    // Not a string is not a headline: the text form of a number must never
    // become the words a story prints under.
    assert.equal(cleanHeadline(42), null);
    assert.equal(cleanHeadline({ headline: "x" }), null);
    assert.equal(cleanHeadline("z".repeat(HEADLINE_MAX + 100))?.length, HEADLINE_MAX);
  });
});

describe("headline suggestions", () => {
  const answer = `Here are three headlines:
1. "Council adopts the annexation, 5-2"
2. The city will pay for the Olson road
3. *Annexation approved after two hours*`;

  it("reads the three headlines out of a numbered, quoted, markdown answer", () => {
    assert.deepEqual(parseHeadlineSuggestions(answer), [
      "Council adopts the annexation, 5-2",
      "The city will pay for the Olson road",
      "Annexation approved after two hours",
    ]);
  });

  it("drops the model's own framing sentence", () => {
    assert.equal(parseHeadlineSuggestions("Here are three headlines:").length, 0);
    assert.equal(parseHeadlineSuggestions("```").length, 0);
  });

  it("drops anything the publish gate would refuse", () => {
    // A paragraph is not a headline: offering it would spend the editor's
    // click to show them something they would have to fix.
    const tooLong = `1. ${"a very long line ".repeat(30)}`;
    assert.deepEqual(parseHeadlineSuggestions(tooLong), []);
    assert.deepEqual(parseHeadlineSuggestions("1. Short"), []);
    assert.equal(parseHeadlineSuggestions(tooLong).length, 0);
    assert.ok(SUGGESTION_MAX < HEADLINE_MAX, "offering is tighter than storing");
  });

  it("gives at most three and never repeats one", () => {
    const five = ["One headline here", "Two headline here", "One headline here", "Three headline here", "Four headline here"]
      .map((h, i) => `${i + 1}. ${h}`)
      .join("\n");
    const options = parseHeadlineSuggestions(five);
    assert.equal(options.length, 3);
    assert.equal(new Set(options.map((o) => o.toLowerCase())).size, 3);
  });

  it("asks the model for three numbered headlines and nothing else", () => {
    const prompt = headlineSuggestionPrompt({
      leadHeadline: "Council takes up annexation",
      section: "council",
      currentHeadline: "The annexation vote",
      dek: "Two hours of testimony",
      body: "The council voted 5-2 Monday.\n\nMore text.",
    });
    assert.match(prompt.system, /three numbered headlines and nothing else/);
    assert.match(prompt.user, /Section: council/);
    assert.match(prompt.user, /The lead as it was filed: Council takes up annexation/);
    assert.match(prompt.user, /The headline on the desk now: The annexation vote/);
    assert.match(prompt.user, /Story so far:\nThe council voted 5-2 Monday\. More text\./);
    assert.doesNotMatch(prompt.user, /\n\n\n/, "no blank gaps where an empty field was");
  });
});

describe("a section the editor printed under that the model did not choose", () => {
  it("counts a real disagreement", () => {
    assert.equal(sectionOverridden("council", "schools"), true);
    assert.equal(sectionOverridden("council", " council "), false);
    assert.equal(sectionOverridden("council", "council"), false);
  });

  it("does not count an unrecorded model choice as a disagreement", () => {
    // Counting NULL as "the editor changed it" would put every pre-0.6.67
    // story in the count and make the number mean nothing.
    assert.equal(sectionOverridden(null, "council"), false);
    assert.equal(sectionOverridden("", "council"), false);
    assert.equal(sectionOverridden("council", ""), false);
    assert.equal(sectionOverridden(undefined, undefined), false);
  });

  it("logs the lead, both sections and what printed, in one stable line", () => {
    const detail = sectionOverrideDetail({ leadId: 240, modelTopic: "council", editorTopic: "schools" });
    assert.deepEqual(JSON.parse(detail), { leadId: 240, modelSection: "council", editorSection: "schools" });
    // The shape is what Stats counts on, so it must not drift silently.
    assert.equal(sectionOverrideDetail({ leadId: 1, modelTopic: "a", editorTopic: "b" }), sectionOverrideDetail({ leadId: 1, modelTopic: "a", editorTopic: "b" }));
  });
});
