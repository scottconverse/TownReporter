import { createContext, useContext, useMemo } from "react";
import { formatDate, formatDayStamp, formatShortDate, formatDateTime, formatClockTime } from "./paper";
import { clockTextAt } from "./desk/ops-rows";
import { DEFAULT_PAPER_IDENTITY, type PaperIdentity } from "./paper-identity";
import { areaLabelsFor, type AreaLabels } from "./story-area";

export const paperContext = createContext<PaperIdentity>(DEFAULT_PAPER_IDENTITY);

/** The paper's live-configured identity for the current request. */
export function usePaper(): PaperIdentity {
  return useContext(paperContext);
}

/**
 * The four geography grounds in the current paper's own words.
 *
 * The pill row, the region band's place labels and the desk's select all read
 * this one hook, so a paper configured for another town cannot print the
 * shipped default's geography on any of its screens (see `areaLabelsFor`).
 *
 * The county comes off the identity with the city and the state (unit BX):
 * before that this hook passed neither, so the county pill printed the generic
 * word "County" on a paper whose owner had configured "Boulder County" in Paper
 * setup. A paper that has never named one still prints "County".
 */
export function useAreaLabels(): AreaLabels {
  const { city, state, county } = usePaper();
  return useMemo(() => areaLabelsFor({ city, state }, county), [city, state, county]);
}

/** Date formatters bound to the current paper's configured timezone. */
export function usePaperDateFormatters() {
  const { timezone } = usePaper();
  return useMemo(
    () => ({
      formatDate: (iso: string | Date | null | undefined) => formatDate(iso, timezone),
      /** "Sat, Sep 26" -- the paper's dateline. */
      formatDayStamp: (iso: string | Date | null | undefined) => formatDayStamp(iso, timezone),
      formatShortDate: (iso: string | Date | null | undefined) => formatShortDate(iso, timezone),
      formatDateTime: (iso: string | Date | null | undefined) => formatDateTime(iso, timezone),
      formatClockTime: (iso: string | Date | null | undefined) => formatClockTime(iso, timezone),
      /** "12:15 p.m." -- the desk's clock, for a moment that was tried. */
      clockTime: (iso: string | Date | null | undefined) => clockTextAt(iso, timezone),
    }),
    [timezone],
  );
}
