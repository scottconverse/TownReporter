import { NativeDialog } from "@/components/dialog";
import { evidenceNeedsReview, type EvidenceDecision } from "@/lib/news/draft-evidence";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { CheckGates } from "@/components/check-gates";
import {
  evidenceChip,
  namesChip,
  pageGateChip,
  publishBarNote,
  recordedChecks,
  type CheckFacts,
} from "@/lib/news/check-gates";
import { DeskShell, Field, InkButton } from "@/components/desk-chrome";
import { ActionButton, rowActionPhase } from "@/components/action-button";
import { SaveShortcut, SaveShortcutHint } from "@/components/desk-save-shortcut";
import { DeskNameCheck } from "@/components/desk-name-check";
import { DeskLengthCut } from "@/components/desk-length-cut";
import { StoryBody } from "@/components/story-body";
import { editorActionError } from "@/lib/news/desk-copy";
import { refusedAnswer } from "@/lib/news/refused-answer";
import { nameCheckText, readNameCheck } from "@/lib/news/name-check";
import { publishBlockers, publishGateNote } from "@/lib/news/publish-blockers";
import { lastDraftWhen, saveState } from "@/lib/news/writer-bar";
import { Notice, WorkbenchSkeleton, EmptyState, ScreenError } from "@/components/states";
import {
  deleteEditorial,
  getEditorialDraft,
  publishEditorial,
  saveEditorialDraft,
} from "@/lib/news/opinion";
import { useEditorSections } from "@/lib/use-sections";

export const Route = createFileRoute("/desk/story/draft/$draftId")({
  head: () => ({ meta: [{ title: "Editorial — TownReporter" }] }),
  component: EditorialPage,
});

/**
 * The editorial workbench, opened by draft -- the drawn story screen.
 *
 * The reported-story workbench is `/desk/story/$leadId` and loads by LEAD. An
 * editorial has no lead -- an editor typed a subject and the paper stated its
 * own position -- so it could be read on the Opinion desk and nothing else:
 * not edited, not printed, not thrown away.
 *
 * Unit CW: the drawing has ONE story screen (`Desk Story.dc.html`), so this
 * renders that screen for the piece instead of the old two-column form. The
 * regions are the drawing's and in the drawing's order -- the three editors
 * (HEADLINE · YOURS, SUMMARY, STORY) with the save line at the head of the
 * Story box, the action row, and the sticky publish bar with the gate chips,
 * the first reason Publish is off, and "Publish in <Section>".
 *
 * What the lead-less piece cannot have is left out rather than faked, and each
 * omission is a line in `design/SPEC-GAPS-0681.md` under CW: there is no
 * Writer row (this screen never chooses the writer), and three of the drawn
 * row's five presses have nothing behind them here -- "Check draft against
 * evidence" (no captures are gathered for an editorial), "+ Add to story" (no
 * lead to add it to) and "Redraft…" (the voice writes a piece in one pass).
 * The section select and the two read-only boxes below it are the desk's own,
 * kept because they are what the piece is checked against.
 *
 * The blockers are unit CT's `publishBlockers` -- the same function the
 * reported screen's Publish button reads, given the state this screen has --
 * so the button is off exactly when the list is not empty on both screens.
 */
