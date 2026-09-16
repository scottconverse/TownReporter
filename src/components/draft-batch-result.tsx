import { Notice } from "@/components/states";
import type { DraftBatchItem } from "@/lib/news/draft-batch";

export function DraftBatchResult({ item, headline, redraftLabel, redrafting, onRedraft }: { item: DraftBatchItem; headline: string; redraftLabel?: string; redrafting?: boolean; onRedraft?: () => void }) {
  const canRedraft = item.status === "completed" || item.status === "failed";
  return (
    <div className="lead-row">
      <div className="lead-main">
        <a className="hl-link" href={item.workbenchHref}>Open current story workbench: {headline}</a>
        <p className="meta">
          <span data-draft-batch-status>{item.status === "completed" ? item.draftId ? `Batch saved draft #${item.draftId}${item.reviewRequired ? " — review required" : ""}` : "Draft ready" : item.status[0].toUpperCase() + item.status.slice(1)}</span>{" "}
          {item.status === "completed" ? null : <>· {item.stage}</>}
        </p>
        {item.status === "completed" && item.reviewRequired ? <Notice kind="err">This draft was saved, but one or more source, evidence, or name checks need review before publication.</Notice> : null}
        {item.error ? <Notice kind="err">{item.error}</Notice> : null}
        {canRedraft && onRedraft ? (
          <>
            <button type="button" className="btn" disabled={redrafting} onClick={onRedraft}>
              {redrafting ? "Queuing redraft…" : `Redraft with ${redraftLabel ?? "selected model"}`}
            </button>
            <p className="meta">Your current saved draft stays in place until the redraft finishes.</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
