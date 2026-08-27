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
  roomy = false,
}: {
  lead: LeadRow;
  dup?: PrintedDup | null;
  onHold?: () => void;
  onBack?: () => void;
  onKill?: () => void;
  roomy?: boolean;
}) {
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
            {lead.status !== "killed" && lead.status !== "published" && onKill ? (
              <InkButton tone="quiet" small onClick={onKill}>
                Kill
              </InkButton>
            ) : null}
          </span>
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
