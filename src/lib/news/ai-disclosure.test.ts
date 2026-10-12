import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { disclosureForPublishedStory, disclosureForReader } from "./ai-disclosure.ts";

describe("published story disclosure follows recorded authoring work", () => {
  it("omits AI claims for a manual story and names research only when the record says it ran", () => {
    assert.equal(
      disclosureForPublishedStory({ text: "", modelBody: null, researchJson: "{}" }),
      "",
    );
    const researched = disclosureForPublishedStory({
      text: "",
      modelBody: null,
      researchJson: JSON.stringify({ publicAiResearchCompleted: true }),
    });
    assert.match(researched, /AI tools/i);
    assert.match(researched, /find records/i);
    assert.doesNotMatch(researched, /write the first draft/i);
  });

  it("separates model drafting from public research and keeps an editor-chosen line", () => {
    const drafted = disclosureForPublishedStory({
      text: "",
      modelBody: "The model's original body.",
      researchJson: "{}",
    });
    assert.match(drafted, /first draft/i);
    assert.doesNotMatch(drafted, /find records/i);

    const researchedAndDrafted = disclosureForPublishedStory({
      text: "",
      modelBody: "The model's original body.",
      researchJson: JSON.stringify({ publicAiResearchCompleted: true }),
    });
    assert.match(researchedAndDrafted, /first draft/i);
    assert.match(researchedAndDrafted, /find records/i);

    assert.equal(
      disclosureForPublishedStory({
        text: "An editor-chosen attribution.",
        modelBody: "The model's original body.",
        researchJson: JSON.stringify({ publicAiResearchCompleted: true }),
      }),
      "An editor-chosen attribution.",
    );
  });
});

describe("the reader's line on a story an editor pasted in (FC04)", () => {
  const pastedBody = "The editor's own words, pasted in.";

  it("gives no AI line even though the pasted text is held as the model body", () => {
    assert.equal(
      disclosureForReader({ text: "", modelBody: pastedBody, researchJson: "{}", pastedByEditor: true }),
      "",
    );
  });

  it("drops the AI line a pasted story was published with before the fix", () => {
    const stored = disclosureForPublishedStory({ text: "", modelBody: pastedBody, researchJson: "{}" });
    assert.match(stored, /first draft/i);
    assert.equal(
      disclosureForReader({ text: stored, modelBody: pastedBody, researchJson: "{}", pastedByEditor: true }),
      "",
    );
  });

  it("keeps an editor's own line on a pasted story", () => {
    assert.equal(
      disclosureForReader({
        text: "An editor-chosen attribution.",
        modelBody: pastedBody,
        researchJson: "{}",
        pastedByEditor: true,
      }),
      "An editor-chosen attribution.",
    );
  });

  it("still gives the AI line to a story an AI drafted", () => {
    assert.match(
      disclosureForReader({ text: "", modelBody: "The model's original body.", researchJson: "{}" }),
      /first draft/i,
    );
  });
});

// DHF-2 (D67): an AI draft published unchanged reads as approved; an edited one keeps today's line.
describe("publishedBody decides approved versus edited wording", () => {
  const modelBody = "The model's original body.";
  const researchJson = JSON.stringify({ publicAiResearchCompleted: true });
  const edited = "A person reviewed and edited this story. AI tools helped find records and write the first draft. The records we used are listed under Sources.";
  const approved = "An editor approved this story for publication. AI tools helped find records and write the first draft. The records we used are listed under Sources.";

  it("an unchanged AI draft says an editor approved it", () => {
    assert.equal(disclosureForReader({ text: "", modelBody, researchJson, publishedBody: modelBody }), approved);
  });

  it("an edited AI draft keeps the reviewed-and-edited line exactly", () => {
    assert.equal(disclosureForReader({ text: "", modelBody, researchJson, publishedBody: "Edited body." }), edited);
  });

  it("a stored derived line is recomputed from the published body", () => {
    assert.equal(disclosureForReader({ text: edited, modelBody, researchJson, publishedBody: modelBody }), approved);
  });

  it("a story with no AI keeps no AI line", () => {
    assert.equal(disclosureForReader({ text: "", modelBody: null, researchJson: "{}", publishedBody: "Typed by hand." }), "");
  });
});
