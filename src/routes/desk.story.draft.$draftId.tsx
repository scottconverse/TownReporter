import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DeskShell, Field, InkButton } from "@/components/desk-chrome";
import { Notice, WorkbenchSkeleton, EmptyState, ScreenError } from "@/components/states";
import {
  deleteEditorial,
  getEditorialDraft,
  publishEditorial,
  saveEditorialDraft,
} from "@/lib/news/opinion";
import { TOPICS } from "@/lib/paper";

export const Route = createFileRoute("/desk/story/draft/$draftId")({
  head: () => ({ meta: [{ title: "Editorial — TownReporter" }] }),
  component: EditorialPage,
});

/**
 * The editorial workbench, opened by draft.
 *
 * The reported-story workbench is `/desk/story/$leadId` and loads by LEAD.
 * An editorial has no lead — an editor typed a subject and the paper stated its
 * own position — so it could be read on the Opinion desk and nothing else: not
 * edited, not printed, not thrown away.
 *
 * This is deliberately not the reported workbench with the lead parts hidden.
 * There is no lead, no reporting notes, no still-to-pull list and no Redraft:
 * the voice writes a piece in one pass and the editor edits the piece. What it
 * adds instead are the two boxes that never print, kept visible because they
 * are what an editor checks the piece against.
 */
