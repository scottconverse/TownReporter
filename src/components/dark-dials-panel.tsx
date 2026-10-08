import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InkButton } from "@/components/desk-chrome";
import { ModelPicker } from "@/components/model-picker";
import { getDarkDials, saveDarkDials } from "@/lib/news/dark";
import { DARK_LIMITS, type DarkLimitKey } from "@/lib/news/editor-dialog-logic";
import type { StoryModelChoice } from "@/lib/news/model-choice";
import type { ModelEffort } from "@/lib/news/provider-registry";

export type DarkDialsPanelProps = {
  modelChoice: StoryModelChoice;
  onModelChoice: (choice: StoryModelChoice) => void;
  modelEffort: ModelEffort | null;
  onModelEffort: (effort: ModelEffort | null) => void;
  modelDisabled?: boolean;
};

export function DarkDialsPanel({
  modelChoice,
  onModelChoice,
  modelEffort,
  onModelEffort,
  modelDisabled,
}: DarkDialsPanelProps) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["dark-dials"], queryFn: () => getDarkDials() });
  const [draft, setDraft] = useState<DarkLimitKey | null>(null);
  const selected = draft ?? settings.data?.defaultLimitKey ?? "standard";
  const save = useMutation({
    mutationFn: () => saveDarkDials({ data: { defaultLimitKey: selected } }),
    onSuccess: () => {
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["dark-dials"] });
    },
  });

  if (settings.isError) {
    return (
      <section className="astra-settings-group" aria-labelledby="dark-settings-depth">
        <h3 id="dark-settings-depth">How hard to dig</h3>
        <p role="alert">Could not read the saved default depth. No setting was changed.</p>
        <InkButton tone="quiet" onClick={() => void settings.refetch()}>Try again</InkButton>
      </section>
    );
  }
  if (!settings.data) return <p role="status">Loading Dark Desk defaults…</p>;

  return (
    <section className="astra-settings-group" aria-labelledby="dark-settings-depth">
      <h3 id="dark-settings-depth">How hard to dig</h3>
      <ModelPicker
        scope="dark"
        label="Digging model"
        value={modelChoice}
        onChange={onModelChoice}
        effort={modelEffort}
        onEffortChange={onModelEffort}
        disabled={modelDisabled}
      />
      <div className="astra-depth-options" role="group" aria-label="Default file depth">
        {DARK_LIMITS.map((limit) => (
          <button
            key={limit.key}
            type="button"
            className={"astra-depth-option" + (selected === limit.key ? " on" : "")}
            aria-pressed={selected === limit.key}
            onClick={() => setDraft(limit.key)}
          >
            <strong>{limit.key === "quick" ? "Quick" : limit.key === "deep" ? "Deep" : "Standard"}</strong>
            <span>{limit.records} records · {limit.minutes >= 60 ? `${limit.minutes / 60} hours` : `${limit.minutes} minutes`}</span>
          </button>
        ))}
      </div>
      {save.isError ? <p role="alert">Could not save the default depth. Try again.</p> : null}
      <div className="astra-settings-actions">
        <InkButton tone="solid" disabled={selected === settings.data.defaultLimitKey || save.isPending} pending={save.isPending} pendingLabel="Saving…" onClick={() => save.mutate()}>
          Save default
        </InkButton>
        <InkButton tone="quiet" disabled={selected === settings.data.defaultLimitKey || save.isPending} onClick={() => setDraft(null)}>
          Reset
        </InkButton>
      </div>
    </section>
  );
}
