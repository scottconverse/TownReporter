import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
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
import { inviteEditor, myDesk } from "@/lib/news/claim";
import { usePaperDateFormatters } from "@/lib/paper-context";
import { PaperSetupForm } from "@/components/paper-setup-form";
import { getPaperConfigForEditor } from "@/lib/news/paper-settings";
import {
  cancelProviderLogin,
  getProviderStatuses,
  pollProviderLogin,
  startProviderLogin,
  testProvider,
  type ProviderLogin,
  type ProviderStatus,
} from "@/lib/news/provider-login";
import { editorDraftError, inviteMessage } from "@/lib/news/desk-copy";

export const Route = createFileRoute("/desk/ops")({
  head: () => ({ meta: [{ title: "Server — TownReporter" }] }),
  /*
    `?signin=claude` is how the Sign in button on a failed draft hands over:
    it starts the login and sends the editor here. Anything else in that slot
    is dropped rather than trusted -- it decides what this page scrolls to and
    announces, and it arrives from the address bar.
  */
  validateSearch: (search: Record<string, unknown>): { signin?: "claude" | "codex" } => ({
    signin: search.signin === "claude" || search.signin === "codex" ? search.signin : undefined,
  }),
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
      <WritingModels />

      <section className="mt-12">
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

      <PaperSetup />
      <InviteAnEditor />
      <GiveUpTheDesk />
    </DeskShell>
  );
}

/**
 * Writing models: is the paper able to write, and can the operator fix it here.
 *
 * The desk drafts through two locally installed CLIs on the operator's own
 * subscriptions. When one of those logins lapses every draft fails, and until
 * 0.6.0 the desk could only say "sign in again" — which meant a terminal, and
 * this operator is point-and-click. The Sign in button spawns the CLI's own
 * headless login and shows what it prints: a link for Claude Code, a link and a
 * one-time code for Codex.
 *
 * There is deliberately NO sign-out button. Signing out is one mis-click that
 * stops the live paper, and nothing on this page needs it — a stale login is
 * fixed by signing in again, not by signing out first.
 *
 * Owner-only, and enforced on the server (see src/lib/news/provider-login.ts),
 * not merely hidden here.
 */
function WritingModels() {
  const me = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const { signin } = Route.useSearch();
  const [note, setNote] = useState("");
  const isOwner = me.data?.role === "owner";

  const statuses = useQuery({
    queryKey: ["provider-statuses"],
    queryFn: () => getProviderStatuses(),
    enabled: isOwner,
    refetchInterval: 60_000,
  });

  /*
    Arriving from a failed draft, the panel is the whole reason for the trip —
    and on a long Server page it is easy to land above it and not know. Scroll
    to it once, and say so in the live region for anyone not looking.
  */
  const scrollHere = useCallback(
    (node: HTMLElement | null) => {
      if (node && signin) {
        node.scrollIntoView({ block: "start" });
        setNote("Writing models: the sign-in you started is below.");
      }
    },
    [signin],
  );

  if (!isOwner) return null;

  return (
    <section className="mt-8" id="writing-models" ref={scrollHere}>
      <SecHead
        title="Writing models"
        aside={
          <InkButton
            tone="quiet"
            small
            onClick={() => void statuses.refetch()}
            disabled={statuses.isFetching}
          >
            {statuses.isFetching ? "Checking…" : "Check now"}
          </InkButton>
        }
        sub="Whether this machine can write at all, and the button that fixes it when it cannot."
      />
      <p aria-live="polite" role="status" className="sr-only">
        {note}
      </p>
      {statuses.isPending ? (
        <ListSkeleton rows={2} />
      ) : statuses.isError ? (
        <p className="mt-4 text-rust">
          Could not read the writing models. {String(statuses.error)}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {(statuses.data ?? []).map((s) => (
            <ProviderRow key={s.provider} status={s} onNote={setNote} />
          ))}
        </ul>
      )}
      <p className="mt-4 max-w-2xl text-sm text-muted">
        These are the command-line tools TownReporter drafts with. Being signed
        in to claude.ai in your browser or the Claude desktop app is a separate
        login and does not count here.
      </p>
    </section>
  );
}