function EditorialPage() {
  const { draftId } = Route.useParams();
  const id = Number(draftId);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [headline, setHeadline] = useState("");
  const [dek, setDek] = useState("");
  const [topic, setTopic] = useState("opinion");
  const [body, setBody] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const q = useQuery({
    queryKey: ["editorial-draft", id],
    queryFn: () => getEditorialDraft({ data: id }),
    enabled: Number.isFinite(id),
  });

  // Adopt the stored piece once. After that the editor's typing owns the boxes.
  useEffect(() => {
    if (!q.data || loaded) return;
    setHeadline(q.data.headline);
    setDek(q.data.dek);
    setTopic(q.data.topic || "opinion");
    setBody(q.data.body);
    setLoaded(true);
  }, [q.data, loaded]);

  const onPaper = Boolean(q.data?.published_slug);

  const save = useMutation({
    mutationFn: () => saveEditorialDraft({ data: { draftId: id, headline, dek, body, topic } }),
    onSuccess: (r) => {
      setMsg(r?.ok ? "Saved." : (r?.error ?? "That did not save."));
      void qc.invalidateQueries({ queryKey: ["editorial-draft", id] });
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : "That did not save."),
  });

  const publish = useMutation({
    mutationFn: async () => {
      await saveEditorialDraft({ data: { draftId: id, headline, dek, body, topic } });
      return publishEditorial({ data: id });
    },
    onSuccess: (r) => {
      setMsg(r?.ok ? "On the paper." : (r?.error ?? "That did not print."));
      void qc.invalidateQueries({ queryKey: ["editorial-draft", id] });
      void qc.invalidateQueries({ queryKey: ["editorials"] });
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : "That did not print."),
  });

  const remove = useMutation({
    mutationFn: () => deleteEditorial({ data: id }),
    onSuccess: (r) => {
      if (!r?.ok) {
        setMsg(r?.error ?? "That did not delete.");
        return;
      }
      void qc.invalidateQueries({ queryKey: ["editorials"] });
      void navigate({ to: "/desk/opinion" });
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : "That did not delete."),
  });

  if (q.isPending) {
    return (
      <DeskShell title="Editorial" kicker="Editor desk">
        <WorkbenchSkeleton />
      </DeskShell>
    );
  }

  if (!q.data) {
    if (q.isError) {
      return (
        <DeskShell title="Editorial" kicker="Editor desk">
          <ScreenError
            message={q.error instanceof Error ? q.error.message : "Could not load that editorial."}
            onRetry={() => void q.refetch()}
            retrying={q.isRefetching}
          />
        </DeskShell>
      );
    }
    return (
      <DeskShell title="Editorial" kicker="Editor desk">
        <EmptyState
          title="That editorial is gone."
          body="It was deleted, or it never existed."
          action={
            <Link to="/desk/opinion" className="btn quiet small">
              Back to Opinion
            </Link>
          }
        />
      </DeskShell>
    );
  }

  return (
    <DeskShell
      title="Editorial"
      kicker="Editor desk"
      lede={
        <>
          Unsigned, as the paper's own position. Edit it here, then print it. A
          published piece is never edited — a correction runs as a dated note
          above it.
        </>
      }
    >
      <p className="crumb">
        <Link to="/desk/opinion" className="inline-link">
          ← Opinion
        </Link>
      </p>

      <div className="work-bar">
        {!onPaper ? (
          <>
            <InkButton tone="ghost" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save edits"}
            </InkButton>
            <InkButton
              disabled={publish.isPending || !headline.trim() || !body.trim()}
              onClick={() => publish.mutate()}
            >
              {publish.isPending ? "Publishing…" : "Publish to the paper"}
            </InkButton>
          </>
        ) : (
          <p className="note">
            On the paper.{" "}
            <Link
              to="/articles/$slug"
              params={{ slug: q.data.published_slug! }}
              className="inline-link"
            >
              Read it
            </Link>
            {" · "}
            <Link to="/desk/published" className="inline-link">
              Published
            </Link>
          </p>
        )}
        {/*
          Delete stays available after printing. The draft and the printed
          piece are separate rows: this removes the draft. Taking the story off
          the paper is done under Published, where the warning belongs.
        */}
        {confirmDelete ? (
          <span className="row-acts static">
            <InkButton tone="ghost" small disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? "Deleting…" : "Yes, delete it"}
            </InkButton>
            <InkButton tone="quiet" small onClick={() => setConfirmDelete(false)}>
              Keep it
            </InkButton>
          </span>
        ) : (
          <InkButton tone="quiet" small onClick={() => setConfirmDelete(true)}>
            Delete
          </InkButton>
        )}
      </div>

      {confirmDelete ? (
        <Notice kind="err">
          This deletes the editorial draft for good.
          {onPaper
            ? " The published piece stays on the paper — remove that under Published."
            : " Nothing else has a copy."}
        </Notice>
      ) : null}
      {msg ? <Notice kind={msg === "Saved." || msg === "On the paper." ? "ok" : "err"}>{msg}</Notice> : null}

      <form className="work-form" onSubmit={(e) => e.preventDefault()}>
        <Field label="Headline" hint="OPINION stays at the front so it cannot be mistaken for a report.">
          <input value={headline} onChange={(e) => setHeadline(e.target.value)} disabled={onPaper} />
        </Field>
        <Field label="Dek">
          <input value={dek} onChange={(e) => setDek(e.target.value)} disabled={onPaper} />
        </Field>
        <Field label="Topic">
          <select value={topic} onChange={(e) => setTopic(e.target.value)} disabled={onPaper}>
            <option value="opinion">opinion</option>
            {TOPICS.filter((t) => t !== "about" && t !== "opinion").map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="The piece"
          hint="Claims and sources run at the end, where a reader who dislikes it can check them."
        >
          <textarea rows={24} value={body} onChange={(e) => setBody(e.target.value)} disabled={onPaper} />
        </Field>
      </form>

      {q.data.fact_sheet ? (
        <Field label="Editor's fact sheet" chip="does not print" hint="What the voice checked. For you, not the reader.">
          <textarea rows={10} value={q.data.fact_sheet} readOnly />
        </Field>
      ) : null}
      {q.data.image_prompt ? (
        <Field label="Social image prompt" chip="does not print" hint="Hand this to whatever draws the card.">
          <textarea rows={8} value={q.data.image_prompt} readOnly />
        </Field>
      ) : null}
    </DeskShell>
  );
}
