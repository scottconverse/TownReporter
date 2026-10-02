import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { InkButton } from "./desk-chrome";

/**
 * The one dialog, and the one card that goes inside it.
 *
 * This is the redesign's `design-system/components/desk/Dialog.jsx`, rebuilt
 * on Radix rather than hand-rolled. The reference component is a plain div
 * that listens for Escape and paints a backdrop; it cannot trap focus, cannot
 * lock the page behind it, and cannot give focus back to the control that
 * opened it -- and `Dialog.prompt.md` says exactly that ("In production, build
 * on Radix Dialog (focus trap, scroll lock, focus return) with this styling").
 * So the look below is the reference's, to the pixel; the behavior is Radix's.
 *
 * **Nothing uses this yet.** Phase 0 puts it here so that phase 2 has one
 * target when the desk's existing dialogs (the native `<dialog class="astra-
 * dialog">` on /desk/ops and the story screen, and the hand-rolled
 * `role="alertdialog"` in unsaved-changes-guard.tsx) move onto it. Migrating
 * those is deliberately not part of this change.
 *
 * Why the portal wrapper carries `desk-ltr astra-modal-layer`:
 *
 *   Radix renders into `document.body`, which is outside the desk shell
 *   (`.desk-ltr.astra`) and outside every palette it declares. A dialog that
 *   inherited nothing would render black-on-white in dark mode on the one
 *   surface the editor uses late at night. `desk-ltr` re-establishes the desk
 *   scope: the whole token block in styles.css from `--bg` down to `--ok` /
 *   `--warn` / `--danger`, and the unlayered `.desk-ltr .btn` / `.desk-ltr
 *   .chip` families. The dark palette is re-declared for this one layer,
 *   following the same precedent as the pending/error screens
 *   (`.screen-page` in styles.css), because a portal cannot inherit it.
 *
 *   It is deliberately NOT `astra`: the astra button rules are scoped
 *   `.desk-ltr.astra`, and the dialog footer is made of `InkButton`, whose
 *   classes are the ones styles.css declares. Keeping the portal out of the
 *   astra scope is what makes the footer buttons the same buttons as the rest
 *   of the desk instead of the astra screen's own family.
 *
 * Every prop of the design reference (`Dialog.d.ts`) is kept, with the same
 * meaning. The additions are `primaryDisabled` / `altDisabled`, for a confirm
 * step that is not allowed to proceed yet, and `cancelLabel` / `closeLabel`,
 * the two strings a caller may need to reword.
 */
export type DialogProps = {
  open: boolean;
  /** Called by Escape, by the close button, by Cancel, and by a click outside. */
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  footNote?: React.ReactNode;
  primaryLabel: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  /** The optional second action between Cancel and the primary one. */
  altLabel?: string;
  onAlt?: () => void;
  altDisabled?: boolean;
  cancelLabel?: string;
  closeLabel?: string;
  /**
   * Unit BH2, added for Legal removal: the design draws "Remove permanently" as
   * a red button, and the footer's primary was hard-coded `solid`. This is
   * additive -- every existing caller keeps the tone it had -- because the
   * alternative was to render the danger press inside the body, which puts the
   * one irreversible control somewhere other than where the design puts it.
   *
   * The two danger tones are InkButton's own: `danger` is the solid fill a
   * confirm step gets, `quiet-danger` is the outline a real action heading
   * toward removal gets. The drawing of dialog-15 is the outline -- a 2px red
   * rule and red text, no fill -- which is also what keeps it legible beside
   * the Cancel button instead of turning the footer into two blocks of color.
   */
  primaryTone?: "solid" | "danger" | "quiet-danger";
  /**
   * Unit UI1a2: this dialog's press is in flight.
   *
   * The dialog foot had a disabled half and no spoken half: pressing "Kill with
   * this reason" or "Hold with this reason" greyed the button and left it
   * wearing the same word, so the one thing the editor could see was that
   * something had stopped working. `pending` with a label draws the word the
   * press is actually doing ("Killing…", "Holding…"), which is the FB5 shape
   * `InkButton` already had and no dialog was using.
   *
   * Optional and additive on purpose: a dialog that passes neither gets exactly
   * the foot it has today, byte for byte.
   */
  pending?: boolean;
  /** The word the PRIMARY press draws while pending. */
  primaryPendingLabel?: string;
  /** The word the ALT press draws while pending. */
  altPendingLabel?: string;
};

