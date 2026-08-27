import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Busy, DeskShell, Field, InkButton, leadOrigin } from "@/components/desk-chrome";
import { EmptyState, WorkbenchSkeleton, Notice } from "@/components/states";
import { draftLead, getLead, publishLead, saveDraft, saveReportingNotes } from "@/lib/news/desk";
import { formatShortDate, parseUrlList } from "@/lib/paper";
import {
  applyTodoPatch,
  notesHaveMemo,
  parseNotes,
  type ReportingNotes,
} from "@/lib/news/notes";
import { editorDraftError } from "@/lib/news/desk-copy";
import { stripReporterNotebook } from "@/lib/news/strip-draft";

export const Route = createFileRoute("/desk/story/$leadId")({
  component: StoryPage,
});

function StoryPage() {
  const { leadId } = Route.useParams();
  const id = Number(leadId);
  const qc = useQueryClient();
  const [headline, setHeadline] = useState("");
  const [dek, setDek] = useState("");
  const [body, setBody] = useState("");
  const [topic, setTopic] = useState("council");
  const [msg, setMsg] = useState("");
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null);
  const [draftStartedAt, setDraftStartedAt] = useState<number | null>(null);
  const hadBodyAtStart = useRef(false);

  const { data, isPending } = useQuery({
    queryKey: ["lead", id],
    queryFn: () => getLead({ data: id }),
    refetchInterval: draftStartedAt ? 3000 : false,
  });

  useEffect(() => {
    if (!data?.draft) return;
    setHeadline(data.draft.headline);
    setDek(data.draft.dek);
    setBody(stripReporterNotebook(data.draft.body));
    setTopic(data.draft.topic);
    if (data.articleSlug) setPublishedSlug(data.articleSlug);
  }, [data?.draft, data?.articleSlug]);

  function draftLanded(draft: { body?: string | null; updated_at?: string } | null | undefined) {
    if (!draft?.body) return false;
    if (!hadBodyAtStart.current) return true;
    if (!draftStartedAt) return true;
    const t = Date.parse(draft.updated_at || "");
    if (!Number.isFinite(t)) return true;
    return t >= draftStartedAt - 5000;
  }

  const draft = useMutation({
    mutationFn: () => draftLead({ data: id }),
    onMutate: () => {
      setMsg("");
      hadBodyAtStart.current = Boolean(data?.draft?.body);
      setDraftStartedAt(Date.now());
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["lead", id] });
      await qc.invalidateQueries({ queryKey: ["leads"] });
      if (res.ok) {
        setDraftStartedAt(null);
        setMsg("");
        return;
      }
      const latest = qc.getQueryData(["lead", id]) as typeof data;
      if (draftLanded(latest?.draft) || draftLanded(data?.draft)) {
        setDraftStartedAt(null);
        setMsg("");
        return;
      }
      if (looksLikeDraftTimeout(res.error)) return;
      setDraftStartedAt(null);
      setMsg(editorDraftError(res.error) ?? res.error);
    },
    onError: async (err) => {
      await qc.invalidateQueries({ queryKey: ["lead", id] });
      const latest = qc.getQueryData(["lead", id]) as typeof data;
      if (draftLanded(latest?.draft) || draftLanded(data?.draft)) {
        setDraftStartedAt(null);
        setMsg("");
        return;
      }
      const raw = err instanceof Error ? err.message : "Draft failed";
      if (looksLikeDraftTimeout(raw)) return;
      setDraftStartedAt(null);
      setMsg(editorDraftError(raw) ?? "The draft did not finish. Click Draft with AI again.");
    },
  });

  const waiting = draft.isPending || Boolean(draftStartedAt);

  useEffect(() => {
    if (!draftStartedAt) return;
    if (draftLanded(data?.draft)) {
      setDraftStartedAt(null);
      setMsg("");
      return;
    }
    const remain = 120_000 - (Date.now() - draftStartedAt);
    const t = setTimeout(() => {
      if (draftLanded(data?.draft)) {
        setDraftStartedAt(null);
        setMsg("");
        return;
      }
      setDraftStartedAt(null);
      if (!data?.draft?.body) {
        setMsg(
          "The draft did not finish in time. Sources were slow or the writing pass ran long. Click Draft with AI again.",
        );
      }
    }, Math.max(1000, remain));
    return () => clearTimeout(t);
  }, [data?.draft, draftStartedAt]);

  const save = useMutation({
    mutationFn: () =>
      saveDraft({ data: { leadId: id, headline, dek, body, topic } }),
    onSuccess: () => setMsg("Saved."),
  });

  const publish = useMutation({
    mutationFn: async () => {
      await saveDraft({ data: { leadId: id, headline, dek, body, topic } });
      return publishLead({ data: id });
    },
    onSuccess: async (res) => {
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      await qc.invalidateQueries({ queryKey: ["leads"] });
      await qc.invalidateQueries({ queryKey: ["paper"] });
      await qc.invalidateQueries({ queryKey: ["published-desk"] });
      setPublishedSlug(res.slug);
      setMsg("On the paper.");
    },
  });

  if (isPending) {
    return (
      <DeskShell title="Story" kicker="Workbench">
        <WorkbenchSkeleton />
      </DeskShell>
    );
  }
  if (!data) {
    return (
      <DeskShell title="Missing" kicker="Workbench">
        <EmptyState
          kicker="Workbench"
          title="That lead is not on this desk"
          body="It may have been killed, or this copy of the desk never filed it. The queue has what is still open."
          action={
            <Link to="/desk/queue" className="btn">
              Back to queue
            </Link>
          }
        />
      </DeskShell>
    );
  }

  const sources = parseUrlList(data.lead.source_urls);
  const fromDark =
    Boolean(data.lead.investigation_id) ||
    /DARK DESK/i.test(data.lead.why) ||
    data.lead.headline.startsWith("[Dark]");
  const locked = data.lead.status === "killed";
  const onPaper = data.lead.status === "published" || Boolean(publishedSlug);
  const canPublish =
    Boolean(data.draft) &&
    data.lead.status !== "held" &&
    !locked &&
    !onPaper;
  const found = findingsFrom(data.draft?.found_note);
  const unanswered = unansweredNotes(data.draft?.unanswered);
  const verify = data.draft?.integrity_notes?.trim() || "";
  const notes = parseNotes(data.lead.notes_json);
  if (!notesHaveMemo(notes)) {
    if (!notes.found.length && found.length) {
      notes.found = found.map((f) => ({ t: f.text, src: f.url }));
    }
    if (!notes.todo.length && unanswered.length) {
      notes.todo = unanswered.map((t) => ({ t, done: false, src: "machine" as const }));
    }
    if (!notes.verify.length && verify) notes.verify = [verify];
  }
  const score = data.lead.newsworthiness ?? 0;

  return (
    <DeskShell title={data.lead.headline} kicker="Workbench" hideTitle>
      <Link to="/desk/queue" className="crumb">
        ← Queue
      </Link>
      <div className="story-grid">
        <aside className="story-side">
          <p className="kick">{fromDark ? "Working notes from Dark Desk" : "The lead"}</p>
          <h2 className="side-h">{data.lead.headline}</h2>
          <p className="side-why">{data.lead.why}</p>
          <p className="meta">
            {data.lead.topic} · filed {formatShortDate(data.lead.created_at)} · scored {score}/20 ·{" "}
            {leadOrigin(data.lead)}
          </p>
          {fromDark ? (
            <p className="side-note">
              This trail came from Dark Desk. Draft privately here; printing is a separate click
              and every claim still needs evidence.
            </p>
          ) : null}
          {sources.length > 0 ? (
            <div className="side-block">
              <p className="side-label">Sources on the lead</p>
              {sources.map((u) => (
                <p key={u} className="side-url">
                  <a href={u} target="_blank" rel="noreferrer" className="inline-link">
                    {u}
                  </a>
                </p>
              ))}
            </div>
          ) : null}
          <ReportingNotesPane
            leadId={id}
            notes={notes}
            hasDraft={Boolean(data.draft)}
            locked={locked || onPaper}
          />
        </aside>

        <section className="story-work">
          <div className="work-bar">
            {!locked && !onPaper ? (
              <InkButton
                disabled={waiting}
                onClick={() => {
                  if (waiting) return;
                  draft.mutate();
                }}
              >
                {waiting ? "Drafting…" : data.draft?.body ? "Redraft" : "Draft with AI"}
              </InkButton>
            ) : null}
            {data.draft && !locked && !onPaper ? (
              <>
                <InkButton tone="ghost" disabled={save.isPending} onClick={() => save.mutate()}>
                  Save edits
                </InkButton>
                {canPublish ? (
                  <InkButton
                    disabled={publish.isPending || !headline.trim() || !body.trim()}
                    onClick={() => publish.mutate()}
                  >
                    {publish.isPending ? "Publishing…" : "Publish to the paper"}
                  </InkButton>
                ) : null}
              </>
            ) : null}
            {onPaper ? (
              <p className="note">
                On the paper.{" "}
                <Link to="/desk/published" className="inline-link">
                  See it under Published
                </Link>
                {publishedSlug ? (
                  <>
                    {" · "}
                    <Link
                      to="/articles/$slug"
                      params={{ slug: publishedSlug }}
                      className="inline-link"
                    >
                      Read it on the paper
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          {waiting ? (
            <Busy label="Reporting first — following the trail, then drafting. Stay on this page." />
          ) : null}
          {publish.isPending ? <Busy label="Sending this to the paper…" /> : null}
          {msg && !onPaper ? (
            <Notice kind={msg === "Saved." ? "ok" : "err"}>{msg}</Notice>
          ) : null}

          {data.draft ? (
            <form className="work-form" onSubmit={(e) => e.preventDefault()}>
              <Field label="Headline">
                <input
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  disabled={onPaper}
                />
              </Field>
              <Field label="Dek">
                <input value={dek} onChange={(e) => setDek(e.target.value)} disabled={onPaper} />
              </Field>
              <Field label="Topic">
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  disabled={onPaper}
                />
              </Field>
              <Field label="Body">
                <textarea
                  rows={16}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={onPaper}
                />
              </Field>
              {data.draft.form ? <p className="meta">Form · {data.draft.form}</p> : null}
            </form>
          ) : waiting ? null : (
            <p className="meta" style={{ marginTop: 14 }}>
              {locked
                ? "This lead was killed. Nothing to draft."
                : "No draft yet. Draft with AI writes a first pass from the lead and its sources; you edit, then publish."}
            </p>
          )}
        </section>
      </div>
    </DeskShell>
  );
}

function looksLikeDraftTimeout(raw: string): boolean {
  return /timeout|timed out|aborted|network|failed to fetch|504|503|502|econnreset|socket hang up|unexpected server error/i.test(
    raw,
  );
}

function findingsFrom(raw: string | null | undefined): { text: string; url?: string }[] {
  if (!raw?.trim()) return [];
  let value: unknown = raw;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return [{ text: raw.trim().slice(0, 1200) }];
  }
  const rows = Array.isArray(value) ? value : [value];
  const out: { text: string; url?: string }[] = [];
  for (const row of rows) {
    if (typeof row === "string" && row.trim()) {
      out.push({ text: row.trim().slice(0, 1200) });
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const text = String(o.text ?? o.found ?? "").trim();
    if (!text) continue;
    const urls = Array.isArray(o.source_urls) ? o.source_urls.map(String) : [];
    out.push({ text: text.slice(0, 1200), url: urls[0] });
  }
  return out.slice(0, 6);
}

function unansweredNotes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v)
      ? v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 12)
      : [];
  } catch {
    return [];
  }
}

