import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DeskShell, InkButton, SecHead } from "@/components/desk-chrome";
import { ListSkeleton, Notice } from "@/components/states";
import { addCorrection, listMemory, listPublishedDesk } from "@/lib/news/desk";
import { formatShortDate } from "@/lib/paper";

export const Route = createFileRoute("/desk/published")({ component: PublishedPage });

function PublishedPage() {
  const qc = useQueryClient();
  const published = useQuery({ queryKey: ["published-desk"], queryFn: () => listPublishedDesk() });
  const memory = useQuery({ queryKey: ["memory"], queryFn: () => listMemory() });
  const [corrFor, setCorrFor] = useState<string | null>(null);
  const [corrText, setCorrText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const corr = useMutation({
    mutationFn: (slug: string) => addCorrection({ data: { articleSlug: slug, body: corrText } }),
    onSuccess: (res) => {
      if (res.ok) {
        setCorrText("");
        setCorrFor(null);
        setNote("Correction is public.");
        void qc.invalidateQueries({ queryKey: ["published-desk"] });
        void qc.invalidateQueries({ queryKey: ["corrections"] });
      } else setNote("error" in res ? String(res.error) : "Could not post that correction.");
    },
  });

  const rows = published.data ?? [];

  return (
    <DeskShell title="Published" kicker="The record">
      <p className="lede">
        What is live on the paper, with its corrections. Corrections are public.
      </p>
      {note ? <Notice kind="ok">{note}</Notice> : null}
      {published.isPending && !rows.length ? (
        <ListSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <p className="wire-sum">Empty until you publish.</p>
      ) : (
        <div className="pub-list">
          {rows.map((p) => (
            <div key={p.id} className="pub-row">
              <div className="pub-main">
                <p className="meta">
                  {p.topic} · {formatShortDate(p.published_at)}
                  {p.lead_score != null ? ` · scored ${p.lead_score}/20 at filing` : ""}
                </p>
                <h3 className="pub-h">{p.headline}</h3>
                {p.dek ? <p className="pub-dek">{p.dek}</p> : null}
                {p.corrections.map((c, i) => (
                  <p key={i} className="pub-corr">
                    <b>Correction, {formatShortDate(c.date)}:</b> {c.body}
                  </p>
                ))}
                {corrFor === p.slug ? (
                  <div className="corr-form">
                    <textarea
                      rows={3}
                      value={corrText}
                      onChange={(e) => setCorrText(e.target.value)}
                      placeholder="What was wrong, and what is right."
                    />
                    <div className="row-acts static">
                      <InkButton
                        small
                        disabled={!corrText.trim() || corr.isPending}
                        onClick={() => corr.mutate(p.slug)}
                      >
                        Publish correction
                      </InkButton>
                      <InkButton tone="quiet" small onClick={() => setCorrFor(null)}>
                        Cancel
                      </InkButton>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="pub-acts">
                <Link to="/articles/$slug" params={{ slug: p.slug }} className="btn quiet small">
                  Read on the paper
                </Link>
                <InkButton tone="quiet" small onClick={() => setCorrFor(p.slug)}>
                  Post correction
                </InkButton>
              </div>
            </div>
          ))}
        </div>
      )}

      <SecHead
        title="Beat memory"
        count={memory.data?.length ?? 0}
        sub="What the drafting AI is told we already covered, so the paper doesn't repeat itself."
      />
      <table className="ltable">
        <thead>
          <tr>
            <th>Entity</th>
            <th>Last angle</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {(memory.data ?? []).map((m) => (
            <tr key={m.id} className="lead-tr">
              <td className="td-hl">
                <span className="src-t">{m.entity}</span>
              </td>
              <td className="td-meta wide">{m.last_angle}</td>
              <td className="td-meta">{formatShortDate(m.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DeskShell>
  );
}
