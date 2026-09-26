import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { DeskShell, Field, InkButton, SecHead } from "@/components/desk-chrome";
import { ListSkeleton, ScreenError } from "@/components/states";
import { addSource, addSourcesBulk, listSources, setSourceStatus } from "@/lib/news/desk";
import { editorActionError, editorFetchError, kindFromSourceUrl, tierFromKind } from "@/lib/news/desk-copy";
import { applySections, editorSections } from "@/lib/news/sections";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import type { SourceRow } from "@/lib/news/types";

export const Route = createFileRoute("/desk/sources")({ component: SourcesPage });

function SourcesPage() {
  const [sourceTab, setSourceTab] = useState("accepted");
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
  /*
    Which sections a source joins, chosen here at the moment the source is
    added or accepted.

    Assigning a source to a section is a `SectionConfig` write, and
    `applySections` refuses anyone but the owner ("Only the owner can configure
    newspaper sections.") -- so this chooser is shown only when that same
    server function says `canEdit`. Adding and accepting a source stay
    editor-level, exactly as they were; nothing about who may do what changed,
    only where the owner can do it from.
  */
  const sectionsQuery = useQuery({
    queryKey: ["editor-sections"],
    queryFn: () => editorSections(),
  });
  const canAssignSections = Boolean(sectionsQuery.data?.canEdit);
  const reportingSections = (sectionsQuery.data?.sections ?? []).filter(
    (s) => !["opinion", "about"].includes(s.key) && !s.replacementKey,
  );
  const [assignKeys, setAssignKeys] = useState<string[]>([]);
  const [rowKeys, setRowKeys] = useState<Record<number, string[]>>({});
  const sectionNames = (keys: string[]) =>
    keys.map((key) => reportingSections.find((s) => s.key === key)?.name ?? key).join(", ");
  /** Write the section assignments for one source; a no-op for a non-owner. */
  const assignSourceToSections = async (sourceId: number, keys: string[]) => {
    const saved = sectionsQuery.data;
    if (!saved?.canEdit || keys.length === 0) return { ok: true as const };
    const result = await applySections({
      data: {
        revision: saved.revision,
        sections: saved.sections.map((s) =>
          keys.includes(s.key) ? { ...s, sourceIds: [...new Set([...s.sourceIds, sourceId])] } : s,
        ),
      },
    });
    if (result.ok) await qc.invalidateQueries({ queryKey: ["editor-sections"] });
    return result;
  };
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
      setSourceTab("accepted");
      const keys = assignKeys;
      setNotice({
        kind: "ok",
        text: `On watch: ${res.source.title} — ${res.source.url}`,
      });
      qc.setQueryData(["sources"], (old: SourceRow[] | undefined) => {
        if (!old) return [res.source];
        return [
          res.source,
          ...old.filter((s) => s.id !== res.source.id && s.url !== res.source.url),
        ];
      });
      void qc.invalidateQueries({ queryKey: ["sources"] });
      // The section assignment is a second write, so it can fail on its own
      // (a stale revision, an expired session). Say which half landed.
      void assignSourceToSections(res.source.id, keys).then((assignment) => {
        if (!assignment.ok) {
          setNotice({
            kind: "err",
            text: `On watch: ${res.source.title} — ${res.source.url}. The section assignment failed: ${assignment.error}`,
          });
          return;
        }
        if (keys.length) {
          setAssignKeys([]);
          setNotice({
            kind: "ok",
            text: `On watch: ${res.source.title} — ${res.source.url}. Assigned to ${sectionNames(keys)}.`,
          });
        }
      });
      requestAnimationFrame(() => {
        document.getElementById("on-watch")?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    },
    onError: (err) => {
      // The URL and Name boxes carry no `maxLength` and `addSourceInput` caps
      // both, so a long paste reached the notice bar as the issues array.
      const raw = err instanceof Error ? err.message : "";
      setNotice({
        kind: "err",
        text:
          raw === "Unauthorized"
            ? "Session expired. Sign in again, then retry."
            : editorActionError(raw, "add that source") ?? "Could not add that source.",
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
      setSourceTab("accepted");
      const t = res.byTier;
      setNotice({
        kind: "ok",
        text: `Added ${res.added} sources (A ${t.A} · B ${t.B} · C ${t.C}). Tier C is scanned as a discovery clue, never treated as fact.`,
      });
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (err) => {
      // Same boundary on the registry box: `bulkSourceInput.text` caps at
      // 200,000 and the textarea is unbounded (a chosen file is read whole
      // into it), so a big paste or file dumped the schema.
      const raw = err instanceof Error ? err.message : "";
      setNotice({
        kind: "err",
        text:
          raw === "Unauthorized"
            ? "Session expired. Sign in again, then retry."
            : editorActionError(raw, "read that registry") ?? "Bulk add failed.",
      });
    },
  });
  /** Tick or untick one reporting section for one row's pending assignment. */
  const toggleRowKey = (rowId: number, key: string) =>
    setRowKeys((map) => {
      const keys = map[rowId] ?? [];
      return {
        ...map,
        [rowId]: keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key],
      };
    });
  const clearRowKey = (rowId: number) =>
    setRowKeys((map) => {
      if (!(rowId in map)) return map;
      const next = { ...map };
      delete next[rowId];
      return next;
    });
  const setStatus = useMutation({
    mutationFn: (input: { id: number; status: "accepted" | "rejected" }) =>
      setSourceStatus({ data: input }),
    onSuccess: async (_res, input) => {
      await qc.invalidateQueries({ queryKey: ["sources"] });
      const keys = rowKeys[input.id] ?? [];
      if (input.status !== "accepted" || !keys.length) {
        clearRowKey(input.id);
        return;
      }
      // Accept first, assign second: applySections refuses a source that is
      // not accepted yet, so this order is the only one that works.
      const assignment = await assignSourceToSections(input.id, keys);
      clearRowKey(input.id);
      setNotice(
        assignment.ok
          ? { kind: "ok", text: `Accepted and filed under ${sectionNames(keys)}.` }
          : {
              kind: "err",
              text: `Accepted, but filing it under ${sectionNames(keys)} failed: ${assignment.error}`,
            },
      );
    },
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
      <details className="file-form astra-source-add">
        <summary>Add a source</summary>
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
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="City Council packets"
            />
          </Field>
          <InkButton type="submit" small disabled={add.isPending || !url.trim()}>
            {add.isPending ? "Adding…" : "Add source"}
          </InkButton>
          {/* The form is a three-column grid, so this spans it rather than
              becoming a fourth column. */}
          <div className="[grid-column:1/-1]">
            {canAssignSections ? (
              <SectionPicker
                legend="Assign to sections (optional)"
                hint="Tick the newspaper sections this source should feed. Saved with the source, in the same step."
                options={reportingSections}
                picked={assignKeys}
                disabled={add.isPending}
                onToggle={(key) =>
                  setAssignKeys((keys) =>
                    keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key],
                  )
                }
              />
            ) : sectionsQuery.isSuccess ? (
              <p className="meta">
                Only the owner can file a source under a section. Adding and accepting are yours to
                do; an owner can tick the sections here, or on Server → Sections.
              </p>
            ) : null}
          </div>
        </form>
      </details>
      <details className="file-form">
        <summary>Import a source registry</summary>
        <p className="meta">
          Paste a registry or choose a .txt, .md or .csv file. TIER A/B/C headers are preserved.
          Selecting a file adds its sources to the watch list.
        </p>
        <textarea
          rows={5}
          className="bulk"
          aria-label="Paste source registry"
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
          placeholder={
            "TIER A — OFFICIAL RECORD\n* City Council: https://www.longmontcolorado.gov/…\nTIER B — JOURNALISM\n* Times-Call: https://www.timescall.com/"
          }
        />
        <div className="row-acts static">
          <InkButton
            small
            disabled={addBulk.isPending || !bulk.trim()}
            onClick={() => addBulk.mutate(bulk)}
          >
            {addBulk.isPending ? "Adding list…" : "Add list"}
          </InkButton>
          <InkButton
            tone="ghost"
            small
            disabled={addBulk.isPending}
            onClick={() => fileRef.current?.click()}
          >
            Choose registry file
          </InkButton>
          <input
            ref={fileRef}
            type="file"
            aria-label="Choose source registry file"
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
      {notice ? (
        <p className={"note" + (notice.kind === "err" ? " err" : "")}>{notice.text}</p>
      ) : null}

      <div className="filters" aria-label="Source groups">
        {groups.map((g) => (
          <button
            key={g.k}
            className={"filter" + (sourceTab === g.k ? " on" : "")}
            aria-pressed={sourceTab === g.k}
            onClick={() => setSourceTab(g.k)}
          >
            {g.k === "accepted" ? "On watch" : g.k === "proposed" ? "Proposed" : "Dropped"}{" "}
            {sources.filter((s) => s.status === g.k).length}
          </button>
        ))}
      </div>
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
          if (sourceTab !== g.k) return null;
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
                  /* Only where an Accept button sits, because only there can
                     the tick be saved in the same step. */
                  assignUI={
                    canAssignSections && g.acts.includes("accepted")
                      ? {
                          options: reportingSections,
                          picked: (rowId) => rowKeys[rowId] ?? [],
                          toggle: toggleRowKey,
                        }
                      : null
                  }
                />
              )}
            </section>
          );
        })
      )}
    </DeskShell>
  );
}

