import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Busy, DeskShell, Field, InkButton, leadOrigin } from "@/components/desk-chrome";
import { EmptyState, WorkbenchSkeleton, Notice } from "@/components/states";
import { draftLead, getLead, publishLead, pullTodo, saveDraft, saveReportingNotes } from "@/lib/news/desk";
import { formatShortDate, parseUrlList, TOPICS } from "@/lib/paper";
import {
  applyTodoPatch,
  notesHaveMemo,
  parseNotes,
  type ReportingNotes,
} from "@/lib/news/notes";
import { editorDraftError, draftHasLanded } from "@/lib/news/desk-copy";
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
  const [scratch, setScratch] = useState("");
  const [msg, setMsg] = useState("");
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [slowWait, setSlowWait] = useState(false);
  const hadBodyAtStart = useRef(false);
  const bodyAtStart = useRef("");
  const appliedFp = useRef("");

  const waiting = waitingSince !== null;

  const { data, isPending } = useQuery({
    queryKey: ["lead", id],
    queryFn: () => getLead({ data: id }),
    refetchInterval: waiting ? 2000 : false,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    if (data?.articleSlug) setPublishedSlug(data.articleSlug);
    const d = data?.draft;
    if (!d) return;
    const fp = `${d.updated_at ?? ""}|${(d.body ?? "").length}|${d.headline ?? ""}`;
    if (!waitingSince) {
      if (appliedFp.current === "" && d.body) {
        setHeadline(d.headline);
        setDek(d.dek);
        setBody(stripReporterNotebook(d.body));
        setTopic(d.topic);
        appliedFp.current = fp;
      }
      return;
    }
    if (
      !draftHasLanded({
        hadBodyAtStart: hadBodyAtStart.current,
        bodyAtStart: bodyAtStart.current,
        startedAt: waitingSince,
        draft: d,
      })
    ) {
      return;
    }
    setHeadline(d.headline);
    setDek(d.dek);
    setBody(stripReporterNotebook(d.body));
    setTopic(d.topic);
    appliedFp.current = fp;
    setWaitingSince(null);
    setSlowWait(false);
    setMsg("");
  }, [data, waitingSince]);

  useEffect(() => {
    if (!waitingSince) return;
    if (data?.job?.status === "failed") {
      setWaitingSince(null);
      setSlowWait(false);
      setMsg(editorDraftError(data.job.error) ?? data.job.error ?? "The draft did not finish.");
    }
  }, [data?.job, waitingSince]);

  useEffect(() => {
    const s = parseNotes(data?.lead.notes_json).scratch ?? "";
    if (s) setScratch(s);
  }, [data?.lead.notes_json]);

  useEffect(() => {
    if (!waitingSince) {
      setSlowWait(false);
      return;
    }
    const slow = window.setTimeout(() => setSlowWait(true), 20_000);
    return () => window.clearTimeout(slow);
  }, [waitingSince]);

  const draft = useMutation({
    mutationFn: async () => {
      await saveReportingNotes({
        data: { leadId: id, scratch, todos: parseNotes(data?.lead.notes_json).todo },
      });
      return draftLead({ data: id });
    },
    onMutate: () => {
      setMsg("");
      hadBodyAtStart.current = Boolean(data?.draft?.body);
      bodyAtStart.current = data?.draft?.body ?? "";
      setWaitingSince(Date.now());
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["lead", id] });
      await qc.invalidateQueries({ queryKey: ["leads"] });
      if (res.ok) return;
      if (looksLikeDraftTimeout(res.error)) return;
      setWaitingSince(null);
      setSlowWait(false);
      setMsg(editorDraftError(res.error) ?? res.error);
    },
    onError: async (err) => {
      await qc.invalidateQueries({ queryKey: ["lead", id] });
      const raw = err instanceof Error ? err.message : "Draft failed";
      if (looksLikeDraftTimeout(raw)) return;
      setWaitingSince(null);
      setSlowWait(false);
      setMsg(editorDraftError(raw) ?? "The draft did not finish. Click Draft with AI again.");
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      await saveReportingNotes({
        data: { leadId: id, scratch, todos: parseNotes(data?.lead.notes_json).todo },
      });
      return saveDraft({ data: { leadId: id, headline, dek, body, topic } });
    },
    onSuccess: () => setMsg("Saved."),
    onError: (err) => {
      setMsg(err instanceof Error ? err.message : "Could not save.");
    },
  });

  const publish = useMutation({
    mutationFn: async () => {
      await saveReportingNotes({
        data: { leadId: id, scratch, todos: parseNotes(data?.lead.notes_json).todo },
      });
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
    onError: (err) => {
      setMsg(err instanceof Error ? err.message : "Could not publish.");
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
            {data.lead.investigation_id ? (
              <>
                {" · "}
                <Link
                  to="/desk/dark"
                  className="inline-link"
                  onClick={() => {
                    try {
                      sessionStorage.setItem(
                        "townreporter.dark.openId",
                        String(data.lead.investigation_id),
                      );
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  Open investigation
                </Link>
              </>
            ) : null}
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
            <Busy
              label={
                slowWait
                  ? "The click dropped. The writing pass is still finishing — this page is pulling the draft in."
                  : "Reporting first — following the trail, then drafting. Stay on this page."
              }
            />
          ) : null}
          {publish.isPending ? <Busy label="Sending this to the paper…" /> : null}
          {msg && !onPaper ? (
            <Notice kind={msg === "Saved." ? "ok" : "err"}>{msg}</Notice>
          ) : null}

          {data.draft || body ? (
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
                <select value={topic} onChange={(e) => setTopic(e.target.value)} disabled={onPaper}>
                  {TOPICS.filter((t) => t !== "about").map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                  {topic && !TOPICS.includes(topic as (typeof TOPICS)[number]) ? (
                    <option value={topic}>{topic}</option>
                  ) : null}
                </select>
              </Field>
              <Field label="Body">
                <textarea
                  rows={16}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={onPaper}
                />
              </Field>
              <Field
                label="Pulled notes"
                chip="does not print"
                hint="Redraft reads this box. Nothing here prints."
              >
                <textarea
                  rows={8}
                  value={scratch}
                  onChange={(e) => setScratch(e.target.value)}
                  disabled={onPaper}
                  placeholder="Pull a still-to-pull line and the excerpt lands here. Cut and paste into the story."
                />
              </Field>
              {data.draft?.form ? <p className="meta">Form · {data.draft.form}</p> : null}
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
  return /timeout|timed out|aborted|abort|network|failed to fetch|load failed|504|503|502|econnreset|socket hang up|unexpected server error|gateway/i.test(
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
  const [pulling, setPulling] = useState<number | null>(null);
  const [pullMsg, setPullMsg] = useState("");
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
    onError: (_err, input, ctx) => {
      if (ctx?.previous) qc.setQueryData(["lead", leadId], ctx.previous);
      if (input.add) setLine(input.add);
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ["lead", leadId] });
    },
  });

  const pull = useMutation({
    mutationFn: (input: { index: number; query: string }) =>
      pullTodo({ data: { leadId, query: input.query, index: input.index } }),
    onMutate: (input) => {
      setPulling(input.index);
      setPullMsg("");
    },
    onSuccess: (res) => {
      setPulling(null);
      if (!res.ok) {
        setPullMsg(res.error);
        return;
      }
      setPullMsg(res.found ? `Dropped ${res.found} page${res.found === 1 ? "" : "s"} under the story.` : "Nothing public found for that line.");
      void qc.invalidateQueries({ queryKey: ["lead", leadId] });
    },
    onError: (err) => {
      setPulling(null);
      setPullMsg(err instanceof Error ? err.message : "Pull failed.");
    },
  });

  const todoList = (prefix: string) =>
    notes.todo.length ? (
      <div className="note-sec">
        <p className="side-label">Still to pull</p>
        {notes.todo.map((t, i) => (
          <TodoRow
            key={`${prefix}-${t.src}-${t.t}-${i}`}
            item={t}
            disabled={locked}
            pulling={pulling === i}
            onToggle={() => save.mutate({ toggle: i, todos: notes.todo })}
            onPull={() => pull.mutate({ index: i, query: t.t })}
          />
        ))}
        <p className="note-hint">
          Pull searches that line and drops the excerpt in the box under the story. The checkbox just strikes it.
        </p>
        {pullMsg ? <p className="note-one">{pullMsg}</p> : null}
      </div>
    ) : null;

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
          {todoList("empty")}
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
          {todoList("filled")}
          {notes.found.length ? (
            <div className="note-sec">
              <p className="side-label">Claims and sources</p>
              {notes.found.map((f) => (
                <p key={f.t} className="note-one">
                  {f.t}
                  {f.src ? (
                    <span className="meta-inline">
                      {" · "}
                      <a href={f.src} target="_blank" rel="noreferrer" className="inline-link">
                        {f.src}
                      </a>
                    </span>
                  ) : null}
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
  pulling,
  onToggle,
  onPull,
}: {
  item: ReportingNotes["todo"][number];
  disabled: boolean;
  pulling: boolean;
  onToggle: () => void;
  onPull: () => void;
}) {
  return (
    <div className={"todo-row" + (item.done ? " done" : "")}>
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
      {!disabled && !item.done ? (
        <button type="button" className="todo-pull" disabled={pulling} onClick={onPull}>
          {pulling ? "Pulling…" : "Pull"}
        </button>
      ) : null}
    </div>
  );
}

