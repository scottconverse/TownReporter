import assert from "node:assert/strict";
import test from "node:test";
import * as sectionTypes from "./section-types.ts";

test("summarizes every unsaved section change with unambiguous source details", () => {
  assert.equal(
    typeof (sectionTypes as Record<string, unknown>).sectionPreviewChanges,
    "function",
    "the preview must have a single pure change summary",
  );
  const summarize = (sectionTypes as any).sectionPreviewChanges;
  const base = {
    revision: 4,
    sections: [
      {
        key: "schools",
        name: "Schools",
        visible: true,
        brief: "Old brief",
        instructions: "Old instructions",
        replacementKey: null,
        sourceIds: [1],
      },
      {
        key: "arts",
        name: "Arts",
        visible: true,
        brief: "Arts brief",
        instructions: "Arts instructions",
        replacementKey: null,
        sourceIds: [2],
      },
    ],
  };
  const draft = {
    ...base,
    sections: [
      { ...base.sections[1], visible: false },
      {
        ...base.sections[0],
        name: "Schools & families",
        brief: "New brief",
        instructions: "New instructions",
        sourceIds: [3],
      },
    ],
  };
  assert.deepEqual(
    summarize(base, draft, [
      { id: 1, title: "District", url: "https://district.example/news" },
      { id: 2, title: "Arts council", url: "https://arts.example/events" },
      { id: 3, title: "District", url: "https://district.example/calendar" },
    ]),
    [
      {
        key: "arts",
        nameBefore: "Arts",
        nameAfter: "Arts",
        positionBefore: 2,
        positionAfter: 1,
        visibleBefore: true,
        visibleAfter: false,
        briefBefore: "Arts brief",
        briefAfter: "Arts brief",
        instructionsBefore: "Arts instructions",
        instructionsAfter: "Arts instructions",
        sourcesBefore: [{ id: 2, title: "Arts council", url: "https://arts.example/events" }],
        sourcesAfter: [{ id: 2, title: "Arts council", url: "https://arts.example/events" }],
        replacementBefore: null,
        replacementAfter: null,
      },
      {
        key: "schools",
        nameBefore: "Schools",
        nameAfter: "Schools & families",
        positionBefore: 1,
        positionAfter: 2,
        visibleBefore: true,
        visibleAfter: true,
        briefBefore: "Old brief",
        briefAfter: "New brief",
        instructionsBefore: "Old instructions",
        instructionsAfter: "New instructions",
        sourcesBefore: [{ id: 1, title: "District", url: "https://district.example/news" }],
        sourcesAfter: [{ id: 3, title: "District", url: "https://district.example/calendar" }],
        replacementBefore: null,
        replacementAfter: null,
      },
    ],
  );
});