/**
 * A multi-select of the newspaper sections a source can feed.
 *
 * A `fieldset`/`legend` rather than a bare list of checkboxes, so a screen
 * reader announces the group before each section name; each box keeps its own
 * `<label>`, so a click on the word works and the name is the accessible name.
 *
 * Reporting sections only: Opinion and About are written by people, and a
 * replacement section is a merged-away key that no longer reads anything.
 */
function SectionPicker({
  legend,
  hint,
  options,
  picked,
  onToggle,
  disabled,
}: {
  legend: string;
  hint: string;
  options: { key: string; name: string }[];
  picked: string[];
  onToggle: (key: string) => void;
  disabled?: boolean;
}) {
  if (!options.length) return null;
  return (
    <fieldset className="src-sections mt-2 min-w-0 rounded border border-rule px-3 py-2">
      <legend className="px-1 font-semibold">{legend}</legend>
      <p className="meta">{hint}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {options.map((s) => (
          <label key={s.key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={picked.includes(s.key)}
              disabled={disabled}
              onChange={() => onToggle(s.key)}
            />
            {s.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function SourceTable({
  rows,
  acts,
  addedId,
  onStatus,
  assignUI,
}: {
  rows: SourceRow[];
  acts: ("accepted" | "rejected")[];
  addedId?: number | null;
  onStatus: (id: number, status: "accepted" | "rejected") => void;
  /** Absent for a non-owner, and on the On watch list, where a source is already accepted. */
  assignUI?: {
    options: { key: string; name: string }[];
    picked: (rowId: number) => string[];
    toggle: (rowId: number, key: string) => void;
  } | null;
}) {
  const { formatShortDate } = usePaperDateFormatters();
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
                <span className="warn-inline">
                  {editorFetchError(s.last_error, s.url) ?? s.last_error}
                </span>
              ) : null}
            </td>
            <td className="td-meta" data-label="Tier">
              {s.tier}
            </td>
            <td className="td-meta" data-label="Kind">
              {s.kind}
            </td>
            <td className="td-meta" data-label="Last fetched">
              {s.last_fetched_at ? formatShortDate(s.last_fetched_at) : "—"}
            </td>
            <td className="td-acts" data-label="Actions">
              {assignUI ? (
                /* Not `.file-form`: that is the page-level accordion, and this
                   one lives in a table cell. */
                <details className="row-sections">
                  <summary className="inline-block cursor-pointer">
                    {(() => {
                      const picked = assignUI.picked(s.id);
                      return picked.length
                        ? `Sections: ${picked.length} ticked`
                        : "Assign to sections";
                    })()}
                  </summary>
                  <SectionPicker
                    legend="Sections this source feeds"
                    hint="Tick now, then Accept: both are saved in one step."
                    options={assignUI.options}
                    picked={assignUI.picked(s.id)}
                    onToggle={(key) => assignUI.toggle(s.id, key)}
                  />
                </details>
              ) : null}
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
