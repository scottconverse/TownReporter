import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { InkButton, SecHead, announceToDesk } from "./desk-chrome";
import { editorSections } from "@/lib/news/sections";
import {
  getRoutineNoticeAutomation,
  saveRoutineNoticeAutomation,
  type RoutineNoticeAutomation,
  type RoutineAutomationSource,
} from "@/lib/news/routine-notice-automation";
import type { RoutineNoticePolicy } from "@/lib/news/routine-notice-policy";
export function RoutineNoticeAutomationPanel({ policy }: { policy: RoutineNoticePolicy }) {
  const query = useQuery({
    queryKey: ["routine-notice-automation"],
    queryFn: () => getRoutineNoticeAutomation(),
  });
  const sectionQuery = useQuery({ queryKey: ["editor-sections"], queryFn: () => editorSections() });
  const [draft, setDraft] = useState<RoutineNoticeAutomation | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (query.data?.ok) setDraft(query.data.automation);
  }, [query.data]);
  const save = useMutation({
    mutationFn: () =>
      saveRoutineNoticeAutomation({
        data: {
          enabled: draft!.enabled,
          expectedRevision: draft!.revision,
          timezone: draft!.timezone,
          localTime: draft!.localTime,
          sections: draft!.sections,
          sources: draft!.sources,
        },
      }),
    onSuccess: (r) => {
      if (r.ok) {
        setDraft(r.automation);
        setNote(
          r.automation.enabled ? "Routine editions are active." : "Routine editions are paused.",
        );
      } else setNote(r.error);
      announceToDesk(r.ok ? "Routine edition settings saved." : r.error);
    },
    onError: (e) =>
      setNote(e instanceof Error ? e.message : "Routine edition settings did not save."),
  });
  if (query.isError || sectionQuery.isError)
    return (
      <p className="mt-6 text-sm" role="alert">
        Routine edition controls could not be loaded. Reload Server to try again.
      </p>
    );
  if (!draft || sectionQuery.isPending)
    return <p className="mt-6 text-sm text-muted">Loading routine edition controls…</p>;
  const available = policy.approvals.filter((a) => a.valid);
  const selected = new Map(draft.sources.map((s) => [`${s.sourceId}:${s.formatKey}`, s]));
  const update = (key: string, patch: Partial<RoutineAutomationSource>) =>
    setDraft({
      ...draft,
      sources: draft.sources.map((s) =>
        `${s.sourceId}:${s.formatKey}` === key ? { ...s, ...patch } : s,
      ),
    });
  const toggle = (approval: (typeof available)[number]) => {
    const key = `${approval.sourceId}:${approval.formatKey}`;
    setDraft({
      ...draft,
      sources: selected.has(key)
        ? draft.sources.filter((s) => `${s.sourceId}:${s.formatKey}` !== key)
        : [
            ...draft.sources,
            {
              sourceId: approval.sourceId,
              sourceUrl: approval.sourceUrl,
              publicSourceUrl: "",
              formatKey: approval.formatKey,
              issuer: "",
              locality: "",
              collectionArea: null,
            },
          ],
    });
  };
  const sections = (sectionQuery.data?.sections ?? []).filter((s) => s.visible);
  return (
    <section
      id="routine-notice-automation"
      className="mt-8 border-t border-rule pt-6"
      aria-labelledby="routine-editions-heading"
    >
      <SecHead
        title="Automatic routine editions"
        sub="Deterministic logistics from explicitly approved structured sources."
      />
      <p id="routine-editions-heading" className="mt-2 max-w-3xl text-sm text-muted">
        Save the source context here while paused before using Check results for parsed logistics. Review the publication settings below. Activation publishes ordinary Today in town, Friday
        weekend, and useful new deadline roundups. Unsupported or ambiguous source prose stays for
        review.
      </p>
      <label className="mt-4 flex gap-2">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
        />
        <span>Activate automatic routine editions</span>
      </label>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label>
          Local time
          <input
            className="field mt-1"
            type="time"
            value={draft.localTime}
            onChange={(e) => setDraft({ ...draft, localTime: e.target.value })}
          />
        </label>
        <label>
          Timezone
          <input
            className="field mt-1"
            value={draft.timezone}
            onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
          />
        </label>
        {(["today", "weekend", "deadlines"] as const).map((channel) => (
          <label key={channel}>
            {channel[0]!.toUpperCase() + channel.slice(1)} section
            <select
              className="field mt-1"
              value={draft.sections[channel]}
              onChange={(e) =>
                setDraft({ ...draft, sections: { ...draft.sections, [channel]: e.target.value } })
              }
            >
              {sections.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <fieldset className="mt-5 border border-rule p-4">
        <legend className="px-1 font-medium">Active structured sources (maximum 12)</legend>
        {available.map((a) => {
          const key = `${a.sourceId}:${a.formatKey}`,
            row = selected.get(key);
          return (
            <div key={key} className="border-t border-rule py-3 first:border-0">
              <label>
                <input type="checkbox" checked={!!row} onChange={() => toggle(a)} />{" "}
                {a.sourceTitle ?? a.sourceUrl} · {a.formatKey}
              </label>
              {row ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input
                    className="field"
                    aria-label={`${key} authoritative issuer`}
                    placeholder="Authoritative issuer"
                    value={row.issuer}
                    onChange={(e) => update(key, { issuer: e.target.value })}
                  />
                  <input
                    className="field"
                    aria-label={`${key} locality`}
                    placeholder="Locality"
                    value={row.locality}
                    onChange={(e) => update(key, { locality: e.target.value })}
                  />
                  <input
                    className="field"
                    aria-label={`${key} public attribution URL`}
                    placeholder="Public attribution URL"
                    value={row.publicSourceUrl}
                    onChange={(e) => update(key, { publicSourceUrl: e.target.value })}
                  />
                  <input
                    className="field"
                    aria-label={`${key} designated area or branch`}
                    placeholder="Area or branch (when required)"
                    value={row.collectionArea ?? ""}
                    onChange={(e) => update(key, { collectionArea: e.target.value || null })}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </fieldset>
      <div className="mt-4 border border-rule p-4 text-sm">
        <p className="font-medium">Publication settings preview</p>
        {draft.sources.length ? (
          <ul className="mt-1 list-disc pl-5">
            {draft.sources.map((source) => (
              <li key={`${source.sourceId}:${source.formatKey}`}>
                {source.issuer || "Issuer required"} · {source.locality || "Locality required"} ·{" "}
                {source.formatKey} · Source: {source.publicSourceUrl || "public URL required"}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted">Select a source to preview its exact attribution.</p>
        )}
        <p className="mt-2">Today uses events and services on the newsroom-local date.</p>
        <p>This weekend publishes Friday for Friday–Sunday logistics.</p>
        <p>Deadlines approaching includes only new or changed deadlines in the next seven days.</p>
      </div>
      <InkButton
        disabled={save.isPending || draft.sources.length > 12}
        onClick={() => save.mutate()}
      >
        {save.isPending ? "Saving…" : draft.enabled ? "Save and activate" : "Save paused settings"}
      </InkButton>
      {note ? (
        <p className="mt-2 text-sm" role="status">
          {note}
        </p>
      ) : null}
      {draft.recentRuns.length ? (
        <ul className="mt-4 text-sm">
          {draft.recentRuns.map((run) => (
            <li key={run.id}>
              {run.localDate} · {run.status} · {run.summary.eligible} eligible ·{" "}
              {run.summary.published} published · {run.summary.corrected} corrected ·{" "}
              {run.summary.needsReview} need review
              {run.summary.error ? ` · ${run.summary.error}` : null}
              {run.summary.needsReview ? (
                <>
                  {" "}· <a href="#routine-notice-checks">Review source checks</a>
                </>
              ) : null}
              {run.articles.map((article) => (
                <span key={article.href}>
                  {" "}· <a href={article.href}>{article.headline}</a>
                </span>
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">No automatic edition runs yet.</p>
      )}
    </section>
  );
}
