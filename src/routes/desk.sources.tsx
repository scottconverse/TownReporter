import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { DeskShell, Field, InkButton, areaClass, inputClass } from "@/components/desk-chrome";
import { EmptyState, ListSkeleton, Notice } from "@/components/states";
import { addSource, addSourcesBulk, listSources, setSourceStatus } from "@/lib/news/desk";
import { formatShortDate } from "@/lib/paper";

export const Route = createFileRoute("/desk/sources")({ component: SourcesPage });

function SourcesPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: sources = [], isPending, error: listError } = useQuery({
    queryKey: ["sources"],
    queryFn: () => listSources(),
  });
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [bulk, setBulk] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  const add = useMutation({
    mutationFn: () =>
      addSource({
        data: { url, title, kind: "official", tier: "A" },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setNotice({ kind: "err", text: res.error });
        return;
      }
      setUrl("");
      setTitle("");
      setNotice({ kind: "ok", text: `On watch: ${res.source.title}` });
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Could not add that source.";
      setNotice({
        kind: "err",
        text:
          msg === "Unauthorized"
            ? "Session expired. Sign in again, then retry."
            : msg,
      });
    },
  });
  const addBulk = useMutation({
    mutationFn: (text: string) => addSourcesBulk({ data: { text } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setNotice({ kind: "err", text: res.error });
        return;
      }
      setBulk("");
      const t = res.byTier;
      setNotice({
        kind: "ok",
        text: `Added ${res.added} sources (A ${t.A} · B ${t.B} · C ${t.C}). Tier C is scanned as a discovery clue, never treated as fact.`,
      });
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Bulk add failed.";
      setNotice({
        kind: "err",
        text:
          msg === "Unauthorized"
            ? "Session expired. Sign in again, then retry."
            : msg,
      });
    },
  });
  const setStatus = useMutation({
    mutationFn: (input: { id: number; status: "accepted" | "rejected" }) =>
      setSourceStatus({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });

  const proposed = sources.filter((s) => s.status === "proposed");
  const watch = sources.filter((s) => s.status === "accepted");
  const rejected = sources.filter((s) => s.status === "rejected");

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setBulk(text);
    setNotice(null);
    addBulk.mutate(text);
  }

  return (
    <DeskShell title="Sources" kicker="Watch list">
      <p className="max-w-2xl text-ink-2">
        Official pages Grok is allowed to fetch. Paste a registry or pick a
        .txt / .md / .csv. TIER A/B/C headers are honored. Community URLs stay
        on the list as signals and are not scanned.
      </p>
      <form
        className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setNotice(null);
          add.mutate();
        }}
      >
        <Field label="URL">
          <input
            className={inputClass}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.longmontcolorado.gov/…"
            required
          />
        </Field>
        <Field label="Name">
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="City Council packets"
          />
        </Field>
        <InkButton type="submit" disabled={add.isPending || !url.trim()}>
          {add.isPending ? "Adding…" : "Add source"}
        </InkButton>
      </form>
      <form
        className="mt-8 max-w-3xl space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setNotice(null);
          addBulk.mutate(bulk);
        }}
      >
        <Field label="Bulk paste or file">
          <textarea
            className={areaClass + " min-h-36"}
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            placeholder={`TIER A — OFFICIAL RECORD
* City Council: https://www.longmontcolorado.gov/departments/departments-a-d/city-council
TIER B — JOURNALISM
* Times-Call: https://www.timescall.com/`}
          />
        </Field>
        <p className="text-sm text-muted">
          Markdown bullets, Title | URL, or CSV. Up to 400 URLs. Duplicate URLs
          update in place.
        </p>
        <div className="flex flex-wrap gap-2">
          <InkButton type="submit" disabled={addBulk.isPending || !bulk.trim()}>
            {addBulk.isPending ? "Adding list…" : "Add list"}
          </InkButton>
          <InkButton
            tone="ghost"
            disabled={addBulk.isPending}
            onClick={() => fileRef.current?.click()}
          >
            Pick a .txt or .csv
          </InkButton>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.csv,.md,.tsv,text/plain,text/csv,text/markdown"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              void onPickFile(file);
            }}
          />
        </div>
      </form>
      {notice && (
        <Notice kind={notice.kind}>{notice.text}</Notice>
      )}
      {listError && (
        <Notice kind="err">
          Could not load sources.
          {listError instanceof Error && listError.message === "Unauthorized"
            ? " Sign in again."
            : ""}
        </Notice>
      )}

      {isPending && sources.length === 0 ? (
        <div className="mt-10">
          <ListSkeleton rows={5} />
        </div>
      ) : (
        <>
      {proposed.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-2xl">Proposed by Grok</h2>
          <SourceTable
            rows={proposed}
            onAccept={(id) => setStatus.mutate({ id, status: "accepted" })}
            onReject={(id) => setStatus.mutate({ id, status: "rejected" })}
          />
        </section>
      )}
      <section className="mt-10">
        <h2 className="font-display text-2xl">On watch</h2>
        <p className="mt-1 text-sm text-muted">
          The starting list, not the universe. Tier C is fetched as a clue.
        </p>
        <SourceTable
          rows={watch}
          onReject={(id) => setStatus.mutate({ id, status: "rejected" })}
          emptyTitle="Nothing on watch"
          emptyBody="Add an official URL above, or paste a registry. Scans only fetch accepted sources."
        />
      </section>
      {rejected.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-2xl">Rejected</h2>
          <SourceTable
            rows={rejected}
            onAccept={(id) => setStatus.mutate({ id, status: "accepted" })}
          />
        </section>
      )}
        </>
      )}
    </DeskShell>
  );
}

function SourceTable({
  rows,
  onAccept,
  onReject,
  emptyTitle,
  emptyBody,
}: {
  rows: Awaited<ReturnType<typeof listSources>>;
  onAccept?: (id: number) => void;
  onReject?: (id: number) => void;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="mt-3">
        <EmptyState
          kicker="Watch list"
          title={emptyTitle ?? "None"}
          body={emptyBody ?? "Nothing in this list."}
        />
      </div>
    );
  }
  return (
    <ul className="stagger-in mt-3 divide-y divide-rule border border-rule bg-paper">
      {rows.map((s) => (
        <li
          key={s.id}
          className="flex flex-col gap-2 px-4 py-3 transition-[background-color] duration-150 ease-out hover:bg-paper-2 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="min-w-0">
            <p className="font-medium">{s.title}</p>
            <a
              href={s.url}
              className="break-all text-sm text-rust transition-[color] duration-150 ease-out hover:text-rust-2"
              target="_blank"
              rel="noreferrer"
            >
              {s.url}
            </a>
            <p className="mt-1 text-[12px] text-muted">
              Tier {s.tier} · {s.kind}
              {s.last_fetched_at ? ` · fetched ${formatShortDate(s.last_fetched_at)}` : ""}
              {s.last_error ? ` · ${s.last_error}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            {onAccept && (
              <InkButton tone="ghost" onClick={() => onAccept(s.id)}>
                Accept
              </InkButton>
            )}
            {onReject && (
              <InkButton tone="ghost" onClick={() => onReject(s.id)}>
                Drop
              </InkButton>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}