import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DraftReconcileControl } from "./draft-reconcile-control.ts";

const base = {
  status: null,
  active: false,
  disabled: false,
  dirty: false,
  note: "",
  noteError: false,
  checkedDraftReady: false,
  onKeepChecked: () => undefined,
  onRestoreOriginal: () => undefined,
  onStart: () => undefined,
  onReload: () => undefined,
};

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(DraftReconcileControl, { ...base, ...props }));

describe("DraftReconcileControl", () => {
  it("requires dirty edits to be saved and explains the bounded operation", () => {
    const html = render({ dirty: true, disabled: true });
    assert.match(html, /Save edits before checking/);
    assert.match(html, /does not restart discovery or initial writing/);
    assert.match(html, /<button[^>]*disabled/);
  });

  it("renders queued, running, failed, completed, and explicit reload states", () => {
    const status = (state: string, stage = "", error: string | null = null) => ({
      jobId: 1,
      draftId: 2,
      status: state,
      stage,
      error,
      modelChoice: "codex-balanced",
      resultDraftId: state === "completed" ? 3 : null,
      evidenceCheckIncomplete: false,
    });
    assert.match(
      render({ active: true, status: status("queued", "Queued") }),
      /Evidence check queued/,
    );
    assert.match(
      render({ active: true, status: status("running", "Checking citations") }),
      /Checking citations/,
    );
    assert.match(
      render({ status: status("failed", "Failed", "Saved evidence changed.") }),
      /Saved evidence changed/,
    );
    assert.match(render({ status: status("completed", "Done") }), /Evidence check finished/);
    assert.match(
      render({ status: { ...status("completed", "Done"), evidenceCheckIncomplete: true } }),
      /no matching saved capture/,
    );
    const completed = render({
      note: "Evidence check finished. Unsaved edits were kept.",
      checkedDraftReady: true,
    });
    assert.match(completed, /Unsaved edits were kept/);
    assert.match(completed, /Reload checked draft/);
    assert.match(
      render({
        note: "A newer saved draft exists.",
        checkedDraftReady: true,
        checkedDraftStale: true,
      }),
      /Load checked version for review/,
    );
    assert.match(render({ note: "Could not queue.", noteError: true }), /notice-err/);
  });

  it("shows a persistent, descriptive progress panel while the check is running", () => {
    const html = render({
      active: true,
      modelLabel: "Local model · halo-brain-35b",
      status: {
        jobId: 9,
        draftId: 2,
        status: "running",
        stage: "Checking names and spellings",
        error: null,
        modelChoice: "local-model",
        resultDraftId: null,
        evidenceCheckIncomplete: false,
      },
    });
    assert.match(html, /evidence-check-progress/);
    assert.match(html, /Checking names and spellings/);
    assert.match(html, /Local model · halo-brain-35b/);
    assert.match(html, /You can leave this page/);
    assert.match(html, /open here for comparison/);
  });

  it("shows the saved before-and-after result and unresolved checks", () => {
    const html = render({
      reviewOpen: true,
      review: {
        original: {
          headline: "Original headline",
          dek: "Original dek",
          body: "The unsupported sentence stayed.",
          topic: "council",
        },
        checked: {
          headline: "Checked headline",
          dek: "Original dek",
          body: "The supported sentence stayed.",
          topic: "council",
        },
        integrityNotes: "Confirm the final vote count before publishing.",
      },
    });
    assert.match(html, /Evidence check results/);
    assert.match(html, /2 changes proposed/);
    assert.match(html, /Before check/);
    assert.match(html, /Checked version/);
    assert.match(html, /Original headline/);
    assert.match(html, /Checked headline/);
    assert.match(html, /Verify before print/);
    assert.match(html, /Confirm the final vote count/);
    assert.match(html, /Keep checked version/);
    assert.match(html, /Restore previous version/);
  });
});
