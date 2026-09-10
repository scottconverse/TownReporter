import { createElement, Fragment, type ReactNode } from "react";
import type { DraftReconcileStatus } from "../lib/news/draft-reconcile-actions.ts";

export function DraftReconcileControl(props: {
  status: DraftReconcileStatus | null | undefined;
  active: boolean;
  disabled: boolean;
  dirty: boolean;
  note: string;
  noteError: boolean;
  noteWarning?: boolean;
  checkedDraftReady: boolean;
  checkedDraftStale?: boolean;
  onStart: () => void;
  onReload: () => void;
}) {
  const children: ReactNode[] = [
    createElement(
      "button",
      {
        key: "start",
        type: "button",
        className: "btn",
        disabled: props.disabled,
        onClick: props.onStart,
      },
      props.active ? "Checking evidence…" : "Check draft against evidence",
    ),
  ];
  if (props.dirty) {
    children.push(
      createElement(
        "span",
        { key: "dirty", className: "note" },
        "Save edits before checking. The check uses only the current saved draft and its captured evidence; it does not restart discovery or initial writing.",
      ),
    );
  }
  if (props.status?.status === "queued") {
    children.push(
      createElement(
        "p",
        { key: "queued", className: "busy", role: "status" },
        "Evidence check queued…",
      ),
    );
  }
  if (props.status?.status === "running") {
    children.push(
      createElement(
        "p",
        { key: "running", className: "busy", role: "status" },
        props.status.stage || "Checking the saved draft against its evidence…",
      ),
    );
  }
  if (props.status?.status === "failed") {
    children.push(
      createElement(
        "p",
        { key: "failed", className: "notice notice-err", role: "alert" },
        props.status.error || "The evidence check did not finish.",
      ),
    );
  }
  if (props.status?.status === "completed" && !props.note) {
    children.push(
      createElement(
        "p",
        {
          key: "completed",
          className: `notice notice-${props.status.evidenceCheckIncomplete ? "warn" : "ok"}`,
          role: "status",
        },
        props.status.evidenceCheckIncomplete
          ? "Evidence check finished, but no matching saved capture was available. The draft remains marked for review."
          : "Evidence check finished.",
      ),
    );
  }
  if (props.note) {
    children.push(
      createElement(
        "p",
        {
          key: "note",
          className: `notice notice-${props.noteError ? "err" : props.noteWarning ? "warn" : "ok"}`,
          role: props.noteError ? "alert" : "status",
        },
        props.note,
        props.checkedDraftReady
          ? createElement(
              "button",
              { type: "button", className: "btn quiet small", onClick: props.onReload },
              props.checkedDraftStale ? "Load checked version for review" : "Reload checked draft",
            )
          : null,
      ),
    );
  }
  return createElement(Fragment, null, ...children);
}
