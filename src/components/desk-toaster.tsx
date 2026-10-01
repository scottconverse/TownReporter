/**
 * The one toast host on the desk.
 *
 * Mounted once, in `DeskShell` (`desk-chrome.tsx`), for the same reason the
 * sr-only `#desk-announcer` lives there: every desk route renders the shell, so
 * one mount covers every screen an editor can press something on. Nothing else
 * may mount a second one -- two hosts would stack two toasts for one press, and
 * `announceToDesk`'s "exactly one live region speaks" rule (`desk-toast.ts`)
 * keys on whether a host is present, not on how many there are.
 *
 * Choices that are not sonner's defaults, and why:
 *
 *  - `position="bottom-left"`, raised clear of the two bars that live at the
 *    bottom of a desk screen. M6 of the batch-6 pre-merge audit: the stack was
 *    `top-right`, and a toast there covers the row menus and the workbench's
 *    stage controls instead. Bottom-left is where the desk has nothing, but it
 *    is also where the story workbench's publish bar (`position: sticky;
 *    bottom: 0`, `desk-astra.css`) and the unsaved-changes bar (`fixed
 *    bottom-0`, `unsaved-changes-guard.tsx`) sit -- and the publish bar holds
 *    the gates that stand between a draft and the paper, the one press on this
 *    desk that must never be hidden. `offset.bottom` is therefore
 *    `DESK_TOAST_LIFT`, the clear height (see `desk-toast.ts`), and the phone
 *    block at the foot of the toast section in `desk-astra.css` puts the stack
 *    back on top there -- below the sticky phone topbar -- because a phone's
 *    keyboard and browser chrome own the bottom of a small screen.
 *  - `offset.left` clears the nav: `--desk-nav-w` plus a gutter, since the
 *    sidebar is 230px, 206px under 1200px and 0px on a phone.
 *  - `zIndex: 55`. Above the sticky publish bar (3), the sticky row menus and
 *    the phone topbar (30), the nav scrim (35) and the sidebar (40); below the
 *    Radix modal layer (60, `styles.css` `.desk-ltr.astra-modal-layer`) so a
 *    dialog is never covered by a toast that is about the dialog. Native
 *    `<dialog class="astra-dialog">` is in the browser's top layer and beats any
 *    z-index, so the drawn dialogs win regardless.
 *  - `unstyled`. Sonner's card is rounded, shadowed, and paints a background per
 *    kind; the desk is square and flat and allows danger as border and text
 *    only (design-system §11/§12). `unstyled` turns off sonner's per-toast
 *    styling alone -- its positioning, stacking and mounted/visible states are
 *    not gated on it, so the stack still behaves. What is left is styled from
 *    the desk's own tokens under `.desk-toaster` in `desk-astra.css`.
 *  - `icons` all null. The design says words, not icons (design-system §9), and
 *    sonner renders no icon element at all when the entry for that kind is null.
 *    The close glyph is a text "✕", one of the unicode marks the desk already
 *    uses, rather than sonner's SVG.
 *  - `closeButton`. Every toast can be dismissed. The alternative is a failure
 *    carrying the real reason disappearing on a timer while it is being read,
 *    which is the same silence in a different shape.
 *  - `aria-live` is sonner's own container region, and is why `announceToDesk`
 *    does not also write `#desk-announcer` while this host is mounted.
 */
import { Toaster } from "sonner";

import { useEffect, useState } from "react";

import {
  DESK_TOASTER_MOBILE_OFFSET,
  DESK_TOASTER_OFFSET,
  DESK_TOASTER_PHONE_QUERY,
  deskStackPosition,
  DESK_TOAST_HOST_ATTR,
  DESK_TOAST_OK_MS,
} from "@/components/desk-toast";

/**
 * Is this frame a phone, as `desk-astra.css` draws one?
 *
 * Read at mount and on every change, so a window dragged narrow moves the stack
 * without a reload. Client-only on purpose: the positioned `<ol>` sonner builds
 * does not exist until a toast does, which is after mount, so there is nothing
 * for the server render to disagree with.
 */
function usePhoneFrame(): boolean {
  const [phone, setPhone] = useState(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.(DESK_TOASTER_PHONE_QUERY).matches),
  );
  useEffect(() => {
    const query = window.matchMedia?.(DESK_TOASTER_PHONE_QUERY);
    if (!query) return;
    const onChange = () => setPhone(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return phone;
}

export function DeskToaster() {
  const position = deskStackPosition(usePhoneFrame());
  return (
    <div className="desk-toaster-host" {...{ [DESK_TOAST_HOST_ATTR]: "" }}>
      <Toaster
        className="desk-toaster"
        position={position}
        offset={DESK_TOASTER_OFFSET}
        mobileOffset={DESK_TOASTER_MOBILE_OFFSET}
        gap={10}
        visibleToasts={3}
        duration={DESK_TOAST_OK_MS}
        closeButton
        containerAriaLabel="Desk messages"
        icons={{
          success: null,
          error: null,
          warning: null,
          info: null,
          loading: null,
          close: "✕",
        }}
        style={{ zIndex: 55 }}
        toastOptions={{
          /*
            `unstyled` is a per-toast option in sonner 2, not a Toaster prop,
            and it is what turns off the rounded, shadowed, per-kind-coloured
            card the desk must not wear (design-system §11/§12). The stack,
            the enter/leave and the mounted/visible states are not gated on it.
          */
          unstyled: true,
          /*
            Every toast is dismissible, and the ✕ says what it does: this is
            the desk's own wording, not sonner's "Close toast".
          */
          closeButtonAriaLabel: "Dismiss this message",
          classNames: {
            toast: "desk-toast-card",
            title: "desk-toast-title",
            actionButton: "desk-toast-action",
            closeButton: "desk-toast-close",
          },
        }}
      />
    </div>
  );
}
