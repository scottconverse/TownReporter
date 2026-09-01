import {
  OPINION_MODEL_CHOICES,
  STORY_MODEL_CHOICES,
  modelChoiceHelp,
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
    };

export function ModelPicker(props: Props) {
  const options = props.scope === "opinion" ? OPINION_MODEL_CHOICES : STORY_MODEL_CHOICES;
  const selected = options.find((option) => option.value === props.value) ?? options[0];
  const helpId = useId();
  const help = modelChoiceHelp(selected.value, props.scope === "opinion" ? "opinion" : "story");
  return (
    <label className={props.compact ? "model-picker compact" : "model-picker"}>
      <span className="model-picker-label">Writing model</span>
      <select
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
    </label>
  );
}
