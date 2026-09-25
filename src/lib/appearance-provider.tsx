import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { AppearanceContext, useHydrated, useIsoLayoutEffect } from "./appearance-context";
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
  const [stored, setStored] = useState<Pick<Appearance, "desk" | "size">>({
    desk: "light",
    size: "normal",
  });
  // Bumped when the reader's own toggle moves, to re-read below. The read is
  // the source of truth, so this carries no value.
  const [, setReaderNonce] = useState(0);

  useEffect(() => {
    const next = readStoredDesk();
    setStored((prev) => (prev.desk === next.desk && prev.size === next.size ? prev : next));
  }, []);

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
  const surface = appearanceSurface(stored.desk, reader, pathname);

  useIsoLayoutEffect(() => {
    // Before hydration the <head> script's value IS the right one; writing
    // here would clobber it with the pre-read default.
    if (!hydrated) return;
    const root = document.documentElement;
    root.setAttribute(APPEARANCE_ATTR, surface);
    root.setAttribute(DESK_SIZE_ATTR, stored.size);
    // A phone's address bar is part of the screen. The <head> script sets this
    // before the first paint; this keeps it right when the toggle moves
    // afterwards, which the script cannot see.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", surfaceBackground(surface));
  }, [hydrated, surface, stored.size]);

  const setDesk = useCallback(
    (patch: { desk?: DeskMode; size?: DeskTextSize }) => {
      const next = { desk: patch.desk ?? stored.desk, size: patch.size ?? stored.size };
      if (next.desk === stored.desk && next.size === stored.size) return;
      writeStoredDesk(next);
      setStored(next);
    },
    [stored],
  );

  const refreshReader = useCallback(() => setReaderNonce((n) => n + 1), []);

  const value = useMemo(
    () => ({
      appearance: { desk: stored.desk, size: stored.size, reader },
      surface,
      setDesk,
      refreshReader,
    }),
    [stored.desk, stored.size, reader, surface, setDesk, refreshReader],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
