import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { DraftBatchResult } from "@/components/draft-batch-result";
import { DeskShell, Field, InkButton } from "@/components/desk-chrome";
import { LeadRowView, SEEN_AGAIN_EXPLAINER } from "@/components/desk-leads";
import { ListSkeleton, Notice, ScreenError } from "@/components/states";
import { deleteLead, draftLead, fileLead, listLeads, listPublishedDesk, listScans, setLeadStatus } from "@/lib/news/desk";
import { restoreTrashItem } from "@/lib/news/trash";
import { mergeFocusSelection, nearDuplicate, openLeads, suggestFocusLeads, workingQueueEmptyCopy } from "@/lib/news/desk-copy";
import { useEditorSections } from "@/lib/use-sections";
import { usePaper } from "@/lib/paper-context";
import { modelChoiceLabel, type StoryModelChoice } from "@/lib/news/model-choice";
import { myDesk } from "@/lib/news/claim";
import {
  getDraftBatch,
  startDraftBatch,
  type DraftBatchRuntime,
} from "@/lib/news/draft-batch";

const BATCH_RUNTIMES: ReadonlyArray<{ value: DraftBatchRuntime; label: string }> = [
  { value: "local", label: "Local model" },
  { value: "claude-cli", label: "Claude Code" },
  { value: "codex-terra", label: "Codex Terra" },
  { value: "codex-sol", label: "Codex Sol" },
];

export const Route = createFileRoute("/desk/queue")({ component: QueuePage });

