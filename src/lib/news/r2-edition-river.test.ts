import { it } from "node:test";
import assert from "node:assert/strict";
import { editionRiverQuery } from "./edition-river.ts";
import { STORY_AREAS } from "../story-area.ts";

it("requests Latest stories on the edition's ground, including an empty edition", () => {
  for (const area of STORY_AREAS) {
    assert.deepEqual(editionRiverQuery(area, 6, []), { area, limit: 6, exclude: [] });
    assert.deepEqual(editionRiverQuery(area, 6, [12, 42]), { area, limit: 6, exclude: [12, 42] });
  }
});
