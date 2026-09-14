import { createElement, Fragment, type ReactNode } from "react";
import type { DraftReconcileStatus } from "../lib/news/draft-reconcile-actions.ts";

type ReviewFields = { headline: string; dek: string; body: string; topic: string };

export type EvidenceCheckReview = {
  original: ReviewFields;
  checked: ReviewFields;
  integrityNotes: string;
};

const REVIEW_LABELS: Record<keyof ReviewFields, string> = {
  headline: "Headline",
  dek: "Dek",
  body: "Story body",
  topic: "Section",
};

function reviewPanel(
  review: EvidenceCheckReview,
  open: boolean,
  onKeep: () => void,
  onRestore: () => void,
): ReactNode {
  const changed = (Object.keys(REVIEW_LABELS) as (keyof ReviewFields)[]).filter(
    (key) => review.original[key] !== review.checked[key],
  );
  const count = changed.length;
  const rows = changed.map((key) =>
    createElement(
      "section",
      { className: "evidence-check-change", key },
      createElement("h4", null, REVIEW_LABELS[key]),
      createElement(
        "div",
        { className: "evidence-check-compare" },
        createElement(
          "article",
          null,
          createElement("h5", null, "Before check"),
          createElement("pre", null, review.original[key] || "(empty)"),
        ),
        createElement(
          "article",
          null,
          createElement("h5", null, "Checked version"),
          createElement("pre", null, review.checked[key] || "(empty)"),
        ),
      ),
    ),
  );
  return createElement(
    "details",
    { className: "evidence-check-review", open: open || undefined },
    createElement(
      "summary",
      null,
      createElement("strong", null, "Evidence check results"),
      ` · ${count ? `${count} change${count === 1 ? "" : "s"} proposed` : "no wording changes"}`,
    ),
    createElement(
      "div",
      { className: "evidence-check-review-body" },
      createElement(
        "p",
        { className: "meta" },
        count
          ? "Compare the saved version with the evidence-checked version before deciding which text to keep."
          : "The check found no wording changes to propose.",
      ),
      ...rows,
      review.integrityNotes.trim()
        ? createElement(
            "section",
            { className: "evidence-check-findings" },
            createElement("h4", null, "Verify before print"),
            createElement("pre", null, review.integrityNotes.trim()),
          )
        : null,
      createElement(
        "div",
        { className: "evidence-check-decisions" },
        createElement("button", { type: "button", className: "btn", onClick: onKeep }, "Keep checked version"),
        createElement(
          "button",
          { type: "button", className: "btn quiet", onClick: onRestore },
          "Restore previous version",
        ),
      ),
    ),
  );
}

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
  modelLabel?: string;
  review?: EvidenceCheckReview | null;
  reviewOpen?: boolean;
  onStart: () => void;
  onReload: () => void;
  onKeepChecked: () => void;
  onRestoreOriginal: () => void;
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
  if (props.active) {
    const stage =
      props.status?.status === "running"
        ? props.status.stage || "Checking the saved draft against its evidence…"
        : props.status?.status === "queued"
          ? "Evidence check queued…"
          : "Starting the evidence check…";
    children.push(
      createElement(
        "section",
        {
          key: "progress",
          className: "evidence-check-progress",
          role: "status",
          "aria-live": "polite",
        },
        createElement("strong", null, "Checking this draft against its saved evidence"),
        createElement("div", { className: "busy-rule", "aria-hidden": "true" }),
        createElement("p", null, stage),
        props.modelLabel ? createElement("p", { className: "meta" }, `Model: ${props.modelLabel}`) : null,
        createElement(
          "p",
          { className: "meta" },
          "This uses saved web captures and uploaded documents. You can leave this page; progress is saved, and the checked version will open here for comparison.",
        ),
      ),
    );
  }
  if (props.dirty) {
    children.push(
      createElement(
        "span",
        { key: "dirty", className: "note" },
        "Save edits before checking. The check uses only the current saved draft and its captured evidence; it does not restart discovery or initial writing.",
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
  if (props.review) {
    children.push(
      reviewPanel(
        props.review,
        Boolean(props.reviewOpen),
        props.onKeepChecked,
        props.onRestoreOriginal,
      ),
    );
  }
  return createElement(Fragment, null, ...children);
}
