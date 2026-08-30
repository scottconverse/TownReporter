import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DeskShell,
  InkButton,
  LeaveEditorControl,
  SecHead,
} from "@/components/desk-chrome";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { ListSkeleton } from "@/components/states";
import { getOpsHealth, runOpsAction } from "@/lib/ops/dashboard";
import { OPS_ACTIONS, type OpsActionId } from "@/lib/ops/actions";
import { formatAgo, overallState, type HealthState } from "@/lib/ops/health";
import { TRASH_DAYS, listTrash, purgeTrashItem, restoreTrashItem } from "@/lib/news/trash";
import { formatDateTime } from "@/lib/paper";

export const Route = createFileRoute("/desk/ops")({
  head: () => ({ meta: [{ title: "Server — TownReporter" }] }),
  component: OpsPage,
});

/**
 * Colour carries no information on its own here.
 *
 * Every row states its condition in words as well, because "is that dot amber
 * or red" is not a thing to be squinting at when the paper is down, and a
 * colour-blind operator gets nothing from the dot at all.
 */
const DOT: Record<HealthState, string> = {
  ok: "bg-emerald-600",
  warn: "bg-amber-500",
  down: "bg-rust",
  unknown: "bg-muted",
};

const WORD: Record<HealthState, string> = {
  ok: "OK",
  warn: "Check",
  down: "Down",
  unknown: "Unknown",
};

