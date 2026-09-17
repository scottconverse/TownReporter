import { Link } from "@tanstack/react-router";
import { usePaperDateFormatters } from "@/lib/paper-context";
import type { ProvenanceItem, StoryFinding } from "@/lib/news/findings";

export function ProvenanceBlock({
  items,
  findings,
  form,
}: {
  items: ProvenanceItem[];
  findings?: StoryFinding[] | null;
  form?: string | null;
}) {
  const { formatDateTime, formatShortDate } = usePaperDateFormatters();
  const urls = new Set(items.map((p) => p.url));
  const versions = new Set(
    items.map((p) => p.version_id).filter((id): id is number => id != null),
  );
  const captures = new Set(
    items.map((p) => p.capture_event_id).filter((id): id is number => id != null),
  );
  const publicFindings = (findings ?? []).filter((f) => {
    if (!f.text.trim()) return false;
    if (!f.source_urls.some((u) => urls.has(u))) return false;
    const versionOk = f.artifact_version_ids.some((id) => versions.has(id));
    const captureOk = f.capture_event_ids.some((id) => captures.has(id));
    return versionOk || captureOk;
  });
  if (!items.length && !publicFindings.length) return null;
  return (
    <section className="enter-rise mt-10 max-w-2xl border-t border-rule pt-4">
      {form && form !== "reported" ? (
        <p className="text-[11px] tracking-[0.16em] text-muted uppercase">{form}</p>
      ) : null}
      {items.length > 0 && (
        <>
          <h2 className="text-[11px] tracking-[0.16em] text-muted uppercase">
            How we reported this
          </h2>
          <ul className="mt-3 space-y-3 text-sm">
            {items.map((item) => (
              <li key={item.url} className="border-b border-rule pb-3 last:border-0">
                <p className="font-medium text-ink">
                  {item.title}
                  {item.role && item.role !== "source" ? (
                    <span className="font-normal text-muted"> · {item.role}</span>
                  ) : null}
                </p>
                <p className="text-muted">
                  {item.organization}
                  {item.document_date ? ` · ${item.document_date}` : ""}
                </p>
                {item.disappeared ? (
                  <p className="mt-1 text-ink-2">
                    Original source no longer available
                    {item.captured_at
                      ? ` — captured by TownReporter on ${formatShortDate(item.captured_at)}`
                      : " — captured by TownReporter"}
                    .
                  </p>
                ) : (
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    <a
                      href={item.url}
                      className="break-all text-rust transition-[color] duration-150 ease-out hover:text-rust-2"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Current source
                    </a>
                    {item.captured_at ? (
                      <span className="text-muted">
                        Captured {formatDateTime(item.captured_at)}
                      </span>
                    ) : null}
                  </p>
                )}
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {item.version_id != null ? (
                    <Link
                      to="/evidence/$versionId"
                      params={{ versionId: String(item.version_id) }}
                      className="text-rust transition-[color] duration-150 ease-out hover:text-rust-2"
                    >
                      View captured version
                    </Link>
                  ) : null}
                  {(item.version_count ?? 0) > 1 ? (
                    <Link
                      to="/evidence/compare"
                      search={{ url: item.url }}
                      className="text-rust transition-[color] duration-150 ease-out hover:text-rust-2"
                    >
                      Compare versions
                    </Link>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {publicFindings.length > 0 ? (
        <div className="mt-6 border border-ink bg-paper-2 p-4">
          <h2 className="text-[11px] tracking-[0.16em] text-rust uppercase">
            What TownReporter found
          </h2>
          <ul className="mt-2 space-y-3">
            {publicFindings.map((f) => (
              <li key={f.text} className="text-ink-2">
                <p className="whitespace-pre-wrap">{f.text}</p>
                {f.source_urls[0] ? (
                  <p className="mt-1 break-all text-sm text-muted">{f.source_urls[0]}</p>
                ) : null}
                {f.artifact_version_ids[0] != null ? (
                  <p className="mt-1 text-sm">
                    <Link
                      to="/evidence/$versionId"
                      params={{ versionId: String(f.artifact_version_ids[0]) }}
                      className="text-rust transition-[color] duration-150 ease-out hover:text-rust-2"
                    >
                      Captured record
                    </Link>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-3 text-sm text-muted">
        Trust is verifiable. Check the official record before you act on a figure
        or a vote.
      </p>
    </section>
  );
}
