import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { InkButton } from "./desk-chrome";

const pageLocks = new WeakMap<Document, { count: number; restore: () => void }>();
function lockPage(doc: Document) {
  let lock = pageLocks.get(doc);
  if (!lock) {
    const style = doc.documentElement.style;
    const overflow = style.getPropertyValue("overflow");
    const priority = style.getPropertyPriority("overflow");
    lock = { count: 0, restore: () => {
      if (overflow) style.setProperty("overflow", overflow, priority);
      else style.removeProperty("overflow");
    } };
    pageLocks.set(doc, lock);
    style.setProperty("overflow", "hidden");
  }
  lock.count++;
  return () => {
    if (--lock.count === 0) { lock.restore(); pageLocks.delete(doc); }
  };
}

// A scrollbar targets its scroll container, and a drag can synthesize a click
// on a common ancestor. Neither means the editor clicked the backdrop.
function useScrimGesture(close: () => void, native = false) {
  const press = React.useRef<number | null>(null);
  React.useEffect(() => {
    const reset = () => { press.current = null; };
    // A release inside Content never reaches the scrim's handler. Forget that
    // gesture too, so it cannot be reused by a later drag out of Content.
    document.addEventListener("pointerdown", reset, true);
    document.addEventListener("pointerup", reset);
    document.addEventListener("pointercancel", reset, true);
    return () => {
      document.removeEventListener("pointerdown", reset, true);
      document.removeEventListener("pointerup", reset);
      document.removeEventListener("pointercancel", reset, true);
    };
  }, []);
  const isScrim = (event: React.PointerEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.button !== 0 || event.ctrlKey) return false;
    const { clientX: x, clientY: y, currentTarget: el } = event;
    const viewport = el.ownerDocument.documentElement;
    if (x < 0 || y < 0 || x >= viewport.clientWidth || y >= viewport.clientHeight) return false;
    const rect = el.getBoundingClientRect();
    if (native) return x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom;
    // clientWidth/Height exclude the scrollbar gutter (including RTL gutters).
    const left = rect.left + el.clientLeft, top = rect.top + el.clientTop;
    return x >= left && x < left + el.clientWidth && y >= top && y < top + el.clientHeight;
  };
  return {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      press.current = isScrim(event) ? event.pointerId : null;
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      const dismiss = press.current === event.pointerId && isScrim(event);
      press.current = null;
      // Touch implicitly captures to the down target: check the actual release.
      if (dismiss && (native || elAtPoint(event) === event.currentTarget)) close();
    },
    onPointerCancel: () => { press.current = null; },
  };
}

function elAtPoint(event: React.PointerEvent<HTMLElement>) {
  return event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY);
}

/** The navigation scrim follows the same press/release rule as every modal. */
export function DialogScrim({ onClose, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { onClose: () => void }) {
  const gesture = useScrimGesture(onClose);
  React.useEffect(() => lockPage(document), []);
  return <button {...props} {...gesture} onClick={event => { if (event.detail === 0) onClose(); }} />;
}

/** Retains native showModal, focus trapping and Escape for search and previews. */
export const NativeDialog = React.forwardRef<HTMLDialogElement, React.DialogHTMLAttributes<HTMLDialogElement>>(
  function NativeDialog(props, ref) {
    const gesture = useScrimGesture(() => local.current?.close(), true);
    const local = React.useRef<HTMLDialogElement | null>(null);
    const opener = React.useRef<HTMLElement | null>(null);
    React.useEffect(() => {
      const element = local.current;
      if (!element) return;
      let release: (() => void) | undefined;
      const sync = () => {
        if (element.open && !release) release = lockPage(element.ownerDocument);
        else if (!element.open && release) { release(); release = undefined; }
      };
      sync();
      const observer = new MutationObserver(sync);
      observer.observe(element, { attributes: true, attributeFilter: ["open"] });
      // Native Tab cycling can visit BODY. Intercept the two boundaries so
      // search and preview keep the editor inside the currently open dialog.
      const controls = () => Array.from(element.querySelectorAll<HTMLElement>(
        'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])',
      )).filter(node => node.getClientRects().length && !node.closest('[inert]'));
      const trap = (event: KeyboardEvent) => {
        if (event.key !== "Tab" || !element.open) return;
        const all = controls();
        const first = all[0], last = all.at(-1);
        const active = element.ownerDocument.activeElement;
        if (!all.length || !element.contains(active) || (event.shiftKey ? active === first : active === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      };
      const show = element.showModal;
      element.showModal = () => {
        if (!element.open) {
          const active = element.ownerDocument.activeElement;
          if (active instanceof HTMLElement && active !== element.ownerDocument.body && !element.contains(active)) opener.current = active;
        }
        show.call(element);
        sync();
      };
      const restore = () => { if (opener.current?.isConnected) opener.current.focus(); };
      element.addEventListener("keydown", trap);
      element.addEventListener("close", restore);
      return () => {
        observer.disconnect(); release?.();
        element.showModal = show;
        element.removeEventListener("keydown", trap);
        element.removeEventListener("close", restore);
      };
    }, []);
    return <dialog {...props} {...gesture} ref={element => {
      local.current = element;
      // A callback ref may call showModal before effects have installed it.
      if (element && !element.open && document.activeElement instanceof HTMLElement && !element.contains(document.activeElement)) opener.current = document.activeElement;
      if (typeof ref === "function") return ref(element);
      if (ref) ref.current = element;
    }} />;
  },
);

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
 * Shared by the desk's editing and confirmation dialogs. Native search,
 * preview and reader dialogs retain their top layer through NativeDialog.
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
  role?: "dialog" | "alertdialog";
  ariaLabel?: string;
  open: boolean;
  /** Called by Escape, by the close button, by Cancel, and by a click outside. */
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  footNote?: React.ReactNode;
  primaryAction?: React.ReactNode;
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
  role = "dialog",
  ariaLabel,
  open,
  onClose,
  title,
  subtitle,
  children,
  footNote,
  primaryLabel,
  primaryAction,
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
  const scrimGesture = useScrimGesture(onClose);

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
          {/* Only a complete scrim gesture dismisses. The body owns scrolling. */}
          <DialogPrimitive.Overlay className="astra-modal-scrim" {...scrimGesture} />
          <DialogPrimitive.Content
            className="astra-modal"
            role={role}
            aria-label={ariaLabel}
            {...(ariaLabel ? { "aria-labelledby": undefined } : {})}
            onPointerDownOutside={event => event.preventDefault()}
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
            <div className="astra-modal-body" tabIndex={0}>{children}</div>
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
                {primaryAction ?? <InkButton
                  tone={primaryTone}
                  onClick={onPrimary}
                  disabled={primaryDisabled}
                  pending={pending && primaryPendingLabel != null}
                  pendingLabel={primaryPendingLabel}
                >
                  {primaryLabel}
                </InkButton>}
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
