import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REPORT_RESEARCH_SYSTEM,
  REPORT_WRITE_SYSTEM,
  reportResearchSystem,
  reportWriteSystem,
} from "./report.ts";
import { NEWSROOM_NOTE, buildEditorialPack, buildWritingPack, newsroomNote } from "./editorial.ts";

/*
  The v0.5.7 walkthrough set up the Ashgrove Gazette in Ashgrove, Colorado,
  filed a lead, and got a story back about what "Longmont council" had not
  done -- every provider was told, in its system prompt, that it worked for
  TownReporter in Longmont. These pin the prompts to the configured paper.
*/
const ASHGROVE = { name: "Ashgrove Gazette", city: "Ashgrove", state: "Oregon" };

describe("the writing prompts name the configured paper, not Longmont", () => {
  it("research and write prompts carry the paper's name, city and state", () => {
    for (const prompt of [reportResearchSystem(ASHGROVE), reportWriteSystem(ASHGROVE)]) {
      assert.match(prompt, /Ashgrove Gazette/);
      assert.match(prompt, /Ashgrove, Oregon/);
      assert.doesNotMatch(prompt, /Longmont/, "a configured city must not be told it is Longmont");
      assert.doesNotMatch(prompt, /Times-Call|Daily Camera|Longmont Leader/);
    }
  });

  it("the shipped defaults are still the Longmont prompts, unchanged in meaning", () => {
    assert.match(REPORT_RESEARCH_SYSTEM, /TownReporter in Longmont, Colorado/);
    assert.match(REPORT_WRITE_SYSTEM, /TownReporter \(Longmont, Colorado\)/);
  });

  it("the Opinion desk note names the paper it runs in", () => {
    const note = newsroomNote({ name: "Ashgrove Gazette", city: "Ashgrove" });
    assert.match(note, /Ashgrove Gazette, the Ashgrove paper/);
    assert.doesNotMatch(note, /Longmont|TownReporter/);
    assert.match(NEWSROOM_NOTE, /TownReporter, the Longmont paper/);
  });

  it("both editorial packs use the paper they are given, and the default otherwise", () => {
    const paper = { name: "Ashgrove Gazette", city: "Ashgrove" };
    assert.match(buildEditorialPack({ subject: "x", pointers: [], paper }), /Ashgrove Gazette/);
    assert.match(buildWritingPack({ subject: "x", research: "r", paper }), /Ashgrove Gazette/);
    assert.match(buildEditorialPack({ subject: "x", pointers: [] }), /TownReporter, the Longmont paper/);
  });
});
