import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { disclosureForPublishedStory } from "./ai-disclosure.ts";

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
