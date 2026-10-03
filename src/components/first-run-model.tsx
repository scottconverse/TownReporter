/*
  Unit F3 / Option A: the two things a brand-new owner meets about their
  writing model.

  `FirstRunModelCard` is the "Choose your writing model" card the first-run
  hook asks for (first-run-model-settings.ts writes `offered` into
  `paper_settings.model_prompt_state`). It draws ONLY when the server says so,
  which only a setup that finished after this release -- with a local server
  answering and nothing in memory -- can have done. The live paper never sees
  it.

  `LocalModelsOnThisComputer` is the read-only list. It draws wherever a page
  wants to show "what is on this machine" REGARDLESS of which provider the
  picker is on: before this, `LocalModelSelect` was the only place a local
  model list appeared, and it draws only when "Local model" is the chosen
  provider -- so a fresh install, whose provider is Automatic, could not see
  its own machine's models at all.

  Both share one catalog query key (`["local-model-catalog"]`, the key
  `model-picker.tsx` and `ops-panels.tsx` already use), so a Refresh on any
  page updates every list.
*/

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { localModelCatalog, refreshLocalModelCatalog } from "@/lib/news/provider-availability";
import {
  answerFirstRunModelCardFn,
  getFirstRunModelCard,
} from "@/lib/news/first-run-model-settings";
import {
  FIRST_RUN_MODEL_CARD_NOTE,
  FIRST_RUN_MODEL_CARD_TITLE,
  FIRST_RUN_MODEL_KEEP_AUTOMATIC,
  LOCAL_MODEL_LIST_EMPTY,
  LOCAL_MODEL_LIST_TITLE,
  firstRunModelLine,
  firstRunModelRowKind,
  localModelListLabel,
  localModelListRows,
} from "@/lib/news/first-run-model";
import { localServerName } from "@/lib/news/preflight";
import { announceToDesk } from "@/components/desk-chrome-utils";

const CATALOG_KEY = ["local-model-catalog"];

/** The Refresh button both components carry, so "re-reads" means one thing. */
function RefreshModels({ onNote }: { onNote: (text: string) => void }) {
  const qc = useQueryClient();
  const refresh = useMutation({
    mutationFn: () => refreshLocalModelCatalog(),
    onSuccess: (data) => {
      qc.setQueryData(CATALOG_KEY, data);
      const reachable = (data?.servers ?? []).some((server) => server.reachable);
      onNote(reachable ? "Local model list refreshed." : "No local server found on this machine.");
    },
  });
  return (
    <button
      type="button"
      className="model-picker-refresh"
      style={{ minHeight: 44, minWidth: 44 }}
      disabled={refresh.isPending}
      onClick={() => refresh.mutate()}
    >
      {refresh.isPending ? "Checking…" : "Refresh"}
    </button>
  );
}

/**
 * The read-only "Models on this computer" list: every model each reachable
 * server reports, with cloud models marked where an editor reads them. No
 * picker, no save -- this is the answer to "what is on this machine", which
 * the Automatic provider never shows.
 */
export function LocalModelsOnThisComputer({ title = LOCAL_MODEL_LIST_TITLE, headingLevel = 3 }: { title?: string; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const catalog = useQuery({ queryKey: CATALOG_KEY, queryFn: () => localModelCatalog() });
  const rows = localModelListRows(catalog.data ?? null);
  if (catalog.isPending) return null;
  return (
    <div className="astra-panel">
      <div className="flex items-center justify-between gap-3">
        <Heading className="font-display text-lg font-semibold">{title}</Heading>
        <RefreshModels onNote={setNote} />
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{LOCAL_MODEL_LIST_EMPTY}</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {rows.map((row) => (
            <li key={row.baseUrl} className="model-inventory-provider">
              <span className="model-picker-help">
                {localServerName(row.serverKind)} · {row.baseUrl}
              </span>
              {row.models.length === 0 ? (
                <div className="text-muted">No chat models found.</div>
              ) : (
                <ul className="ml-4 list-disc">
                  {(expanded[row.baseUrl] ? row.models : row.models.slice(0, 5)).map((model) => (
                    <li key={model.id}>{localModelListLabel(model)}</li>
                  ))}
                </ul>
              )}
              {row.models.length > 5 ? <button type="button" className="btn quiet" onClick={() => setExpanded((prev) => ({ ...prev, [row.baseUrl]: !prev[row.baseUrl] }))}>{expanded[row.baseUrl] ? "Show fewer" : `Show all ${row.models.length}`}</button> : null}
            </li>
          ))}
        </ul>
      )}
      {note ? (
        <p className="mt-2 text-sm" role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The first-run card. Owner-only and first-run-only: both answers are decided
 * on the server (`getFirstRunModelCard`), and this component draws nothing at
 * all when the answer is no.
 */
export function FirstRunModelCard() {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const card = useQuery({ queryKey: ["first-run-model-card"], queryFn: () => getFirstRunModelCard() });
  const catalog = useQuery({ queryKey: CATALOG_KEY, queryFn: () => localModelCatalog() });
  const answer = useMutation({
    mutationFn: (payload: { choice?: { baseUrl: string; id: string }; keepAutomatic?: boolean }) =>
      answerFirstRunModelCardFn({ data: payload }),
    onSuccess: (result, payload) => {
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      qc.invalidateQueries({ queryKey: ["first-run-model-card"] });
      qc.invalidateQueries({ queryKey: ["local-model-choice"] });
      announceToDesk(
        payload.keepAutomatic
          ? "Automatic ladder kept as the writing model."
          : `Writing model set to ${payload.choice?.id ?? "the model you chose"}.`,
      );
    },
  });

  if (!card.data?.show) return null;
  const rows = localModelListRows(catalog.data ?? null);

  return (
    <div className="astra-panel hot" data-testid="first-run-model-card">
      <h3 className="font-display text-lg font-semibold">{FIRST_RUN_MODEL_CARD_TITLE}</h3>
      <p className="mt-2 text-sm text-muted">{FIRST_RUN_MODEL_CARD_NOTE}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{LOCAL_MODEL_LIST_EMPTY}</p>
      ) : (
        <div className="mt-3 space-y-3">
          {rows.map((row) => (
            <div key={row.baseUrl} className="break-all">
              <div className="model-picker-help">
                {localServerName(row.serverKind)} · {row.baseUrl}
              </div>
              <ul className="mt-1 space-y-1">
                {row.models.map((model) =>
                  /*
                    UI1b-6 / Option A: a cloud row is a LINE, not a button.
                    The server refuses a cloud pick on purpose (it spends the
                    owner's Ollama allowance), so a "Use" button there could
                    only ever fail -- see `firstRunModelRowKind`. The line
                    carries the reason instead.
                  */
                  firstRunModelRowKind(model) === "local" ? (
                    <li key={model.id}>
                      <button
                        type="button"
                        className="btn quiet"
                        style={{ minHeight: 44 }}
                        disabled={answer.isPending}
                        onClick={() => answer.mutate({ choice: { baseUrl: row.baseUrl, id: model.id } })}
                      >
                        Use {localModelListLabel(model)}
                      </button>
                    </li>
                  ) : (
                    <li key={model.id} className="text-muted">
                      {firstRunModelLine(model)}
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          className="btn quiet"
          style={{ minHeight: 44 }}
          disabled={answer.isPending}
          onClick={() => answer.mutate({ keepAutomatic: true })}
        >
          {FIRST_RUN_MODEL_KEEP_AUTOMATIC}
        </button>
        <RefreshModels onNote={setNote} />
      </div>
      {note ? (
        <p className="mt-2 text-sm" role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}
