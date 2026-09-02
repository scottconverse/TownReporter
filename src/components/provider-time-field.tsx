import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { InkButton } from "@/components/desk-chrome";
import { saveProviderTimeFn, type ProviderTimeSetting } from "@/lib/news/provider-settings";
/*
  The two bounds come from the PURE registry module, not from
  provider-settings.ts: this is a client component, and the registry is the
  half with no database handle, no `node:` imports and nothing to leak into
  the browser bundle.
*/
import { MAX_BUDGET_SECONDS, MIN_BUDGET_SECONDS } from "@/lib/news/provider-registry";

/**
 * How long the desk waits for one answer from this model before giving up.
 *
 * The operator's rule for 0.6.2: "timeouts are likely too short for local
 * models -- give the editor the option to make them longer or shorter in the
 * interface." A model running on this same machine can take four minutes to
 * read a long pack, and the shipped 150-second ceiling would call that a
 * failure every time.
 *
 * Seconds here, milliseconds in the database and in code; the conversion
 * happens in src/lib/news/provider-settings.ts, not in this component. The
 * field is owner-only, and the server function refuses a plain editor rather
 * than relying on this panel being hidden from them.
 */
export function ProviderTimeField({
  row,
  onNote,
}: {
  row: ProviderTimeSetting;
  onNote: (text: string) => void;
}) {
  const qc = useQueryClient();
  const fieldId = `provider-seconds-${row.providerId}`;
  const [value, setValue] = useState(String(row.callSeconds));
  const [err, setErr] = useState("");

  // The server is the source of truth. A save (or a Reset) returns the whole
  // list, and the field follows what came back rather than what was typed.
  useEffect(() => {
    setValue(String(row.callSeconds));
  }, [row.callSeconds]);

  const save = useMutation({
    mutationFn: (callSeconds: number | null) =>
      saveProviderTimeFn({ data: { providerId: row.providerId, callSeconds } }),
    onMutate: () => setErr(""),
    onSuccess: (res) => {
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      const now = res.settings.find((s) => s.providerId === row.providerId);
      onNote(`${row.label} may now take up to ${now?.callSeconds ?? row.callSeconds} seconds per answer.`);
      void qc.invalidateQueries({ queryKey: ["provider-times"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "That would not save."),
  });

  const parsed = Number(value);
  const dirty = value.trim() !== "" && parsed !== row.callSeconds;

  return (
    <div className="mt-3 border-t border-rule pt-3" data-provider-time={row.providerId}>
      <label htmlFor={fieldId} className="block text-sm">
        Time per call, {row.label}
      </label>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        How long the desk waits for one answer before giving up. Local models need more.
      </p>
      <p className="mt-1 flex flex-wrap items-baseline gap-2">
        <input
          id={fieldId}
          type="number"
          inputMode="numeric"
          min={MIN_BUDGET_SECONDS}
          max={MAX_BUDGET_SECONDS}
          className="w-24 border border-rule bg-paper px-2 py-1"
          value={value}
          disabled={save.isPending}
          onChange={(event) => setValue(event.target.value)}
        />
        <span className="text-sm text-muted">
          seconds (default {row.defaultCallSeconds} s)
        </span>
        <InkButton
          small
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate(Number.isFinite(parsed) ? Math.round(parsed) : null)}
        >
          {save.isPending ? "Saving…" : "Save"}
        </InkButton>
        {row.overridden ? (
          <InkButton
            tone="quiet"
            small
            disabled={save.isPending}
            onClick={() => save.mutate(null)}
          >
            Reset
          </InkButton>
        ) : null}
      </p>
      {err ? <p className="mt-1 text-sm text-rust">{err}</p> : null}
    </div>
  );
}