function usePhoneNotes() {
  const [small, setSmall] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const go = () => setSmall(mq.matches);
    go();
    mq.addEventListener("change", go);
    return () => mq.removeEventListener("change", go);
  }, []);
  return small;
}

function ReportingNotesPane({
  leadId,
  notes,
  hasDraft,
  locked,
}: {
  leadId: number;
  notes: ReportingNotes;
  hasDraft: boolean;
  locked: boolean;
}) {
  const qc = useQueryClient();
  const [line, setLine] = useState("");
  const small = usePhoneNotes();
  const filled = notesHaveMemo(notes);
  const save = useMutation({
    mutationFn: (input: { add?: string; toggle?: number; todos: ReportingNotes["todo"] }) =>
      saveReportingNotes({ data: { leadId, ...input } }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["lead", leadId] });
      const previous = qc.getQueryData(["lead", leadId]);
      qc.setQueryData(["lead", leadId], (old: typeof previous) => {
        if (!old || typeof old !== "object" || !("lead" in old) || !old.lead) return old;
        const lead = old.lead as { notes_json?: string | null };
        const next = applyTodoPatch(parseNotes(lead.notes_json), input);
        return {
          ...old,
          lead: { ...lead, notes_json: JSON.stringify(next) },
        };
      });
      if (input.add) setLine("");
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(["lead", leadId], ctx.previous);
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ["lead", leadId] });
    },
  });

  const inner = (
    <div className="notes">
      {!small ? (
        <div className="notes-head">
          <p className="side-label" style={{ margin: 0 }}>
            Reporting notes
          </p>
          <span className="chip dnp">does not print</span>
        </div>
      ) : null}
      {!filled ? (
        <>
          <p className="note-one" style={{ marginTop: small ? 0 : 8 }}>
            {hasDraft
              ? "This draft was written before notes were kept. Redraft fills them; lines you add stay."
              : "Draft with AI fills this. You can add a line."}
          </p>
          {notes.todo.length ? (
            <div className="note-sec">
              <p className="side-label">Still to pull</p>
              {notes.todo.map((t, i) => (
                <TodoRow
                  key={`${t.src}-${t.t}-${i}`}
                  item={t}
                  disabled={locked}
                  onToggle={() => save.mutate({ toggle: i, todos: notes.todo })}
                />
              ))}
              <p className="note-hint">Click a line to mark it pulled. It stays on the list, struck through.</p>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {notes.news ? (
            <div className="note-sec">
              <p className="side-label">The news</p>
              <p className="note-one">{notes.news}</p>
            </div>
          ) : null}
          {notes.why ? (
            <div className="note-sec">
              <p className="side-label">Why it matters</p>
              <p className="note-one">{notes.why}</p>
            </div>
          ) : null}
          {notes.angle ? (
            <div className="note-sec">
              <p className="side-label">Angle</p>
              <p className="note-one">{notes.angle}</p>
            </div>
          ) : null}
          {notes.todo.length ? (
            <div className="note-sec">
              <p className="side-label">Still to pull</p>
              {notes.todo.map((t, i) => (
                <TodoRow
                  key={`${t.src}-${t.t}-${i}`}
                  item={t}
                  disabled={locked}
                  onToggle={() => save.mutate({ toggle: i, todos: notes.todo })}
                />
              ))}
              <p className="note-hint">Click a line to mark it pulled. It stays on the list, struck through.</p>
            </div>
          ) : null}
          {notes.found.length ? (
            <div className="note-sec">
              <p className="side-label">What we found</p>
              {notes.found.map((f) => (
                <p key={f.t} className="note-one">
                  {f.t}
                  {f.src ? <span className="meta-inline"> · {f.src}</span> : null}
                </p>
              ))}
            </div>
          ) : null}
          {notes.verify.length ? (
            <div className="note-sec">
              <p className="side-label">Verify before print</p>
              {notes.verify.map((v) => (
                <p key={v} className="note-one">
                  {v}
                </p>
              ))}
            </div>
          ) : null}
          {notes.opened.length ? (
            <div className="note-sec">
              <p className="side-label">Documents opened for this draft</p>
              {notes.opened.map((d) => (
                <p key={d.url} className="note-one">
                  <a href={d.url} target="_blank" rel="noreferrer" className="inline-link">
                    {d.title}
                  </a>
                </p>
              ))}
            </div>
          ) : null}
        </>
      )}
      {!locked ? (
        <div className="note-add">
          <input
            value={line}
            onChange={(e) => setLine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (line.trim()) save.mutate({ add: line.trim(), todos: notes.todo });
              }
            }}
            placeholder="Your own line — a call to make, a record to pull"
          />
          <InkButton
            small
            tone="ghost"
            disabled={!line.trim() || save.isPending}
            onClick={() => save.mutate({ add: line.trim(), todos: notes.todo })}
          >
            Add
          </InkButton>
        </div>
      ) : null}
    </div>
  );

  if (small) {
    return (
      <details className="notes-disc">
        <summary>
          Reporting notes <span className="chip dnp">does not print</span>
        </summary>
        {inner}
      </details>
    );
  }
  return inner;
}

function TodoRow({
  item,
  disabled,
  onToggle,
}: {
  item: ReportingNotes["todo"][number];
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={"todo" + (item.done ? " done" : "")}
      title={item.done ? "Struck — click to restore" : "Click to mark this pulled"}
      aria-pressed={item.done}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="todo-box" />
      <span className="todo-t">{item.t}</span>
      {item.src === "you" ? <span className="todo-src">yours</span> : null}
    </button>
  );
}
