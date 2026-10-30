import assert from "node:assert/strict";
import test from "node:test";
import {
  ROUTINE_EDITION_UPDATE_PREFIX,
  routineEditionUpdateNote,
} from "./correction-origin.ts";

test("routine edition updates use a short plain note for zero, one, or many added items", () => {
  const cases = [
    { addedCount: 0, expected: "The list in this story was updated." },
    { addedCount: 1, expected: "The list in this story was updated. 1 new item was added." },
    { addedCount: 4, expected: "The list in this story was updated. 4 new items were added." },
  ];

  for (const { addedCount, expected } of cases) {
    const note = routineEditionUpdateNote(addedCount);
    assert.ok(note.startsWith(ROUTINE_EDITION_UPDATE_PREFIX));
    assert.equal(note, `${ROUTINE_EDITION_UPDATE_PREFIX}\n\n${expected}`);
    for (const mark of ["#", "*", "[", "]("]) assert.equal(note.includes(mark), false);
    const [prefix, sentence, ...rest] = note.split("\n\n");
    assert.equal(prefix, ROUTINE_EDITION_UPDATE_PREFIX);
    assert.equal(sentence, expected);
    assert.deepEqual(rest, []);
    assert.equal(sentence?.includes("\n"), false);
    assert.ok(note.length < 120);
  }
});
