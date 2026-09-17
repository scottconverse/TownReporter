import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assessCheckedDraftResult,
  assessRefreshedCheckedDraft,
  draftFieldsMatch,
} from "./draft-reconcile-actions.ts";

describe("draft reconciliation editor state", () => {
  const saved = { headline: "Headline", dek: "Dek", body: "Body", topic: "schools" };

  it("recognizes the exact saved fields as safe to replace after a check", () => {
    assert.equal(draftFieldsMatch(saved, { ...saved }), true);
  });

  it("protects typing in every editable draft field", () => {
    for (const key of ["headline", "dek", "body", "topic"] as const) {
      assert.equal(draftFieldsMatch(saved, { ...saved, [key]: `${saved[key]} changed` }), false);
    }
  });

  it("refuses to auto-load a checked result when a newer saved draft exists", () => {
    assert.deepEqual(assessCheckedDraftResult({ resultDraftId: 12, currentDraftId: 13 }), {
      exactResult: true,
      safeToAutoLoad: false,
    });
    assert.deepEqual(assessCheckedDraftResult({ resultDraftId: 13, currentDraftId: 13 }), {
      exactResult: true,
      safeToAutoLoad: true,
    });
  });

  it("requires the refreshed saved draft and unchanged editor before loading the checked version", () => {
    const checked = { headline: "Checked", dek: "New dek", body: "Checked body", topic: "schools" };
    assert.equal(
      assessRefreshedCheckedDraft({
        checkedDraftId: 65,
        refreshedDraftId: 65,
        checked,
        refreshed: checked,
        expected: saved,
        current: saved,
      }),
      "load",
    );
    assert.equal(
      assessRefreshedCheckedDraft({
        checkedDraftId: 65,
        refreshedDraftId: 60,
        checked,
        refreshed: saved,
        expected: saved,
        current: saved,
      }),
      "stale",
    );
    assert.equal(
      assessRefreshedCheckedDraft({
        checkedDraftId: 65,
        refreshedDraftId: 65,
        checked,
        refreshed: checked,
        expected: saved,
        current: checked,
      }),
      "typed",
    );
    assert.equal(
      assessRefreshedCheckedDraft({
        checkedDraftId: 65,
        refreshedDraftId: 65,
        checked,
        refreshed: { ...checked, body: "A later saved edit" },
        expected: saved,
        current: saved,
      }),
      "stale",
    );
  });
});