export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  children,
  footNote,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  altLabel,
  onAlt,
  altDisabled,
  cancelLabel = "Cancel",
  closeLabel = "Close",
  primaryTone = "solid",
  pending = false,
  primaryPendingLabel,
  altPendingLabel,
}: DialogProps) {
  // Radix hands focus back through `DialogPrimitive.Trigger`: its close handler
  // focuses `context.triggerRef`, which only a rendered Trigger ever sets. This
  // component renders no Trigger -- callers open it from a flag, off a button
  // that lives somewhere else on the page -- so Radix's focus return has
  // nothing to focus and closing dropped the keyboard user on `<body>`.
  // (Measured against the running app, not assumed: the walk in
  // scripts/astra-dialog-e2e.mjs came back with `""`, meaning a focus on body.)
  //
  // So this remembers and restores that element itself, at Radix's two focus
  // hooks, which are the only two moments that are not a race:
  //
  //   onOpenAutoFocus  fires inside the FocusScope as it is about to move focus
  //                    into the dialog, while `document.activeElement` is still
  //                    the control that opened it. Recording it *here* is what
  //                    makes this reliable; a `focusin` listener subscribed
  //                    while the dialog is closed loses the race when a caller
  //                    mounts the component and focuses the opener in the same
  //                    tick (measured: it recorded nothing about half the time).
  //   onCloseAutoFocus fires inside the FocusScope's unmount teardown, i.e.
  //                    after the content is gone and in the same dispatch as
  //                    Radix's own handler -- so nothing focuses behind us.
  //                    Radix's handler still runs after ours (composed, not
  //                    replaced) and its `preventDefault` is what stops the
  //                    FocusScope from falling back to `document.body`.
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        // Escape, the scrim and the close button all arrive here; the component
        // stays controlled, so the only thing to do is report the close.
        if (!next) onClose();
      }}
    >
      {/*
        Unit BH2: the Portal is rendered only while the dialog can be open.

        Radix's own DialogPortal already gates its children on `open` through
        Presence, but that is an internal detail of the installed Radix version,
        and this subtree is now reached by server code that has no DOM
        (`renderToStaticMarkup`) and by tests that pin the markup it produces.
        Gating here makes the whole subtree a pure function of `open` -- and it
        is the whole subtree that matters, because the
        `.desk-ltr.astra-modal-layer` wrapper below is a fixed, full-viewport
        layer: outside the Portal's own gating, a closed dialog would still have
        painted one. No exit animation is defined for `.astra-modal`, so nothing
        that used to be visible on the way out is lost.
      */}
      {open ? (
      <DialogPrimitive.Portal>
        <div className="desk-ltr astra-modal-layer">
          {/* The scrim: one scrim, painted here, and the click-outside target
              Radix uses to dismiss. The wrapper is only the scroll container,
              so a tall dialog scrolls instead of overflowing the viewport. */}
          <DialogPrimitive.Overlay className="astra-modal-scrim" />
          <DialogPrimitive.Content
            className="astra-modal"
            onOpenAutoFocus={() => {
              const opener = document.activeElement;
              returnFocusRef.current =
                opener instanceof HTMLElement &&
                opener !== document.body &&
                !opener.closest(".astra-modal-layer")
                  ? opener
                  : null;
            }}
            onCloseAutoFocus={() => {
              const target = returnFocusRef.current;
              returnFocusRef.current = null;
              if (target?.isConnected) target.focus();
            }}
          >
            <div className="astra-modal-head">
              <div>
                <DialogPrimitive.Title className="astra-modal-title">{title}</DialogPrimitive.Title>
                {subtitle ? (
                  <DialogPrimitive.Description className="astra-modal-sub">
                    {subtitle}
                  </DialogPrimitive.Description>
                ) : null}
              </div>
              <InkButton tone="quiet" onClick={onClose} ariaLabel={closeLabel}>
                <span aria-hidden="true">✕</span>
              </InkButton>
            </div>
            <div className="astra-modal-body">{children}</div>
            <div className="astra-modal-foot">
              {footNote ? <span className="astra-modal-note">{footNote}</span> : null}
              <div className="astra-modal-actions">
                <InkButton tone="quiet" onClick={onClose}>
                  {cancelLabel}
                </InkButton>
                {altLabel ? (
                  <InkButton
                    tone="ghost"
                    onClick={onAlt}
                    disabled={altDisabled}
                    /* Unit UI1a2: a dialog whose press takes time says so at the
                       button it was pressed -- see `pendingLabel` below. */
                    pending={pending && altPendingLabel != null}
                    pendingLabel={altPendingLabel}
                  >
                    {altLabel}
                  </InkButton>
                ) : null}
                <InkButton
                  tone={primaryTone}
                  onClick={onPrimary}
                  disabled={primaryDisabled}
                  pending={pending && primaryPendingLabel != null}
                  pendingLabel={primaryPendingLabel}
                >
                  {primaryLabel}
                </InkButton>
              </div>
            </div>
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
      ) : null}
    </DialogPrimitive.Root>
  );
}

/**
 * One choice in a set, as the design system draws it: a square radio marker
 * and a label with an optional note under it. `role="radio"` wants a
 * `role="radiogroup"` parent -- the callers that use a set of these wrap them
 * in one.
 */
export function ChoiceCard({
  label,
  note,
  selected,
  onSelect,
}: {
  label: React.ReactNode;
  note?: React.ReactNode;
  selected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected === true}
      onClick={onSelect}
      className={"astra-choice-card" + (selected ? " on" : "")}
    >
      <span className="astra-choice-mark" aria-hidden="true" />
      <span className="astra-choice-text">
        <b>{label}</b>
        {note ? <span className="astra-choice-note">{note}</span> : null}
      </span>
    </button>
  );
}
