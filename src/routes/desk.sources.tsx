import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { DeskShell, Field, InkButton, SecHead } from "@/components/desk-chrome";
import { ListSkeleton, ScreenError } from "@/components/states";
import {
  addSource,
  addSourcesBulk,
  listSources,
  reviewSuggestedSources,
  setSourceStatus,
} from "@/lib/news/desk";
import {
  editorActionError,
  editorFetchError,
  kindFromSourceUrl,
  suggestedOriginLine,
  tierFromKind,
} from "@/lib/news/desk-copy";
import { applySections, editorSections } from "@/lib/news/sections";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import type { SourceRow } from "@/lib/news/types";

export const Route = createFileRoute("/desk/sources")({
  /*
    `?tab=` is here for the Command Center's "N more suggested" link, which has
    to land the editor on the list it is counting. Everywhere else links to
    this page without one and lands on the watch list, which is the default.
    An unknown value is dropped rather than trusted, so a hand-typed URL cannot
    open a group this screen does not have.
  */
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: "accepted" | "proposed" | "rejected" } => ({
    tab:
      search.tab === "accepted" || search.tab === "proposed" || search.tab === "rejected"
        ? search.tab
        : undefined,
  }),
  component: SourcesPage,
});

function SourcesPage() {
  const search = Route.useSearch();
  const [sourceTab, setSourceTab] = useState<string>(search.tab ?? "accepted");
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
      title: "Suggested sources",
      sub: "Pages the scan, the research pass and the Dark Desk found while they worked. Nothing is fetched until you accept it, and nothing here is a source until you say so.",
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
            {g.k === "accepted"
              ? "On watch"
              : g.k === "proposed"
                ? "Suggested sources:"
                : "Dropped"}{" "}
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
            <section key={g.k} id={g.k === "accepted" ? "on-watch" : "suggested"} className="src-sec">
              <SecHead title={g.title} count={rows.length} sub={g.sub ?? undefined} />
              {g.k === "accepted" && !rows.length ? (
                <p className="wire-sum">Nothing on watch yet — add a URL above.</p>
              ) : g.k === "proposed" ? (
                /* The one list built for volume: 175 rows were waiting when
                   this was written, so it carries a select-all, a per-press
                   Saving/Saved/Failed line, and one transaction per press. */
                <SuggestedSources rows={rows} canAssign={canAssignSections} options={reportingSections} />
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

/** Which filter bucket a suggestion falls in; anything unknown is "unrecorded". */
function suggesterKey(by: string | null | undefined): "scan" | "research" | "dark" | "editor" | "unrecorded" {
  return by === "scan" || by === "research" || by === "dark" || by === "editor" ? by : "unrecorded";
}

const SUGGESTER_FILTERS: { k: "all" | ReturnType<typeof suggesterKey>; label: string; none: string }[] = [
  { k: "all", label: "Anyone", none: "Nothing is waiting for review." },
  { k: "scan", label: "The scan", none: "No suggestions from the scan are waiting." },
  { k: "research", label: "The research pass", none: "No suggestions from the research pass are waiting." },
  { k: "dark", label: "The Dark Desk", none: "No suggestions from the Dark Desk are waiting." },
  {
    k: "unrecorded",
    label: "Not recorded",
    none: "No suggestions are waiting without a recorded suggester.",
  },
];

/**
 * The Suggested sources list: a pile of suggestions an editor can actually
 * clear, not a list to click through one at a time.
 *
 * WHAT IT IS FOR. Production held 175 waiting suggestions, all of them from
 * the scan, none of them reviewed, and the screen showed a title and a URL --
 * so the only way to decide was to open each page. This shows the reason the
 * pass recorded, who suggested it, which lead it came from and the section it
 * guessed, which is the material a decision needs. Several rows can be decided
 * at once.
 *
 * ONE PRESS, ONE TRANSACTION. Every button here calls `reviewSuggestedSources`
 * with the whole selection: status and section link are written together, so a
 * failure changes nothing and this screen can say "Nothing was changed" and be
 * telling the truth. The old path -- accept, then assign -- could leave a batch
 * half-filed with no way to see which rows landed.
 *
 * The section picker is owner-only, the same rule as everywhere else that
 * writes `section_sources`. An editor without it still accepts and rejects;
 * the guess is shown to them as a note rather than as a control they cannot
 * use.
 */
function SuggestedSources({
  rows,
  canAssign,
  options,
}: {
  rows: SourceRow[];
  canAssign: boolean;
  options: { key: string; name: string }[];
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<number[]>([]);
  const [who, setWho] = useState<"all" | ReturnType<typeof suggesterKey>>("all");
  const [rowSection, setRowSection] = useState<Record<number, string>>({});
  const [rowNote, setRowNote] = useState<Record<number, string>>({});
  const [batchSection, setBatchSection] = useState("");
  const [press, setPress] = useState<{ phase: "saving" | "ok" | "err"; text: string } | null>(null);

  const nameOf = (key: string) => options.find((o) => o.key === key)?.name ?? key;
  /*
    The model's section guess, used as the picker's starting value -- but only
    when this newsroom still files under that key. A guess for a section that
    has since been renamed or merged away is a value this select cannot show
    and the accept would refuse, so it is dropped here and the picker starts
    empty rather than preselected with something that cannot be saved.
  */
  const guessFor = (row: SourceRow) =>
    row.proposed_section && options.some((o) => o.key === row.proposed_section)
      ? row.proposed_section
      : "";
  const sectionFor = (row: SourceRow) => rowSection[row.id] ?? guessFor(row);

  const review = useMutation({
    mutationFn: (input: {
      ids: number[];
      decision: "accepted" | "rejected";
      sectionKey?: string;
      note?: string;
    }) => reviewSuggestedSources({ data: input }),
    onMutate: (input) =>
      setPress({
        phase: "saving",
        text:
          input.ids.length === 1
            ? `Saving "${rows.find((r) => r.id === input.ids[0])?.title ?? "that suggestion"}"…`
            : `Saving ${input.ids.length} suggestions…`,
      }),
    onSuccess: (res, input) => {
      if (!res.ok) {
        // The server says nothing was written; repeat it here rather than
        // letting the editor work out which half landed.
        setPress({ phase: "err", text: `Nothing was changed: ${res.error}` });
        return;
      }
      const n = input.ids.length;
      const one = n === 1 ? (rows.find((r) => r.id === input.ids[0])?.title ?? "That suggestion") : null;
      const noteSaved = input.note ? " The note was saved with it." : "";
      const verb = input.decision === "accepted" ? "Accepted" : "Rejected";
      const what = one ? `"${one}"` : `${n} suggestions`;
      const where =
        input.decision === "accepted"
          ? res.sectionName
            ? ` and filed ${one ? "it" : "them"} under ${res.sectionName}`
            : " onto the watch list"
          : "";
      setPress({ phase: "ok", text: `${verb} ${what}${where}.${noteSaved}` });
      setSelected([]);
      setRowNote({});
      setRowSection({});
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (err) => {
      // A thrown error is the boundary, not the server's own refusal: an
      // expired session, or a payload the validator refused (the batch cap).
      const raw = err instanceof Error ? err.message : "";
      setPress({
        phase: "err",
        text:
          raw === "Unauthorized"
            ? "Nothing was changed: the session expired. Sign in again, then retry."
            : `Nothing was changed: ${
                editorActionError(raw, "review those suggestions") ?? "could not reach the desk."
              }`,
      });
    },
  });

  const visible = who === "all" ? rows : rows.filter((r) => suggesterKey(r.proposed_by) === who);
  const allPicked = visible.length > 0 && visible.every((r) => selected.includes(r.id));
  const togglePicked = (id: number) =>
    setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const noteFor = (row: SourceRow) => rowNote[row.id]?.trim() || undefined;
  const decide = (
    ids: number[],
    decision: "accepted" | "rejected",
    sectionKey?: string,
    note?: string,
  ) => {
    if (!ids.length) return;
    review.mutate({ ids, decision, sectionKey, note });
  };

  return (
    <>
      <div className="row-acts static" aria-label="Decide several suggestions at once">
        <InkButton
          small
          disabled={!selected.length || review.isPending}
          onClick={() =>
            decide(selected, "accepted", canAssign ? batchSection || undefined : undefined)
          }
        >
          Accept selected{canAssign && batchSection ? ` to ${nameOf(batchSection)}` : ""}
        </InkButton>
        <InkButton
          tone="ghost"
          small
          disabled={!selected.length || review.isPending}
          onClick={() => decide(selected, "rejected")}
        >
          Reject selected
        </InkButton>
        <InkButton
          tone="ghost"
          small
          disabled={!visible.length || review.isPending}
          onClick={() => setSelected(allPicked ? [] : visible.map((r) => r.id))}
        >
          {allPicked ? "Clear selection" : `Select all ${visible.length}`}
        </InkButton>
        {canAssign && options.length ? (
          <label className="meta-inline">
            Section for the batch
            <select
              className="ml-2"
              value={batchSection}
              disabled={review.isPending}
              onChange={(e) => setBatchSection(e.target.value)}
            >
              <option value="">No section</option>
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="filters" aria-label="Who suggested these sources">
        {SUGGESTER_FILTERS.map((f) => {
          const count =
            f.k === "all" ? rows.length : rows.filter((r) => suggesterKey(r.proposed_by) === f.k).length;
          return (
            <button
              key={f.k}
              className={"filter" + (who === f.k ? " on" : "")}
              aria-pressed={who === f.k}
              onClick={() => setWho(f.k)}
            >
              {f.label} {count}
            </button>
          );
        })}
      </div>
      {press ? (
        <p className={"note" + (press.phase === "err" ? " err" : "")} role="status">
          {press.text}
        </p>
      ) : null}
      {!rows.length ? (
        <p className="wire-sum">
          Nothing is waiting for review. The scan, the research pass and the Dark Desk file what
          they find here as they work.
        </p>
      ) : !visible.length ? (
        <p className="wire-sum">{SUGGESTER_FILTERS.find((f) => f.k === who)?.none}</p>
      ) : (
        <table className="ltable">
          <thead>
            <tr>
              <th>
                <span className="sr-only">Select</span>
              </th>
              <th>Suggested source</th>
              <th>Why it was suggested</th>
              <th>Suggested by</th>
              <th>Section</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const picked = sectionFor(s);
              return (
                <tr key={s.id} className="lead-tr">
                  <td className="td-meta" data-label="Select">
                    <input
                      type="checkbox"
                      checked={selected.includes(s.id)}
                      disabled={review.isPending}
                      aria-label={`Select ${s.title}`}
                      onChange={() => togglePicked(s.id)}
                    />
                  </td>
                  <td className="td-hl" data-label="Suggested source">
                    <span className="src-t">{s.title}</span>
                    <span className="meta-inline block">
                      <a href={s.url} target="_blank" rel="noreferrer" className="inline-link">
                        {s.url}
                      </a>
                    </span>
                  </td>
                  <td className="td-meta" data-label="Why">
                    {/*
                      A row suggested before 0.6.70 has no reason on it. Saying
                      so is the point -- 175 of them were waiting, and a blank
                      cell would read as "the reason is nothing".
                    */}
                    {s.proposed_reason ?? "No reason was recorded when this was suggested."}
                  </td>
                  <td className="td-meta" data-label="Suggested by">
                    {suggestedOriginLine(s)}
                    {s.proposed_lead_id != null ? (
                      <>
                        {" "}
                        <Link
                          to="/desk/story/$leadId"
                          params={{ leadId: String(s.proposed_lead_id) }}
                          className="inline-link"
                        >
                          Open the lead
                        </Link>
                      </>
                    ) : null}
                  </td>
                  <td className="td-meta" data-label="Section">
                    {canAssign ? (
                      <select
                        aria-label={`Section for ${s.title}`}
                        value={picked}
                        disabled={review.isPending}
                        onChange={(e) =>
                          setRowSection((map) => ({ ...map, [s.id]: e.target.value }))
                        }
                      >
                        <option value="">No section</option>
                        {options.map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    ) : s.proposed_section ? (
                      `Guessed ${s.proposed_section}`
                    ) : (
                      "No section guessed"
                    )}
                  </td>
                  <td className="td-acts" data-label="Actions">
                    <input
                      className="mb-1 w-full"
                      value={rowNote[s.id] ?? ""}
                      disabled={review.isPending}
                      aria-label={`Review note for ${s.title}`}
                      placeholder="Note (optional)"
                      onChange={(e) => setRowNote((map) => ({ ...map, [s.id]: e.target.value }))}
                    />
                    <span className="row-acts">
                      <InkButton
                        tone="quiet"
                        small
                        disabled={review.isPending}
                        onClick={() => decide([s.id], "accepted", canAssign ? picked || undefined : undefined, noteFor(s))}
                      >
                        {canAssign && picked ? `Accept to ${nameOf(picked)}` : "Accept"}
                      </InkButton>
                      <InkButton
                        tone="quiet"
                        small
                        disabled={review.isPending}
                        onClick={() => decide([s.id], "rejected", undefined, noteFor(s))}
                      >
                        Reject
                      </InkButton>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
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
