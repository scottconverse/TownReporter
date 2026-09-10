import { Notice } from "@/components/states";
import type { DraftBatchItem } from "@/lib/news/draft-batch";

export function DraftBatchResult({ item, headline }: { item: DraftBatchItem; headline: string }) {
  return (
    <div className="lead-row">
      <div className="lead-main">
        <a className="hl-link" href={item.workbenchHref}>Open current story workbench: {headline}</a>
        <p className="meta">
          <span data-draft-batch-status>{item.status === "completed" ? item.draftId ? `Batch saved draft #${item.draftId}` : "Draft ready" : item.status[0].toUpperCase() + item.status.slice(1)}</span>{" "}
          {item.status === "completed" ? null : <>· {item.stage}</>}
        </p>
        {item.status === "completed" && item.evidenceCheckIncomplete ? <Notice kind="err">This batch draft&apos;s evidence check was incomplete. Review the current draft before publication.</Notice> : null}
        {item.error ? <Notice kind="err">{item.error}</Notice> : null}
      </div>
    </div>
  );
}