function QueuePage() {
  const { sections } = useEditorSections();
  const TOPICS = sections.map(s=>s.key);
  const PAPER = usePaper();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const desk = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const newsroomId = desk.data?.ok ? desk.data.newsroomId : null;
  const { data: leads = [], isPending, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["leads"],
    queryFn: () => listLeads(),
    placeholderData: keepPreviousData,
  });
  const scans = useQuery({ queryKey: ["scans"], queryFn: () => listScans() });
  const published = useQuery({ queryKey: ["published-desk"], queryFn: () => listPublishedDesk() });
  const setStatus = useMutation({
    mutationFn: (input: { id: number; status: "held" | "killed" | "new" }) =>
      setLeadStatus({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteLead({ data: id }),
    onSuccess: (res) => {
      if (!res?.ok) {
        setDeleteError(res?.error ?? "That did not delete.");
        setUndo(null);
      } else {
        // Undo where the delete happened. The trash on the Server page is the
        // durable net; this is the one an editor will actually reach for.
        setDeleteError("");
        setUndo(res.trashId);
      }
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => setDeleteError(e instanceof Error ? e.message : "That did not delete."),
  });
  const [deleteError, setDeleteError] = useState("");
  const [undo, setUndo] = useState<number | null>(null);
  const undoDelete = useMutation({
    mutationFn: (id: number) => restoreTrashItem({ data: id }),
    onSuccess: (res) => {
      setUndo(null);
      if (!res?.ok) setDeleteError(res?.error ?? "That would not go back.");
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["trash"] });
    },
    onError: (e) => setDeleteError(e instanceof Error ? e.message : "That would not go back."),
  });
  const [filter, setFilter] = useState<"all" | "new" | "drafted" | "held" | "killed">("all");
  const [focusTarget, setFocusTarget] = useState<3 | 4 | 5>(3);
  const [headline, setHeadline] = useState("");
  const [why, setWhy] = useState("");
  const [topic, setTopic] = useState("council");
  const [url, setUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [draftNotices, setDraftNotices] = useState<Record<number, { kind: "ok" | "err"; text: string }>>({});
  const [draftingIds, setDraftingIds] = useState<number[]>([]);
  const [selectedBatchLeadIds, setSelectedBatchLeadIds] = useState<number[]>([]);
  const [batchRuntime, setBatchRuntime] = useState<DraftBatchRuntime>("local");
  const [activeBatchId, setActiveBatchId] = useState<number | null>(null);
  const [batchNotice, setBatchNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const leadRefreshAfterTerminalBatch = useRef<number | null>(null);
  const batch = useQuery({
    queryKey: ["draft-batch", newsroomId, activeBatchId ?? "latest"],
    queryFn: () => getDraftBatch({ data: activeBatchId ? { batchId: activeBatchId } : {} }),
    enabled: newsroomId !== null,
    refetchInterval: (query) => {
      const result = query.state.data;
      if (!result?.ok || !result.batch) return false;
      return result.batch.items.some((item) => item.status === "queued" || item.status === "running")
        ? 1_500
        : false;
    },
  });
  useEffect(() => {
    const current = batch.data?.ok ? batch.data.batch : null;
    if (!current) return;
    const open = current.items.some((item) => item.status === "queued" || item.status === "running");
    if (open || leadRefreshAfterTerminalBatch.current === current.id) return;
    leadRefreshAfterTerminalBatch.current = current.id;
    void qc.invalidateQueries({ queryKey: ["leads"] });
  }, [batch.data, qc]);
  const startBatch = useMutation({
    mutationFn: (input: { leadIds: number[]; runtime: DraftBatchRuntime }) =>
      startDraftBatch({
        data: { items: input.leadIds.map((leadId) => ({ leadId })), runtime: input.runtime },
      }),
    onSuccess: (result) => {
      if (!result.ok) {
        setBatchNotice({
          kind: "err",
          text: `${result.error}${result.leadId ? ` (lead #${result.leadId})` : ""}`,
        });
        return;
      }
      setSelectedBatchLeadIds([]);
      setActiveBatchId(result.batch.id);
      leadRefreshAfterTerminalBatch.current = null;
      setBatchNotice({
        kind: "ok",
        text: `Draft batch started with ${result.batch.runtime.label}.`,
      });
      qc.setQueryData(["draft-batch", newsroomId, result.batch.id], result);
    },
    onError: (error) => {
      setBatchNotice({
        kind: "err",
        text: error instanceof Error ? error.message : "That draft batch did not start.",
      });
    },
  });
  const queueDraft = useMutation({
    mutationFn: (input: { leadId: number; modelChoice: StoryModelChoice }) => draftLead({ data: input }),
    onMutate: ({ leadId }) => setDraftingIds((ids) => [...ids.filter((id) => id !== leadId), leadId]),
    onSuccess: (res, { leadId }) => {
      if (res?.ok) {
        setDraftNotices((notices) => ({
          ...notices,
          [leadId]: {
            kind: "ok",
            text: `Draft queued with ${modelChoiceLabel(res.modelChoice)}. Open the lead to watch it arrive.`,
          },
        }));
      } else {
        setDraftNotices((notices) => ({
          ...notices,
          [leadId]: {
            kind: "err",
            text: res?.error
              ? `${res.error}${"detail" in res && res.detail ? `\n\n${res.detail}` : ""}`
              : "That draft did not queue.",
          },
        }));
      }
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (error, { leadId }) => setDraftNotices((notices) => ({
      ...notices,
      [leadId]: {
        kind: "err",
        text: error instanceof Error ? error.message : "That draft did not queue.",
      },
    })),
    onSettled: (_data, _error, { leadId }) => setDraftingIds((ids) => ids.filter((id) => id !== leadId)),
  });
  const file = useMutation({
    mutationFn: () => fileLead({ data: { headline, why, topic, url } }),
    onSuccess: async (res) => {
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      setHeadline("");
      setWhy("");
      setUrl("");
      setFormError(null);
      await qc.invalidateQueries({ queryKey: ["leads"] });
      await navigate({ to: "/desk/story/$leadId", params: { leadId: String(res.id) } });
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Could not file that lead.");
    },
  });

  const working = openLeads(leads);
  const batchEligible = leads.filter(
    (lead) => lead.status !== "held" && lead.status !== "killed" && lead.status !== "published",
  );
  const selectedBatchLeads = selectedBatchLeadIds.filter((leadId) =>
    batchEligible.some((lead) => lead.id === leadId),
  );
  const suggestedFocus = suggestFocusLeads(batchEligible, sections, focusTarget);
  const focusAddable = suggestedFocus.filter((lead) => !selectedBatchLeads.includes(lead.id));
  const publishedCount = leads.filter((l) => l.status === "published").length;
  const last = scans.data?.[0];
  const counts = {
    all: working.length,
    new: leads.filter((l) => l.status === "new").length,
    drafted: leads.filter((l) => l.status === "drafted").length,
    held: leads.filter((l) => l.status === "held").length,
    killed: leads.filter((l) => l.status === "killed").length,
  };
  const printed = published.data ?? [];
  const shown =
    filter === "killed"
      ? // What keeps coming back belongs on top of the Killed tab -- that is
        // the whole point of stamping a resurfaced lead instead of quietly
        // hiding it. Leads never resurfaced (last_resurfaced_at null) sort
        // after ones that have, oldest kill first within that group.
        leads
          .filter((l) => l.status === "killed")
          .sort((a, b) => {
            const at = a.last_resurfaced_at ? Date.parse(a.last_resurfaced_at) : -1;
            const bt = b.last_resurfaced_at ? Date.parse(b.last_resurfaced_at) : -1;
            if (at !== bt) return bt - at;
            return b.id - a.id;
          })
      : (filter === "all" ? working : leads.filter((l) => l.status === filter)).sort(
          (a, b) => (b.newsworthiness ?? 0) - (a.newsworthiness ?? 0),
        );

  return (
    <DeskShell title="The queue" kicker="Leads">
      <p className="lede">
        Everything that might be news, scored and sorted. The scanner and Dark Desk file leads
        here; so do you. Printed stories move to Published. Nothing prints until you open a lead
        and publish it.
      </p>

      <details className="file-form">
        <summary>File a lead yourself</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setFormError(null);
            file.mutate();
          }}
        >
          <div className="form-grid">
            <Field label="Headline">
              <input
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                required
                minLength={8}
                placeholder="What happened"
              />
            </Field>
            <Field label="Why now">
              <input
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                required
                minLength={8}
                placeholder={`Why this is news in ${PAPER.city} today`}
              />
            </Field>
            <Field label="Topic">
              <select value={topic} onChange={(e) => setTopic(e.target.value)}>
                {TOPICS.filter((t) => t !== "about").map((t) => (
                  <option key={t} value={t}>
                    {sections.find(s=>s.key===t)?.name??t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Source URL (optional)">
              <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
            </Field>
          </div>
          {formError ? <Notice kind="err">{formError}</Notice> : null}
          <InkButton disabled={file.isPending} type="submit">
            {file.isPending ? "Filing…" : "File lead"}
          </InkButton>
        </form>
      </details>

      <section id="draft-batch" aria-labelledby="draft-batch-heading">
        <h2 id="draft-batch-heading">Draft selected leads</h2>
        <p className="wire-sum">
          Choose up to five eligible queue leads and one writing runtime. Each lead keeps its own
          stored research scope. This queues drafts for editor review; it does not publish anything.
        </p>
        <div className="wire-sum">
          <Field label="Suggested focus size">
            <select
              value={focusTarget}
              onChange={(event) => setFocusTarget(Number(event.target.value) as 3 | 4 | 5)}
              disabled={startBatch.isPending}
            >
              {[3, 4, 5].map((size) => (
                <option key={size} value={size}>
                  {size} leads
                </option>
              ))}
            </select>
          </Field>
          <p className="meta">
            Suggestions balance existing lead scores and sections. Review the evidence before drafting.
          </p>
          <InkButton
            small
            disabled={startBatch.isPending || focusAddable.length === 0 || selectedBatchLeads.length >= 5}
            onClick={() => {
              setSelectedBatchLeadIds((ids) =>
                mergeFocusSelection(
                  ids,
                  batchEligible.map((lead) => lead.id),
                  suggestedFocus.map((lead) => lead.id),
                  5,
                ),
              );
            }}
          >
            Add suggested focus ({Math.min(focusAddable.length, 5 - selectedBatchLeads.length)})
          </InkButton>
        </div>
        <div className="form-grid">
          <Field label="Batch runtime">
            <select
              value={batchRuntime}
              disabled={startBatch.isPending}
              onChange={(event) => setBatchRuntime(event.target.value as DraftBatchRuntime)}
            >
              {BATCH_RUNTIMES.map((runtime) => (
                <option key={runtime.value} value={runtime.value}>
                  {runtime.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="meta">{selectedBatchLeads.length} of 5 selected</p>
        <InkButton
          disabled={newsroomId === null || selectedBatchLeads.length === 0 || startBatch.isPending}
          onClick={() => {
            setBatchNotice(null);
            startBatch.mutate({ leadIds: selectedBatchLeads, runtime: batchRuntime });
          }}
        >
          {startBatch.isPending ? "Starting batch…" : "Draft selected"}
        </InkButton>
        {batchNotice ? <Notice kind={batchNotice.kind}>{batchNotice.text}</Notice> : null}
        {desk.isPending || batch.isPending ? (
          <p className="meta">Loading the latest draft batch…</p>
        ) : batch.isError ? (
          <Notice kind="err">Could not load the latest draft batch.</Notice>
        ) : batch.data && !batch.data.ok ? (
          <Notice kind="err">{batch.data.error}</Notice>
        ) : batch.data?.ok && batch.data.batch ? (
          <div className="lead-list roomy" aria-label="Draft batch results">
            <p className="meta">
              Batch #{batch.data.batch.id} · {batch.data.batch.runtime.label}
            </p>
            {batch.data.batch.runtime.runtime === "local" ? (
              <p className="meta">
                This batch keeps the saved local model shown above.{" "}
                <Link to="/desk/ops" className="inline-link">
                  Review local models on Server
                </Link>{" "}
                before starting another batch.
              </p>
            ) : null}
            {batch.data.batch.items.map((item) => {
              const lead = leads.find((candidate) => candidate.id === item.leadId);
              return <DraftBatchResult key={item.jobId} item={item} headline={lead?.headline ?? `lead #${item.leadId}`} />;
            })}
          </div>
        ) : (
          <p className="meta">No draft batch has been started in this newsroom.</p>
        )}
      </section>

      <div className="filters">
        {(["all", "new", "drafted", "held", "killed"] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={"filter" + (filter === k ? " on" : "")}
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
          >
            {k} {counts[k]}
          </button>
        ))}
      </div>

      {filter === "killed" && shown.some((l) => (l.resurfaced_count ?? 0) > 0) ? (
        <p className="meta seen-again-note">{SEEN_AGAIN_EXPLAINER}</p>
      ) : null}

      {deleteError ? <Notice kind="err">{deleteError}</Notice> : null}
      {undo != null ? (
        <Notice kind="ok">
          Deleted, and kept for 30 days.{" "}
          <button
            type="button"
            className="inline-link"
            disabled={undoDelete.isPending}
            onClick={() => undoDelete.mutate(undo)}
          >
            {undoDelete.isPending ? "Putting it back…" : "Undo"}
          </button>
        </Notice>
      ) : null}

      {isError && leads.length === 0 ? (
        <ScreenError
          message={error instanceof Error ? error.message : "Could not load the queue."}
          onRetry={() => void refetch()}
          retrying={isRefetching}
        />
      ) : isPending && leads.length === 0 ? (
        <ListSkeleton rows={4} />
      ) : shown.length === 0 ? (
        <p className="wire-sum">
          {filter === "all" ? (
            <>
              {workingQueueEmptyCopy({
                publishedCount,
                lastScan: last
                  ? {
                      leads_created: last.leads_created,
                      sources_fetched: last.sources_fetched,
                      error: last.error,
                    }
                  : null,
              })}{" "}
              {publishedCount > 0 ? (
                <Link to="/desk/published" className="inline-link">
                  Published
                </Link>
              ) : null}
            </>
          ) : (
            `No ${filter} leads.`
          )}
        </p>
      ) : (
        <div className="lead-list roomy">
          {shown.map((l) => (
            <LeadRowView
              key={l.id}
              lead={l}
              dup={nearDuplicate(l, printed)}
              roomy
              onHold={() => setStatus.mutate({ id: l.id, status: "held" })}
              onBack={() => setStatus.mutate({ id: l.id, status: "new" })}
              onKill={() => setStatus.mutate({ id: l.id, status: "killed" })}
              onDelete={() => remove.mutate(l.id)}
              onDraft={(modelChoice) => {
                setDraftNotices((notices) => {
                  const next = { ...notices };
                  delete next[l.id];
                  return next;
                });
                queueDraft.mutate({ leadId: l.id, modelChoice });
              }}
              drafting={draftingIds.includes(l.id)}
              draftNotice={draftNotices[l.id] ?? null}
              batchSelected={selectedBatchLeads.includes(l.id)}
              batchDisabled={
                startBatch.isPending ||
                (!selectedBatchLeads.includes(l.id) && selectedBatchLeads.length >= 5)
              }
              onBatchSelect={
                l.status !== "held" && l.status !== "killed" && l.status !== "published"
                  ? (selected) => {
                      setSelectedBatchLeadIds((ids) => {
                        if (selected) return [...ids.filter((id) => id !== l.id), l.id];
                        return ids.filter((id) => id !== l.id);
                      });
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </DeskShell>
  );
}
