/**
 * One writing model's sign-in card: what it is, whether it works, and the two
 * buttons that fix it.
 *
 * MOVED HERE VERBATIM from `ProviderRow` in routes/desk.ops.tsx (unit BG), for
 * the same reason the Models screen exists at all: the same card has to appear
 * on two screens now -- under "Writing models" on Server settings, and under
 * "Subscription sign-ins (OAuth)" on Models -- and a second copy of a sign-in
 * card is a second place for the countdown, the one-time code and the cancel
 * button to drift apart.
 *
 * The markup is deliberately unchanged, down to `li[data-provider]` and
 * `[data-signin-code]`: scripts/provider-signin-e2e.mjs drives this DOM on
 * /desk/ops, and a move that quietly renamed a hook would be a move that
 * quietly stopped testing the sign-in.
 *
 * There is deliberately NO sign-out button. Signing out is one mis-click that
 * stops the live paper, and nothing here needs it -- a stale login is fixed by
 * signing in again, not by signing out first.
 *
 * Owner-only in practice, and enforced on the server (see
 * src/lib/news/provider-login.ts), not merely hidden here.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InkButton } from "@/components/desk-chrome";
import { ProviderTimeField } from "@/components/provider-time-field";
import { editorDraftError } from "@/lib/news/desk-copy";
import {
  cancelProviderLogin,
  pollProviderLogin,
  startProviderLogin,
  testProvider,
  type ProviderLogin,
  type ProviderStatus,
} from "@/lib/news/provider-login";
import type { ProviderTimeSetting } from "@/lib/news/provider-settings";

export function ProviderStatusCard({
  status,
  onNote,
  times,
  /**
   * The live status chip the Models screen draws in the card's top-right
   * corner. Server settings passes nothing, so that page is unchanged.
   */
  chip,
  /**
   * The models this sign-in brings, when the caller has a list to draw. The
   * Models screen passes the registry's entries for the transport; Server
   * settings passes nothing.
   */
  children,
}: {
  status: ProviderStatus;
  onNote: (text: string) => void;
  times: ProviderTimeSetting[];
  chip?: React.ReactNode;
  children?: React.ReactNode;
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
    login && open ? Math.max(0, login.expiresInSeconds - Math.round((now - anchor) / 1000)) : 0;

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
        {chip}
        <span className="row-acts static">
          {!status.signedIn && !status.disabledByOperator && status.installed && !open ? (
            <InkButton small disabled={start.isPending} onClick={() => start.mutate()}>
              {start.isPending ? "Starting…" : `Sign in to ${status.name}`}
            </InkButton>
          ) : null}
          {status.signedIn ? (
            <InkButton tone="quiet" small disabled={test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? "Asking…" : "Test"}
            </InkButton>
          ) : null}
        </span>
      </div>

      <p className="mt-1">
        <span className="text-sm tracking-[0.14em] text-muted uppercase">
          {status.installed ? "Installed" : "Not installed"}
        </span>{" "}
        <span>{line}</span>
      </p>
      {status.path ? <p className="mt-1 text-sm break-all text-muted">{status.path}</p> : null}
      {status.detail && !open ? <p className="mt-1 text-sm text-ink-2">{status.detail}</p> : null}

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
            <p className="text-sm" role="status">Waiting for {status.name} to print its link…</p>
          )}
          {login?.code ? (
            <div className="mt-3">
              <p className="text-sm tracking-[0.14em] text-muted uppercase">
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
          <InkButton tone="quiet" small disabled={cancel.isPending} onClick={() => cancel.mutate()}>
            {cancel.isPending ? "Stopping…" : "Cancel"}
          </InkButton>
        </div>
      ) : null}

      {login && !open && login.status !== "done" && login.detail ? (
        <p className="mt-2 text-sm text-rust" role="alert">{login.detail}</p>
      ) : null}

      {lastTest ? (
        <p className="mt-2 text-sm" role={lastTest.ok ? "status" : "alert"}>
          {lastTest.ok ? (
            <>Answered in {(lastTest.ms / 1000).toFixed(1)} s.</>
          ) : (
            <span className="text-rust">
              {editorDraftError(lastTest.detail) ?? lastTest.detail}
            </span>
          )}
        </p>
      ) : null}

      {err ? <p className="mt-2 text-sm text-rust" role="alert">{err}</p> : null}

      {/*
        What this sign-in can run, drawn by the caller. The Models screen fills
        it with the registry's own entries for this transport; Server settings
        passes nothing, so that page's cards are the same cards they were.
      */}
      {children}

      {times.map((row) => (
        <ProviderTimeField key={row.providerId} row={row} onNote={onNote} />
      ))}
    </li>
  );
}