function StateDot({ state }: { state: HealthState }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[state]}`} aria-hidden />
      <span className="text-[11px] tracking-[0.14em] text-muted uppercase">{WORD[state]}</span>
    </span>
  );
}

function OpsPage() {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<OpsActionId | null>(null);
  const [message, setMessage] = useState<string>("");
  const [running, setRunning] = useState<OpsActionId | null>(null);

  const health = useQuery({
    queryKey: ["ops-health"],
    queryFn: () => getOpsHealth(),
    // The page is read, not watched. A poll every 30s keeps it honest without
    // running PowerShell probes forever behind a forgotten open tab.
    refetchInterval: 30_000,
  });

  const act = useMutation({
    mutationFn: (id: OpsActionId) => runOpsAction({ data: id }),
    onMutate: (id) => {
      setRunning(id);
      setMessage("");
    },
    onSuccess: (res) => {
      setRunning(null);
      setConfirming(null);
      /*
        A reply can be missing without anything having gone wrong.

        Restarting the tunnel cuts the path this very answer travels on, so the
        call resolves to nothing. Reading `res.output` then threw "Cannot read
        properties of undefined" and the page reported an error for an action
        that had just succeeded.
      */
      if (!res) {
        setMessage(
          "No answer came back. That is expected when the action interrupts the connection it would reply on — check the health rows above in a few seconds.",
        );
      } else {
        setMessage(res.output || (res.ok ? "Done." : "Failed."));
      }
      void qc.invalidateQueries({ queryKey: ["ops-health"] });
    },
    onError: (err) => {
      setRunning(null);
      setConfirming(null);
      setMessage(err instanceof Error ? err.message : "That did not run.");
    },
  });

  const checks = health.data?.checks ?? [];
  const state = checks.length ? overallState(checks) : "unknown";

  return (
    <DeskShell
      title="Server"
      kicker="Editor desk"
      lede={
        <>
          Everything this machine is doing to keep the paper online, and the few
          buttons worth having. Read from this machine, so it can tell you the
          tunnel is routing but not that a reader in another town can reach you.
        </>
      }
    >
      <section className="mt-8">
        <SecHead
          title="Health"
          aside={
            <span className="flex items-center gap-4">
              <StateDot state={state} />
              <InkButton
                tone="quiet"
                small
                onClick={() => void health.refetch()}
                disabled={health.isFetching}
              >
                {health.isFetching ? "Checking…" : "Check now"}
              </InkButton>
            </span>
          }
          sub={
            health.data
              ? `${health.data.host} · read ${formatAgo(health.data.takenAt)}`
              : undefined
          }
        />

        {health.isPending ? (
          <ListSkeleton />
        ) : health.isError ? (
          <p className="mt-4 text-rust">
            Could not read the server. {String(health.error)}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-rule border-y border-rule">
            {checks.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
                <span className="w-40 shrink-0 text-[11px] tracking-[0.14em] text-muted uppercase">
                  {c.label}
                </span>
                <span className="min-w-0 flex-1 break-words">{c.value}</span>
                <StateDot state={c.state} />
                {c.note ? (
                  <p className="w-full text-sm text-ink-2">{c.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12">
        <SecHead
          title="Actions"
          sub="Each one says what it does before it does it. The two that interrupt the paper ask twice."
        />
        <ul className="mt-4 space-y-3">
          {OPS_ACTIONS.map((a) => {
            const isConfirming = confirming === a.id;
            const isRunning = running === a.id;
            return (
              <li key={a.id} className="border border-rule p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-display text-lg font-semibold">
                    {a.label}
                    {a.interrupts ? (
                      <span className="ml-2 text-[11px] tracking-[0.14em] text-rust uppercase">
                        interrupts
                      </span>
                    ) : null}
                  </h3>
                  {isConfirming ? (
                    <span className="flex gap-2">
                      <InkButton
                        tone="danger"
                        small
                        disabled={isRunning}
                        onClick={() => act.mutate(a.id)}
                      >
                        {isRunning ? "Running…" : "Yes, do it"}
                      </InkButton>
                      <InkButton tone="quiet" small onClick={() => setConfirming(null)}>
                        Cancel
                      </InkButton>
                    </span>
                  ) : (
                    <InkButton
                      tone={a.interrupts ? "ghost" : "solid"}
                      small
                      disabled={Boolean(running)}
                      onClick={() =>
                        a.interrupts ? setConfirming(a.id) : act.mutate(a.id)
                      }
                    >
                      {isRunning ? "Running…" : "Run"}
                    </InkButton>
                  )}
                </div>
                <p className="mt-2 max-w-2xl text-ink-2">{a.detail}</p>
                <p className="mt-1 text-sm text-muted">
                  Takes about {a.expectSeconds} seconds.
                </p>
              </li>
            );
          })}
        </ul>
        {message ? (
          <pre className="mt-4 max-h-72 overflow-auto border border-rule bg-paper-2 p-3 text-sm whitespace-pre-wrap">
            {message}
          </pre>
        ) : null}
      </section>

      <RecentlyDeleted />

      <section className="mt-12">
        <SecHead title="Logs" sub="The last few lines of each. Newest at the bottom." />
        <div className="mt-4 space-y-6">
          {(health.data?.logs ?? []).map((l) => (
            <div key={l.path}>
              <h3 className="text-[11px] tracking-[0.14em] text-muted uppercase">
                {l.name}
              </h3>
              {l.error ? (
                <p className="mt-1 text-sm text-muted">{l.error}</p>
              ) : (
                <pre className="mt-1 max-h-56 overflow-auto border border-rule bg-paper-2 p-3 text-xs whitespace-pre-wrap">
                  {l.lines.join("\n")}
                </pre>
              )}
            </div>
          ))}
        </div>
      </section>

      <p className="mt-12 max-w-2xl text-sm text-muted">
        This page runs inside the paper, so it cannot report on itself when the
        paper is down. That is what the watchdog is for: it runs from Windows
        every five minutes and restarts whatever has stopped. Its log is above.
      </p>

      <GiveUpTheDesk />
    </DeskShell>
  );
}

/**
 * Recently deleted.
 *
 * Delete is one click away from the whole desk, which is what the operator
 * asked for; this is the floor under it. A lead takes its drafts with it and an
 * editorial draft has no copy anywhere, so before this a mis-click was final.
 *
 * The row says what restoring it would bring back, because "a lead" and "a lead
 * and the two drafts on it" are different things to get back.
 */
function RecentlyDeleted() {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [confirmPurge, setConfirmPurge] = useState<number | null>(null);

  const list = useQuery({ queryKey: ["trash"], queryFn: () => listTrash() });

  const invalidateEverything = () => {
    for (const key of ["trash", "leads", "editorials", "published-desk", "articles"]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const restore = useMutation({
    mutationFn: (id: number) => restoreTrashItem({ data: id }),
    onSuccess: (r) => {
      setNote(r?.ok ? "Back on the desk." : (r?.error ?? "That would not go back."));
      invalidateEverything();
    },
    onError: (e) => setNote(e instanceof Error ? e.message : "That would not go back."),
  });

  const purge = useMutation({
    mutationFn: (id: number) => purgeTrashItem({ data: id }),
    onSuccess: (r) => {
      setConfirmPurge(null);
      setNote(r?.ok ? "Gone for good." : (r?.error ?? "That did not work."));
      void qc.invalidateQueries({ queryKey: ["trash"] });
    },
    onError: (e) => setNote(e instanceof Error ? e.message : "That did not work."),
  });

  const rows = list.data ?? [];

  return (
    <section className="mt-12">
      <SecHead
        title="Recently deleted"
        count={rows.length || null}
        sub={`Anything deleted from the desk waits here for ${TRASH_DAYS} days, then goes for good. Restoring puts it back where it was.`}
      />
      {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
      {list.isPending ? (
        <ListSkeleton rows={2} />
      ) : rows.length === 0 ? (
        <p className="mt-4 text-ink-2">Nothing deleted.</p>
      ) : (
        <ul className="mt-4 divide-y divide-rule border-y border-rule">
          {rows.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="min-w-0 flex-1">
                  <span className="text-[11px] tracking-[0.14em] text-rust uppercase">
                    {r.kind === "article" ? "Was on the paper" : r.kind === "lead" ? "Lead" : "Editorial"}
                  </span>{" "}
                  <span className="font-display text-lg">{r.label}</span>
                  {r.extra ? <span className="ml-2 text-sm text-muted">with {r.extra}</span> : null}
                </span>
                <span className="row-acts static">
                  <InkButton
                    tone="quiet"
                    small
                    disabled={restore.isPending}
                    onClick={() => restore.mutate(r.id)}
                  >
                    Restore
                  </InkButton>
                  {confirmPurge === r.id ? (
                    <>
                      <InkButton
                        tone="ghost"
                        small
                        disabled={purge.isPending}
                        onClick={() => purge.mutate(r.id)}
                      >
                        Yes, for good
                      </InkButton>
                      <InkButton tone="quiet" small onClick={() => setConfirmPurge(null)}>
                        Keep
                      </InkButton>
                    </>
                  ) : (
                    <InkButton tone="quiet" small onClick={() => setConfirmPurge(r.id)}>
                      Delete for good
                    </InkButton>
                  )}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">Deleted {formatDateTime(r.deleted_at)}</p>
              {confirmPurge === r.id ? (
                <p className="mt-1 text-sm text-rust">
                  This is the copy. After this there is nothing to restore.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}


/**
 * The one irreversible thing on this page, kept furthest from everything else.
 *
 * It used to be a button in the header of every desk page. See
 * LeaveEditorControl in desk-chrome.tsx for what an audit found when it walked
 * that path. It belongs here, at the bottom of the page an operator visits on
 * purpose, and nowhere else.
 */
function GiveUpTheDesk() {
  const { user, isPending } = useCurrentUserState();
  const email = user?.primaryEmail ?? "";
  return (
    <section className="mt-16 border-t border-rule pt-8">
      <SecHead
        title="Give up the desk"
        sub="Hands the newsroom to the next person who signs in. There is no way back."
      />
      <div className="mt-4 max-w-2xl">
        {isPending ? (
          <p className="text-sm text-muted">Checking who you are…</p>
        ) : email ? (
          <LeaveEditorControl email={email} />
        ) : (
          <p className="text-sm text-muted">
            This needs the email address you signed in with, and it could not be
            read. Reload the page.
          </p>
        )}
      </div>
    </section>
  );
}
