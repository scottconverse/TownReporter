import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  ClaimEvidenceRow,
  FindingCaptureEvidence,
  FindingEvidenceRow,
  FindingJudgment,
  ManualClaimEvidenceRow,
} from "./finding-evidence-review.ts";
import type { NameCheck } from "./name-check.ts";
import {
  captureIsReadable,
  citedCaptureCount,
  evidenceCheckRows,
  evidenceDetailId,
  evidenceRanLine,
  judgmentChip,
  openRecordAction,
  STYLE_ROW_KEY,
} from "./evidence-check-list.ts";

/**
 * The Checks tab's drawn list, one test per thing the list has to get right
 * (unit CW, 0.6.81).
 *
 * The point of these is not the strings. It is that the chip an editor reads
 * is a function of the judgment the desk recorded and nothing else, that a
 * row's press only exists when there is something behind it, and that the
 * drawn line never claims a number or a model the desk did not record. The
 * four drawn things with nothing behind them are listed in
 * `design/SPEC-GAPS-0681.md` under CW.
 */

function capture(patch: Partial<FindingCaptureEvidence> = {}): FindingCaptureEvidence {
  return {
    versionId: 1,
    captureEventId: 1,
    url: "https://example.gov/agenda",
    title: "Agenda packet, Oct. 1",
    capturedAt: "2026-10-01T14:14:00.000Z",
    available: true,
    readable: true,
    /* Unit U11b: an ordinary capture; a taken-down one is not readable. */
    takenDown: false,
    excerptState: "found",
    newerCapture: null,
    viewHref: "/evidence/1",
    ...patch,
  };
}

function finding(
  patch: Partial<FindingEvidenceRow> & { judgment?: FindingJudgment } = {},
): FindingEvidenceRow {
  const { judgment = "supports", ...rest } = patch;
  return {
    key: "f1",
    finding: {
      text: "The council meets Oct. 1 and Oct. 8 at 6 p.m.",
      sourceUrls: ["https://example.gov/agenda"],
      locators: [],
      excerpt: null,
    },
    captures: [capture()],
    judgment: { value: judgment, reason: "", contraryVersionId: null },
    ...rest,
  };
}

function claimRow(patch: Partial<ClaimEvidenceRow> = {}): ClaimEvidenceRow {
  return {
    key: "c1",
    claim: { fact: "The city cancelled the Oct. 8 meeting.", url: "https://example.gov", kind: "primary" },
    captures: [capture()],
    judgment: { value: "supports", reason: "", contraryVersionId: null },
    ...patch,
  };
}

function manualRow(patch: Partial<ManualClaimEvidenceRow> = {}): ManualClaimEvidenceRow {
  return {
    key: "m1",
    claim: { id: "m1", fact: "The grant is $2.6 million.", kind: "record" },
    captures: [{ ...capture(), relation: "corroborating" }],
    judgment: { value: "supports", reason: "", contraryVersionId: null },
    ...patch,
  };
}

function base(over: Partial<Parameters<typeof evidenceCheckRows>[0]> = {}) {
  return evidenceCheckRows({
    rows: [],
    claimRows: [],
    manualClaimRows: [],
    openClaims: [],
    nameCheck: null,
    styleFindings: [],
    ...over,
  });
}

describe("judgmentChip", () => {
  it("gives every recorded judgment its own drawn chip", () => {
    assert.deepEqual(judgmentChip("supports", [capture()]), { chip: "✓ Supported", tone: "ok" });
    assert.deepEqual(judgmentChip("does-not-support", [capture()]), {
      chip: "Checked · not found",
      tone: "ink",
    });
    assert.deepEqual(judgmentChip("needs-reporting", [capture()]), {
      chip: "Could not check",
      tone: "fail",
    });
    assert.deepEqual(judgmentChip("contradicts", [capture()]), {
      chip: "! Needs review",
      tone: "warn",
    });
  });

  /*
    "Checked, nothing changed" and "could not check" must not look alike
    (DECISIONS.md), and they must not say alike either: `does-not-support` is
    the check's answer and `needs-reporting` is the check giving up. The tones
    differ -- solid ink against a dashed danger outline -- so the difference is
    a shape as well as a color.
  */
  it("keeps the check that found nothing apart from the check that could not run", () => {
    const found = judgmentChip("does-not-support", [capture()]);
    const gaveUp = judgmentChip("needs-reporting", [capture()]);
    assert.notEqual(found.chip, gaveUp.chip);
    assert.notEqual(found.tone, gaveUp.tone);
  });

  /*
    An unreviewed row has no judgment, so the chip has to be read off the
    captures instead: something readable means a person or the desk still has
    to look at it; nothing readable means there was nothing to look at.
  */
  it("sends an unreviewed row to a person only when a record could be read", () => {
    assert.deepEqual(judgmentChip("unreviewed", [capture()]), {
      chip: "! Needs review",
      tone: "warn",
    });
    assert.deepEqual(judgmentChip("unreviewed", [capture({ readable: false })]), {
      chip: "Could not check",
      tone: "fail",
    });
    assert.deepEqual(judgmentChip("unreviewed", []), { chip: "Could not check", tone: "fail" });
  });
});

