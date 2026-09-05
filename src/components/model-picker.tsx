import {
  DARK_MODEL_CHOICES,
  OPINION_MODEL_CHOICES,
  STORY_MODEL_CHOICES,
  modelChoiceHelp,
  type DarkModelChoice,
  type ModelChoiceOption,
  type OpinionModelChoice,
  type StoryModelChoice,
} from "@/lib/news/model-choice";
import { providerAvailability, localModelCatalog, refreshLocalModelCatalog } from "@/lib/news/provider-availability";
import { getLocalModelChoice, saveLocalModelFn } from "@/lib/news/provider-settings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";

/** Speaks through DeskShell's always-mounted `#desk-announcer` region. */
function announceToDesk(text: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById("desk-announcer");
  if (el) el.textContent = text;
}

const LOCAL_SERVER_LABELS: Record<string, string> = {
  lmstudio: "LM Studio",
  ollama: "Ollama",
  "openai-compatible": "Configured server",
};

function localServerLabel(kind: string, baseUrl: string): string {
  const host = baseUrl.replace(/^https?:\/\//, "").replace(/\/v1\/?$/, "");
  return `${LOCAL_SERVER_LABELS[kind] ?? "Server"} · ${host}`;
}

type Props =
  | {
      scope?: "story";
      value: StoryModelChoice;
      onChange: (value: StoryModelChoice) => void;
      disabled?: boolean;
      compact?: boolean;
    }
  | {
      scope: "opinion";
      value: OpinionModelChoice;
      onChange: (value: OpinionModelChoice) => void;
      disabled?: boolean;
      compact?: boolean;
    }
  | {
      /**
       * Dark Desk (0.6.2). The same component, because "which model does
       * this" should look and behave identically wherever the desk spends --
       * and because a fourth hand-written picker is a fourth place to forget
       * a provider.
       */
      scope: "dark";
      value: DarkModelChoice;
      onChange: (value: DarkModelChoice) => void;
      disabled?: boolean;
      compact?: boolean;
    };

/**
 * What the desk shows when the option the editor has selected -- or the one
 * un-set-up option sitting in the list -- has no server behind it. Same
 * single sentence `preflight.ts`'s `LOCAL_MODEL_UNCONFIGURED` gives a run
 * that gets all the way to spending before refusing, so an editor sees the
 * identical wording whether the picker catches it first or the run does.
 */
function notSetUpHelp(option: ModelChoiceOption): string {
  if (option.value === "local-model") {
    return "Local model is not set up on this server. See docs/local-models.md.";
  }
  return `${option.label} is not set up on this server. See docs/setup.md.`;
}

/**
 * The second, model-level select that appears under the picker only when
 * "Local model" is the chosen provider. Its own component so its two
 * queries (the live catalog, the newsroom's stored pick) only ever run when
 * they are needed.
 */
function LocalModelSelect({ scope }: { scope: "story" | "opinion" | "dark" }) {
  const qc = useQueryClient();
  const selectId = useId();
  const catalog = useQuery({
    queryKey: ["local-model-catalog"],
    queryFn: () => localModelCatalog(),
    staleTime: 15_000,
  });
  const choice = useQuery({
    queryKey: ["local-model-choice", scope],
    queryFn: () => getLocalModelChoice(),
    staleTime: 15_000,
  });
  const save = useMutation({
    mutationFn: (picked: { baseUrl: string; id: string }) => saveLocalModelFn({ data: picked }),
    onSuccess: (_result, picked) => {
      qc.invalidateQueries({ queryKey: ["local-model-choice"] });
      announceToDesk(`Local model set to ${picked.id}.`);
    },
  });
  const refresh = useMutation({
    mutationFn: () => refreshLocalModelCatalog(),
    onSuccess: (data) => {
      qc.setQueryData(["local-model-catalog"], data);
      announceToDesk(
        data.servers.some((s) => s.reachable)
          ? "Local server list refreshed."
          : "No local server found on this machine.",
      );
    },
  });

  const servers = catalog.data?.servers ?? [];
  const reachable = servers.filter((s) => s.reachable);
  const selected = choice.data?.override ?? catalog.data?.defaultModel ?? null;
  const notice = choice.data?.notice;

  if (catalog.isLoading) return null;

  return (
    <div className="model-picker local-model-picker" style={{ gridColumn: "1 / -1" }}>
      <label htmlFor={selectId} className="model-picker-label">
        Local model
      </label>
      {reachable.length === 0 ? (
        <span className="model-picker-help">
          No local server found on this machine. Start LM Studio&apos;s server or Ollama, or set
          LLM_BASE_URL. See docs/local-models.md.
        </span>
      ) : (
        <>
          <select
            id={selectId}
            value={selected ? `${selected.baseUrl} ${selected.id}` : ""}
            onChange={(event) => {
              const [baseUrl, id] = event.target.value.split(" ");
              if (baseUrl && id) save.mutate({ baseUrl, id });
            }}
          >
            {!selected ? <option value="">Choose a model…</option> : null}
            {reachable.map((server) => (
              <optgroup key={server.baseUrl} label={localServerLabel(server.kind, server.baseUrl)}>
                {server.models.map((model) => {
                  const suffix = [model.loaded ? "loaded" : null, model.thinking ? "thinking off" : null]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <option key={model.id} value={`${server.baseUrl} ${model.id}`}>
                      {model.id}
                      {suffix ? ` · ${suffix}` : ""}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
          <span className="model-picker-help">
            Loaded models answer fast. A model that is not loaded gets loaded on the first call,
            which can take a minute or more.
          </span>
          {notice ? <span className="model-picker-help">{notice}</span> : null}
        </>
      )}
      <button
        type="button"
        className="model-picker-refresh"
        style={{ minHeight: 44, minWidth: 44 }}
        disabled={refresh.isPending}
        onClick={() => refresh.mutate()}
      >
        {refresh.isPending ? "Checking…" : "Refresh"}
      </button>
    </div>
  );
}

export function ModelPicker(props: Props) {
  const options =
    props.scope === "opinion"
      ? OPINION_MODEL_CHOICES
      : props.scope === "dark"
        ? DARK_MODEL_CHOICES
        : STORY_MODEL_CHOICES;
  const selected = options.find((option) => option.value === props.value) ?? options[0];
  const helpId = useId();
  const flagId = useId();
  const selectId = useId();
  /*
    Which providers are actually usable ON THIS SERVER, not just offered for
    this surface. `providersFor()` (provider-registry.ts) only filters by
    `offeredFor[surface]` -- it never asked `entry.enabled()` -- so before
    this query existed the picker rendered "Local model" as a plain
    selectable option even with LLM_BASE_URL unset, and a draft picked that
    way could only fail after spending nothing but the editor's time (owner
    report 2026-09-05). `enabled()` reads `process.env`, which does not exist
    in the browser bundle this component ships in, so the answer has to come
    from the server -- this is the one query every picker instance shares.
  */
  const availability = useQuery({
    queryKey: ["provider-availability"],
    queryFn: () => providerAvailability(),
    staleTime: 5 * 60 * 1000,
  });
  function isAvailable(value: string): boolean {
    if (value === "auto") return true;
    // Undecided (still loading, or the query failed) defaults to available
    // so the picker never locks up over a slow network call -- the
    // preflight check on the actual run is the backstop that refuses
    // before spending anything either way (see commitStoryDraftForAuthenticatedEditor).
    return availability.data ? availability.data[value] !== false : true;
  }
  const unavailable = options.filter((option) => option.value !== "auto" && !isAvailable(option.value));
  const selectedUnavailable = !isAvailable(props.value);
  // The one un-set-up option gets flagged even when it is not the current
  // selection, so an editor sees "not set up" before picking it rather than
  // after a failed draft.
  const flagged = !selectedUnavailable && unavailable.length === 1 ? unavailable[0] : null;
  const help = selectedUnavailable ? notSetUpHelp(selected) : modelChoiceHelp(selected.value, props.scope ?? "story");
  return (
    <div className={props.compact ? "model-picker compact" : "model-picker"}>
      <label htmlFor={selectId} className="model-picker-label">
        {props.scope === "dark" ? "Digging model" : "Writing model"}
      </label>
      <select
        id={selectId}
        value={props.value}
        disabled={props.disabled}
        aria-describedby={flagged ? `${helpId} ${flagId}` : helpId}
        onChange={(event) => props.onChange(event.target.value as never)}
      >
        {options.map((option) => {
          const available = isAvailable(option.value);
          return (
            <option key={option.value} value={option.value} disabled={!available}>
              {option.label} — {option.detail}
              {available ? "" : " — not set up"}
            </option>
          );
        })}
      </select>
      <span id={helpId} className="model-picker-help">
        {help}
      </span>
      {flagged ? (
        <span id={flagId} className="model-picker-help">
          {notSetUpHelp(flagged)}
        </span>
      ) : null}
      {props.value === "local-model" && !selectedUnavailable ? (
        <LocalModelSelect scope={props.scope ?? "story"} />
      ) : null}
      <details className="min-w-0 text-sm" style={{ gridColumn: "1 / -1" }}>
        <summary className="cursor-pointer underline underline-offset-2 focus-visible:outline-2">
          Set up a writing model
        </summary>
        <div className="mt-2 space-y-2">
          <p>
            Set up the provider on the computer running TownReporter, not just the computer viewing
            this page.
          </p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              For Codex, follow the{" "}
              <a
                className="inline-link"
                href="https://developers.openai.com/codex/cli/"
                target="_blank"
                rel="noreferrer"
              >
                Codex CLI installation guide
              </a>
              . For Claude, follow the{" "}
              <a
                className="inline-link"
                href="https://code.claude.com/docs/en/setup"
                target="_blank"
                rel="noreferrer"
              >
                Claude Code installation guide
              </a>
              . For the local model, start llama.cpp, LM Studio, or any other OpenAI-compatible
              server on that computer and set <code>LLM_BASE_URL</code> (and, if it wants one,{" "}
              <code>LLM_MODEL</code> / <code>LLM_API_KEY</code>) in the server&apos;s{" "}
              <code>.env</code> -- see{" "}
              <a
                className="inline-link"
                href="https://github.com/scottconverse/TownReporter/blob/main/docs/local-models.md"
                target="_blank"
                rel="noreferrer"
              >
                the local models guide
              </a>
              .
            </li>
            <li>
              Open that provider and sign in under the same account that runs TownReporter. If a
              login expires, sign in again there.
            </li>
            {props.scope === "opinion" ? (
              <li>
                Opinion also needs your editorial voice: save the voice file outside the repository,
                set <code>TOWNREPORTER_VOICE_FILE</code> in the server&apos;s <code>.env</code> to
                its full path, and have the server operator use the approved restart procedure to
                load that setting. The{" "}
                <a
                  className="inline-link"
                  href="https://github.com/scottconverse/TownReporter/blob/main/docs/setup.md#the-opinion-voice"
                  target="_blank"
                  rel="noreferrer"
                >
                  Opinion voice guide
                </a>{" "}
                explains the file and configuration.
              </li>
            ) : null}
            <li>
              Return here, reload this page to check readiness again, choose the model, then start
              your draft. An explicit choice never switches to another provider.
            </li>
          </ol>
          <p>
            <a
              className="inline-link"
              href="https://github.com/scottconverse/TownReporter/blob/main/docs/setup.md#per-run-picker"
              target="_blank"
              rel="noreferrer"
            >
              Open the operator setup guide
            </a>{" "}
            for paths, endpoints and troubleshooting. TownReporter does not install software or sign
            you in from this page.
          </p>
        </div>
      </details>
    </div>
  );
}
