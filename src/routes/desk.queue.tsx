import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DeskShell, Field, InkButton } from "@/components/desk-chrome";
import { LeadRowView } from "@/components/desk-leads";
import { ListSkeleton, Notice, ScreenError } from "@/components/states";
import { deleteLead, draftLead, fileLead, listLeads, listPublishedDesk, listScans, setLeadStatus } from "@/lib/news/desk";
import { restoreTrashItem } from "@/lib/news/trash";
import { nearDuplicate, openLeads, workingQueueEmptyCopy } from "@/lib/news/desk-copy";
import { TOPICS } from "@/lib/paper";
import { usePaper } from "@/lib/paper-context";
import { modelChoiceLabel, type StoryModelChoice } from "@/lib/news/model-choice";

export const Route = createFileRoute("/desk/queue")({ component: QueuePage });

function QueuePage() {
  const PAPER = usePaper();
  const qc = useQueryClient();
  const navigate = useNavigate();
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
  const [headline, setHeadline] = useState("");
  const [why, setWhy] = useState("");
  const [topic, setTopic] = useState("council");
  const [url, setUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [draftNotices, setDraftNotices] = useState<Record<number, { kind: "ok" | "err"; text: string }>>({});
  const [draftingIds, setDraftingIds] = useState<number[]>([]);
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
  const shown = (filter === "all" ? working : leads.filter((l) => l.status === filter)).sort(
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
                    {t}
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
            />
          ))}
        </div>
      )}
    </DeskShell>
  );
}
