import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DeskShell, Field, InkButton, areaClass, inputClass } from "@/components/desk-chrome";
import { EmptyState, WorkbenchSkeleton, BusyLine, Notice } from "@/components/states";
import { draftLead, getLead, publishLead, saveDraft } from "@/lib/news/desk";
import { parseUrlList } from "@/lib/paper";

export const Route = createFileRoute("/desk/story/$leadId")({
  component: StoryPage,
});

function StoryPage() {
  const { leadId } = Route.useParams();
  const id = Number(leadId);
  const qc = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ["lead", id],
    queryFn: () => getLead({ data: id }),
  });

  const [headline, setHeadline] = useState("");
  const [dek, setDek] = useState("");
  const [body, setBody] = useState("");
  const [topic, setTopic] = useState("council");
  const [msg, setMsg] = useState("");

  const [publishedSlug, setPublishedSlug] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.draft) return;
    setHeadline(data.draft.headline);
    setDek(data.draft.dek);
    setBody(data.draft.body);
    setTopic(data.draft.topic);
    if (data.articleSlug) setPublishedSlug(data.articleSlug);
  }, [data?.draft, data?.articleSlug]);

  const draft = useMutation({
    mutationFn: () => draftLead({ data: id }),
    onSuccess: async (res) => {
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setMsg("");
      await qc.invalidateQueries({ queryKey: ["lead", id] });
      await qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });

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
      setPublishedSlug(res.slug);
      setMsg("On the paper. You are still at the desk.");
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
            <Link
              to="/desk/queue"
              className="pressable inline-flex min-h-11 items-center border border-ink px-4 text-sm hover:bg-paper-2"
            >
              Back to queue
            </Link>
          }
        />
      </DeskShell>
    );
  }

  const sources = parseUrlList(data.lead.source_urls);
  const fromDark =
    data.lead.why.includes("DARK DESK investigation") ||
    data.lead.headline.startsWith("[Dark]");
  const locked = data.lead.status === "killed";
  const canPublish =
    Boolean(data.draft) &&
    data.lead.status !== "held" &&
    !locked &&
    data.lead.status !== "published" &&
    !publishedSlug;

  return (
    <DeskShell
      title={data.lead.headline}
      kicker={fromDark ? "Working notes from Dark desk" : "Workbench"}
    >
      <p className="max-w-2xl text-ink-2">{data.lead.why}</p>
      {fromDark && (
        <p className="mt-4 max-w-2xl border border-ink bg-paper-2 p-4 text-sm">
          This trail came from Dark desk. You can write working notes and a
          private draft here. Printing is still a separate click, and every
          claim still needs evidence.
        </p>
      )}
      {data.lead.evidence && (
        <blockquote className="mt-4 max-w-2xl border-l-2 border-rust pl-4 text-sm text-ink-2">
          {data.lead.evidence}
        </blockquote>
      )}
      {sources.length > 0 && (
        <ul className="mt-3 text-sm">
          {sources.map((u) => (
            <li key={u}>
              <a
                href={u}
                className="break-all text-rust transition-[color] duration-150 ease-out hover:text-rust-2"
                target="_blank"
                rel="noreferrer"
              >
                {u}
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        {!locked && (
          <InkButton disabled={draft.isPending} onClick={() => draft.mutate()}>
            {draft.isPending
              ? "Drafting with Grok…"
              : data.draft?.body
                ? "Redraft"
                : "Draft with Grok"}
          </InkButton>
        )}
        {!locked && data.draft && (
          <>
            <InkButton tone="ghost" disabled={save.isPending} onClick={() => save.mutate()}>
              Save edits
            </InkButton>
            {canPublish && (
              <InkButton
                disabled={publish.isPending || !headline || !body}
                onClick={() => publish.mutate()}
              >
                {publish.isPending ? "Publishing…" : "Publish to the paper"}
              </InkButton>
            )}
          </>
        )}
        <Link
          to="/desk/queue"
          className="self-center text-sm text-muted transition-[color] duration-150 ease-out hover:text-ink"
        >
          Back to queue
        </Link>
      </div>
      {draft.isPending && (
        <div className="enter-fade-fast mt-4 max-w-2xl border border-rule bg-paper-2 p-4">
          <BusyLine label="Reporting first — following the trail, then drafting. Stay on this page." />
        </div>
      )}
      {publish.isPending && (
        <div className="enter-fade-fast mt-4 max-w-2xl border border-rule bg-paper-2 p-4">
          <BusyLine label="Sending this to the paper…" />
        </div>
      )}
      {msg && (
        <Notice kind={msg.startsWith("On the paper") || msg === "Saved." ? "ok" : "err"}>
          {msg}
        </Notice>
      )}
      {publishedSlug && (
        <p className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link
            to="/articles/$slug"
            params={{ slug: publishedSlug }}
            className="text-rust hover:text-rust-2"
          >
            Read it on the paper
          </Link>
          <Link to="/desk/queue" className="text-ink hover:text-rust">
            Queue
          </Link>
          <Link to="/desk" className="text-ink hover:text-rust">
            Desk overview
          </Link>
        </p>
      )}
      {data.draft?.form && (
        <p className="mt-4 text-[11px] tracking-[0.12em] text-muted uppercase">
          Form · {data.draft.form}
        </p>
      )}
      {data.draft?.found_note ? (
        <p className="mt-4 max-w-2xl border border-ink bg-paper-2 p-3 text-sm">
          <span className="tracking-[0.12em] text-muted uppercase">What we found · </span>
          {data.draft.found_note}
        </p>
      ) : null}
      {unansweredNotes(data.draft?.unanswered).length > 0 ? (
        <div className="mt-4 max-w-2xl border border-rule bg-paper-2 p-3 text-sm">
          <p className="tracking-[0.12em] text-muted uppercase">Still unanswered</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {unansweredNotes(data.draft?.unanswered).map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {data.draft?.integrity_notes && (
        <p className="mt-4 max-w-2xl border border-rule bg-paper-2 p-3 text-sm">
          <span className="tracking-[0.12em] text-muted uppercase">Verify · </span>
          {data.draft.integrity_notes}
        </p>
      )}

      {!locked && data.draft && (
        <form className="mt-8 max-w-3xl space-y-4" onSubmit={(e) => e.preventDefault()}>
          <Field label="Headline">
            <input
              className={inputClass}
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
            />
          </Field>
          <Field label="Dek">
            <input
              className={inputClass}
              value={dek}
              onChange={(e) => setDek(e.target.value)}
            />
          </Field>
          <Field label="Topic">
            <input
              className={inputClass}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </Field>
          <Field label="Body">
            <textarea
              className={areaClass + " min-h-80"}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
        </form>
      )}
    </DeskShell>
  );
}

function unansweredNotes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 12) : [];
  } catch {
    return [];
  }
}
