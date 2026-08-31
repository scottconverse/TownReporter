/*
  CITY-SETUP slice B: the live-merged paper identity, threaded through React
  context instead of read from the PAPER constant everywhere.

  Client-safe only -- no server/db import here, ever. This module is pulled
  into every page's client bundle (paper-chrome.tsx, desk-chrome.tsx, every
  route). It only imports src/lib/paper.ts (also client-safe) for the default
  fallback shape, so a build that never configures paper_settings renders
  byte-for-byte what it renders today.
*/
import { createContext, useContext } from "react";
import { PAPER, COUNCIL_VOTES_URL } from "./paper";

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
