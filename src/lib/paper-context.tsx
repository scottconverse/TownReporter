/*
  CITY-SETUP slice B: the live-merged paper identity, threaded through React
  context instead of read from the PAPER constant everywhere.

  Client-safe only -- no server/db import here, ever. This module is pulled
  into every page's client bundle (paper-chrome.tsx, desk-chrome.tsx, every
  route). It only imports src/lib/paper.ts (also client-safe) for the default
  fallback shape, so a build that never configures paper_settings renders
  byte-for-byte what it renders today.
*/
import { createContext, useContext, useMemo } from "react";
import {
  PAPER,
  COUNCIL_VOTES_URL,
  formatDate,
  formatShortDate,
  formatDateTime,
} from "./paper";

export type PaperIdentity = {
  name: string;
  city: string;
  state: string;
  location: string;
  timezone: string;
  tagline: string;
  kicker: string;
  deck: string;
  trust: string;
  councilVotesUrl: string;
};

/**
 * Same shape `defaultConfig()` in src/lib/news/paper-settings.ts builds from
 * PAPER -- duplicated here (not imported) because that module pulls in
 * src/lib/db.ts and must never reach the client bundle.
 */
export const DEFAULT_PAPER_IDENTITY: PaperIdentity = {
  name: PAPER.name,
  city: PAPER.city,
  state: PAPER.state,
  location: PAPER.location,
  timezone: PAPER.timezone,
  tagline: PAPER.tagline,
  kicker: PAPER.kicker,
  deck: PAPER.deck,
  trust: PAPER.trust,
  councilVotesUrl: COUNCIL_VOTES_URL,
};

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
