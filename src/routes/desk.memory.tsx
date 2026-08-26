import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DeskShell, Field, InkButton, areaClass, inputClass } from "@/components/desk-chrome";
import { EmptyState, ListSkeleton, Notice } from "@/components/states";
import { addCorrection, listMemory } from "@/lib/news/desk";
import { formatShortDate } from "@/lib/paper";

export const Route = createFileRoute("/desk/memory")({ component: MemoryPage });

function MemoryPage() {
  const qc = useQueryClient();
  const memory = useQuery({ queryKey: ["memory"], queryFn: () => listMemory() });
  const [slug, setSlug] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const corr = useMutation({
    mutationFn: () =>
      addCorrection({
        data: { articleSlug: slug || undefined, body },
      }),
    onSuccess: (res) => {
      if (res.ok) {
        setBody("");
        setNote("Posted to the public corrections page.");
        void qc.invalidateQueries({ queryKey: ["corrections"] });
        void qc.invalidateQueries({ queryKey: ["memory"] });
      } else {
        setNote("error" in res ? String(res.error) : "Could not post that correction.");
      }
    },
    onError: (err) => {
      setNote(err instanceof Error ? err.message : "Could not post that correction.");
    },
  });

  return (
    <DeskShell title="Memory & corrections" kicker="The record">
      <p className="max-w-2xl text-ink-2">
        Beat memory is what Grok is told we already covered. Corrections are
        public.
      </p>
      <section className="mt-8">
        <h2 className="font-display text-2xl">Post a correction</h2>
        <form
          className="mt-3 max-w-xl space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            corr.mutate();
          }}
        >
          <Field label="Article slug (optional)">
            <input
              className={inputClass}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="welcome-to-townreporter"
            />
          </Field>
          <Field label="Correction">
            <textarea
              className={areaClass + " min-h-28"}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
            />
          </Field>
          <InkButton type="submit" disabled={corr.isPending || !body.trim()}>
            {corr.isPending ? "Posting…" : "Publish correction"}
          </InkButton>
        </form>
        {note && (
          <Notice kind={note.startsWith("Posted") ? "ok" : "err"}>{note}</Notice>
        )}
      </section>
      <section className="mt-10">
        <h2 className="font-display text-2xl">Beat memory</h2>
        {memory.isPending && !(memory.data ?? []).length ? (
          <ListSkeleton rows={3} />
        ) : (memory.data ?? []).length === 0 ? (
          <div className="mt-3">
            <EmptyState
              kicker="The record"
              title="Empty until you publish"
              body="Beat memory is what Grok is told we already covered. It fills in when a story hits the paper."
            />
          </div>
        ) : (
          <ul className="stagger-in mt-3 divide-y divide-rule border border-rule bg-paper">
            {(memory.data ?? []).map((m) => (
              <li key={m.id} className="px-4 py-3">
                <p className="font-medium">{m.entity}</p>
                <p className="text-sm text-ink-2">{m.last_angle}</p>
                <p className="text-[12px] text-muted">{formatShortDate(m.updated_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </DeskShell>
  );
}
