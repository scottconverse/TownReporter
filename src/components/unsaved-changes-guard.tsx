import { useCallback, useRef } from "react";
import { useBlocker } from "@tanstack/react-router";
import { InkButton } from "./desk-chrome";

/*
  THE STICKY BAR AND THE LEAVE-PAGE PROMPT (0.6.63, Unit W).

  Lifted out of sections-setup.tsx when the Named outlets panel needed the same
  two pieces, because the brief for that panel asks for the Sections panel's
  unsaved-changes protection as the same component and not as a copy. The
  reason is in the details rather than the markup, and each one is a bug a
  second copy would eventually have:

  * the draft flag lives in a ref read by a `useCallback` with no deps. The
    blocker re-registers its history hook whenever `shouldBlockFn` changes
    identity, so a function that closed over the draft would re-register on
    every keystroke.

  * `enableBeforeUnload` is armed separately, because an in-app route blocker
    cannot see a reload, a closed tab or a URL typed into the address bar.

  * the bar is mounted even with no draft, collapsing to `sr-only` and holding
    no text. Text inserted into a live region is announced; a live region
    inserted with its text is not -- so the `role="status"` paragraph has to
    already be there when the draft arrives.

  Both callers keep their own words: the bar's accessible name, the message it
  announces, and the two buttons' labels are props, so the walked locators on
  the Sections panel ("Section changes not saved", "Review changes, from the
  unsaved changes bar") are unchanged by this refactor.
*/

export type UnsavedPrimary = {
  label: string;
  /** The accessible name, which is also what the walkers click by. */
  ariaLabel: string;
  tone?: "solid" | "danger";
  onClick: () => void;
};

export function UnsavedChangesGuard({
  unsaved,
  barLabel,
  message,
  leaveLabel,
  primary,
  cancelLabel,
  cancelAriaLabel,
  onCancel,
  busy = false,
}: {
  /** True while a draft exists. The only thing either panel has to keep in sync. */
  unsaved: boolean;
  /** The bar's accessible name when a draft exists. */
  barLabel: string;
  /** The live message, announced while a draft exists. */
  message: string;
  /** The leave prompt's accessible name. */
  leaveLabel: string;
  /** The bar's main action: "Review changes" or "Confirm and apply". */
  primary: UnsavedPrimary;
  cancelLabel: string;
  cancelAriaLabel: string;
  onCancel: () => void;
  busy?: boolean;
}) {
  const unsavedRef = useRef(false);
  unsavedRef.current = unsaved;
  const hasUnsavedDraft = useCallback(() => unsavedRef.current, []);
  const blocker = useBlocker({
    shouldBlockFn: hasUnsavedDraft,
    enableBeforeUnload: hasUnsavedDraft,
    withResolver: true,
  });

  return (
    <>
      {/*
        `astra-unsaved-bar` is not decoration: the bar is fixed to the viewport
        but must sit in the content column, and only CSS knows how wide the
        desk's nav is at each breakpoint. See `.astra-unsaved-bar` (and
        `--desk-nav-w`) in src/desk-astra.css.
      */}
      <div
        aria-label={unsaved ? barLabel : undefined}
        className={
          unsaved
            ? "astra-unsaved-bar fixed bottom-0 z-30 border-t-2 border-rule bg-paper px-3 py-3"
            : "sr-only"
        }
      >
        <div
          className={
            unsaved ? "mx-auto flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-2" : undefined
          }
        >
          <p role="status" className={unsaved ? "text-sm font-semibold" : undefined}>
            {unsaved ? message : ""}
          </p>
          {unsaved ? (
            <>
              <InkButton
                tone={primary.tone ?? "solid"}
                small
                ariaLabel={primary.ariaLabel}
                disabled={busy}
                onClick={primary.onClick}
              >
                {primary.label}
              </InkButton>
              <InkButton
                tone="ghost"
                small
                ariaLabel={cancelAriaLabel}
                disabled={busy}
                onClick={onCancel}
              >
                {cancelLabel}
              </InkButton>
            </>
          ) : null}
        </div>
      </div>
      {blocker.status === "blocked" ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={leaveLabel}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="max-w-md border-2 border-rule bg-paper p-5 text-sm">
            <h4 className="font-display text-xl">{message}</h4>
            <p className="mt-2">
              Leaving now discards the draft. Review and confirm first if you want to keep it.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <InkButton tone="solid" onClick={() => blocker.proceed()}>
                Leave and discard changes
              </InkButton>
              <InkButton tone="ghost" onClick={() => blocker.reset()}>
                Stay on this page
              </InkButton>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