describe("captureIsReadable", () => {
  it("needs both the capture and its text", () => {
    assert.equal(captureIsReadable(capture()), true);
    assert.equal(captureIsReadable(capture({ readable: false })), false);
    assert.equal(captureIsReadable(capture({ available: false })), false);
  });
});

describe("openRecordAction", () => {
  it("presses through to the captured version the desk reviewed", () => {
    assert.deepEqual(openRecordAction([capture({ viewHref: "/evidence/9" })]), {
      kind: "open-record",
      label: "Open record",
      href: "/evidence/9",
    });
  });

  /*
    No captured version means no press. A drawn "Open record" pointing at
    nothing would be worse than the missing press: the editor would press it
    and land on nothing, which is the dead end this screen exists to end.
  */
  it("offers no press when no version can be opened", () => {
    assert.equal(openRecordAction([]), null);
    assert.equal(openRecordAction([capture({ viewHref: null })]), null);
  });
});

describe("evidenceRanLine", () => {
  /* Unit U24: the line is a reading of the shared state, so every case below
     says what a check that RAN looks like. The state's own cases -- a line for
     a draft nothing ran on -- are in `evidence-check-state.test.ts`. */
  const RAN = { ran: true, toReview: 0, contradicted: 0 } as const;

  it("writes the drawn line from the record, in the drawn order", () => {
    assert.equal(
      evidenceRanLine({
        state: RAN,
        checkedAt: "2026-10-01T14:14:00.000Z",
        modelLabel: "Claude Sonnet",
        captures: 3,
      }),
      "Ran 8:14 a.m. · Claude Sonnet · checked against 3 captures",
    );
  });

  it("says capture, not captures, for one", () => {
    assert.equal(
      evidenceRanLine({ state: RAN, checkedAt: null, modelLabel: "", captures: 1 }),
      "checked against 1 capture",
    );
  });

  /*
    The model is only known when a reconcile job is on the books for this lead.
    Dropping the piece leaves "Ran 8:14 a.m. · checked against 3 captures",
    which is true; printing an empty separator or a guess is not.
  */
  it("drops a piece it does not have instead of printing a separator", () => {
    assert.equal(
      evidenceRanLine({
        state: RAN,
        checkedAt: "2026-10-01T14:14:00.000Z",
        modelLabel: "",
        captures: 3,
      }),
      "Ran 8:14 a.m. · checked against 3 captures",
    );
    assert.equal(
      evidenceRanLine({ state: RAN, checkedAt: null, modelLabel: "Claude Sonnet", captures: 0 }),
      "Claude Sonnet",
    );
  });

  it("is empty when the desk recorded none of it, never 'Ran · · '", () => {
    assert.equal(
      evidenceRanLine({ state: RAN, checkedAt: null, modelLabel: "", captures: 0 }),
      "",
    );
    assert.equal(
      evidenceRanLine({ state: RAN, checkedAt: "not a date", modelLabel: "  ", captures: 0 }),
      "",
    );
  });

  /*
    UNIT U24 -- THE LINE AND THE BAR READ ONE STATE.

    This is the case that was wrong on the stand-in editorial day: the check had
    run (two captures cited, seven claims raised) and the bar above the pane
    said "No evidence check ran on this draft". The line now asks the shared
    state first, so a state that says no run produces no line at all -- and a
    state with claims waiting says how many, in the same words the publish
    blocker prints.
  */
  it("says nothing when the shared state says no check ran, whatever the captures", () => {
    assert.equal(
      evidenceRanLine({
        state: { ran: false, toReview: 0, contradicted: 0 },
        checkedAt: null,
        modelLabel: "",
        captures: 2,
      }),
      "",
    );
  });

  it("counts the claims waiting on a person, the count the blocker prints", () => {
    assert.equal(
      evidenceRanLine({
        state: { ran: true, toReview: 7, contradicted: 0 },
        checkedAt: null,
        modelLabel: "",
        captures: 2,
      }),
      "checked against 2 captures · 7 claims need review",
    );
    assert.equal(
      evidenceRanLine({
        state: { ran: true, toReview: 1, contradicted: 0 },
        checkedAt: null,
        modelLabel: "",
        captures: 0,
      }),
      "1 claim needs review",
    );
  });
});

