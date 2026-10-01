import { Notice } from "@/components/states";
import type { DraftBatchItem } from "@/lib/news/draft-batch";

export function DraftBatchResult({ item, headline, redraftLabel, redrafting, onRedraft }: { item: DraftBatchItem; headline: string; redraftLabel?: string; redrafting?: boolean; onRedraft?: () => void }) {
  const canRedraft = item.status === "completed" || item.status === "failed";
  return (
    <div className="lead-row">
      <div className="lead-main">
        <a className="hl-link" href={item.workbenchHref}>Open current story workbench: {headline}</a>
        <p className="meta">
          {/*
            FB6: FB0-Report Table B's last Queue row -- "batch item status line
            -- LAZY BAR (mild) -- no card, no cancel, unannounced". The line
            already moves in words as the item progresses (it is polled at
            1.5 s), so it is the announcement that was missing: a live region
            carries each change to a screen reader without a second reader of
            the same fact. The card half stays where it belongs -- the story's
            own workbench, which is what "Open current story workbench" above
            goes to, and the Drafts list, which draws the same job at the size
            of a row (see `desk.drafts.tsx`).
          */}
          <span data-draft-batch-status role="status" aria-live="polite">
            {item.status === "completed" ? item.draftId ? `Batch saved draft #${item.draftId}${item.reviewRequired ? " — review required" : ""}` : "Draft ready" : item.status[0].toUpperCase() + item.status.slice(1)}
          </span>{" "}
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
