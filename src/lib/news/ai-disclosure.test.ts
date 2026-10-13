import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { disclosureForPublishedStory, disclosureForReader } from "./ai-disclosure.ts";

// Scott, Oct 12 2026: "NO reference to AI anywhere in this system except ONE
// place and I'll write it. In the about section." No story gets an AI line.
describe("a published story never gets an AI line", () => {
  const modelBody = "The model's original body.";
  const researched = JSON.stringify({ publicAiResearchCompleted: true });
  const oldLines = [
    "A person reviewed and edited this story. AI tools helped find records and write the first draft. The records we used are listed under Sources.",
    "An editor approved this story for publication. AI tools helped write the first draft. The records we used are listed under Sources.",
    "An editor published this story. AI tools helped write the first draft. Some claims in it were not checked against sources. The records we used are listed under Sources.",
    "An outside AI research tool wrote this from public records; an editor reviewed it.",
  ];

  it("derives no line from drafting, research, approval or unreviewed claims", () => {
    for (const publishedWithUnreviewedClaims of [false, true]) {
      for (const publishedBody of [modelBody, "Edited body."]) {
        assert.equal(
          disclosureForReader({ text: "", modelBody, researchJson: researched, publishedBody, publishedWithUnreviewedClaims }),
          "",
        );
      }
    }
    assert.equal(disclosureForPublishedStory({ text: "", modelBody: null, researchJson: researched }), "");
  });

  it("drops an AI line saved on an article before this change", () => {
    for (const text of oldLines) {
      assert.equal(disclosureForReader({ text, modelBody, researchJson: researched }), "");
      assert.equal(disclosureForReader({ text, modelBody, researchJson: "{}", pastedByEditor: true }), "");
    }
  });

  it("keeps a line the editor typed", () => {
    const own = "A person wrote this from public records; an editor reviewed it.";
    assert.equal(disclosureForReader({ text: own, modelBody, researchJson: researched }), own);
    assert.equal(disclosureForReader({ text: own, modelBody, researchJson: "{}", pastedByEditor: true }), own);
  });
});
