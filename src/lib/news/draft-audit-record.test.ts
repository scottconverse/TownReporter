import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditDraft } from "./draft-audit.ts";
import { repairDraftStyle } from "./draft-audit-repair.ts";
import {
  STYLE_AUDIT_KEY,
  fixFindings,
  parseStyleRecord,
  researchJsonWithStyleAudit,
  reviewFindings,
  styleAuditSummary,
  styleRecordForSavedText,
  styleRecordFromAudit,
  styleRecordFromRepair,
} from "./draft-audit-record.ts";

const audit = (body: string): ReturnType<typeof auditDraft> =>
  auditDraft({ headline: "", dek: "", body, form: "reported" });

const CLEAN = "The council voted on the water fee.\n\nRosa Delgado said the fee is unfair.\n\nThe new rate starts in January.";
const MESSY = "The council voted on the water fee.\n\nExperts say the increase will be felt by renters.\n\nThe rate starts in January.";
const REPAIRED = "The council voted on the water fee.\n\nThe increase will be felt by renters.\n\nThe rate starts in January.";

describe("a record of an audit that ran with no model", () => {
  it("stores the measurements once on both sides, because nothing was rewritten", () => {
    const record = styleRecordFromAudit(audit(CLEAN), "2026-09-26T10:00:00.000Z");
    assert.equal(record.status, "clean");
    assert.equal(record.rounds, 0);
    assert.equal(record.repairCalls, 0);
    assert.equal(record.fixCount, 0);
    assert.deepEqual(record.measurementsAfter, record.measurementsBefore);
    assert.deepEqual(record.rejections, []);
    assert.equal(record.checkedAt, "2026-09-26T10:00:00.000Z");
    assert.match(record.note, /nothing to fix/);
  });

  it("reads as open when the saved draft still has something to fix", () => {
    const record = styleRecordFromAudit(audit(MESSY));
    assert.equal(record.status, "open");
    assert.equal(record.fixCount, 1);
    assert.match(record.note, /no model was asked/);
  });

  it("never claims a timestamp it was not given", () => {
    assert.equal("checkedAt" in styleRecordFromAudit(audit(CLEAN)), false);
  });
});

describe("measuring text the editor saved, with no model", () => {
  /*
    143 words in one paragraph: over the cap for a brief (95) and a reported
    piece (135), under it for an explainer and an investigation (155). The form
    is the only thing that differs between these calls.
  */
  const LONG = Array.from({ length: 11 }, (_, index) => `Witness number ${index} described the flooding on the road that night in detail`).join(" ") + ".";
  const saved = (form: unknown) =>
    styleRecordForSavedText({ headline: "Flooding closes the road", dek: "", body: LONG, form });
  const hasParagraphFinding = (form: unknown) =>
    saved(form).findings.some((finding) => finding.code === "paragraph-length");

  it("lets the form decide the paragraph cap", () => {
    assert.equal(hasParagraphFinding("brief"), true);
    assert.equal(hasParagraphFinding("reported"), true);
    assert.equal(hasParagraphFinding("investigation"), false);
    assert.equal(saved("brief").measurementsBefore.paragraphCap, 95);
    assert.equal(saved("investigation").measurementsBefore.paragraphCap, 155);
  });

  it("falls back to the default cap when the form is empty or is one it does not know", () => {
    assert.equal(saved("").measurementsBefore.paragraphCap, saved("reported").measurementsBefore.paragraphCap);
    assert.equal(saved("newsletter").measurementsBefore.paragraphCap, saved("reported").measurementsBefore.paragraphCap);
    assert.equal(saved(undefined).measurementsBefore.paragraphCap, saved("reported").measurementsBefore.paragraphCap);
  });

  it("claims no timestamp, so the same words saved twice write the same bytes", () => {
    const first = saved("reported");
    assert.equal("checkedAt" in first, false);
    assert.deepEqual(first, saved("reported"));
  });

  it("counts a long paragraph as something to read, and names the form it broke", () => {
    const finding = saved("brief").findings.find((row) => row.code === "paragraph-length");
    assert.equal(finding?.severity, "review");
    assert.match(finding?.message ?? "", /143 words/);
    assert.match(finding?.message ?? "", /brief/);
  });
});

describe("putting the audit into a row's research_json", () => {
  const record = () => styleRecordFromAudit(audit(MESSY), "2026-09-26T12:00:00.000Z");
  const read = (raw: string) => JSON.parse(raw) as Record<string, unknown>;

  it("adds the audit and leaves the keys it does not own alone", () => {
    const raw = JSON.stringify({ nameCheck: { version: 1, rows: [] }, manualClaims: [{ fact: "the fee" }] });
    const merged = read(researchJsonWithStyleAudit(raw, record()));
    assert.deepEqual(merged.nameCheck, { version: 1, rows: [] });
    assert.deepEqual(merged.manualClaims, [{ fact: "the fee" }]);
    assert.equal(parseStyleRecord(merged.styleAudit)?.status, "open");
  });

  it("replaces an earlier audit rather than stacking them up", () => {
    const once = researchJsonWithStyleAudit("{}", styleRecordFromAudit(audit(MESSY)));
    const twice = researchJsonWithStyleAudit(once, styleRecordFromAudit(audit(CLEAN)));
    assert.equal(Object.keys(read(twice)).length, 1);
    assert.equal(parseStyleRecord(read(twice).styleAudit)?.status, "clean");
  });

  it("starts a fresh memo when there is nothing stored, or nothing readable", () => {
    for (const raw of [null, undefined, "", "   ", "{oops", "null", "[]", "7"]) {
      const merged = read(researchJsonWithStyleAudit(raw, record()));
      assert.deepEqual(Object.keys(merged), [STYLE_AUDIT_KEY]);
      assert.equal(parseStyleRecord(merged[STYLE_AUDIT_KEY])?.fixCount, 1);
    }
  });
});