describe("citedCaptureCount", () => {
  it("counts distinct captured records, not rows and not citations", () => {
    const one = capture({ versionId: 7 });
    assert.equal(
      citedCaptureCount(
        [finding({ captures: [one] }), finding({ key: "f2", captures: [one] })],
        [claimRow({ captures: [one, capture({ versionId: 8 })] })],
        [manualRow()],
      ),
      3,
    );
  });

  it("does not count a capture with no version to open", () => {
    assert.equal(citedCaptureCount([finding({ captures: [capture({ versionId: null })] })], [], []), 0);
  });
});

describe("evidenceCheckRows", () => {
  it("puts the rows in the drawn order, each with its chip", () => {
    const rows = evidenceCheckRows({
      rows: [finding()],
      claimRows: [claimRow({ judgment: { value: "does-not-support", reason: "", contraryVersionId: null } })],
      manualClaimRows: [manualRow({ judgment: { value: "needs-reporting", reason: "", contraryVersionId: null } })],
      openClaims: [{ t: "The city site does not list the meeting.", done: false, src: "gate", q: "site:example.gov meeting" }],
      nameCheck: null,
      styleFindings: [],
    });
    assert.deepEqual(
      rows.map((row) => row.key),
      ["finding:f1", "claim:c1", "manual:m1", "absence:The city site does not list the meeting."],
    );
    assert.deepEqual(
      rows.map((row) => row.chip),
      ["✓ Supported", "Checked · not found", "Could not check", "! Needs review"],
    );
  });

  /*
    A claim of absence is not a claim that failed a check -- it is one the desk
    refuses to print until a person confirms it. Its note is what the gate
    searched, which is the same line the Reporting tab shows.
  */
  it("shows what the gate searched behind a claim of absence", () => {
    const [row] = base({
      openClaims: [{ t: "No launch release exists.", done: false, src: "gate", q: "site:example.gov launch" }],
    });
    assert.equal(row!.note, "The gate searched: site:example.gov launch");
    assert.equal(row!.action, null);
  });

  it("says so, without inventing a search, when the gate recorded none", () => {
    const [row] = base({ openClaims: [{ t: "No launch release exists.", done: false, src: "gate" }] });
    assert.equal(row!.note, "Confirmation is still outstanding.");
  });

  it("falls back from an excerpt to a locator to the record itself", () => {
    assert.equal(
      base({ rows: [finding({ finding: { ...finding().finding, excerpt: "  the packet says  " } })] })[0]!.note,
      "the packet says",
    );
    assert.equal(
      base({ rows: [finding({ finding: { ...finding().finding, locators: ["p. 4", "item 7"] } })] })[0]!.note,
      "p. 4 · item 7",
    );
    assert.equal(base({ rows: [finding()] })[0]!.note, "Agenda packet, Oct. 1");
  });

  /*
    The captured version exists and its text could not be read: the editor is
    told that, and is still handed the record -- `viewHref` is null only when
    there is no version to open at all, and a record nobody could read is
    exactly the one worth opening by hand.
  */
  it("tells the editor when the cited record could not be read, and opens it", () => {
    const [row] = base({ rows: [finding({ captures: [capture({ readable: false })] })] });
    assert.equal(row!.note, "The cited record could not be read.");
    assert.deepEqual(row!.action, { kind: "open-record", label: "Open record", href: "/evidence/1" });
  });

  it("gives no press when the cited version is gone", () => {
    const [row] = base({
      rows: [finding({ captures: [capture({ available: false, viewHref: null })] })],
    });
    assert.equal(row!.action, null);
  });

  it("gives a claim cited against nothing no press and no invented record", () => {
    const [row] = base({ claimRows: [claimRow({ captures: [] })] });
    assert.equal(row!.note, "No captured record was cited for this claim.");
    assert.equal(row!.action, null);
  });

  /*
    The name row carries the drawn "Name: X" only when one is outstanding; a
    settled check reports the count instead, because a row that named every
    matched name would be a paragraph.
  */
  it("gives the name check one row, and only says review when one is outstanding", () => {
    const check: NameCheck = {
      version: 1,
      checkedAt: "2026-10-01T14:14:00.000Z",
      checkedText: "x",
      complete: false,
      note: "",
      rows: [
        { name: "Housing and Human Services Advisory Board", role: "body", status: "unresolved", spelling: "", reason: "no written source", url: "", excerpt: "", captureId: null },
        { name: "Rosa Delgado", role: "person", status: "matched", spelling: "Rosa Delgado", reason: "", url: "https://example.gov", excerpt: "Rosa Delgado", captureId: 1 },
      ],
    };
    const [pending] = base({ nameCheck: check });
    assert.equal(pending!.key, "names");
    assert.equal(pending!.chip, "! Needs review");
    assert.equal(pending!.what, "Name: Housing and Human Services Advisory Board");
    assert.match(pending!.note, /no written source/);
    // Nothing in this app confirms a spelling; the row carries no press.
    assert.equal(pending!.action, null);

    const settled = base({
      nameCheck: { ...check, complete: true, note: "Every name matched.", rows: [check.rows[1]!] },
    });
    assert.equal(settled[0]!.chip, "✓ Reviewed");
    assert.equal(settled[0]!.what, "Names: 1 checked against the record");
    assert.equal(settled[0]!.note, "Every name matched.");
  });

  it("leaves the name row out when no check was recorded", () => {
    assert.equal(base({ nameCheck: null }).length, 0);
  });

  /*
    The style row is the measurement the Style check section already acts on,
    and its press is that section's own repair button -- so the row carries the
    first finding's own sentence, never a rewrite of it.
  */
  it("carries the style count, the first finding, and the way to the work", () => {
    const rows = base({
      styleFindings: [
        { severity: "fix", code: "long-sentence", paragraph: 0, sentence: 0, message: "This sentence runs 41 words.", snippet: "" },
        { severity: "review", code: "passive", paragraph: 1, sentence: 0, message: "Passive voice.", snippet: "" },
      ],
    });
    assert.equal(rows[0]!.key, "style");
    assert.equal(rows[0]!.chip, "! Style: 2 issues");
    assert.equal(rows[0]!.what, "Style check (measured in code)");
    assert.equal(rows[0]!.note, "This sentence runs 41 words.");
    assert.deepEqual(rows[0]!.action, { kind: "style", label: "Fix these with the model" });
  });

  /*
    Unit CW2. The style row opens, because the section its press reaches is that
    row's disclosure body now -- the section is not drawn anywhere else on the
    page. Its ref is the one id a press outside the list has to name, and the
    row's key and the id must not drift apart: the press opens
    `evidenceDetailId(STYLE_ROW_KEY)` and nothing else.
  */
  it("gives the style row the ref that opens the page's own Style check section", () => {
    const rows = base({
      styleFindings: [
        { severity: "fix", code: "long-sentence", paragraph: 0, sentence: 0, message: "One.", snippet: "" },
      ],
    });
    assert.deepEqual(rows[0]!.ref, { kind: "style", id: STYLE_ROW_KEY });
    assert.equal(evidenceDetailId(rows[0]!.key), "evidence-detail-style");
  });

  it("says issue, not issues, for one", () => {
    const rows = base({
      styleFindings: [
        { severity: "fix", code: "long-sentence", paragraph: 0, sentence: 0, message: "One.", snippet: "" },
      ],
    });
    assert.equal(rows[0]!.chip, "! Style: 1 issue");
  });

  it("leaves the style row out when the audit finds nothing", () => {
    assert.equal(base({ styleFindings: [] }).length, 0);
  });

  /*
    A draft with claims but no name check and no style findings still gets its
    rows: the list is the claims first, and the two trailing rows are the
    drawing's, not the report's.
  */
  it("is the claims alone when there is no name check and nothing to style", () => {
    const rows = base({ claimRows: [claimRow()] });
    assert.deepEqual(rows.map((row) => row.key), ["claim:c1"]);
    assert.deepEqual(rows[0]!.action, { kind: "open-record", label: "Open record", href: "/evidence/1" });
  });

  it("gives a recorded claim the drawn press when a version can be opened", () => {
    const [row] = base({ rows: [finding()] });
    assert.deepEqual(row!.action, { kind: "open-record", label: "Open record", href: "/evidence/1" });
  });

  it("keeps every row's sentence on the row, never blank", () => {
    const [row] = base({ rows: [finding({ finding: { ...finding().finding, text: "   " } })] });
    assert.equal(row!.what, "A finding recorded for this draft.");
  });
});

it("labels a support or contradiction based on the editor’s knowledge as having no capture", () => {
  for (const judgment of ["supports", "contradicts"] as const) {
    assert.deepEqual(judgmentChip(judgment, [], true), {chip: "editor's judgment, no capture", tone: "ink"});
  }
});
