import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  AppearanceContext,
  useHydrated,
  useIsoLayoutEffect,
  useSystemReaderMode,
} from "./appearance-context";
import {
  APPEARANCE_ATTR,
  DESK_SIZE_ATTR,
  appearanceSurface,
  isDeskPath,
  readReaderMode,
  readStoredDesk,
  surfaceBackground,
  writeStoredDesk,
  type Appearance,
  type DeskMode,
  type DeskTextSize,
  type ReaderMode,
} from "./appearance";

/*
  The provider that mounts the appearance system. The design is documented in
  src/lib/appearance.ts and src/lib/appearance-context.ts; this file is only the
  component, so that the hooks can live in a plain `.ts` module (see the note at
  the bottom of appearance-context.ts).
*/
export function AppearanceProvider({
  readerKey,
  children,
}: {
  /** The resolved paper's reader store key, e.g. `townreporter:reader:…`. */
  readerKey: string;
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const hydrated = useHydrated();
  useSystemReaderMode();
  // The server and hydration render use a stable value. On the first
  // post-hydration render, read localStorage synchronously so the attributes
  // agree with the pre-paint script before a navigation/toggle can paint.
  const [stored, setStored] = useState<Pick<Appearance, "desk" | "size">>({
    desk: "light",
    size: "normal",
  });
  const [storedInitialized, setStoredInitialized] = useState(false);
  const currentStored = hydrated && !storedInitialized ? readStoredDesk() : stored;
  // Bumped when the reader's own toggle moves, to re-read below. The read is
  // the source of truth, so this carries no value.
  const [, setReaderNonce] = useState(0);

  useIsoLayoutEffect(() => {
    if (!hydrated || storedInitialized) return;
    setStored(currentStored);
    setStoredInitialized(true);
  }, [hydrated, storedInitialized, currentStored.desk, currentStored.size]);

  const deskPath = isDeskPath(pathname);
  /*
    Read during render rather than in an effect, and only once we are past
    hydration.

    During hydration `hydrated` is false and this is "light", which is what the
    server rendered -- no mismatch. But on a CLIENT-side navigation the reader
    provider for the incoming page has not mounted yet, so an effect here would
    paint the previous page's surface for a frame: leaving a dark desk for a
    light article would light a dark room for one frame, which is the bug we
    are here to remove. Reading synchronously is safe because `hydrated` is
    already true for any render after hydration.
  */
  const reader: ReaderMode = hydrated && !deskPath ? readReaderMode(readerKey) : "light";
  const surface = appearanceSurface(currentStored.desk, reader, pathname);

  useIsoLayoutEffect(() => {
    // Before hydration the <head> script's value IS the right one; writing
    // here would clobber it with the pre-read default.
    if (!hydrated) return;
    const root = document.documentElement;
    root.setAttribute(APPEARANCE_ATTR, surface);
    root.setAttribute(DESK_SIZE_ATTR, currentStored.size);
    // A phone's address bar is part of the screen. The <head> script sets this
    // before the first paint; this keeps it right when the toggle moves
    // afterwards, which the script cannot see.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", surfaceBackground(surface));
  }, [hydrated, surface, currentStored.size]);

  const setDesk = useCallback(
    (patch: { desk?: DeskMode; size?: DeskTextSize }) => {
      const next = {
        desk: patch.desk ?? currentStored.desk,
        size: patch.size ?? currentStored.size,
      };
      if (next.desk === currentStored.desk && next.size === currentStored.size) return;
      writeStoredDesk(next);
      setStored(next);
      setStoredInitialized(true);
    },
    [currentStored.desk, currentStored.size],
  );

  const refreshReader = useCallback(() => setReaderNonce((n) => n + 1), []);

  const value = useMemo(
    () => ({
      appearance: { desk: currentStored.desk, size: currentStored.size, reader },
      surface,
      setDesk,
      refreshReader,
    }),
    [currentStored.desk, currentStored.size, reader, surface, setDesk, refreshReader],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
