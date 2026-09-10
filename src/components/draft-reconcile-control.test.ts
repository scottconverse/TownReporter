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
});