/** One provider: what it is, whether it works, and the two buttons. */
function ProviderRow({
  status,
  onNote,
}: {
  status: ProviderStatus;
  onNote: (text: string) => void;
}) {
  const qc = useQueryClient();
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  /*
    The row's own view of the attempt in flight.

    `status.login` is whatever the last statuses read saw; the poll below is
    what keeps it moving. Both are shown through one value so the countdown
    never jumps backwards when the slower query lands.
  */
  const [login, setLogin] = useState<ProviderLogin | null>(status.login);
  useEffect(() => {
    setLogin(status.login);
  }, [status.login]);

  const open = login?.status === "awaiting_user" || login?.status === "starting";

  const poll = useQuery({
    queryKey: ["provider-signin", login?.id],
    queryFn: () => pollProviderLogin({ data: login!.id }),
    enabled: Boolean(open && login?.id),
    refetchInterval: 3_000,
  });

  useEffect(() => {
    if (!poll.data) return;
    setLogin(poll.data);
    if (poll.data.status === "done") {
      onNote(`${status.name} is signed in.`);
      void qc.invalidateQueries({ queryKey: ["provider-statuses"] });
    }
  }, [poll.data, qc, status.name, onNote]);

  // A local second hand so the countdown moves between three-second polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [open]);
  const anchor = login ? Date.parse(login.updated_at) : 0;
  const left =
    login && open
      ? Math.max(0, login.expiresInSeconds - Math.round((now - anchor) / 1000))
      : 0;

  const start = useMutation({
    mutationFn: () => startProviderLogin({ data: status.provider }),
    onMutate: () => {
      setErr("");
      onNote(`Starting the ${status.name} sign-in.`);
    },
    onSuccess: (row) => {
      if (!row || "error" in row) {
        setErr(row?.error ?? "That sign-in did not start.");
        return;
      }
      setLogin(row);
      void qc.invalidateQueries({ queryKey: ["provider-statuses"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "That sign-in did not start."),
  });

  const cancel = useMutation({
    mutationFn: () => cancelProviderLogin({ data: login!.id }),
    onSuccess: (row) => {
      setLogin(row ?? null);
      onNote(`The ${status.name} sign-in was stopped.`);
      void qc.invalidateQueries({ queryKey: ["provider-statuses"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "That would not stop."),
  });

  const test = useMutation({
    mutationFn: () => testProvider({ data: status.provider }),
    onMutate: () => {
      setErr("");
      onNote(`Asking ${status.name} for one word.`);
    },
    onSuccess: (res) => {
      if (!res || "error" in res) {
        setErr(res?.error ?? "That check did not run.");
        return;
      }
      onNote(
        res.ok
          ? `${status.name} answered in ${(res.ms / 1000).toFixed(1)} seconds.`
          : `${status.name} did not answer.`,
      );
      void qc.invalidateQueries({ queryKey: ["provider-statuses"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "That check did not run."),
  });

  const lastTest = (test.data && !("error" in test.data) ? test.data : null) ?? status.lastTest;

  const line = status.disabledByOperator
    ? "Disabled by operator"
    : !status.installed
      ? "Not installed"
      : status.signedIn
        ? status.account && status.account !== "signed in"
          ? `Signed in as ${status.account}`
          : "Signed in"
        : "Not signed in";

  return (
    <li className="border border-rule p-4" data-provider={status.provider}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">{status.name}</h3>
        <span className="row-acts static">
          {!status.signedIn && !status.disabledByOperator && status.installed && !open ? (
            <InkButton small disabled={start.isPending} onClick={() => start.mutate()}>
              {start.isPending ? "Starting…" : `Sign in to ${status.name}`}
            </InkButton>
          ) : null}
          {status.signedIn ? (
            <InkButton
              tone="quiet"
              small
              disabled={test.isPending}
              onClick={() => test.mutate()}
            >
              {test.isPending ? "Asking…" : "Test"}
            </InkButton>
          ) : null}
        </span>
      </div>

      <p className="mt-1">
        <span className="text-[11px] tracking-[0.14em] text-muted uppercase">
          {status.installed ? "Installed" : "Not installed"}
        </span>{" "}
        <span>{line}</span>
      </p>
      {status.path ? <p className="mt-1 text-xs break-all text-muted">{status.path}</p> : null}
      {status.detail && !open ? (
        <p className="mt-1 text-sm text-ink-2">{status.detail}</p>
      ) : null}

      {open ? (
        <div className="mt-3 border border-rule bg-paper-2 p-3">
          {login?.url ? (
            <>
              <p className="text-sm">
                Open this page and finish the sign-in there. It opens in a new tab.
              </p>
              <p className="mt-2">
                <a
                  className="inline-link break-all"
                  href={login.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {login.url}
                </a>
              </p>
            </>
          ) : (
            <p className="text-sm">Waiting for {status.name} to print its link…</p>
          )}
          {login?.code ? (
            <div className="mt-3">
              <p className="text-[11px] tracking-[0.14em] text-muted uppercase">
                Enter this one-time code
              </p>
              <p className="mt-1 font-mono text-2xl tracking-[0.2em]" data-signin-code>
                {login.code}
              </p>
              <InkButton
                tone="quiet"
                small
                ariaLabel="Copy the one-time code"
                onClick={() => {
                  void navigator.clipboard.writeText(login.code!).then(() => setCopied(true));
                }}
              >
                {copied ? "Copied" : "Copy code"}
              </InkButton>
            </div>
          ) : null}
          <p className="mt-3 text-sm text-muted">
            {left > 0
              ? `This link runs out in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}.`
              : "This link has run out of time."}
          </p>
          <InkButton
            tone="quiet"
            small
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {cancel.isPending ? "Stopping…" : "Cancel"}
          </InkButton>
        </div>
      ) : null}

      {login && !open && login.status !== "done" && login.detail ? (
        <p className="mt-2 text-sm text-rust">{login.detail}</p>
      ) : null}

      {lastTest ? (
        <p className="mt-2 text-sm">
          {lastTest.ok ? (
            <>Answered in {(lastTest.ms / 1000).toFixed(1)} s.</>
          ) : (
            <span className="text-rust">
              {editorDraftError(lastTest.detail) ?? lastTest.detail}
            </span>
          )}
        </p>
      ) : null}

      {err ? <p className="mt-2 text-sm text-rust">{err}</p> : null}
    </li>
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
  const { formatDateTime } = usePaperDateFormatters();
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
/**
 * Invite a second editor (v0.5.3). Owner-only, enforced server-side; the UI
 * simply does not render the form for an invited editor. The minted link is
 * shown ONCE -- the server stores only a hash -- so the owner copies it here
 * and hands it over however they like. It expires in seven days, works for
 * exactly the named address, and burns on use.
 */
/**
 * CITY-SETUP final slice: the same setup form as the first-run gate
 * (src/routes/desk.setup.tsx), reachable again here so a mistake made
 * during setup -- the wrong timezone, a typo in the city -- is fixable
 * without touching a file. Owner-only, same as Invite an editor below.
 */
function PaperSetup() {
  const me = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const current = useQuery({
    queryKey: ["paper-config-for-setup"],
    queryFn: () => getPaperConfigForEditor(),
    enabled: me.data?.role === "owner",
  });
  if (me.data?.role !== "owner") return null;
  return (
    <section className="mt-16 border-t border-rule pt-8">
      <SecHead
        title="Paper setup"
        sub="The paper's name, city, state, timezone, tagline and starting watch list. Saving also rewrites the welcome article on the front page to match."
      />
      <p className="mt-2 max-w-2xl text-sm text-muted">
        What Save does: it writes every field below; rewrites the front-page
        kicker and deck from the paper's name and city; and rewrites the
        welcome article. Published stories are not touched. There is no
        undo, but you can edit again and save over it. The starting watch
        list is added as real rows on the Sources page, not just stored as
        a default — each editor gets them added once, the first time they
        visit.
      </p>
      {current.isPending ? null : <PaperSetupForm initial={current.data} submitLabel="Save" />}
    </section>
  );
}

/**
 * Copy `text` to the clipboard. Tries the async Clipboard API first; if it
 * is unavailable (older browser, insecure context) or throws (permission
 * denied), falls back to a hidden, selected textarea and the legacy
 * `execCommand("copy")` so the button still does something instead of
 * silently failing on a click.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the selection-based fallback below
    }
  }
  if (typeof document !== "undefined") {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      document.body.removeChild(ta);
    }
  }
  return false;
}

function InviteAnEditor() {
  const me = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const paper = useQuery({
    queryKey: ["paper-config-for-invite"],
    queryFn: () => getPaperConfigForEditor(),
    enabled: me.data?.role === "owner",
  });
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const mint = useMutation({
    mutationFn: () => inviteEditor({ data: email }),
    onSuccess: (r) => {
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setErr(null);
      setCopiedLink(false);
      setCopiedMessage(false);
      setLink(`${window.location.origin}/login?invite=${r.token}`);
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "That did not mint."),
  });
  if (me.data?.role !== "owner") return null;
  const message =
    link && paper.data
      ? inviteMessage({
          paperName: paper.data.name,
          email,
          link,
          ownerEmail: paper.data.editorEmail,
        })
      : null;
  return (
    <section className="mt-16 border-t border-rule pt-8">
      <SecHead
        title="Invite an editor"
        sub="A one-time link for one email address. It expires in seven days, and the person sets their own password. Editors can do everything but invite others or give up the desk."
      />
      <p className="mt-2 max-w-2xl text-sm text-muted">
        You will get a link to send yourself. TownReporter does not send
        email.
      </p>
      <div className="mt-4 max-w-2xl space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            Their email
            <input
              className="mt-1 min-h-11 border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.org"
            />
          </label>
          <InkButton
            small
            disabled={mint.isPending || !email.trim()}
            onClick={() => mint.mutate()}
          >
            {mint.isPending ? "Minting…" : "Make the invite link"}
          </InkButton>
        </div>
        {err ? <p className="text-sm text-rust">{err}</p> : null}
        {link ? (
          <div className="border border-rule bg-paper-2 p-3">
            <p className="text-xs tracking-[0.14em] text-muted uppercase">
              Shown once — copy it now
            </p>
            <p className="mt-1 text-sm break-all">{link}</p>
            <InkButton
              tone="quiet"
              small
              onClick={() => {
                void copyToClipboard(link).then((ok) => ok && setCopiedLink(true));
              }}
            >
              {copiedLink ? "Copied" : "Copy link"}
            </InkButton>
            {message ? (
              <div className="mt-3 border-t border-rule pt-3">
                <p className="text-xs tracking-[0.14em] text-muted uppercase">
                  Ready-to-send message
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{message}</p>
                <InkButton
                  tone="quiet"
                  small
                  onClick={() => {
                    void copyToClipboard(message).then((ok) => ok && setCopiedMessage(true));
                  }}
                >
                  {copiedMessage ? "Copied" : "Copy message"}
                </InkButton>
              </div>
            ) : null}
          </div>
        ) : null}
        <p className="text-sm text-muted">
          What happens next: they click the link, set a password, and appear
          on this page as an editor. They cannot invite others or give up
          the desk.
        </p>
      </div>
    </section>
  );
}

function GiveUpTheDesk() {
  const { user, isPending } = useCurrentUserState();
  const email = user?.primaryEmail ?? "";
  return (
    <section className="mt-16 border-t border-rule pt-8">
      <SecHead
        title="Give up the desk"
        sub="Hands the newsroom to the next person who signs in: the archive, Dark Desk files, notes and Server controls. There is no way back. You will be asked to type your email address to confirm."
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
