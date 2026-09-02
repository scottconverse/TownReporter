import assert from "node:assert/strict";
import { test } from "node:test";
import {
  editorialAttribution,
  editorialRemovalCopy,
  openedEditorial,
  toggleEditorialReader,
} from "./opinion-view.ts";

test("pasted human-authored Opinion is attributed to the editor, not the schema's default model", () => {
  assert.equal(
    editorialAttribution({ source_kind: "written-by-the-editor", model_choice: "auto" }),
    "Written by the editor",
  );
  assert.equal(
    editorialAttribution({ source_kind: "paste", model_choice: "codex-frontier" }),
    "Codex Sol",
  );
  assert.equal(
    editorialAttribution({ source_kind: "article", model_choice: "claude-frontier" }),
    "Claude Opus",
  );
  assert.equal(editorialAttribution({ source_kind: "paste", model_choice: "auto" }), "Automatic");
});

test("the reader follows the selected draft, even when its ID matches another request", () => {
  const rows = [
    { id: 7, draft_id: 20, published_slug: null },
    { id: 20, draft_id: 91, published_slug: "another-published-editorial" },
  ];
  assert.equal(openedEditorial(rows, 20), rows[0]);
  assert.equal(openedEditorial(rows, 91), rows[1]);
  assert.equal(openedEditorial(rows, 7), undefined);
});

test("Read it opens, Close closes, and a different piece replaces the reader", () => {
  assert.equal(toggleEditorialReader(null, 20), 20);
  assert.equal(toggleEditorialReader(20, 20), null);
  assert.equal(toggleEditorialReader(20, 91), 91);
});

test("draft deletion promises the real recovery window and preserves published-piece guidance", () => {
  assert.match(editorialRemovalCopy(true, false), /30 days/);
  assert.match(editorialRemovalCopy(true, false), /Undo/);
  assert.doesNotMatch(editorialRemovalCopy(true, false), /for good|nothing else has a copy/i);
  assert.match(editorialRemovalCopy(true, true), /published piece stays on the paper/);
});

test("clearing an unfiled request does not claim to delete or preserve a nonexistent draft", () => {
  assert.match(editorialRemovalCopy(false, false), /request/);
  assert.match(editorialRemovalCopy(false, false), /No draft/);
  assert.doesNotMatch(editorialRemovalCopy(false, false), /30 days|Undo|deletes the draft/);
});