function EditorialPage() {
  const { sections } = useEditorSections();
  const TOPICS = sections.map(s=>s.key);
  const { draftId } = Route.useParams();
  const id = Number(draftId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const preview = useRef<HTMLDialogElement | null>(null);

  const [headline, setHeadline] = useState("");
  const [dek, setDek] = useState("");
  const [topic, setTopic] = useState("opinion");
  const [body, setBody] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  /*
    Unit UI1a2: has the preview actually been opened? The story page keeps the
    same flag (and reads it into the Checks tab's "✓ Preview viewed" chip); this
    screen has no gate chip, so the only reader of it is the control's own done
    state -- "Preview opened", in the success green, with a check.
  */
  const [previewSeen, setPreviewSeen] = useState(false);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  /*
    The text as the server last had it. The save line says "Unsaved changes"
    until this matches the boxes again, which is the one question that line
    exists to answer.
  */
  const [baseline, setBaseline] = useState("");

  const q = useQuery({
    queryKey: ["editorial-draft", id],
    queryFn: () => getEditorialDraft({ data: id }),
    enabled: Number.isFinite(id),
  });

  const snapshot = (values: { headline: string; dek: string; topic: string; body: string }) =>
    JSON.stringify([values.headline, values.dek, values.topic, values.body]);

  // Adopt the stored piece once. After that the editor's typing owns the boxes.
  useEffect(() => {
    if (!q.data || loaded) return;
    setHeadline(q.data.headline);
    setDek(q.data.dek);
    setTopic(q.data.topic || "opinion");
    setBody(q.data.body);
    setBaseline(
      snapshot({
        headline: q.data.headline,
        dek: q.data.dek,
        topic: q.data.topic || "opinion",
        body: q.data.body,
      }),
    );
    setLoaded(true);
  }, [q.data, loaded]);

  const onPaper = Boolean(q.data?.published_slug);
  const evidenceStale = q.data ? evidenceNeedsReview(q.data, body) : false;
  const dirty = loaded && baseline !== snapshot({ headline, dek, topic, body });
  const review = useMutation({
    mutationFn: (decision: EvidenceDecision) => saveEditorialDraft({ data: {draftId:id,headline,dek,body,topic,evidenceDecision:decision,evidenceToken:q.data?.evidenceToken} }),
    onSuccess: () => { setMsg("Evidence review saved."); void qc.invalidateQueries({queryKey:["editorial-draft",id]}); },
    onError: (e) =>
      setMsg(
        editorActionError(e instanceof Error ? e.message : "", "save the evidence review") ??
          "The evidence review did not save. Try again.",
      ),
  });

  const save = useMutation({
    mutationFn: () => saveEditorialDraft({ data: { draftId: id, headline, dek, body, topic } }),
    onSuccess: (r) => {
      setMsg(r?.ok ? "Saved." : "That did not save.");
      if (r?.ok) setBaseline(snapshot({ headline, dek, topic, body }));
      void qc.invalidateQueries({ queryKey: ["editorial-draft", id] });
    },
    onError: (e) =>
      setMsg(
        editorActionError(e instanceof Error ? e.message : "", "save this editorial") ??
          "That did not save. Try again.",
      ),
  });

  /*
    FB5: the ⌘S badge this screen's "Save edits" carries had nothing behind it
    (FB0-REPORT.md Table B, "⌘S badge … DEAD"). Bound, not removed: saving here
    is manual — there is a press, a `dirty` flag and an "Unsaved changes" line,
    and no autosave — and README "Interactions & behavior" names ⌘S as the
    workbench's save. The binding rides the button's own condition and adds no
    announcement of its own; the save already answers through `setMsg`.
  */

  const publish = useMutation({
    mutationFn: async () => {
      await saveEditorialDraft({ data: { draftId: id, headline, dek, body, topic } });
      return publishEditorial({ data: id });
    },
    onSuccess: (r) => {
      setMsg(r?.ok ? "On the paper." : (editorActionError(r?.error, "print it") ?? "That did not print."));
      if (r?.ok) setBaseline(snapshot({ headline, dek, topic, body }));
      void qc.invalidateQueries({ queryKey: ["editorial-draft", id] });
      void qc.invalidateQueries({ queryKey: ["editorials"] });
    },
    onError: (e) =>
      setMsg(
        editorActionError(e instanceof Error ? e.message : "", "print it") ??
          "That did not print. Try again.",
      ),
  });

  const remove = useMutation({
    mutationFn: () => deleteEditorial({ data: id }),
    onSuccess: (r) => {
      if (!r?.ok) {
        setMsg(editorActionError(r?.error, "delete the draft") ?? "That did not delete.");
        return;
      }
      void qc.invalidateQueries({ queryKey: ["editorials"] });
      void navigate({ to: "/desk/opinion" });
    },
    onError: (e) =>
      setMsg(
        editorActionError(e instanceof Error ? e.message : "", "delete the draft") ??
          "That did not delete. Try again.",
      ),
  });

  /*
    Unit CT's list, given this screen's state. `openClaims` and `namedOutlets`
    are empty because nothing computes either for an editorial and the server's
    own refusal (`performPublishEditorial`) does not read them; leaving them out
    of the list is the same as the server not gating on them.
  */
  const blockers = publishBlockers({
    headline,
    dek,
    body,
    sectionReady: topic.trim() !== "",
    openClaims: 0,
    namedOutlets: [],
    /*
      Unit U24: an editorial resolves no findings review (that pane lives on
      the reported workbench), so there is no count to gate on here and the
      editorial publish path `performPublishEditorial` does not read one.
      Leaving both out of the list is the same as the server not gating on
      them -- the same reason `openClaims` and `namedOutlets` above are empty.
    */
    unreviewedClaims: 0,
    unreviewedAccepted: false,
    evidenceStale,
    reviewingEvidence: review.isPending,
    reconcileActive: false,
    publishing: publish.isPending,
  });

  const sectionNameNow = sections.find((s) => s.key === topic)?.name ?? topic;
  const saveLine = saveState({
    published: onPaper,
    dirty,
    when: lastDraftWhen(q.data?.updated_at),
  });
  const check = readNameCheck(q.data?.research_json);
  const namesStale = Boolean(check && check.checkedText !== nameCheckText({ headline, dek, body }));
  const namesPending = check?.rows.filter((row) => row.status === "unresolved").length ?? 0;
  /*
    Unit U9: the same three states the reported workbench shows, from the same
    rule (`lib/news/check-gates.ts`), because this bar had the same defect --
    an editorial with no name check and nothing to check said `✓ Names
    reviewed` and `✓ Evidence kept`. The two chips this screen cannot have are
    left out rather than faked: an editorial names no outlet, so there is no
    named-outlet gate to count (see `blockers` above), and this screen has no
    stepper.
  */
  const recorded = recordedChecks(q.data?.research_json);
  const checkFacts: CheckFacts = {
    hasDraft: Boolean(q.data),
    evidenceChecked: recorded.evidenceChecked,
    /* Unit U24b: an editorial resolves no review, so "it ran" is the same pass
       record and nothing else -- the note below says the same for the count. */
    evidenceRan: recorded.evidenceChecked,
    /*
      Unit U24: an editorial has no findings review behind it -- the editorial
      desk resolves no review and this bar has no Checks pane to agree with --
      so it keeps the record-only reading it has always had rather than
      inventing a count. `deskRowChecks` does the same for the desk home's
      projected row.
    */
    evidenceToReview: 0,
    evidenceRequired: recorded.evidenceRequired,
    evidenceOutstanding: evidenceStale || review.isPending,
    namesUnresolved: namesPending,
    namedOutlets: 0,
    nameCheckComplete: recorded.nameCheckComplete,
    nameCheckRecorded: recorded.nameCheckRecorded,
    namesOutstanding: namesStale,
  };
  const publishGates = [
    pageGateChip(`${dirty ? "!" : "✓"} Saved`, !dirty),
    namesChip(checkFacts),
    evidenceChip(checkFacts),
  ];

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
            message={
              editorActionError(
                q.error instanceof Error ? q.error.message : "",
                "load that editorial",
              ) ?? "Could not load that editorial."
            }
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

      {evidenceStale && !onPaper ? <div className="note publish-blocked" role="status">
        <strong>The story changed. Review its retained evidence before publishing.</strong>
        <p>Check these sources against the edited body. Removing evidence keeps the original privately.</p>
        <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{[q.data.source_urls,q.data.provenance_json,q.data.found_note,q.data.unanswered].filter(value => value && !["[]","{}"].includes(value)).join("\n\n")}</pre>
        <InkButton disabled={review.isPending} onClick={() => review.mutate("keep")}>I checked: keep this evidence</InkButton>
        <InkButton tone="ghost" disabled={review.isPending} onClick={() => review.mutate("remove")}>Remove old evidence from public story</InkButton>
      </div> : null}
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
        <Field
          label="Headline · yours"
          htmlFor="editorial-headline"
          aside="OPINION stays at the front so it cannot be mistaken for a report."
        >
          <input
            id="editorial-headline"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            disabled={onPaper}
          />
        </Field>
        <Field label="Summary">
          <input value={dek} onChange={(e) => setDek(e.target.value)} disabled={onPaper} />
        </Field>
        {/*
          The drawn save line, in the drawn place: the head of the STORY box,
          from the same `saveState` the reported screen uses, so both screens
          say "Unsaved changes" for the same reason.
        */}
        <Field
          label="Story"
          htmlFor="editorial-body"
          aside={
            <span className={`astra-save-state astra-wb-saved astra-wb-saved-${saveLine.tone}`} role="status">
              {saveLine.label}
            </span>
          }
        >
          <textarea
            id="editorial-body"
            rows={24}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={onPaper}
          />
        </Field>
        <Field label="Topic">
          <select value={topic} onChange={(e) => setTopic(e.target.value)} disabled={onPaper}>
            <option value="opinion">opinion</option>
            {TOPICS.filter((t) => t !== "about" && t !== "opinion").map((t) => (
              <option key={t} value={t}>
                {sections.find(s=>s.key===t)?.name??t}
              </option>
            ))}
          </select>
        </Field>
      </form>

      {/*
        The drawn action row (Desk Story.dc.html:112), carrying the presses
        this screen can honour: the drawn "Save edits" and "Preview as reader",
        and Delete, which the drawing does not draw anywhere -- it has no More
        menu on this screen -- but which an editor must keep (a written piece
        has to be removable). The three drawn presses with nothing behind them
        here are listed in `design/SPEC-GAPS-0681.md`.
      */}
      <div className="work-bar astra-story-actions">
        {!onPaper ? (
          <>
            <SaveShortcut save={() => save.mutate()} enabled={dirty && !save.isPending} />
            <InkButton
              tone="ghost"
              disabled={save.isPending || !dirty}
              onClick={() => save.mutate()}
            >
              Save edits
              {/*
                The drawn chip, aria-hidden so the press's accessible name stays
                exactly "Save edits" -- the walks ask for it by that name
                (`getByRole("button", { name: "Save edits" })`) and a name of
                "Save edits ⌘S" would stop matching. Drawn through
                `SaveShortcutHint`, not as a literal, so the label follows the
                platform (Ctrl+S off a Mac) exactly as the story page's does.
              */}
              <SaveShortcutHint />
            </InkButton>
            {/*
              Unit UI1a2. Same control as the story page's (`desk.story.$leadId`),
              same four states: no `working` (the press is synchronous), a done
              word once the preview has actually been opened, and a reason
              beside it when there is nothing to preview yet.
            */}
            <ActionButton
              tone="quiet"
              phase={previewSeen ? "done" : "idle"}
              doneLabel="Preview opened"
              disabled={!headline.trim() && !body.trim()}
              disabledReason={
                !headline.trim() && !body.trim()
                  ? "Write a headline or a body to preview."
                  : null
              }
              onAct={() => {
                setPreviewSeen(true);
                preview.current?.showModal();
              }}
            >
              Preview as reader
            </ActionButton>
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
            {/*
              Unit UI1a2: the second press is the one that does the work, so it
              carries the states -- "Deleting…" with a spinner and the button
              disabled. Its DONE is the draft leaving this screen, which the
              screen's own removal already says; there is no second green
              "Deleted" on a button that is about to be unmounted.
            */}
            <ActionButton
              tone="primary"
              small
              phase={rowActionPhase({
                isPending: remove.isPending,
                /* Unit UI1a3, finding 1: `deleteEditorial` answers
                   `{ ok: false, error }` for its ordinary refusal ("That
                   standalone editorial is gone."), which settles as a SUCCESS --
                   read off the settled answer so the reason reaches the control
                   instead of the button going quietly back to idle. */
                problem: !remove.isPending ? refusedAnswer(remove.data) : null,
              })}
              workingLabel="Deleting…"
              reason={!remove.isPending ? refusedAnswer(remove.data) : null}
              onAct={() => remove.mutate()}
            >
              Yes, delete it
            </ActionButton>
            <ActionButton
              tone="quiet"
              small
              phase="idle"
              disabled={remove.isPending}
              disabledReason={remove.isPending ? "The delete is still being saved." : null}
              onAct={() => setConfirmDelete(false)}
            >
              Keep it
            </ActionButton>
          </span>
        ) : (
          <ActionButton
            tone="danger"
            small
            phase="idle"
            disabled={remove.isPending}
            onAct={() => setConfirmDelete(true)}
          >
            Delete
          </ActionButton>
        )}
      </div>

      {/*
        "Names and spellings", the panel the drawn story screen carries too
        (desk-name-check.tsx). It sits under the action row because the drawing
        has nothing here: on the reported screen it lives on the Checks tab.
      */}
      <DeskNameCheck research={q.data.research_json} headline={headline} dek={dek} body={body} />
      {/* Unit B8P: the material behind this piece was cut for length. Stored on
          the draft, so it reads the same here as it does on the opinion desk. */}
      <DeskLengthCut research={q.data.research_json} />

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

      {/*
        The sticky publish bar, drawn at the foot of the story screen
        (Desk Story.dc.html:122): the gate chips on the left, the first reason
        Publish is off and the press on the right. The button is off exactly
        when unit CT's list is not empty, on this screen as on the reported one.
      */}
      {!onPaper ? (
        <div className="astra-publish-bar" id="astra-publish-bar">
          <CheckGates gates={publishGates} label="Publish gates" />
          <div className="astra-publish-actions">
            {confirmingPublish ? (
              <>
                <span className="note">
                  This puts the piece on the public paper and in the feed, as the paper's own
                  position. Corrections are published, not silent edits.
                </span>
                <InkButton
                  disabled={publish.isPending || blockers.length > 0}
                  onClick={() => {
                    setConfirmingPublish(false);
                    publish.mutate();
                  }}
                >
                  {publish.isPending ? "Publishing…" : `Yes, print it in ${sectionNameNow}`}
                </InkButton>
                <InkButton tone="quiet" onClick={() => setConfirmingPublish(false)}>
                  Not yet
                </InkButton>
              </>
            ) : (
              <>
                <InkButton
                  disabled={publish.isPending || blockers.length > 0}
                  onClick={() => setConfirmingPublish(true)}
                >
                  {`Publish in ${sectionNameNow}`}
                </InkButton>
                {blockers.length > 0 ? (
                  <span className="note publish-blocked">{publishGateNote(blockers)}</span>
                ) : (
                  /* Unit U9: the same line the reported workbench prints --
                     "All checks done." only when the checks actually ran. */
                  <span className="note">{publishBarNote(checkFacts)}</span>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}

      <NativeDialog
        ref={preview}
        className="astra-dialog astra-preview"
        aria-labelledby="editorial-preview-title"
      >
        <div className="astra-dialog-head">
          <h2 id="editorial-preview-title">Draft preview</h2>
          <button className="btn" onClick={() => preview.current?.close()}>
            Close preview
          </button>
        </div>
        <article className="astra-dialog-body" tabIndex={0}>
          <p className="kick">{topic} · Draft for review</p>
          <h1>{headline}</h1>
          <p className="astra-preview-dek">{dek}</p>
          <div className="astra-preview-body">
            <StoryBody body={body} />
          </div>
        </article>
      </NativeDialog>
    </DeskShell>
  );
}
