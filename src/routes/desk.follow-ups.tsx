import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DeskShell, SecHead, announceToDesk } from "@/components/desk-chrome";
import { FollowUpItem } from "@/components/follow-up-item";
import { ListSkeleton, ScreenError } from "@/components/states";
import { dropFollowUp, listFollowUps, nudgeFollowUp, recordFollowUpReply } from "@/lib/news/desk";

export const Route = createFileRoute("/desk/follow-ups")({ component: FollowUpsPage });

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "answered", label: "Answered" },
  { key: "dropped", label: "Dropped" },
] as const;

/**
 * The Follow-ups object's full list (Direction A stage 1). Reachable from
 * the desk rail's "All follow-ups" link and from the story page only -- not
 * a 10th nav tab, per the build notes.
 */
function FollowUpsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"open" | "answered" | "dropped">("open");
  const list = useQuery({
    queryKey: ["follow-ups", filter],
    queryFn: () => listFollowUps({ data: { status: filter } }),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["follow-ups"] });

  const reply = useMutation({
    mutationFn: (input: { id: number; replyText: string; repliedOn: string }) =>
      recordFollowUpReply({ data: input }),
    onSuccess: (res) => {
      invalidate();
      announceToDesk(res?.ok ? "Reply recorded." : (res && "error" in res && res.error) || "Could not save that reply.");
    },
  });
  const nudge = useMutation({
    mutationFn: (id: number) => nudgeFollowUp({ data: { id } }),
    onSuccess: () => {
      invalidate();
      announceToDesk("Nudge stamped.");
    },
  });
  const drop = useMutation({
    mutationFn: (id: number) => dropFollowUp({ data: { id } }),
    onSuccess: () => {
      invalidate();
      announceToDesk("Follow-up dropped.");
    },
  });

  return (
    <DeskShell title="Follow-ups" kicker="The desk">
      <section className="mt-8">
        <SecHead title="Every follow-up" sub="Who you asked, what they owe, and when it's due." />
        <div className="seg mt-4" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={"seg-opt" + (filter === f.key ? " on" : "")}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {list.isError ? (
          <ScreenError
            message={list.error instanceof Error ? list.error.message : "Could not load follow-ups."}
            onRetry={() => void list.refetch()}
            retrying={list.isRefetching}
          />
        ) : list.isPending ? (
          <ListSkeleton rows={4} />
        ) : (list.data ?? []).length === 0 ? (
          <p className="wire-sum mt-4">
            {filter === "open"
              ? "No one owes you an answer right now."
              : `Nothing ${filter} yet.`}
          </p>
        ) : (
          <div className="lead-list mt-4">
            {(list.data ?? []).map((f) => (
              <FollowUpItem
                key={f.id}
                item={f}
                onReply={filter === "open" ? (replyText, repliedOn) => reply.mutate({ id: f.id, replyText, repliedOn }) : undefined}
                onNudge={filter === "open" ? () => nudge.mutate(f.id) : undefined}
                onDrop={filter === "open" ? () => drop.mutate(f.id) : undefined}
                nudging={nudge.isPending}
                dropping={drop.isPending}
                replying={reply.isPending}
              />
            ))}
          </div>
        )}
      </section>
    </DeskShell>
  );
}
