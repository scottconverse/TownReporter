import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Chip, InkButton, Score, leadOrigin } from "@/components/desk-chrome";
import { formatAge, formatShortDate } from "@/lib/paper";
import type { PrintedDup } from "@/lib/news/desk-copy";
import type { LeadRow } from "@/lib/news/types";

export function LeadRowView({
  lead,
  dup,
  onHold,
  onBack,
  onKill,
  onDelete,
  roomy = false,
}: {
  lead: LeadRow;
  dup?: PrintedDup | null;
  onHold?: () => void;
  onBack?: () => void;
  onKill?: () => void;
  /**
   * Remove the lead entirely.
   *
   * Kill is not delete. A killed lead stays under Killed, which is right for
   * "not this one" and wrong for a lead filed against the wrong person or a
   * scan that swept up something private. Confirmed in place, because a
   * two-click delete on a row this small is the whole safety net it needs.
   */
  onDelete?: () => void;
  roomy?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const score = lead.newsworthiness ?? 0;
  return (
    <div className={"lead-row" + (lead.status === "killed" ? " dead" : "") + (roomy ? " roomy" : "")}>
      <Score v={score} />
      <div className="lead-main">
        <Link to="/desk/story/$leadId" params={{ leadId: String(lead.id) }} className="hl-link">
          {lead.headline}
        </Link>
        <p className="lead-why">{lead.why}</p>
        <p className="meta">
          {lead.topic} · {formatAge(lead.created_at)} · {leadOrigin(lead)}
          <span className="row-acts">
            <Link
              to="/desk/story/$leadId"
              params={{ leadId: String(lead.id) }}
              className="btn quiet small"
            >
              Open
            </Link>
            {dup ? (
              <Link to="/articles/$slug" params={{ slug: dup.slug }} className="btn quiet small">
                The piece
              </Link>
            ) : null}
            {lead.status !== "held" && lead.status !== "published" && lead.status !== "killed" && onHold ? (
              <InkButton tone="quiet" small onClick={onHold}>
                Hold
              </InkButton>
            ) : null}
            {lead.status === "held" && onBack ? (
              <InkButton tone="quiet" small onClick={onBack}>
                Back
              </InkButton>
            ) : null}
            {lead.status === "killed" && onBack ? (
              <InkButton tone="quiet" small onClick={onBack}>
                Back
              </InkButton>
            ) : null}
            {lead.status !== "killed" && lead.status !== "published" && onKill ? (
              <InkButton tone="quiet" small onClick={onKill}>
                Kill
              </InkButton>
            ) : null}
            {onDelete ? (
              confirming ? (
                <>
                  <InkButton
                    tone="ghost"
                    small
                    onClick={() => {
                      setConfirming(false);
                      onDelete();
                    }}
                  >
                    Yes, delete
                  </InkButton>
                  <InkButton tone="quiet" small onClick={() => setConfirming(false)}>
                    Keep
                  </InkButton>
                </>
              ) : (
                <InkButton tone="quiet" small onClick={() => setConfirming(true)}>
                  Delete
                </InkButton>
              )
            ) : null}
          </span>
          {confirming ? (
            <span className="del-warn">
              Deletes this lead and any draft on it.
              {lead.status === "published"
                ? " The printed story stays on the paper — remove that under Published."
                : ""}
            </span>
          ) : null}
        </p>
        {dup ? (
          <p className="meta">
            ≈ covers “{dup.note}”, published {formatShortDate(dup.publishedAt)}
          </p>
        ) : null}
      </div>
      <div className="lead-flags">
        <Chip s={lead.status} />
        {dup ? (
          <span className="chip dup" title={"Covers ground published " + formatShortDate(dup.publishedAt)}>
            ≈ printed
          </span>
        ) : null}
      </div>
    </div>
  );
}
