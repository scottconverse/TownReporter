import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useSyncExternalStore,
} from "react";
import type { Appearance, AppearanceSurface, DeskMode, DeskTextSize } from "./appearance";

/*
  The live half of the appearance system. `src/lib/appearance.ts` explains the
  design (the bug, the <head> script, why not a cookie); this file is what keeps
  the <html> attributes and the React tree in step once the app is running, and
  `src/lib/appearance-provider.tsx` is the component that mounts it.

  Division of labour, so that neither half can undo the other:

    - The <head> script paints the FIRST frame and owns the attributes until
      hydration. Nothing here writes before the app is hydrated.
    - After hydration the provider is the only writer of the attributes, and it
      writes exactly what the script would have written for the same stores.
    - React never RENDERS `data-appearance`/`data-desk-size`, only sets them on
      the DOM. That is deliberate and it is the same choice `__root.tsx`
      documents for `data-stranded`: <html> is the one element React is told to
      ignore on hydration (suppressHydrationWarning), and a server that cannot
      read localStorage could only ever render the light default anyway -- so
      handing React an attribute it cannot know is a way to manufacture a
      mismatch on exactly the page load this fix is about.

  The provider's own state still starts at the light default on the server and
  on the first client render, which is what keeps hydration clean; the flip to
  the stored value happens in an effect a moment later. That flip changes no
  pixel, because the attributes (and therefore the palettes) were already dark
  from the script -- the React-side `night`/`large`/`mode-dark` classes are now
  a redundant second statement of the same fact.

  Hooks live in this `.ts` file and the component in `appearance-provider.tsx`
  on purpose: eslint's react-refresh/only-export-components warns about a file
  that exports both, and splitting is this repo's convention for it
  (`reader-context.ts` + `reader-controls.tsx`, `paper-context.ts` +
  `paper-context-state.ts`).
*/

/** Stable module-level identity: `useSyncExternalStore` re-subscribes forever
    otherwise. There is nothing to subscribe to -- React itself tells us when
    hydration is done. */
const noSubscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * `useLayoutEffect` where it can run, `useEffect` on the server.
 *
 * The provider's attribute write has to land BEFORE the browser paints, or a
 * client-side navigation shows one frame of the outgoing page's surface --
 * dark desk to light article repaints as a #182024 body behind a light reader
 * panel, and desk to desk keeps the outgoing palette for the frame the new
 * route is being committed. A layout effect runs in the same commit, before
 * paint, so there is no such frame.
 *
 * The swap is the usual one and it is not cosmetic: React logs "useLayoutEffect
 * does nothing on the server" for every server render otherwise, and this
 * component renders on every request.
 */
export const useIsoLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

/**
 * `false` while rendering on the server and during hydration, `true` from the
 * render after hydration onwards.
 *
 * This is the one honest way to ask "may I read localStorage right now?".
 * Reading it in a `useState` initializer directly would make the first client
 * render disagree with the server markup, which is a hydration mismatch.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscribe, onClient, onServer);
}

export type AppearanceContextValue = {
  appearance: Appearance;
  /** What the document is painted as right now. */
  surface: AppearanceSurface;
  /** Desk light/dark and Normal/Large text. Persists to localStorage. */
  setDesk: (patch: { desk?: DeskMode; size?: DeskTextSize }) => void;
  /**
   * Re-read the public paper's appearance. The reader owns that store (its
   * blob also carries text size and bookmarks), so when its toggle moves the
   * document has to be told -- this is the tell.
   */
  refreshReader: () => void;
};

export const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("useAppearance must be used inside AppearanceProvider");
  return value;
}
