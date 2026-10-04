import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeskLengthCut } from "./desk-length-cut.ts";
import { reconcileDraftEvidence } from "../lib/news/draft-evidence.ts";
import {
  readSuppliedMaterialCut,
  suppliedMaterialCutRecord,
} from "../lib/news/supplied-material-cap.ts";

/**
 * Unit B8P, the editor's half.
 *
 * The cut happens before the model call; this is what the editor is told about
 * it. The rule the brief sets is narrow, and each clause has a test: the right
 * numbers for a cut piece, nothing at all for a piece that was sent whole, and
 * a note that comes back off the STORED draft rather than out of a job's
 * memory -- which is what makes it survive a reload.
 */

/** What `fileEditorial` writes into `drafts.research_json` when it cut. */
const STORED = JSON.stringify({
  nameCheck: { version: 1 },
  lengthCut: suppliedMaterialCutRecord({
    cut: true,
    keptChars: 118_400,
    totalChars: 2_000_000,
  }),
});

const render = (research: string | null | undefined) =>
  renderToStaticMarkup(createElement(DeskLengthCut, { research }));

describe("DeskLengthCut", () => {
  it("renders the counts the editor needs, from the stored draft", () => {
    const html = render(STORED);
    assert.match(html, /2,000,000 characters/);
    assert.match(html, /first 118,400/);
    assert.match(html, /about 6%/);
    assert.match(html, /cut for length/);
    assert.match(html, /paste it in separate pieces/);
  });

  it("announces itself rather than appearing silently", () => {
    assert.match(render(STORED), /role="status"/);
  });

  it("renders nothing when nothing was cut", () => {
    // The ordinary case: a short paste, so `fileEditorial` stored no record.
    assert.equal(render(JSON.stringify({ nameCheck: { version: 1 } })), "");
    assert.equal(render("{}"), "");
    assert.equal(render(null), "");
    assert.equal(render(undefined), "");
    assert.equal(render(""), "");
  });

  it("renders nothing for a malformed record rather than guessing", () => {
    assert.equal(render("{ not json"), "");
    assert.equal(render(JSON.stringify({ lengthCut: { version: 1 } })), "");
    assert.equal(
      render(JSON.stringify({ lengthCut: { version: 2, keptChars: 1, totalChars: 9, note: "x" } })),
      "",
    );
  });

  it("never claims a cut for a record whose counts describe none", () => {
    // A piece filed whole, with numbers that contradict each other.
    const bogus = JSON.stringify({
      lengthCut: { version: 1, keptChars: 2_000, totalChars: 2_000, note: "the rest was cut" },
    });
    assert.equal(render(bogus), "");
    assert.equal(readSuppliedMaterialCut(bogus), null);
  });
});

describe("readSuppliedMaterialCut", () => {
  it("reads back what was stored, counts and wording", () => {
    const cut = readSuppliedMaterialCut(STORED);
    assert.ok(cut);
    assert.equal(cut.keptChars, 118_400);
    assert.equal(cut.totalChars, 2_000_000);
    assert.match(cut.note, /2,000,000 characters/);
  });

  it("stores nothing at all when nothing was cut", () => {
    assert.equal(
      suppliedMaterialCutRecord({ cut: false, keptChars: 500, totalChars: 500 }),
      null,
    );
  });

  it("survives the round trip through the column", () => {
    const record = suppliedMaterialCutRecord({ cut: true, keptChars: 90, totalChars: 400 });
    assert.ok(record);
    // `drafts.research_json` is a text column holding JSON: what comes back is
    // a string, and the reader has to get the same sentence out of it -- under
    // the same `lengthCut` key it was written to.
    const column = JSON.stringify({ lengthCut: record });
    assert.equal(readSuppliedMaterialCut(column)?.note, record.note);
  });

  it("survives the editor saving the piece", () => {
    /*
      The other half of "persists with the piece": editing and saving an
      editorial rewrites `research_json` from `reconcileDraftEvidence`, so the
      note only survives if that round trip carries unknown keys. It does --
      the record is spread back in beside the keys the function owns -- and
      this is the test that says so, because losing it silently on the first
      save would make the note a one-reload notice.
    */
    const record = suppliedMaterialCutRecord({ cut: true, keptChars: 90, totalChars: 400 });
    const stored = JSON.stringify({ nameCheck: { version: 1 }, lengthCut: record });
    const afterSave = reconcileDraftEvidence(
      { research_json: stored, body: "The old body.", source_urls: "[]" },
      "The editor's new body.",
    );
    const cut = readSuppliedMaterialCut(afterSave.research_json);
    assert.ok(cut, "the note was dropped by a save");
    assert.equal(cut.note, record?.note);
  });
});
