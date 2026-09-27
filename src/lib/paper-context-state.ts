import { createContext, useContext, useMemo } from "react";
import { formatDate, formatDayStamp, formatShortDate, formatDateTime } from "./paper";
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
 */
export function useAreaLabels(): AreaLabels {
  const { city, state } = usePaper();
  return useMemo(() => areaLabelsFor({ city, state }), [city, state]);
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
    }),
    [timezone],
  );
}
