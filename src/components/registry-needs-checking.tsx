import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { InkButton } from "@/components/desk-chrome";
import { listRegistryNeedsChecking } from "@/lib/news/registry/registry-verify";
import { endSentence } from "@/lib/news/registry/registry-sentence";
import { registryEntryHeading } from "@/lib/news/registry/registry-entry-copy";
import { usePaperDateFormatters } from "@/lib/paper-context-state";

/**
 * The "Needs checking" view (spec 24, Phase 3): published entries with no
 * explicit verification, a verification older than the limit, or key facts
 * changed since the last check. Each row names the entry, says why it is
 * listed, and opens that entry in the editor, where the Verify form is.
 *
 * Every line is the page's normal body size and full-contrast text.
 */
const NEEDS_CHECKING_KEY = ["registry-needs-checking"];

export function RegistryNeedsChecking({
  onOpen,
  limit,
  renderFoot,
}: {
  onOpen: (serviceId: number) => void;
  /** How many rows to draw; a loaded directory can put 151 entries here. */
  limit?: number;
  /** The page's own "show more" row, given the full count. */
  renderFoot?: (total: number) => ReactNode;
}) {
  const { formatShortDate } = usePaperDateFormatters();
  const query = useQuery({
    queryKey: NEEDS_CHECKING_KEY,
    queryFn: () => listRegistryNeedsChecking(),
  });
  if (query.isError) {
    return (
      <p className="text-base text-rust" role="alert">
        {query.error instanceof Error ? query.error.message : "The list could not be loaded."}
      </p>
    );
  }
  if (!query.data) {
    return (
      <p className="text-base" role="status">
        Loading the entries that need checking…
      </p>
    );
  }
  if (query.data.length === 0) {
    return <p className="text-base">Every published entry has a current verification.</p>;
  }
  const rows = limit === undefined ? query.data : query.data.slice(0, limit);
  return (
    <>
      <ul className="astra-plain" data-testid="needs-checking-list">
        {rows.map((item) => (
          <li key={item.serviceId}>
            <div className="astra-row-t">
              {registryEntryHeading(item.organizationName, item.serviceName)}
            </div>
            {item.reasons.map((reason) => (
              <p className="text-base" key={reason}>
                {reason}
              </p>
            ))}
            {item.lastCheckedAt ? (
              <p className="text-base">
                Last checked {endSentence(formatShortDate(item.lastCheckedAt))}
              </p>
            ) : null}
            <div className="mt-2">
              <InkButton
                tone="ghost"
                ariaLabel={`Open in the editor: ${item.serviceName}`}
                onClick={() => onOpen(item.serviceId)}
              >
                Open in the editor
              </InkButton>
            </div>
          </li>
        ))}
      </ul>
      {renderFoot?.(query.data.length)}
    </>
  );
}
