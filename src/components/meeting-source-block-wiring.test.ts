import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const route = fs.readFileSync(path.join(here, "../routes/desk.story.$leadId.tsx"), "utf8");

describe("meeting source block wiring", () => {
  it("renders meeting provenance before the empty-versus-filled notes branch", () => {
    const notesRoot = route.indexOf('<div className="notes" id="evidence-review">');
    const sourceBlock = route.indexOf("{meetingSourceBlock}", notesRoot);
    const notesBranch = route.indexOf("{!filled ? (", notesRoot);
    assert.ok(notesRoot >= 0 && sourceBlock > notesRoot, "the provenance block is rendered in the notes pane");
    assert.ok(sourceBlock < notesBranch, "filled reporting notes cannot hide meeting provenance");
    assert.equal(route.indexOf("{meetingSourceBlock}", sourceBlock + 1), -1, "the block has one render location");
  });
});
