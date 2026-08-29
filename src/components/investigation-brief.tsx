import { InkButton } from "@/components/desk-chrome";
import { VERDICT_COPY, type InvestigationBrief } from "@/lib/news/dark-brief";

/**
 * The read-me-first block above an investigation file.
 *
 * Ordered by what an editor decides with, not by what the desk produced. The
 * verdict and the hypothesis are the first two things on the page because the
 * question being answered is "is there something here, and should I spend an
 * hour" — and everything below is four dense lists that cannot answer it.
 *
 * The benign explanation sits beside the supporting evidence rather than below
 * the fold. A hypothesis shown without the ordinary explanation that also fits
 * is how a desk like this talks itself into things.
 */
const VERDICT_TONE: Record<string, string> = {
  promising: "text-rust",
  thin: "text-ink-2",
  dead: "text-muted",
  unknown: "text-muted",
};

function StrengthBar({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-block h-1.5 w-24 bg-rule" aria-hidden>
        <span className="block h-full bg-ink" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-[11px] tracking-[0.14em] text-muted uppercase">
        {pct}% supported
      </span>
    </span>
  );
}

export function InvestigationBriefCard({
  brief,
  onRefresh,
  refreshing,
}: {
  brief: InvestigationBrief | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  if (!brief) {
    return (
      <section className="mb-6 border border-rule p-4">
        <p className="text-[11px] tracking-[0.14em] text-muted uppercase">Read this first</p>
        <p className="mt-2 text-ink-2">
          No brief yet. One is written at the end of each round — or ask for one now.
        </p>
        {onRefresh ? (
          <div className="mt-3">
            <InkButton tone="quiet" small onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "Reading the file…" : "Write the brief"}
            </InkButton>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="mb-6 border-2 border-ink p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-[11px] tracking-[0.14em] text-muted uppercase">Read this first</p>
        <span className={`text-[11px] tracking-[0.14em] uppercase ${VERDICT_TONE[brief.verdict]}`}>
          {VERDICT_COPY[brief.verdict]}
        </span>
      </div>

      {brief.headline ? (
        <h3 className="mt-2 font-display text-2xl font-semibold leading-tight">{brief.headline}</h3>
      ) : null}
      {brief.tldr ? <p className="mt-2 max-w-3xl text-ink-2">{brief.tldr}</p> : null}
      {brief.why_verdict ? (
        <p className="mt-1 max-w-3xl text-sm text-muted">{brief.why_verdict}</p>
      ) : null}

      {brief.hypothesis ? (
        <div className="mt-5 border-t border-rule pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-[11px] tracking-[0.14em] text-muted uppercase">The hypothesis</p>
            <StrengthBar value={brief.strength} />
          </div>
          <p className="mt-2 max-w-3xl font-display text-lg leading-snug">{brief.hypothesis}</p>

          {brief.supports.length ? (
            <>
              <p className="mt-3 text-[11px] tracking-[0.14em] text-muted uppercase">
                What points at it
              </p>
              <ul className="mt-1 max-w-3xl space-y-1 text-ink-2">
                {brief.supports.map((sIt, i) => (
                  <li key={i}>{sIt}</li>
                ))}
              </ul>
            </>
          ) : null}

          {brief.benign ? (
            <>
              <p className="mt-3 text-[11px] tracking-[0.14em] text-muted uppercase">
                The boring explanation that also fits
              </p>
              <p className="mt-1 max-w-3xl text-ink-2">{brief.benign}</p>
            </>
          ) : null}

          {brief.kills_it ? (
            <>
              <p className="mt-3 text-[11px] tracking-[0.14em] text-muted uppercase">
                What would settle it
              </p>
              <p className="mt-1 max-w-3xl text-ink-2">{brief.kills_it}</p>
            </>
          ) : null}
        </div>
      ) : null}

      {brief.connections.length ? (
        <div className="mt-5 border-t border-rule pt-4">
          <p className="text-[11px] tracking-[0.14em] text-muted uppercase">
            Connections across the file
          </p>
          <ul className="mt-1 max-w-3xl space-y-1 text-ink-2">
            {brief.connections.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {brief.next ? (
        <div className="mt-5 border-t border-rule pt-4">
          <p className="text-[11px] tracking-[0.14em] text-muted uppercase">Do this next</p>
          <p className="mt-1 max-w-3xl text-ink-2">{brief.next}</p>
        </div>
      ) : null}

      {onRefresh ? (
        <div className="mt-4">
          <InkButton tone="quiet" small onClick={onRefresh} disabled={refreshing}>
            {refreshing ? "Re-reading the file…" : "Rewrite the brief"}
          </InkButton>
        </div>
      ) : null}
    </section>
  );
}

/** The one-line summary that sits above each of the four dense sections. */
export function SectionTldr({ text }: { text: string }) {
  if (!text.trim()) return null;
  return <p className="side-item text-ink-2 italic">{text}</p>;
}
