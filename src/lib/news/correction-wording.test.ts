import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bodyEditRecord,
  cleanCorrectionLine,
  correctionTemplate,
  correctionWordingPrompt,
  CORRECTION_LINE_MAX,
  parseCorrectionWording,
} from "./correction-wording.ts";

/*
  The owner's first real correction (2026-09-25) was that the correcton box
  starts empty. These are the decisions that fill it, tested as plain values --
  `correction-wording.ts` has no database and no model in it, which is what lets
  the wording be checked here rather than through a running desk.
*/

describe("the plain note the desk writes itself, with no model", () => {
  it("builds the house sentence out of the editor's two lines", () => {
    assert.equal(
      correctionTemplate("the fee was $4,200", "the fee is $2,400"),
      "An earlier version of this story said the fee was $4,200. In fact, the fee is $2,400.",
    );
  });

  it("takes the full stops off the lines, so the sentence the desk writes is not doubled", () => {
    assert.equal(
      correctionTemplate("the meeting was Tuesday.", "it was Wednesday."),
      "An earlier version of this story said the meeting was Tuesday. In fact, it was Wednesday.",
    );
  });

  it("answers nothing from half the fact, rather than a sentence that reads finished", () => {
    // "An earlier version of this story said ." looks like a correction and
    // says nothing, which is worse than the empty box the owner complained
    // about: an empty box is obviously unfinished.
    assert.equal(correctionTemplate("", "the fee is $2,400"), null);
    assert.equal(correctionTemplate("the fee was $4,200", "   "), null);
    assert.equal(correctionTemplate("", ""), null);
  });

  it("reads only a string, so an object never prints its own text form", () => {
    assert.equal(cleanCorrectionLine({ toString: () => "sneaky" }), "");
    assert.equal(cleanCorrectionLine(4200), "");
    assert.equal(cleanCorrectionLine("  the   fee  was $4,200  "), "the fee was $4,200");
  });

  it("bounds a line at the schema's own ceiling, so a template always posts", () => {
    const long = "x".repeat(CORRECTION_LINE_MAX + 500);
    assert.equal(cleanCorrectionLine(long).length, CORRECTION_LINE_MAX);
    const note = correctionTemplate(long, long);
    assert.ok(note && note.length <= 2000, "a note the desk writes must pass the post button's own check");
  });
});

describe("the model's answer, read back", () => {
  it("takes a plain note as it stands", () => {
    assert.equal(
      parseCorrectionWording("An earlier version of this story said the fee was $4,200. In fact, it is $2,400."),
      "An earlier version of this story said the fee was $4,200. In fact, it is $2,400.",
    );
  });

  it("strips the wrapping the model adds anyway: a fence, a label, quotes, a lead-in", () => {
    assert.equal(
      parseCorrectionWording('```\nCorrection: "An earlier version said the fee was $4,200."\n```'),
      "An earlier version said the fee was $4,200.",
    );
  });

  it("reads the first line only, so the model's own explanation is not posted", () => {
    const answer =
      "An earlier version of this story said the fee was $4,200. In fact, it is $2,400.\n\n" +
      "I kept the wording close to your two lines and did not add any facts.";
    assert.equal(
      parseCorrectionWording(answer),
      "An earlier version of this story said the fee was $4,200. In fact, it is $2,400.",
    );
  });

  it("refuses a list of options -- three notes where one was asked for is not a correction", () => {
    assert.equal(
      parseCorrectionWording("1. An earlier version said $4,200.\n2. An earlier version said $4,200, not $2,400."),
      null,
    );
    assert.equal(parseCorrectionWording("- An earlier version said $4,200."), null);
  });

  it("refuses something too short to be a correction, and something too long to post", () => {
    assert.equal(parseCorrectionWording("Sorry!"), null);
    assert.equal(parseCorrectionWording(""), null);
    assert.equal(parseCorrectionWording("   \n  \n"), null);
    assert.equal(parseCorrectionWording(`An earlier version said ${"x".repeat(2100)}.`), null);
  });
});

describe("the model's ask", () => {
  it("carries the editor's two lines, the headline and the story, and forbids new facts", () => {
    const prompt = correctionWordingPrompt({
      wasWrong: "the fee was $4,200",
      isRight: "the fee is $2,400",
      headline: "Council approves the fee",
      body: "The council approved a $4,200 fee on Tuesday.",
    });
    assert.match(prompt.user, /What was wrong: the fee was \$4,200/);
    assert.match(prompt.user, /What is right: the fee is \$2,400/);
    assert.match(prompt.user, /The story's headline: Council approves the fee/);
    assert.match(prompt.user, /The council approved a \$4,200 fee on Tuesday\./);
    assert.match(prompt.system, /never add a fact/i);
    assert.match(prompt.system, /Answer with the correction note and nothing else/i);
  });

  it("leaves out a story it was not given rather than asking about an empty one", () => {
    const prompt = correctionWordingPrompt({ wasWrong: "the name", isRight: "the other name" });
    assert.doesNotMatch(prompt.user, /story as it printed/i);
    assert.doesNotMatch(prompt.user, /headline/i);
  });
});

describe("the body edit record", () => {
  it("records the text before and the text after when the text really changed", () => {
    assert.deepEqual(
      bodyEditRecord({ body: "The fee is $4,200." }, "  The fee is $2,400.  "),
      { oldBody: "The fee is $4,200.", newBody: "The fee is $2,400." },
    );
  });

  it("writes nothing for a second press, or for an empty story", () => {
    // The history is the record of decisions; pressing Post twice is one.
    assert.equal(bodyEditRecord({ body: "The fee is $2,400." }, "The fee is $2,400."), null);
    assert.equal(bodyEditRecord({ body: "The fee is $2,400." }, "   "), null);
    assert.equal(bodyEditRecord(null, "The fee is $2,400."), null);
  });
});
