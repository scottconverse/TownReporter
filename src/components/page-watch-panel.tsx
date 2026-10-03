import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InkButton } from "./desk-chrome";
import { ActionButton, rowActionPhase } from "./action-button";
import { ModelPicker } from "./model-picker";
import { refusedAnswer } from "@/lib/news/refused-answer";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import { useEditorSections } from "@/lib/use-sections";
import type { StoryModelChoice } from "@/lib/news/model-choice";
import { defaultModelEffort, type ModelEffort } from "@/lib/news/provider-registry";
import {
  listPageWatches,
  createPageWatch,
  checkPageWatch,
  pageWatchDetail,
  setPageWatchState,
  actOnPageWatch,
  setPageWatchModel,
  readPageWatchCapture,
} from "@/lib/news/page-watch-actions";
const WORDS: Record<string, string> = {
  "first-capture": "First capture saved",
  unchanged: "Checked — no text change",
  changed: "Text changed",
  moved: "Page moved — inspect the redirect",
  failed: "Check failed",
  blocked: "Source blocked the check",
  unavailable: "Page unavailable",
  "no-readable-text": "No readable text",
  "needs-ocr": "Scanned PDF — not readable yet",
  "refused-too-large": "Source too large to read",
  "refused-content-type": "Unsupported source file type",
};
export function PageWatchPanel({
  files,
  onOpenFile,
}: {
  files: Array<{ id: number; title: string }>;
  onOpenFile: (id: number) => void;
}) {
  const qc = useQueryClient(),
    { formatListDateTime } = usePaperDateFormatters();
  const sections = useEditorSections();
  const [sectionKey, setSectionKey] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState(false),
    [selected, setSelected] = useState<number | null>(null),
    [offset, setOffset] = useState(0);
  const [url, setUrl] = useState(""),
    [name, setName] = useState(""),
    [reason, setReason] = useState(""),
    [file, setFile] = useState(""),
    [model, setModel] = useState<StoryModelChoice>("auto"),
    [modelEffort, setModelEffort] = useState<ModelEffort | null>(defaultModelEffort("auto"));
  const [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [leadId, setLeadId] = useState<number | null>(null),
    [attached, setAttached] = useState<number | null>(null),
    [target, setTarget] = useState("");
  const watches = useQuery({
    queryKey: ["page-watches"],
    queryFn: () => listPageWatches(),
    refetchInterval: expanded ? 15000 : false,
  });
  const detail = useQuery({
    queryKey: ["page-watch", selected, offset],
    queryFn: () => pageWatchDetail({ data: { id: selected!, offset } }),
    enabled: selected != null && expanded,
    refetchInterval: expanded ? 15000 : false,
  });
  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["page-watches"] }),
      qc.invalidateQueries({ queryKey: ["page-watch"] }),
      qc.invalidateQueries({ queryKey: ["investigation"] }),
    ]);
  }
  const check = useMutation({
    mutationFn: (id: number) => checkPageWatch({ data: id }),
    onSuccess: async (r) => {
      if (r.ok) setNote(WORDS[r.state] ?? r.state);
      else setError(r.error);
      await refresh();
    },
    onError: (e) => setError(e.message),
  });
  const create = useMutation({
    mutationFn: () =>
      createPageWatch({
        data: {
          url,
          name,
          reason,
          modelChoice: model,
          modelEffort,
          investigationId: file ? Number(file) : null,
        },
      }),
    onSuccess: async (r) => {
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSelected(r.id);
      setOffset(0);
      if (r.alreadyExists) {
        setNote(
          "This page is already watched. Open its existing watch below; its name, file and state were preserved.",
        );
        await refresh();
        return;
      }
      setNote("Watch saved. First check is starting; history will show the result.");
      setUrl("");
      setName("");
      setReason("");
      await refresh();
      check.mutate(r.id);
    },
    onError: (e) => setError(e.message),
  });
  const modelSave = useMutation({
    mutationFn: (input: { id: number; choice: string; effort: ModelEffort | null }) => setPageWatchModel({ data: input }),
    onSuccess: async (r) => {
      if (r.ok) setNote("OCR model saved for future checks.");
      else setError(r.error);
      await refresh();
    },
    onError: (e) => setError(e.message),
  });
  async function download(checkId: number, previous = false) {
    clear();
    try {
      const captured = await readPageWatchCapture({
        data: { watchId: selected!, checkId, previous },
      });
      if (!captured) {
        setError("Captured text not found on this watch.");
        return;
      }
      const href = URL.createObjectURL(
        new Blob([captured.full_text], { type: "text/plain;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = href;
      a.download = `watched-page-${selected}-${checkId}-${previous ? "previous" : "current"}.txt`;
      a.click();
      URL.revokeObjectURL(href);
      setNote("Captured text downloaded. This is the stored copy, not a new fetch.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    }
  }
  const state = useMutation({
    mutationFn: (input: { id: number; state: "active" | "paused" | "stopped" }) =>
      setPageWatchState({ data: input }),
    onSuccess: async (r) => {
      if (r.ok) setNote("Watch state saved. Capture history is retained.");
      else setError(r.error);
      await refresh();
    },
    onError: (e) => setError(e.message),
  });
  const action = useMutation({
    mutationFn: (input: { checkId: number; action: "lead" | "attach" | "dismiss" }) =>
      actOnPageWatch({
        data: {
          ...input,
          watchId: selected!,
          investigationId: target ? Number(target) : undefined,
          sectionKey,
        },
      }),
    onSuccess: async (r) => {
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if ("leadId" in r && r.leadId) {
        setLeadId(r.leadId);
        setNote("Unverified lead is on the queue. Nothing was published.");
      } else if ("investigationId" in r && r.investigationId) {
        setAttached(r.investigationId);
        setNote("Captured record attached to the investigation.");
      } else setNote("Change dismissed. The capture remains in history.");
      await refresh();
    },
    onError: (e) => setError(e.message),
  });
  const busy =
    create.isPending ||
    check.isPending ||
    state.isPending ||
    action.isPending ||
    modelSave.isPending;
  function clear() {
    setError("");
    setNote("");
    setLeadId(null);
    setAttached(null);
  }
  const row = detail.data?.watch;
  /*
    Unit UI1a3, finding 1: `checkPageWatch` and `setPageWatchState` both answer
    `{ ok: false, error }` for their ordinary refusals, which React Query
    settles as a SUCCESS. Read once here, gated on `!isPending` -- React Query
    keeps the last answer on `data` while a new press runs, so an ungated read
    would paint the previous refusal over this press's spinner.
  */
  const checkRefusal = check.isPending ? null : refusedAnswer(check.data);
  const stateRefusal = state.isPending ? null : refusedAnswer(state.data);
  return (
    <section className="tipbox page-watch" aria-label="Watched pages">
      <div className="np-acts">
        <h2>Watched pages · {watches.data?.length ?? 0}</h2>
        <InkButton tone="quiet" small onClick={() => setExpanded(!expanded)}>
          {expanded ? "Close watch form" : "Watch a page"}
        </InkButton>
      </div>
      <p className="meta">
        Daily checks keep dated captures of the public pages you watch.
      </p>
          {watches.isError ? (
            <p role="alert">Could not load watches. Reload this page.</p>
          ) : watches.isPending ? (
            <p>Loading watches…</p>
          ) : !watches.data?.length ? (
            <p>No pages watched yet.</p>
          ) : (
            <div className="watch-list">
              {(showAll ? watches.data : watches.data.slice(0, 5)).map((w) => (
                <div className="deskfile" key={w.id}>
                  <h3>{w.title}</h3>
                  <p className="meta">
                    {w.watch_state} ·{" "}
                    {w.last_check_at
                      ? `${WORDS[w.last_outcome ?? ""] ?? w.last_outcome} · ${formatListDateTime(w.last_check_at)}`
                      : "First capture pending — not checked yet"}
                  </p>
                  <InkButton
                    small
                    onClick={() => {
                      clear();
                      setExpanded(true);
                      setSelected(w.id);
                      setTarget(w.investigation_id ? String(w.investigation_id) : "");
                      setOffset(0);
                    }}
                  >
                    Open watch
                  </InkButton>
                </div>
              ))}
            </div>
          )}
          {(watches.data?.length ?? 0) > 5 ? <InkButton tone="quiet" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${watches.data?.length}`}</InkButton> : null}
      {expanded ? (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              clear();
              create.mutate();
            }}
            className="work-form"
          >
            <label className="f">
              Page URL
              <input
                type="url"
                required
                maxLength={2048}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
              />
            </label>
            <label className="f">
              Watch name
              <input
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="f">
              Why watch this page?
              <textarea
                required
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <label className="f">
              Investigation (optional)
              <select
                aria-label="Investigation (optional)"
                value={file}
                onChange={(e) => setFile(e.target.value)}
              >
                <option value="">No file yet</option>
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            </label>
            <p className="meta">
              A chosen investigation receives readable captures automatically. You can also attach a
              capture later.
            </p>
            <p className="meta">
              OCR model, used only if a scanned PDF needs reading. Other pages do not need AI.
            </p>
            <ModelPicker scope="dark" value={model} onChange={(choice) => {
              setModel(choice);
              setModelEffort(defaultModelEffort(choice));
            }} effort={modelEffort} onEffortChange={setModelEffort} disabled={busy} />
            <InkButton type="submit" disabled={busy}>
              {create.isPending ? "Saving watch…" : "Save watch and capture page"}
            </InkButton>
          </form>
          {error ? (
            <p className="note err" role="alert">
              {error}
            </p>
          ) : null}
          {note ? (
            <p className="note" role="status">
              {note}{" "}
              {leadId ? (
                <Link
                  to="/desk/story/$leadId"
                  params={{ leadId: String(leadId) }}
                  className="inline-link"
                >
                  Open the lead
                </Link>
              ) : null}{" "}
              {/* UI1b-4: opening the investigation file does something, so this
                  is a button and wears the Quiet edge -- it was wearing
                  `.inline-link`, the underlined look the desk reserves for
                  controls that go somewhere. Label and behaviour unchanged. */}
              {attached ? (
                <InkButton tone="quiet" small onClick={() => onOpenFile(attached)}>
                  Open investigation
                </InkButton>
              ) : null}
            </p>
          ) : null}
          {row ? (
            <article className="openfile">
              <h3>{row.title}</h3>
              <p>{row.watch_reason}</p>
              <p className="read-url">{row.url}</p>
              <p>
                <a href={row.url} target="_blank" rel="noreferrer" className="inline-link">
                  Open original
                </a>
              </p>
              <p className="meta">
                State: {row.watch_state}.{" "}
                {row.last_check_at
                  ? `Last checked ${formatListDateTime(row.last_check_at)}.`
                  : "No completed check yet."}{" "}
                {row.watch_state === "active"
                  ? `Next scheduled check ${formatListDateTime(row.next_check_at)} (the local scheduler must be running).`
                  : "Automatic checks are stopped; history remains."}
              </p>
              {row.watch_check_started_at ? (
                <p role="status">
                  Check started {formatListDateTime(row.watch_check_started_at)}. If interrupted, it can
                  be retried after 30 minutes.
                </p>
              ) : null}
              {row.watch_last_error ? <p className="note err">{row.watch_last_error}</p> : null}
              {row.watch_failover_note ? (
                <p className="note" role="status">{row.watch_failover_note}</p>
              ) : null}
              <p className="meta">Model for the next scanned PDF check:</p>
              <ModelPicker
                scope="dark"
                value={row.watch_model_choice as StoryModelChoice}
                effort={row.watch_model_effort}
                disabled={busy}
                onChange={(choice) => {
                  clear();
                  modelSave.mutate({ id: row.id, choice, effort: defaultModelEffort(choice) });
                }}
                onEffortChange={(effort) => {
                  clear();
                  modelSave.mutate({ id: row.id, choice: row.watch_model_choice, effort });
                }}
              />
              <div className="np-acts">
                {/*
                  Unit UI1a2: Check now, Pause / Resume and Stop watching are
                  the shared `ActionButton` here too. Pause's DONE is the row's
                  own new state -- the button is redrawn as "Resume" because
                  `row.watch_state` changed -- and Check now's is "Checked",
                  with the row's own answer (`watch_last_error` /
                  `watch_failover_note`) still printed above it, which is the
                  existing flow and not a second confirmation.
                */}
                <ActionButton
                  phase={
                    check.isPending
                      ? "working"
                      : check.isError || checkRefusal
                        ? "failed"
                        : check.isSuccess
                          ? "done"
                          : "idle"
                  }
                  workingLabel="Checking…"
                  doneLabel="Checked"
                  /*
                    Unit UI1a3, finding 1: `checkPageWatch` answers
                    `{ ok: false, error }` for a page it could not read, which
                    settles as a SUCCESS -- so without this the control drew
                    "Checked" in green over a refusal. The refusal outranks the
                    success branch, and the reason is printed beside it.
                  */
                  reason={
                    check.isError
                      ? check.error instanceof Error
                        ? check.error.message
                        : "Could not check that page."
                      : checkRefusal
                  }
                  disabled={busy || row.watch_state !== "active"}
                  disabledReason={
                    row.watch_state !== "active"
                      ? "This page is paused, so the desk is not checking it."
                      : null
                  }
                  onAct={() => {
                    clear();
                    check.mutate(row.id);
                  }}
                >
                  Check now
                </ActionButton>
                <ActionButton
                  tone="quiet"
                  phase={rowActionPhase({
                    /*
                      Unit UI1a3, finding 3: Pause/Resume and Stop share ONE
                      `state` mutation, so an unfiltered `isPending` put this
                      button into its working phase whenever "Stop watching" was
                      pressed -- the row said "Pausing." and "Stopping." at once.
                      The pending phase is scoped to the states this button
                      actually sends, exactly as the failure branch already was.
                    */
                    isPending: state.isPending && state.variables?.state !== "stopped",
                    problem:
                      state.variables?.state !== "stopped"
                        ? state.isError
                          ? state.error instanceof Error
                            ? state.error.message
                            : "Could not change that page's watch."
                          : stateRefusal
                        : null,
                  })}
                  workingLabel={row.watch_state === "active" ? "Pausing…" : "Resuming…"}
                  disabled={busy}
                  onAct={() => {
                    clear();
                    state.mutate({
                      id: row.id,
                      state: row.watch_state === "active" ? "paused" : "active",
                    });
                  }}
                >
                  {row.watch_state === "active" ? "Pause" : "Resume"}
                </ActionButton>
                <ActionButton
                  tone="danger"
                  phase={rowActionPhase({
                    isPending: state.isPending && state.variables?.state === "stopped",
                    problem:
                      state.variables?.state === "stopped"
                        ? state.isError
                          ? state.error instanceof Error
                            ? state.error.message
                            : "Could not stop watching that page."
                          : /* Unit UI1a3, finding 1: the same settled-refusal
                               read as the Pause/Resume button above. */
                            stateRefusal
                        : null,
                  })}
                  workingLabel="Stopping…"
                  disabled={busy || row.watch_state === "stopped"}
                  disabledReason={
                    row.watch_state === "stopped" ? "This page is already stopped." : null
                  }
                  onAct={() => {
                    clear();
                    state.mutate({ id: row.id, state: "stopped" });
                  }}
                >
                  Stop watching
                </ActionButton>
              </div>
              <h4>Capture history</h4>
              <p className="meta">
                Newest first, 20 checks per page. Failed checks are not “unchanged.” Comparison uses
                the last readable capture, even if checks failed in between.
              </p>
              {detail.data?.history.map((h) => (
                <details key={h.id} className="of-trail">
                  <summary>
                    {formatListDateTime(h.created_at)} · {WORDS[h.state] ?? h.state}
                    {h.state === "moved"
                      ? h.textChanged
                        ? " · Text changed"
                        : " · Text unchanged"
                      : ""}
                  </summary>
                  <p className="meta">
                    {h.actions.some((a) => a.action === "dismiss")
                      ? "Dismissed — capture retained in history."
                      : ""}
                  </p>
                  {h.actions
                    .filter((a) => a.action === "lead")
                    .map((a) => (
                      <p key={`lead-${a.result_id}`}>
                        {a.target_exists ? (
                          <Link
                            to="/desk/story/$leadId"
                            params={{ leadId: String(a.result_id) }}
                            className="inline-link"
                          >
                            Open created lead
                          </Link>
                        ) : (
                          "The created lead was removed. Capture history remains."
                        )}
                      </p>
                    ))}
                  {h.actions
                    .filter((a) => a.action === "attach")
                    .map((a) => (
                      <p key={`file-${a.target_id}`}>
                        {/* UI1b-4: same as "Open investigation" above -- it
                            opens a file, so it is a Quiet button. */}
                        {a.target_exists ? (
                          <InkButton tone="quiet" small onClick={() => onOpenFile(a.target_id)}>
                            Open attached investigation
                          </InkButton>
                        ) : (
                          "The attached record or investigation was removed. Capture history remains."
                        )}
                      </p>
                    ))}
                  {h.note ? <p>{h.note}</p> : null}
                  <pre className="read-full">{h.diff}</pre>
                  {h.textShortened ? (
                    <p>
                      Text previews are shortened to 30,000 characters. The complete capture remains
                      stored.
                    </p>
                  ) : null}
                  <details>
                    <summary>Read this captured text</summary>
                    <pre className="read-full">{h.full_text || "No readable text captured."}</pre>
                  </details>
                  {h.previous_text ? (
                    <details>
                      <summary>Read previous captured text</summary>
                      <pre className="read-full">{h.previous_text}</pre>
                    </details>
                  ) : null}
                  <div className="np-acts">
                    <InkButton small tone="quiet" onClick={() => download(h.id)}>
                      Download complete captured text
                    </InkButton>
                    {h.previous_text ? (
                      <InkButton small tone="quiet" onClick={() => download(h.id, true)}>
                        Download previous captured text
                      </InkButton>
                    ) : null}
                  </div>
                  <p className="meta">Extraction: {h.extraction_method || "not recorded"}</p>
                  {h.redirect_chain !== "[]" ? (
                    <p className="read-url">Redirect trail: {h.redirect_chain}</p>
                  ) : null}
                  <div className="np-acts">
                    <label className="f">
                      Lead section
                      <select
                        aria-label="Lead section"
                        value={sectionKey}
                        onChange={(e) => setSectionKey(e.target.value)}
                      >
                        <option value="">Choose a reporting section</option>
                        {sections.sections
                          .filter((s) => !["about", "opinion"].includes(s.key))
                          .map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <InkButton
                      small
                      disabled={busy || !h.full_text || !sectionKey}
                      onClick={() => {
                        clear();
                        action.mutate({ checkId: h.id, action: "lead" });
                      }}
                    >
                      Create unverified lead
                    </InkButton>
                    <InkButton
                      small
                      tone="quiet"
                      disabled={busy}
                      onClick={() => {
                        clear();
                        action.mutate({ checkId: h.id, action: "dismiss" });
                      }}
                    >
                      Dismiss change
                    </InkButton>
                  </div>
                  <label className="f">
                    Attach to investigation
                    <select
                      aria-label="Attach to investigation"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">Choose a file</option>
                      {files.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <InkButton
                    small
                    disabled={busy || !target || !h.full_text}
                    onClick={() => {
                      clear();
                      action.mutate({ checkId: h.id, action: "attach" });
                    }}
                  >
                    Attach captured record
                  </InkButton>
                </details>
              ))}
              <div className="np-acts">
                <InkButton
                  tone="quiet"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 20))}
                >
                  Newer checks
                </InkButton>
                <InkButton
                  tone="quiet"
                  disabled={(detail.data?.history.length ?? 0) < 20}
                  onClick={() => setOffset(offset + 20)}
                >
                  Older checks
                </InkButton>
              </div>
            </article>
          ) : detail.isError ? (
            <p role="alert">Could not load capture history.</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
