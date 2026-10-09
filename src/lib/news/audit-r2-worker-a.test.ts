import { test } from "node:test";
import assert from "node:assert/strict";
import { editorTitle } from "./desk-copy.ts";
import {
  INVESTIGATION_TITLE_LIMIT,
  newestTouchedFile,
  fullFileQuestion,
  signalCounts,
} from "./dark-rail.ts";
import { bulkDeleteReasonLines } from "./queue-bulk.ts";
import { deskDraftState, tonightDrafts, type DeskDraftFacts } from "./desk-drafts.ts";

test("shared title cleaner strips provenance and preserves agenda identifiers", () => {
  assert.equal(editorTitle("City Council (2026-09-30T05:15:02Z)"), "City Council");
  assert.equal(editorTitle("City Council (2026-09-16)"), "City Council");
  assert.equal(editorTitle("[discovery] Reddit analysis"), "Reddit analysis");
  assert.equal(editorTitle("9C APPROVE THE CONTRACT (2026-09-16)"), "9C approve the contract");
  assert.equal(editorTitle("Approve item 9C"), "Approve item 9C");
  assert.equal(
    editorTitle("Budget (FY 2026) and Sept. 16 meeting"),
    "Budget (FY 2026) and Sept. 16 meeting",
  );
});

// guards: a newer file must not be hidden because it is running or set aside
test("auto-open picks the most recently touched file", () => {
  const rows = [
    { id: 1, status: "open", updated_at: "2026-09-10T00:00:00Z" },
    { id: 2, status: "paused", updated_at: "2026-09-12T00:00:00Z" },
    { id: 3, status: "aside", updated_at: "2026-09-15T00:00:00Z" },
    { id: 4, status: "investigating", updated_at: "2026-09-16T00:00:00Z" },
  ];
  assert.equal(newestTouchedFile(rows)?.id, 4);
  assert.equal(newestTouchedFile([]), undefined);
  assert.deepEqual(
    rows.map((r) => r.id),
    [1, 2, 3, 4],
  );
});

test("question recovers the full pasted first line only from a title that was cut", () => {
  /*
    Review D1. A short question that only happens to be the prefix of some other
    artifact's first line is a whole question of its own. "City budget" beside a
    tip that opens "City budget documents are available..." is two different
    things; swapping the tip in rewrites what the editor asked.
  */
  assert.equal(
    fullFileQuestion("City budget", "City budget documents are available at city hall.\nRecords below"),
    "City budget",
    "an editor's short question keeps its own words",
  );
  assert.equal(
    fullFileQuestion("Editor's renamed question", "An unrelated pasted record"),
    "Editor's renamed question",
  );
  /*
    A title that WAS cut: `openInvestigationForEditor` stores the paste's first
    line only up to the title limit, so a stored title that sits exactly on that
    limit is a truncated one, and the artifact holds the rest.
  */
  const longFirstLine = `${"Check filing dates, endorsements and campaign reports. ".repeat(5)}And the rest.`;
  const cut = longFirstLine.slice(0, INVESTIGATION_TITLE_LIMIT);
  assert.equal(cut.length, INVESTIGATION_TITLE_LIMIT, "the fixture must sit on the real limit");
  assert.equal(
    fullFileQuestion(cut, `${longFirstLine}\nRecords below`),
    longFirstLine,
    "a title cut at the limit recovers the artifact's full first line",
  );
  /* A title cut with a visible ellipsis recovers the same way. */
  assert.equal(
    fullFileQuestion(
      "Check filing dates, end…",
      "Check filing dates, endorsements and campaign reports.\nRecords below",
    ),
    "Check filing dates, endorsements and campaign reports.",
  );
});

test("signals account for both unreviewed and covered cards from one list", () => {
  assert.deepEqual(signalCounts([{ off: null }, { off: null }, { off: { kind: "covered" } }]), {
    total: 3,
    covered: 1,
    toReview: 2,
  });
  assert.deepEqual(signalCounts([]), { total: 0, covered: 0, toReview: 0 });
});

test("bulk delete lists the filing, hold and kill reason for each selected lead", () => {
  const common = { headline: "Council (2026-09-16)", why: "Filing reason" };
  assert.deepEqual(
    bulkDeleteReasonLines([
      { ...common, id: 1, status: "new" },
      {
        ...common,
        id: 2,
        status: "held",
        notes_json: JSON.stringify({
          hold: {
            key: "verify",
            reason: "Needs a record",
            note: "Ask the clerk",
            at: "2026-09-16",
          },
        }),
      },
      { ...common, id: 3, status: "killed", kill_reason: "Already printed" },
      { ...common, id: 4, status: "killed" },
    ]),
    [
      { id: 1, title: "Council", reason: "Filing reason" },
      { id: 2, title: "Council", reason: "Needs a record — Ask the clerk" },
      { id: 3, title: "Council", reason: "Already printed" },
      { id: 4, title: "Council", reason: "No kill reason recorded." },
    ],
  );
});

test("edition rows and step counts include every qualifying draft beyond three", () => {
  const base: DeskDraftFacts = {
    job_status: null,
    job_stage: null,
    job_started_at: null,
    job_updated_at: null,
    evidence_required: false,
    evidence_decision: null,
    imported_text: false,
    names_unresolved: 0,
    has_body: true,
    headline: "Council votes",
    model_headline: "Council votes",
    headline_source: "model",
  };
  const drafts = [
    base,
    base,
    base,
    base,
    { ...base, names_unresolved: 1 },
    { ...base, job_status: "running" },
    { ...base, has_body: false },
  ];
  const edition = tonightDrafts(
    drafts,
    drafts.map((row) => deskDraftState(row)),
  );
  assert.equal(edition.rows.length, 5);
  assert.equal(edition.readyToPrint, 4);
  assert.equal(edition.readyToCheck, 1);
  assert.equal(edition.rows.length, edition.readyToPrint + edition.readyToCheck);
});
