import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { topicFromText } from "./desk-copy.ts";

/*
  The manual path's chooser.

  `topicFromText` reads a section out of pasted text for the two paths that
  have no model reply to read it from: the Write a story box
  (`write-story.ts` -> `model-request-commit.server.ts`) and the Dark Desk
  handoff (`dark.ts`). It used to be ordered keyword regexes with `council`
  hard-wired as the answer for anything unrecognised, so a lead about a
  nonprofit fundraiser or a local-media hire came out of the desk labelled
  with a section that had nothing to do with it -- live: the cat-rescue
  fundraiser was filed `budget`, the Longmont Public Media hire `schools`.

  These are the two live texts (rewritten as realistic fixture strings, per
  the unit brief), the false positives that made the old rules fire
  ("a school of thought", a person's education, a museum), and the two
  sections the newsroom actually has.
*/

/** The live newsroom's sections (coordinator: council..elections, briefs empty). */
const LIVE_SECTIONS = [
  { key: "council", name: "Council", brief: "" },
  { key: "budget", name: "Budget", brief: "" },
  { key: "housing", name: "Housing", brief: "" },
  { key: "utilities", name: "Utilities", brief: "" },
  { key: "schools", name: "Schools", brief: "" },
  { key: "planning", name: "Planning", brief: "" },
  { key: "infrastructure", name: "Infrastructure", brief: "" },
  { key: "elections", name: "Elections", brief: "" },
];

const LPM_HIRE = `Longmont Public Media hires a new executive director
The nonprofit said Tuesday it hired Ana Duarte, who spent eight years at a community radio station in Greeley and holds a degree in education from Colorado State University.`;
const CAT_RESCUE = `Cat rescued from a cottonwood on Bohn Farm after three days
Neighbors raised more than $2,000 to cover the vet bill for the cat, which came down a ladder Thursday morning.`;

describe("topicFromText", () => {
  it("files a local-media hire under no section rather than reading a degree in education as schools", () => {
    const match = topicFromText(LPM_HIRE, LIVE_SECTIONS);
    assert.notEqual(match.topic, "schools", "a hire is not a schools story");
    assert.equal(match.topic, "council", "the column still needs a section");
    assert.equal(match.unchosen, true, "but nobody chose it, and the lead has to say so");
  });

  it("files a cat-rescue fundraiser under no section rather than budget", () => {
    const match = topicFromText(CAT_RESCUE, LIVE_SECTIONS);
    assert.notEqual(match.topic, "budget", "the live misfile must not be reproducible");
    assert.equal(match.topic, "council", "the column still needs a section");
    assert.equal(match.unchosen, true);
  });

  it("does not read a school of thought, a person's education, or a museum as schools", () => {
    for (const text of [
      "A school of thought holds that the roundabout will not move traffic.",
      "The new director's education was at a museum studies program in Denver.",
      "Her education took her from a Greeley classroom to a museum in Denver.",
    ]) {
      const match = topicFromText(text, LIVE_SECTIONS);
      assert.notEqual(match.topic, "schools", `"${text}" is not a schools story`);
      assert.equal(match.unchosen, true, `"${text}" names no section this newsroom files under`);
    }
  });

  it("matches on whole words, not on the insides of them", () => {
    assert.equal(
      topicFromText("Unschooling is growing in Larimer County.", LIVE_SECTIONS).unchosen,
      true,
      "'Unschooling' contains 'school' but does not name the schools beat",
    );
    assert.equal(
      topicFromText("The city's budgeteers meet Thursday.", LIVE_SECTIONS).unchosen,
      true,
      "'budgeteers' contains 'budget' but does not name the budget beat",
    );
  });

  it("still reads the two texts the old keyword list was written for", () => {
    assert.deepEqual(topicFromText("St. Vrain Valley Schools board packet", LIVE_SECTIONS), {
      topic: "schools",
      unchosen: false,
    });
    assert.deepEqual(topicFromText("NextLight fiber upgrade", LIVE_SECTIONS), {
      topic: "utilities",
      unchosen: false,
    });
  });

  it("reads the newsroom's own section names and briefs before the built-in list", () => {
    /*
      Same sentence, two newsrooms. The built-in vocabulary reads "high
      school" and says schools; this newsroom wrote "Police, fire and
      emergency response" for a section of its own, and its own words win --
      that is what "prefer the configured sections" has to mean, or the
      setting is decoration.
    */
    const text = "Police responded to a fire at the high school Friday night.";
    assert.deepEqual(topicFromText(text, LIVE_SECTIONS), { topic: "schools", unchosen: false });
    assert.deepEqual(
      topicFromText(text, [
        { key: "council", name: "City Council", brief: "" },
        { key: "public-safety", name: "Public safety", brief: "Police, fire and emergency response" },
      ]),
      { topic: "public-safety", unchosen: false },
    );
  });

  it("files a story under a section this newsroom configured by name alone", () => {
    const match = topicFromText(CAT_RESCUE, [
      { key: "community-life", name: "Community life", brief: "Neighbors, clubs and local arts" },
    ]);
    assert.deepEqual(match, { topic: "community-life", unchosen: false });
    assert.equal(
      topicFromText(CAT_RESCUE, LIVE_SECTIONS).unchosen,
      true,
      "the same text names nothing in the built-in list",
    );
  });

  it("falls back to the first section this newsroom files under, and never to a retired one", () => {
    const match = topicFromText(
      "The library's chess club meets Saturdays.",
      [
        { key: "about", name: "About", brief: "" },
        { key: "opinion", name: "Opinion", brief: "" },
        { key: "schools", name: "Schools", brief: "", replacementKey: "council" },
        { key: "council", name: "Council", brief: "" },
      ],
    );
    assert.equal(match.unchosen, true);
    assert.equal(match.topic, "council", "reserved and retired sections are not filing sections");
  });
});
