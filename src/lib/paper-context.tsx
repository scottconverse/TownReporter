/*
  CITY-SETUP slice B: the live-merged paper identity, threaded through React
  context instead of read from the PAPER constant everywhere.

  Client-safe only -- no server/db import here, ever. This module is pulled
  into every page's client bundle (paper-chrome.tsx, desk-chrome.tsx, every
  route). It only imports src/lib/paper.ts (also client-safe) for the default
  fallback shape, so a build that never configures paper_settings renders
  byte-for-byte what it renders today.

  The type, the shipped default, and the undefined/null fallback logic live in
  paper-identity.ts (plain .ts, no React) so they can be unit-tested directly
  -- see paper-identity.test.ts. Re-exported here so every existing import
  from "@/lib/paper-context" keeps working unchanged.
*/
import { createContext, useContext, useMemo } from "react";
import { formatDate, formatShortDate, formatDateTime } from "./paper";
import { DEFAULT_PAPER_IDENTITY, resolvePaperIdentity, type PaperIdentity } from "./paper-identity";

export { DEFAULT_PAPER_IDENTITY, resolvePaperIdentity, type PaperIdentity };

const PaperContext = createContext<PaperIdentity>(DEFAULT_PAPER_IDENTITY);

export const PaperProvider = PaperContext.Provider;

/** The paper's live-configured identity for the current request. */
export function usePaper(): PaperIdentity {
  return useContext(PaperContext);
}

/**
 * CITY-SETUP slice C2: `formatDate`/`formatShortDate`/`formatDateTime`
 * pre-bound to the current paper's configured timezone, so a call site in a
 * component never has to remember to pass one.
 *
 * With no `paper_settings` row, `usePaper()` returns `DEFAULT_PAPER_IDENTITY`
 * whose `timezone` is `PAPER.timezone` -- the same default the three
 * functions already fall back to -- so this changes nothing for the current
 * (unconfigured) paper.
 */
export function usePaperDateFormatters() {
  const { timezone } = usePaper();
  return useMemo(
    () => ({
      formatDate: (iso: string | Date | null | undefined) => formatDate(iso, timezone),
      formatShortDate: (iso: string | Date | null | undefined) => formatShortDate(iso, timezone),
      formatDateTime: (iso: string | Date | null | undefined) => formatDateTime(iso, timezone),
    }),
    [timezone],
  );
}
