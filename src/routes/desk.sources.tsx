import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { DeskShell, Field, InkButton, SecHead } from "@/components/desk-chrome";
import { ListSkeleton, ScreenError } from "@/components/states";
import { addSource, addSourcesBulk, listSources, setSourceStatus } from "@/lib/news/desk";
import { editorFetchError, kindFromSourceUrl, tierFromKind } from "@/lib/news/desk-copy";
import { formatShortDate } from "@/lib/paper";
import type { SourceRow } from "@/lib/news/types";

export const Route = createFileRoute("/desk/sources")({ component: SourcesPage });

function SourcesPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const {
    data: sources = [],
    isPending,
    isError: listIsError,
    error: listError,
    refetch: refetchSources,
    isRefetching: refetchingSources,
  } = useQuery({
    queryKey: ["sources"],
    queryFn: () => listSources(),
  });
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [bulk, setBulk] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [addedId, setAddedId] = useState<number | null>(null);
  const add = useMutation({
    mutationFn: () =>
      addSource({
        data: {
          url,
          title,
          kind: kindFromSourceUrl(url),
          tier: tierFromKind(kindFromSourceUrl(url)),
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setNotice({ kind: "err", text: res.error });
        return;
      }
      setUrl("");
      setTitle("");
      setAddedId(res.source.id);
      setNotice({
        kind: "ok",
        text: `On watch: ${res.source.title} — ${res.source.url}`,
      });
      qc.setQueryData(["sources"], (old: SourceRow[] | undefined) => {
        if (!old) return [res.source];
        return [res.source, ...old.filter((s) => s.id !== res.source.id && s.url !== res.source.url)];
      });
      void qc.invalidateQueries({ queryKey: ["sources"] });
      requestAnimationFrame(() => {
        document.getElementById("on-watch")?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Could not add that source.";
      setNotice({
        kind: "err",
        text: msg === "Unauthorized" ? "Session expired. Sign in again, then retry." : msg,
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
        text: msg === "Unauthorized" ? "Session expired. Sign in again, then retry." : msg,
      });
    },
  });
  const setStatus = useMutation({
    mutationFn: (input: { id: number; status: "accepted" | "rejected" }) => setSourceStatus({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });

  const groups: {
    k: string;
    title: string;
    sub: string | null;
    acts: ("accepted" | "rejected")[];
  }[] = [
    {
      k: "accepted",
      title: "On watch",
      sub: "What the scanner is allowed to fetch. Tier A is official record; B is journalism; C is a discovery clue, never treated as fact.",
      acts: ["rejected"],
    },
    {
      k: "proposed",
      title: "Proposed",
      sub: "Turned up by scans and Dark Desk. Nothing is fetched until you accept it.",
      acts: ["accepted", "rejected"],
    },
    {
      k: "rejected",
      title: "Rejected",
      sub: null,
      acts: ["accepted"],
    },
  ];

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setBulk(text);
    setNotice(null);
    addBulk.mutate(text);
  }

  return (
    <DeskShell title="Sources" kicker="Watch list">
      <p className="lede">
        The pages the scanner reads on every pass. Add one, paste a whole registry, or review what
        the machine proposes.
      </p>
      <form
        className="src-add"
        onSubmit={(e) => {
          e.preventDefault();
          setNotice(null);
          add.mutate();
        }}
      >
        <Field label="URL">
          <input
            type="text"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.longmontcolorado.gov/…"
            required
          />
        </Field>
        <Field label="Name">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="City Council packets" />
        </Field>
        <InkButton type="submit" small disabled={add.isPending || !url.trim()}>
          {add.isPending ? "Adding…" : "Add source"}
        </InkButton>
      </form>
      <details className="file-form">
        <summary>Bulk paste a registry (.txt, .md, .csv — TIER A/B/C headers honored)</summary>
        <textarea
          rows={5}
          className="bulk"
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
          placeholder={"TIER A — OFFICIAL RECORD\n* City Council: https://www.longmontcolorado.gov/…\nTIER B — JOURNALISM\n* Times-Call: https://www.timescall.com/"}
        />
        <div className="row-acts static">
          <InkButton small disabled={addBulk.isPending || !bulk.trim()} onClick={() => addBulk.mutate(bulk)}>
            {addBulk.isPending ? "Adding list…" : "Add list"}
          </InkButton>
          <InkButton tone="ghost" small disabled={addBulk.isPending} onClick={() => fileRef.current?.click()}>
            Pick a file
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
      </details>
      {notice ? <p className={"note" + (notice.kind === "err" ? " err" : "")}>{notice.text}</p> : null}

      {listIsError && sources.length === 0 ? (
        <ScreenError
          message={listError instanceof Error ? listError.message : "Could not load sources."}
          onRetry={() => void refetchSources()}
          retrying={refetchingSources}
        />
      ) : isPending && sources.length === 0 ? (
        <ListSkeleton rows={5} />
      ) : (
        groups.map((g) => {
          const rows = sources.filter((s) => s.status === g.k);
          if (!rows.length && g.k !== "accepted") return null;
          return (
            <section key={g.k} id={g.k === "accepted" ? "on-watch" : undefined} className="src-sec">
              <SecHead title={g.title} count={rows.length} sub={g.sub ?? undefined} />
              {g.k === "accepted" && !rows.length ? (
                <p className="wire-sum">Nothing on watch yet — add a URL above.</p>
              ) : (
                <SourceTable
                  rows={rows}
                  acts={g.acts}
                  addedId={addedId}
                  onStatus={(id, status) => setStatus.mutate({ id, status })}
                />
              )}
            </section>
          );
        })
      )}
    </DeskShell>
  );
}

function SourceTable({
  rows,
  acts,
  addedId,
  onStatus,
}: {
  rows: SourceRow[];
  acts: ("accepted" | "rejected")[];
  addedId?: number | null;
  onStatus: (id: number, status: "accepted" | "rejected") => void;
}) {
  return (
    <table className="ltable">
      <thead>
        <tr>
          <th>Source</th>
          <th>Tier</th>
          <th>Kind</th>
          <th>Last fetched</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.id} className={"lead-tr" + (addedId === s.id ? " just-added" : "")}>
            <td className="td-hl" data-label="Source">
              <span className="src-t">{s.title}</span>
              <span className="meta-inline block">
                {/^https?:/i.test(s.url) ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="inline-link">
                    {s.url}
                  </a>
                ) : (
                  s.url
                )}
              </span>
              {s.last_error ? (
                <span className="warn-inline">{editorFetchError(s.last_error, s.url) ?? s.last_error}</span>
              ) : null}
            </td>
            <td className="td-meta" data-label="Tier">{s.tier}</td>
            <td className="td-meta" data-label="Kind">{s.kind}</td>
            <td className="td-meta" data-label="Last fetched">{s.last_fetched_at ? formatShortDate(s.last_fetched_at) : "—"}</td>
            <td className="td-acts" data-label="Actions">
              <span className="row-acts">
                {acts.includes("accepted") ? (
                  <InkButton tone="quiet" small onClick={() => onStatus(s.id, "accepted")}>
                    Accept
                  </InkButton>
                ) : null}
                {acts.includes("rejected") ? (
                  <InkButton tone="quiet" small onClick={() => onStatus(s.id, "rejected")}>
                    Drop
                  </InkButton>
                ) : null}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