describe("a record of a full repair run", () => {
  it("keeps the audit before and the audit of the text that was kept", async () => {
    const outcome = await repairDraftStyle({
      headline: "",
      dek: "",
      body: MESSY,
      form: "reported",
      repair: async () => ({ ok: true, body: REPAIRED }),
    });
    const record = styleRecordFromRepair(outcome, { checkedAt: "2026-09-26T10:05:00.000Z", requested: true });
    assert.equal(record.status, "repaired");
    assert.equal(record.rounds, 1);
    assert.equal(record.repairCalls, 1);
    assert.equal(record.fixCount, 0);
    assert.equal(record.requested, true);
    assert.equal(record.findings.length, outcome.after.findings.length);
    assert.equal(record.measurementsAfter.sentenceCount, record.measurementsBefore.sentenceCount);
    assert.ok(record.measurementsAfter.wordCount < record.measurementsBefore.wordCount);
  });

  it("keeps the reason a rewrite was refused, so the editor can see why", async () => {
    const outcome = await repairDraftStyle({
      headline: "",
      dek: "",
      body: MESSY,
      form: "reported",
      repair: async () => ({ ok: true, body: MESSY.replace("renters", "landlords") }),
    });
    const record = styleRecordFromRepair(outcome);
    assert.equal(record.status, "open");
    assert.equal(record.rejections.length, 1);
    assert.match(record.rejections[0]?.reason ?? "", /unchanged/);
    assert.equal(record.requested, undefined);
  });
});

describe("reading a record back out of a stored row", () => {
  const stored = () =>
    JSON.stringify(styleRecordFromAudit(audit(MESSY), "2026-09-26T11:00:00.000Z"));

  it("round-trips through JSON", () => {
    const record = parseStyleRecord(stored());
    assert.equal(record?.status, "open");
    assert.equal(record?.fixCount, 1);
    assert.equal(record?.checkedAt, "2026-09-26T11:00:00.000Z");
    assert.equal(record?.findings[0]?.message, parseStyleRecord(stored())?.findings[0]?.message);
    assert.equal(record?.measurementsBefore.paragraphCount, 3);
  });

  it("reads a record that arrives as an object, not a string", () => {
    assert.equal(parseStyleRecord(styleRecordFromAudit(audit(CLEAN)))?.status, "clean");
  });

  it("counts the findings it can read, never the totals the row claims", () => {
    const row = { ...styleRecordFromAudit(audit(MESSY)), fixCount: 99, reviewCount: 42 };
    const record = parseStyleRecord(row);
    assert.equal(record?.fixCount, 1);
    assert.equal(record?.reviewCount, record?.findings.filter((f) => f.severity === "review").length);
  });

  it("answers null for anything it cannot trust", () => {
    assert.equal(parseStyleRecord(null), null);
    assert.equal(parseStyleRecord("not json"), null);
    assert.equal(parseStyleRecord({}), null);
    assert.equal(parseStyleRecord({ ...styleRecordFromAudit(audit(CLEAN)), status: "polished" }), null);
    assert.equal(parseStyleRecord({ ...styleRecordFromAudit(audit(CLEAN)), measurementsAfter: undefined }), null);
    assert.equal(
      parseStyleRecord({ ...styleRecordFromAudit(audit(CLEAN)), findings: [{ severity: "maybe", message: "x" }] }),
      null,
    );
  });

  it("drops a rejection it cannot read rather than inventing a reason", () => {
    const row = { ...styleRecordFromAudit(audit(MESSY)), rejections: [{ round: 1 }, "nonsense", { round: 2, reason: "it changed a number" }] };
    assert.deepEqual(parseStyleRecord(row)?.rejections, [{ round: 2, reason: "it changed a number" }]);
  });
});

describe("what the page and the receipt ask of a record", () => {
  const record = styleRecordFromAudit(
    auditDraft({
      headline: "",
      dek: "",
      body: "Experts say the fee will rise.\n\nThe rate starts in January.\n\nThe council will vote on it again in March and again in April and again in May and once more after that, the manager said.",
      form: "reported",
    }),
  );

  it("splits the findings into the ones to fix and the ones to read", () => {
    assert.equal(fixFindings(record).length, 1);
    assert.ok(fixFindings(record).every((finding) => finding.severity === "fix"));
    assert.ok(reviewFindings(record).every((finding) => finding.severity === "review"));
    assert.equal(fixFindings(record).length + reviewFindings(record).length, record.findings.length);
  });

  it("answers empty lists when there is no record at all", () => {
    assert.deepEqual(fixFindings(null), []);
    assert.deepEqual(reviewFindings(null), []);
  });

  it("reduces to the four numbers the completion receipt carries", () => {
    assert.deepEqual(styleAuditSummary(record), {
      status: "open",
      fixCount: 1,
      reviewCount: record.reviewCount,
      rounds: 0,
    });
  });

  it("names the key the record lives under in research_json", () => {
    assert.equal(STYLE_AUDIT_KEY, "styleAudit");
  });
});
