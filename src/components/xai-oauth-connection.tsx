import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { InkButton } from "./desk-chrome";
import { inputClass } from "./desk-chrome-utils";
import {
  cancelXaiOauthLoginFn,
  disconnectXaiOauthFn,
  getXaiOauthStatusFn,
  pollXaiOauthLoginFn,
  refreshXaiOauthModelsFn,
  selectXaiOauthModelFn,
  startXaiOauthLoginFn,
  testXaiOauthConnectionFn,
  type XaiOauthStatus,
} from "@/lib/news/xai-oauth";
import { PROVIDER_AVAILABILITY_QUERY_KEY } from "@/lib/news/provider-availability-key";

const KEY = ["xai-oauth-status"] as const;

export function XaiOauthConnection({ onNote }: { onNote: (text: string) => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [approvalPopupBlocked, setApprovalPopupBlocked] = useState(false);
  const approvalPopup = useRef<Window | null>(null);
  const approvalPopupRequested = useRef(false);
  const status = useQuery({
    queryKey: KEY,
    queryFn: () => getXaiOauthStatusFn(),
    refetchInterval: (query) => {
      const state = (query.state.data as XaiOauthStatus | undefined)?.loginState;
      return state === "starting" || state === "awaiting_user" ? 2_000 : false;
    },
  });
  const update = (next: XaiOauthStatus, note?: string) => {
    qc.setQueryData(KEY, next);
    void qc.invalidateQueries({
      queryKey: PROVIDER_AVAILABILITY_QUERY_KEY,
      refetchType: "all",
    });
    setError("");
    if (note) onNote(note);
  };
  const fail = (value: unknown) =>
    setError(value instanceof Error ? value.message : "That Grok action did not finish.");
  const closeApprovalPopup = () => {
    approvalPopup.current?.close();
    approvalPopup.current = null;
    approvalPopupRequested.current = false;
  };
  const start = useMutation({
    mutationFn: () => startXaiOauthLoginFn(),
    onSuccess: (next) => update(next, "Grok Build sign-in started."),
    onError: (value) => {
      closeApprovalPopup();
      fail(value);
    },
  });
  const poll = useMutation({
    mutationFn: () => pollXaiOauthLoginFn(),
    onSuccess: (next) => update(next),
    onError: fail,
  });
  const cancel = useMutation({
    mutationFn: () => cancelXaiOauthLoginFn(),
    onSuccess: (next) => {
      closeApprovalPopup();
      update(next, "Grok Build sign-in stopped.");
    },
    onError: fail,
  });
  const refresh = useMutation({
    mutationFn: () => refreshXaiOauthModelsFn(),
    onSuccess: (next) => update(next, "Grok model list refreshed."),
    onError: fail,
  });
  const select = useMutation({
    mutationFn: (modelId: string) => selectXaiOauthModelFn({ data: { modelId } }),
    onSuccess: (next) => update(next, `Grok will use ${next.selectedModelId}.`),
    onError: fail,
  });
  const test = useMutation({
    mutationFn: () => testXaiOauthConnectionFn(),
    onSuccess: (result) => {
      setError(result.ok ? "" : result.message);
      onNote(result.message);
    },
    onError: fail,
  });
  const disconnect = useMutation({
    mutationFn: () => disconnectXaiOauthFn(),
    onSuccess: (next) => {
      closeApprovalPopup();
      update(next, "TownReporter disconnected from Grok Build.");
    },
    onError: fail,
  });

  const loginState = status.data?.loginState;
  const waitingForApproval = loginState === "starting" || loginState === "awaiting_user";
  const approvalUrl = status.data?.url;
  useEffect(() => {
    if (!waitingForApproval || !approvalUrl || !approvalPopupRequested.current) return;
    const popup = approvalPopup.current;
    approvalPopupRequested.current = false;
    approvalPopup.current = null;
    if (!popup || popup.closed) {
      setApprovalPopupBlocked(true);
      return;
    }
    try {
      // This blank window was opened directly from the editor's click. Sever
      // the opener before crossing to xAI's approval page.
      popup.opener = null;
      popup.location.replace(approvalUrl);
      popup.focus();
      setApprovalPopupBlocked(false);
    } catch {
      setApprovalPopupBlocked(true);
    }
  }, [approvalUrl, waitingForApproval]);

  function beginLogin() {
    setApprovalPopupBlocked(false);
    approvalPopupRequested.current = true;
    approvalPopup.current = window.open(
      "",
      "townreporter-xai-oauth",
      "popup,width=560,height=720,resizable=yes,scrollbars=yes",
    );
    if (!approvalPopup.current) setApprovalPopupBlocked(true);
    else approvalPopup.current.focus();
    start.mutate();
  }

  if (status.isPending) return <p role="status">Checking SuperGrok…</p>;
  if (status.isError || !status.data)
    return (
      <div role="alert" className="border border-rule p-4">
        <h3 className="font-display text-lg font-semibold">Grok (SuperGrok)</h3>
        <p className="mt-2 text-rust">Could not read this connection.</p>
        <InkButton tone="quiet" small onClick={() => void status.refetch()}>
          Try again
        </InkButton>
      </div>
    );

  const row = status.data;
  const waiting = waitingForApproval;
  const busy =
    start.isPending ||
    poll.isPending ||
    cancel.isPending ||
    refresh.isPending ||
    select.isPending ||
    test.isPending ||
    disconnect.isPending;

  return (
    <div className="mt-3 border border-rule p-4" data-provider="xai-oauth">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Grok (SuperGrok)</h3>
          <p className="mt-1 text-sm text-ink-2">
            TownReporter connects directly to xAI with your SuperGrok subscription. No DSH proxy or
            API key is used. The xAI approval page identifies the client as{" "}
            <strong>{row.identity}</strong>.
          </p>
        </div>
        {!row.connected && !waiting ? (
          <InkButton small disabled={busy} onClick={beginLogin}>
            {start.isPending ? "Starting…" : "Sign in with SuperGrok"}
          </InkButton>
        ) : null}
      </div>

      <p className="mt-2">
        {row.connected
          ? `Connected · ${row.selectedModelId ?? "choose a model"}`
          : waiting
            ? "Waiting for approval"
            : "Not connected"}
      </p>
      {row.detail ? <p className="mt-1 text-sm text-ink-2">{row.detail}</p> : null}

      {waiting ? (
        <div className="mt-4 grid gap-3 border-t border-rule pt-4">
          {row.url ? (
            <>
              {approvalPopupBlocked ? (
                <p role="status" className="text-sm text-ink-2">
                  The approval page could not be opened automatically. Use this link instead.
                </p>
              ) : null}
              <a className="underline" href={row.url} target="_blank" rel="noopener noreferrer">
                Open the xAI approval page
              </a>
            </>
          ) : (
            <p role="status">Requesting a sign-in code from xAI…</p>
          )}
          {row.code ? (
            <div>
              <span className="text-sm text-muted">One-time code</span>
              <p className="font-mono text-xl tracking-[0.12em]">{row.code}</p>
              <InkButton
                tone="quiet"
                small
                onClick={() => void navigator.clipboard.writeText(row.code ?? "")}
              >
                Copy code
              </InkButton>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <InkButton tone="quiet" small disabled={busy} onClick={() => poll.mutate()}>
              {poll.isPending ? "Checking…" : "I approved it — check now"}
            </InkButton>
            <InkButton tone="ghost" small disabled={busy} onClick={() => cancel.mutate()}>
              Stop sign-in
            </InkButton>
          </div>
        </div>
      ) : null}

      {row.connected ? (
        <div className="mt-4 grid gap-3 border-t border-rule pt-4">
          <label className="grid gap-1 text-sm">
            <span>Grok model</span>
            <select
              className={inputClass}
              value={row.selectedModelId ?? ""}
              disabled={busy}
              onChange={(event) => select.mutate(event.target.value)}
            >
              <option value="" disabled>
                Choose a model
              </option>
              {row.models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <InkButton tone="quiet" small disabled={busy} onClick={() => refresh.mutate()}>
              {refresh.isPending ? "Refreshing…" : "Refresh models"}
            </InkButton>
            <InkButton
              tone="quiet"
              small
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    "This sends one tiny real prompt through your SuperGrok subscription. Continue?",
                  )
                )
                  test.mutate();
              }}
            >
              {test.isPending ? "Testing…" : "Test connection"}
            </InkButton>
            <InkButton
              tone="quiet-danger"
              small
              disabled={busy}
              onClick={() => {
                if (confirm("Disconnect TownReporter from this SuperGrok account?"))
                  disconnect.mutate();
              }}
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </InkButton>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="mt-3 text-rust" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
