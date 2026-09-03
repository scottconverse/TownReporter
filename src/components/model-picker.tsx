import {
  DARK_MODEL_CHOICES,
  OPINION_MODEL_CHOICES,
  STORY_MODEL_CHOICES,
  modelChoiceHelp,
  type DarkModelChoice,
  type OpinionModelChoice,
  type StoryModelChoice,
} from "@/lib/news/model-choice";
import { useId } from "react";

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

export function ModelPicker(props: Props) {
  const options =
    props.scope === "opinion"
      ? OPINION_MODEL_CHOICES
      : props.scope === "dark"
        ? DARK_MODEL_CHOICES
        : STORY_MODEL_CHOICES;
  const selected = options.find((option) => option.value === props.value) ?? options[0];
  const helpId = useId();
  const selectId = useId();
  const help = modelChoiceHelp(selected.value, props.scope ?? "story");
  return (
    <div className={props.compact ? "model-picker compact" : "model-picker"}>
      <label htmlFor={selectId} className="model-picker-label">
        {props.scope === "dark" ? "Digging model" : "Writing model"}
      </label>
      <select
        id={selectId}
        value={props.value}
        disabled={props.disabled}
        aria-describedby={helpId}
        onChange={(event) => props.onChange(event.target.value as never)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} — {option.detail}
          </option>
        ))}
      </select>
      <span id={helpId} className="model-picker-help">
        {help}
      </span>
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
