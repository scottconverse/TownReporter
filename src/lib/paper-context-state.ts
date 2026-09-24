import { createContext, useContext, useMemo } from "react";
import { formatDate, formatShortDate, formatDateTime } from "./paper";
import { DEFAULT_PAPER_IDENTITY, type PaperIdentity } from "./paper-identity";

export const paperContext = createContext<PaperIdentity>(DEFAULT_PAPER_IDENTITY);

/** The paper's live-configured identity for the current request. */
export function usePaper(): PaperIdentity {
  return useContext(paperContext);
}

/** Date formatters bound to the current paper's configured timezone. */
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
