import { formatDateTime, formatShortDate } from "@/lib/paper";
import type { ProvenanceItem } from "@/lib/news/report";

export function ProvenanceBlock({
  items,
  found,
  form,
}: {
  items: ProvenanceItem[];
  found?: string | null;
  form?: string | null;
}) {
  if (!items.length && !found) return null;
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
                {item.version_id != null && !item.disappeared ? (
                  <p className="mt-1 text-muted">Captured version v{item.version_id}</p>
                ) : null}
                {(item.version_count ?? 0) > 1 ? (
                  <p className="mt-1 text-ink-2">
                    Compare versions — TownReporter captured {item.version_count} versions
                    of this record.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
      {found?.trim() ? (
        <div className="mt-6 border border-ink bg-paper-2 p-4">
          <h2 className="text-[11px] tracking-[0.16em] text-rust uppercase">
            What TownReporter found
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-ink-2">{found.trim()}</p>
        </div>
      ) : null}
      <p className="mt-3 text-sm text-muted">
        Trust is verifiable. Check the official record before you act on a figure
        or a vote.
      </p>
    </section>
  );
}
