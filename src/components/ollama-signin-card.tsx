/*
  "Sign in to Ollama" -- the optional sign-in beside the other AI sign-ins
  (DEF-2, Scott's pick of option B, Nov 4 2026).

  It runs `ollama signin` on this machine and shows the link that command
  prints. Nothing here is required: the card says so, and there is no password
  box, no key field, and no stored credential of any kind.

  The server refuses the button for an editor rather than merely hiding it
  (`startOllamaSignIn` in lib/news/ollama.ts).
*/

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { InkButton } from "@/components/desk-chrome";
import {
  cancelOllamaSignIn,
  pollOllamaSignIn,
  startOllamaSignIn,
  type OllamaSignIn,
} from "@/lib/news/ollama";
import {
  OLLAMA_NO_SIGNIN_WORDS,
  OLLAMA_SIGN_IN_LABEL,
  OLLAMA_SIGN_IN_LINK_LINE,
  OLLAMA_SIGNED_IN_WORDS,
} from "@/lib/news/ollama-status";

export function OllamaSignInCard({ isOwner }: { isOwner: boolean }) {
  const [row, setRow] = useState<OllamaSignIn | null>(null);

  const start = useMutation({
    mutationFn: () => startOllamaSignIn(),
    onSuccess: (next) => setRow(next),
    onError: () =>
      setRow({
        status: "failed",
        url: null,
        detail: "Ollama did not start the sign-in. You can skip this step.",
        pid: null,
      }),
  });

  const open = row?.status === "starting" || row?.status === "awaiting_user";

  const poll = useQuery({
    queryKey: ["ollama-signin", row?.pid],
    queryFn: () => pollOllamaSignIn(),
    enabled: open,
    refetchInterval: 2_000,
  });

  useEffect(() => {
    if (poll.data) setRow(poll.data);
  }, [poll.data]);

  const cancel = useMutation({
    mutationFn: () => cancelOllamaSignIn(),
    onSuccess: (next) => setRow(next),
  });

  return (
    <div className="border border-rule p-4" data-testid="ollama-signin">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">Ollama</h3>
        <span className="row-acts static">
          {isOwner && !open && row?.status !== "done" ? (
            <InkButton small disabled={start.isPending} onClick={() => start.mutate()}>
              {start.isPending ? "Starting…" : OLLAMA_SIGN_IN_LABEL}
            </InkButton>
          ) : null}
        </span>
      </div>

      <p className="mt-1 text-base">
        {row?.status === "done"
          ? OLLAMA_SIGNED_IN_WORDS
          : row?.status === "no-signin"
            ? OLLAMA_NO_SIGNIN_WORDS
            : "Optional. Sign in to ollama.com to use hosted models. You can skip this step."}
      </p>

      {open && row?.url ? (
        <div className="mt-3 border border-rule bg-paper-2 p-3">
          <p className="text-base">{OLLAMA_SIGN_IN_LINK_LINE}</p>
          <p className="mt-2">
            <a className="inline-link break-all" href={row.url} target="_blank" rel="noreferrer noopener">
              {row.url}
            </a>
          </p>
          <InkButton tone="quiet" small disabled={cancel.isPending} onClick={() => cancel.mutate()}>
            {cancel.isPending ? "Stopping…" : "Cancel"}
          </InkButton>
        </div>
      ) : null}

      {open && !row?.url ? <p className="mt-2 text-base text-muted">Waiting for Ollama to print its link…</p> : null}

      {row?.detail && !open && row.status !== "no-signin" ? (
        <p className="mt-2 text-base text-rust" role="alert">
          {row.detail}
        </p>
      ) : null}
    </div>
  );
}
