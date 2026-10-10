/**
 * The editor's new dialogs (Unit BK) -- the shells.
 *
 * Three layers, split so that only the middle one needs a browser:
 *
 *   `editor-dialog-forms.ts`   what a press sends, and whether it is allowed
 *   `editor-dialog-bodies.ts`  what the dialog draws (no state, no calls)
 *   this file                  the state, the server calls, the trigger button
 *
 * Every dialog here is exported twice: as the dialog itself (`NewStoryDialog`,
 * which takes `open`/`onClose` and can be mounted by a screen that owns its own
 * trigger) and as a small trigger (`NewStoryButton`) that holds the open state
 * and renders the dialog beside itself. The screens mount whichever fits; a
 * screen that already has a New story button mounts the dialog and keeps its
 * own control.
 *
 * WHAT EVERY PRESS DOES, in one place:
 *
 * - It runs the plan `editor-dialog-forms.ts` built and nothing else. The plan
 *   already decided whether a model is spent, so no call site re-decides.
 * - It is guarded against a double press while it is in flight (`usePress`), so
 *   a slow round cannot be started twice by an impatient click.
 * - It ends with a sentence, always. A success closes the dialog and hands the
 *   sentence to `onDone` (or leaves it on screen when no screen asked); a
 *   refusal stays on screen in the warning style and is spoken through the
 *   desk's live region. There is no silent no-op on any path -- `sonner` is not
 *   in this app, so the visible feedback is the `astra-msg` line plus
 *   `announceToDesk` (`desk-chrome-utils.ts`), the same pair every other desk
 *   control uses.
 * - The dialog's drawn foot note stays drawn. Where the build cannot honor a
 *   sentence of it (the Dark Desk run, the first check on a new source, the
 *   Headline model's name), the unit's report names it instead of the dialog
 *   quietly pretending.
 *
 * THE DRAWN COPY IS THE DESIGN'S, VERBATIM. Titles, subtitles, button labels
 * and foot notes below are copied from `Desk Dialogs.dc.html` and the
 * "Dialogs" table in `docs/design/handoff-2026-09-26/README.md:433`; the
 * bodies draw the fields. Nothing in this file invents a sentence the editor
 * was not shown.
 */
import * as React from "react";

import { ChoiceCard, Dialog } from "@/components/dialog";
import { ModelPicker as SharedModelPicker } from "@/components/model-picker";
import { InkButton } from "@/components/desk-chrome";
import { announceToDesk } from "@/components/desk-chrome-utils";
import { dialogPressProps } from "@/lib/news/dialog-press";
import { openDarkInvestigation } from "@/lib/news/dark";
import {
  addSource,
  addSourcesBulk,
  fileLead,
  findPasteDuplicate,
  listSources,
  saveDraft,
  suggestHeadlines,
  writeStoryFromInput,
} from "@/lib/news/desk";
import type { DuplicateWarning } from "@/lib/news/import-review";
import { requestDraftReconciliationFn } from "@/lib/news/draft-reconcile-actions";
import {
  addLead,
  chooseHeadline,
  findSources,
  holdLead,
  sourceKillPattern,
  weaveIntoStory,
} from "@/lib/news/editor-dialog-actions";
import {
  addSourcesLabel,
  previewSources,
  type SourcePreview,
} from "@/lib/news/editor-dialog-logic";
import { uploadStoryDocument } from "@/lib/news/story-document-api";
import { DOCUMENT_COUNT_LIMIT, DOCUMENT_FILE_LIMIT } from "@/lib/news/story-document-text";
import type { SourceRow } from "@/lib/news/types";
import { useEditorSections } from "@/lib/use-sections";
import { sourceIdentity } from "@/lib/news/url-guard";
import { useFirstRunPickerDefault } from "@/components/first-run-picker-default";
import { defaultModelEffort } from "@/lib/news/provider-registry";
import type { ModelEffort } from "@/lib/news/provider-registry";
import type { StoryModelChoice } from "@/lib/news/model-choice";
import {
  AddLeadBody,
  AddSourcesBody,
  AddToBody,
  DarkFileBody,
  HeadlineBody,
  HoldBody,
  MoreLeadMenu,
  NewStoryBody,
  SourceKillPatternBody,
  type ChoiceRender,
  type ModelPickerRender,
} from "./editor-dialog-bodies";
import {
  addLeadInitial,
  addLeadProblem,
  addLeadRequest,
  addSourcesInitial,
  addToConfirm,
  addToInitial,
  addToProblem,
  addToRequest,
  darkFileFromSeed,
  darkFileSeed,
  darkProblem,
  darkRequest,
  fillStepId,
  headlineChoice,
  headlineInitial,
  headlineProblem,
  headlineSuggestRequest,
  holdInitial,
  holdProblem,
  holdRequest,
  killPatternLine,
  KILL_PATTERN_EMPTY,
  newStoryInitial,
  newStoryProblem,
  newStoryRequest,
  sourcesProblem,
  sourcesRequest,
  type AddLeadState,
  type AddSourcesState,
  type AddToState,
  type DarkFilePrefill,
  type DarkFileState,
  type HeadlineState,
  type HoldState,
  type MoreLeadAction,
  type NewStoryState,
  type NewStoryStep,
} from "./editor-dialog-forms";

/* The .ts dialog bodies accept one renderer and return exact choice strings;
   the shared picker owns its supported model unions. */
const DialogModelPicker = SharedModelPicker as unknown as ModelPickerRender;

/* ------------------------------------------------------------ the one card -- */

/**
 * The phase 0 `ChoiceCard`, as the `.ts` bodies take it.
 *
 * The bodies cannot import it themselves: `node --experimental-strip-types`
 * loads `.ts` and not `.tsx`, so a `.ts` file that imported `dialog.tsx` would
 * take the whole test suite's ability to render a body with it. They take a
 * render function instead and this is the single place the two halves meet.
 */
const Choice: ChoiceRender = (p) => (
  <ChoiceCard label={p.label} note={p.note} selected={p.selected} onSelect={p.onSelect} />
);

/* -------------------------------------------------------------- the press -- */

/** What a finished press has to say: a refusal, a sentence, or nothing to add. */
type PressAnswer = void | { problem?: string | null; note?: string | null };

type Press = {
  busy: boolean;
  problem: string | null;
  note: string | null;
  clear: () => void;
  fail: (problem: string) => void;
  run: (work: () => Promise<PressAnswer>) => Promise<void>;
};

/**
 * One press at a time, and always an answer.
 *
 * `run` clears whatever the last press said, refuses to start while another is
 * still running (a second click on a slow round would spend twice), turns a
 * thrown error into a sentence for the editor, and speaks the answer through
 * the desk's live region. A rejection here is a bug in the caller, not a
 * dialog state: every server function this unit calls answers `{ok:false,error}`
 * rather than throwing, and a throw that does escape is reported as itself.
 */
function usePress(): Press {
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const lock = React.useRef(false);

  const clear = React.useCallback(() => {
    setProblem(null);
    setNote(null);
  }, []);

  const fail = React.useCallback((text: string) => {
    setProblem(text);
    announceToDesk(text, "err");
  }, []);

  const run = React.useCallback(async (work: () => Promise<PressAnswer>) => {
    if (lock.current) return;
    lock.current = true;
    setProblem(null);
    setNote(null);
    setBusy(true);
    try {
      const answer = await work();
      if (answer?.problem) {
        setProblem(answer.problem);
        announceToDesk(answer.problem, "err");
      }
      if (answer?.note) {
        setNote(answer.note);
        announceToDesk(answer.note);
      }
    } catch (err) {
      const text = `That press did not go through: ${err instanceof Error ? err.message : String(err)}`;
      setProblem(text);
      announceToDesk(text, "err");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, problem, note, clear, fail, run };
}

/**
 * The dialog's state, reseeded every time it opens.
 *
 * Cancel is therefore free: the state is thrown away the moment the dialog
 * closes and rebuilt from the `*Initial()` factory the next time it opens, so
 * "Cancel keeps state unchanged" is a property of the factories rather than of
 * a cleanup path somebody has to remember to write.
 */
function useDialogState<S>(
  factory: () => S,
  open: boolean,
  reseed: () => void,
): [S, (patch: Partial<S>) => void] {
  const [state, setState] = React.useState<S>(factory);
  const seed = React.useCallback(() => {
    setState(factory());
    reseed();
  }, [factory, reseed]);
  React.useEffect(() => {
    if (open) seed();
  }, [open, seed]);
  const set = React.useCallback((patch: Partial<S>) => {
    setState((current) => ({ ...current, ...patch }));
  }, []);
  return [state, set];
}

/* --------------------------------------------------------- the upload path -- */

type Uploaded = { ok: true; ids: string[] } | { ok: false; error: string };

/**
 * The desk's own chunked upload, over the desk's own server function.
 *
 * `StoryDocumentUpload` does exactly this in `story-documents.tsx`, but it is a
 * whole panel with its own dropzone markup, and the redesign draws a different
 * one (`astra-drop`); swapping it in would replace the drawing. So the loop is
 * repeated here -- 4 MB slices, the previous part's id threaded through, the
 * same `uploadStoryDocument` -- and NOT re-invented: the size ceiling, the
 * kinds, and the "uploaded" status all come from `story-documents.server.ts`.
 */
async function uploadDocuments(
  files: File[],
  onStatus: (text: string) => void,
): Promise<Uploaded> {
  if (files.length > DOCUMENT_COUNT_LIMIT) {
    return { ok: false, error: `Choose up to ${DOCUMENT_COUNT_LIMIT} documents at a time.` };
  }
  const ids: string[] = [];
  try {
    for (const file of files) {
      if (file.size > DOCUMENT_FILE_LIMIT) {
        throw new Error(`${file.name} is over 100 MB. Split it into volumes before uploading.`);
      }
      onStatus(`Uploading ${file.name}…`);
      let id = "";
      for (let offset = 0; offset < file.size; offset += 4 * 1024 * 1024) {
        const form = new FormData();
        form.append("file", file.slice(offset, offset + 4 * 1024 * 1024, file.type), file.name);
        form.append("total", String(file.size));
        form.append("offset", String(offset));
        form.append("id", id);
        const part = await uploadStoryDocument({ data: form });
        id = part?.id ?? id;
      }
      if (!id) throw new Error(`${file.name} is empty.`);
      ids.push(id);
    }
    return { ok: true, ids };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ------------------------------------------------------------- new story --- */

/**
 * The step shapes the planner answers with.
 *
 * `NewStoryStep.input` is `Record<string, unknown>` on purpose -- a step is
 * assembled from the editor's fields plus the id the previous call returned --
 * so each call site names the shape it is running. A wrong key is caught by the
 * server's own strict `z.object` on arrival, which refuses rather than
 * ignoring it.
 */
type WriteStoryStepIn = {
  text: string;
  documentIds?: string[];
  modelChoice?: string;
  modelEffort?: string | null;
};
type FileLeadStepIn = {
  headline: string;
  why: string;
  topic: string;
  url?: string;
  /** Unit BW3: the pages the pasted story cites (see `newStoryRequest`). */
  urls?: string[];
  disclosureKey?: "outside-ai" | "person" | "other";
  disclosureOther?: string;
  /** Unit BW3: the body is an editor's paste (`draft-evidence.ts:36`). */
  importedText?: boolean;
  /**
   * Unit BW5: how the lead entered the desk, when the screen that filed it
   * knows -- the one-story paste is the import path, so its lead carries the
   * import path's own word (`PASTE_ONE_ORIGIN`, `paste-one-story.ts`), which is
   * what draws the Queue row's Imported chip (`desk-leads.tsx:516`).
   */
  origin?: "import";
};
type SaveDraftStepIn = {
  sourceAttachmentNote?: string;
  headline: string;
  dek: string;
  body: string;
  topic: string;
  leadId?: number;
};

export type NewStoryDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Told the closing sentence, then the dialog closes. */
  onDone?: (note: string) => void;
};

/**
 * "New story" -- the three tabs, and the one press each of them runs.
 *
 * Mounted by: the desk home (`/desk`, `desk.index.tsx`) as the New story
 * control, and `/desk/queue`'s empty state. Props: `open`, `onClose`, `onDone`.
 */
export function NewStoryDialog({ open, onClose, onDone }: NewStoryDialogProps) {
  const press = usePress();
  const [state, set] = useDialogState<NewStoryState>(newStoryInitial, open, press.clear);
  const [documents, setDocuments] = React.useState<string[]>([]);
  /*
    Unit BW5: the paste tab's duplicate warning.

    The old one-story paste panel warned, after adding the story, that it looked
    like one the paper already had, and linked to that one. The drawn dialog's
    paste tab filed the story and said nothing. This holds the server's answer
    for the paste that was just saved; the body draws it beside the
    confirmation, and the next press clears it (a warning about the last paste
    over the current one would be a sentence about a story the editor is not
    looking at).
  */
  const [duplicate, setDuplicate] = React.useState<DuplicateWarning | null>(null);
  /*
    Unit BW3: tabs (b) and (c) save the editor's own text, and `saveDraft`
    writes `topic` -- which the database refuses unless it names a section of
    this newsroom (`sections.server.ts:38`). Tabs (b) and (c) had no control for
    it at all, so the row is fed by the desk's own sections query, the same one
    the write box and the import screen draw (`use-sections.ts:3`).
  */
  const sectionQuery = useEditorSections();

  React.useEffect(() => {
    if (open) {
      setDocuments([]);
      setDuplicate(null);
    }
  }, [open]);

  const done = (text: string): PressAnswer => {
    announceToDesk(text);
    if (onDone) {
      onDone(text);
      onClose();
      return undefined;
    }
    return { note: text };
  };

  const start = (which: "primary" | "alt") => () =>
    press.run(async () => {
      setDuplicate(null);
      const plan = newStoryRequest(state, which, documents);
      let leadId: number | null = null;
      for (const raw of plan.steps) {
        /*
          Annotated rather than inferred: `leadId` is assigned from the filing
          call below, which reads `step.input`, so letting TypeScript infer this
          one makes the three of them circular and it gives up on all three.
        */
        const step: NewStoryStep = leadId === null ? raw : fillStepId(raw, leadId);
        if (step.call === "writeStory") {
          const filed = await writeStoryFromInput({ data: step.input as WriteStoryStepIn });
          if (!filed.ok) return { problem: filed.error };
          return done(plan.done);
        }
        if (step.call === "fileLead") {
          /*
            Named and annotated for the same reason `step` is: this is the call
            `leadId` comes from, and `leadId` is what `step` is built with, so
            TypeScript has to be told the answer's shape instead of working it
            out from a loop that reads its own output.
          */
          const filed: { ok: true; id: number } | { ok: false; error: string } = await fileLead({
            data: step.input as FileLeadStepIn,
          });
          if (!filed.ok) return { problem: filed.error };
          leadId = filed.id;
          continue;
        }
        if (step.call === "saveDraft") {
          /*
            `saveDraft` answers `{ok:true}` or throws -- there is no
            `{ok:false,error}` branch to read (`draft-edit.server.ts:64`) -- so
            the refusal reaches the editor through `usePress`'s own catch
            instead of a check that can never be true.
          */
          await saveDraft({ data: step.input as SaveDraftStepIn });
          /*
            Unit BW5: and then the warning the old paste panel drew.

            Asked AFTER the save, from the headline that was just saved, and the
            lead this press just filed is named and left out (`excludeLeadId`) --
            the old panel looked the duplicate up before the add, from lists
            loaded before the click, so its paste could not find itself; here the
            lead is already on the desk, and its own headline is the one row it
            would always match.

            Only the paste tab: this save writes the editor's own words, and the
            paper already tells them what is in its own Queue.
          */
          if (state.tab === "paste" && leadId !== null) {
            const saved = step.input as SaveDraftStepIn;
            setDuplicate(
              (await findPasteDuplicate({
                data: { headline: saved.headline, excludeLeadId: leadId },
              })) ?? null,
            );
          }
          continue;
        }
        if (step.call === "checkEvidence") {
          if (leadId === null) continue;
          /*
            The evidence check runs on the draft that was just saved, which is
            the closest thing to "the paste" the desk has a version of. Its
            model comes from this tab's own row -- "auto" is a known choice
            (`STORY_MODEL_CHOICES`), so it is always sent.
          */
          const checked = await requestDraftReconciliationFn({
            data: {
              leadId,
              modelChoice: state.model || "auto",
              modelEffort: state.effort,
            },
          });
          if (checked.ok === false) return { problem: checked.error, note: plan.done };
          continue;
        }
        if (step.call === "suggestHeadlines") {
          if (leadId === null) continue;
          /*
            The pick the paste tab's model row carries, or nothing at all when
            the row is on Automatic -- `suggestHeadlinesInput`'s pair is
            optional, so `{leadId}` alone is the call the desk made before this
            dialog drew a row.
          */
          const asked = await suggestHeadlines({ data: { leadId, ...step.input } });
          const options = asked.ok ? asked.options : [];
          return done(
            options.length
              ? `${plan.done} The AI suggests: ${options.join(" · ")}`
              : plan.done,
          );
        }
      }
      return done(plan.done);
    });

  const onFiles = (files: File[]) =>
    void press.run(async () => {
      const saved = await uploadDocuments(files, () => undefined);
      if (!saved.ok) return { problem: saved.error };
      setDocuments((current) => [...current, ...saved.ids]);
      return { note: `${saved.ids.length === 1 ? "Document" : "Documents"} ready. The drafter reads ${saved.ids.length === 1 ? "it" : "them"}.` };
    });

  const foot =
    state.tab === "ai"
      ? "The AI reads everything, drafts, and files it to Drafts. You'll see its progress the whole time."
      : state.tab === "self"
        ? "Saved as your draft. The evidence check is optional but runs the same checks as an AI draft."
        : "Reprints keep the credit line and link on the published page.";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New story"
      subtitle="Start from material for the AI, write it yourself, or bring in a story written elsewhere. Nothing prints until you press Publish."
      footNote={foot}
      primaryLabel={state.tab === "ai" ? "Start drafting" : state.tab === "self" ? "Save draft" : "Save as draft"}
      onPrimary={start("primary")}
      primaryDisabled={press.busy || newStoryProblem(state, documents.length) !== null}
      altLabel={state.tab === "self" ? "Save & check against evidence" : undefined}
      onAlt={state.tab === "self" ? start("alt") : undefined}
      altDisabled={press.busy}
    >
      <NewStoryBody
        state={state}
        set={set}
        problem={press.problem ?? newStoryProblem(state, documents.length)}
        note={press.note}
        ModelPicker={DialogModelPicker}
        sections={sectionQuery.sections}
        onFiles={onFiles}
        duplicate={duplicate}
        Choice={Choice}
      />
    </Dialog>
  );
}

/* -------------------------------------------------------------- add lead --- */

export type AddLeadDialogProps = {
  open: boolean;
  onClose: () => void;
  onDone?: (note: string) => void;
};

/**
 * "Add a lead". No model row, which is the drawing: what happens next picks the
 * work ("Research and score it" is the story job), so the desk resolves it.
 *
 * Mounted by: the desk home's Leads head, and `/desk/queue`'s toolbar.
 */
export function AddLeadDialog({ open, onClose, onDone }: AddLeadDialogProps) {
  const press = usePress();
  const [state, set] = useDialogState<AddLeadState>(addLeadInitial, open, press.clear);

  /*
    This one does NOT close on success, unlike the rest, and the reason is the
    `notice` the server may send with a filed lead: closing would be the only
    way to lose it. So the outcome and any warning stay on screen together, the
    screen is still told (`onDone`) so it can refresh its queue behind the
    dialog, and the editor closes it.
  */
  const onPrimary = () =>
    press.run(async () => {
      const answer = await addLead({ data: addLeadRequest(state) });
      if (!answer.ok) return { problem: answer.error };
      const filed =
        answer.then === "as-is"
          ? `Filed as lead ${answer.leadId} with nothing else run.`
          : answer.then === "draft"
            ? `Filed as lead ${answer.leadId}, and it is drafting now -- watch it under Running now.`
            : answer.score !== undefined && answer.score !== null
              ? `Filed as lead ${answer.leadId} with a usefulness score of ${answer.score}.`
              : `Filed as lead ${answer.leadId}. The AI is reading it now.`;
      announceToDesk(filed);
      onDone?.(filed);
      return { note: filed, problem: answer.notice ?? null };
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a lead"
      subtitle="Give the desk a link or a tip. The AI does the reading; you decide what happens next."
      footNote="A Dark Desk file is for questions that need an investigation. This is for ordinary leads."
      primaryLabel="Add lead"
      onPrimary={onPrimary}
      primaryDisabled={press.busy || addLeadProblem(state) !== null}
    >
      <AddLeadBody
        state={state}
        set={set}
        problem={press.problem ?? addLeadProblem(state)}
        note={press.note}
        Choice={Choice}
        ModelPicker={DialogModelPicker}
      />
    </Dialog>
  );
}

/* ----------------------------------------------------------- add sources --- */

type FindSourcesStepIn = { topic: string; scope: string; modelChoice?: string; modelEffort?: string | null };
type AddSourceStepIn = { url: string; title: string; kind: string; tier: string };
type BulkSourceStepIn = { text: string };

export type AddSourcesDialogProps = {
  open: boolean;
  onClose: () => void;
  onDone?: (note: string) => void;
};

/**
 * "Add sources to watch" -- four tabs, and a preview table before anything is
 * added on the two tabs where the editor pasted more than one row.
 *
 * The watch list is read once per open so that "already watched" is this
 * newsroom's own answer, matched by `sourceIdentity` (host plus path) rather
 * than by string equality -- the same identity the add path refuses duplicates
 * with. If that read fails the preview says so instead of marking every row
 * "new", because a preview that is wrong about a duplicate is worse than no
 * preview.
 *
 * Mounted by: `/desk/sources` (`desk.sources.tsx`, phase 2c) above the watch
 * list, and `/desk/scan`'s sources card. Props: `open`, `onClose`, `onDone`.
 */
export function AddSourcesDialog({ open, onClose, onDone }: AddSourcesDialogProps) {
  const press = usePress();
  const [state, set] = useDialogState<AddSourcesState>(addSourcesInitial, open, press.clear);
  const [watched, setWatched] = React.useState<string[] | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    setWatched(null);
    listSources()
      .then((rows: SourceRow[]) => {
        if (!alive) return;
        setWatched(
          rows
            .filter((row) => row.status === "accepted")
            .map((row) => sourceIdentity(row.url))
            .filter((value): value is string => Boolean(value)),
        );
      })
      .catch(() => {
        if (alive) setWatched(null);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const listTab = state.tab === "list" || state.tab === "file";
  const preview: SourcePreview | null = React.useMemo(
    () => (listTab && watched !== null ? previewSources(state.text, watched) : null),
    [listTab, watched, state.text],
  );

  const done = (text: string): PressAnswer => {
    announceToDesk(text);
    if (onDone) {
      onDone(text);
      onClose();
      return undefined;
    }
    return { note: text };
  };

  const nothingNew = listTab && watched !== null && state.text.trim() !== "" && preview?.newCount === 0;
  const problem =
    press.problem ??
    sourcesProblem(state) ??
    (nothingNew ? "Every one of these is already on the watch list." : null);

  const label = listTab && preview ? addSourcesLabel(preview.newCount) : "Find sources";

  const onPrimary = () =>
    press.run(async () => {
      const request = sourcesRequest(state);
      if (request.call === "findSources") {
        const found = await findSources({ data: request.input as FindSourcesStepIn });
        if (!found.ok) return { problem: found.error };
        const refusedCount = found.skipped - found.alreadyExisted;
        const refused = refusedCount
          ? ` ${refusedCount} ${refusedCount === 1 ? "row was" : "rows were"} refused as unusable, so they are not there.`
          : "";
        return done(
          `The AI proposed ${found.proposed} new ${found.proposed === 1 ? "source" : "sources"}; ${found.alreadyExisted} already existed.${refused} They are in Suggested sources with why, for you to accept or reject.`,
        );
      }
      if (request.call === "addSource") {
        const added = await addSource({ data: request.input as AddSourceStepIn });
        if (!added.ok) return { problem: added.error };
        return done(
          `${added.added} new source; ${added.alreadyExisted} already existed. Newly accepted sources are read first in the next scan.`,
        );
      }
      const added = await addSourcesBulk({ data: request.input as BulkSourceStepIn });
      if (!added.ok) return { problem: added.error };
      const already = added.alreadyExisted;
      return done(
        `${added.added} new sources; ${already} already existed (${added.total} submitted). Newly accepted sources are read first in the next scan.`,
      );
    });

  const onFiles = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    set({ fileName: file.name, text: "" });
    file
      .text()
      .then((text) => set({ text }))
      .catch(() => press.fail(`${file.name} could not be read. Paste its links instead.`));
  };

  const foot =
    state.tab === "one"
      ? "Newly accepted sources are read first in the next scan."
      : state.tab === "list"
        ? "Existing sources keep their kind and tier. Newly accepted sources are read first in the next scan."
        : state.tab === "file"
          ? "You'll see every row before anything is added."
          : "The AI proposes sources. They land in Suggested sources, with why and who found each, for you to accept or reject.";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add sources to watch"
      subtitle="Add one page, paste a list, upload a file, or ask the AI to find sources."
      footNote={foot}
      primaryLabel={state.tab === "one" ? "Add source" : label}
      onPrimary={onPrimary}
      primaryDisabled={press.busy || problem !== null}
    >
      <AddSourcesBody
        state={state}
        set={set}
        problem={problem}
        note={press.note}
        preview={preview}
        ModelPicker={DialogModelPicker}
        onFiles={onFiles}
        Choice={Choice}
      />
    </Dialog>
  );
}

/* ---------------------------------------------------------- add to story --- */

type WeaveStepIn = {
  leadId: number;
  mode: string;
  material: string;
  documentIds?: string[];
  saveText?: string;
  modelChoice?: string;
  modelEffort?: string | null;
};

export type AddToStoryDialogProps = {
  leadId: number;
  open: boolean;
  onClose: () => void;
  onDone?: (note: string) => void;
  /**
   * Unit CP: the exact body the confirm press saved, handed to the screen.
   *
   * The screen around this dialog keeps its own copy of the draft's body in a
   * box, and that box only takes the server's copy when the draft it is
   * looking at changes. A landed add would otherwise leave the box showing the
   * pre-weave text -- and the page's own "Save edits" would then write that
   * older body back over the weave. The screen gets the saved bytes, not a
   * note about them, so it cannot land the wrong thing.
   */
  onSaved?: (body: string) => void;
};

/**
 * "Add to this story" -- two presses, and the first one writes nothing.
 *
 * The review press runs the weave (or builds the update / the plain append) and
 * shows the editor the whole body that would be saved; the confirm press sends
 * exactly those bytes back as `saveText`. `addToConfirm` answers null until a
 * review has happened, so there is no path that saves a body the editor has not
 * read -- which is the design's own foot note, kept as a property of the forms
 * layer rather than of this component's discipline.
 *
 * Mounted by: the story screen (`/desk/story/$leadId`), from the "+ Add to
 * story" press in its action row (`Desk Story.dc.html:114` wires that press to
 * the `add-to` action). Props: `leadId`, `open`, `onClose`, `onDone`,
 * `onSaved`.
 */
export function AddToStoryDialog({
  leadId,
  open,
  onClose,
  onDone,
  onSaved,
}: AddToStoryDialogProps) {
  const press = usePress();
  const [state, set] = useDialogState<AddToState>(addToInitial, open, press.clear);
  const [names, setNames] = React.useState<string[]>([]);
  /*
    What the review press answered as the story AS IT IS (`answer.before`, the
    draft's stored body). Held here rather than in `AddToState` because it is
    the desk's answer about the story, not something the editor typed: the
    compare's "Now" column has to show the story the change lands on. It used
    to be drawn from `state.material`, which printed the paragraph the editor
    had just pasted under the heading "Now" -- a compare that compared nothing.
  */
  const [before, setBefore] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setNames([]);
      setBefore("");
    }
  }, [open]);

  const done = (text: string): PressAnswer => {
    announceToDesk(text);
    if (onDone) {
      onDone(text);
      onClose();
      return undefined;
    }
    return { note: text };
  };

  const onPrimary = () =>
    press.run(async () => {
      const request = addToRequest(state);
      const confirm = addToConfirm(state);
      const answer = await weaveIntoStory({
        data: {
          leadId,
          ...(request as Omit<WeaveStepIn, "leadId">),
          ...(confirm ?? {}),
        },
      });
      if (!answer.ok) return { problem: answer.error };
      if (!confirm) {
        set({ reviewed: answer.after });
        setBefore(answer.before);
        return {
          note:
            answer.notice ??
            `Nothing saved yet. Read it above, then press Add to save exactly this text.`,
        };
      }
      onSaved?.(answer.after);
      return done(
        `Saved. The story is ${answer.after.length} characters now${answer.documents ? `, with ${answer.documents} document${answer.documents === 1 ? "" : "s"} attached` : ""}.`,
      );
    });

  const onFiles = (files: File[]) =>
    void press.run(async () => {
      const saved = await uploadDocuments(files, () => undefined);
      if (!saved.ok) return { problem: saved.error };
      set({ documentIds: [...state.documentIds, ...saved.ids] });
      setNames((current) => [...current, ...files.map((file) => file.name)]);
      return { note: `${saved.ids.length} document${saved.ids.length === 1 ? "" : "s"} uploaded. They attach to the story when you save.` };
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add to this story"
      subtitle="New material, a new record, or your own paragraph."
      footNote="You'll see exactly what changed before saving."
      primaryLabel="Add"
      onPrimary={onPrimary}
      primaryDisabled={press.busy || addToProblem(state) !== null}
    >
      <AddToBody
        state={state}
        set={set}
        problem={press.problem ?? addToProblem(state)}
        note={press.note}
        review={state.reviewed === null ? null : { before, after: state.reviewed }}
        documentNames={names}
        onFiles={onFiles}
        Choice={Choice}
        ModelPicker={DialogModelPicker}
      />
    </Dialog>
  );
}

/* ------------------------------------------------------------- dark file --- */

export type DarkFileDialogProps = {
  open: boolean;
  onClose: () => void;
  defaultLimit?: string;
  defaultModel?: StoryModelChoice;
  defaultEffort?: ModelEffort | null;
  /**
   * Seeds the file fields the caller already knows, instead of making the editor
   * retype them (`darkFileSeed`). Every open reseeds from the factory, so a
   * row's prefill is cleared again by the next open that has none.
   */
  prefill?: DarkFilePrefill;
  /**
   * A hypothesis to open the dialog already holding, handed over from another
   * screen (an import's review screen, a lead's More menu). The dialog reseeds
   * from it every time it opens, so a caller that leaves it in place gets the
   * same file offered again; the caller clears its own copy when it is spent.
   *
   * A `seed` is the whole hand-over and wins over `prefill` when a caller
   * passes both: it already carries the question and the material. The two are
   * separate props because a seed is one paste that has to be split, while a
   * prefill is two fields the caller already has apart.
   */
  seed?: string;
  /**
   * The file is open. The screen owns what happens next: it can navigate to the
   * file, and it may start the first round with the material and the model the
   * editor chose in this dialog.
   */
  /*
    Unit CY item 9: the run handoff carries the effort as well as the model,
    because the dialog now draws both and the first round is what spends it.
    `modelEffort` is optional exactly as `modelChoice` is: an untouched row
    sends neither, and the screen falls back to the surface default.
  */
  onOpened?: (
    investigationId: number,
    run: { paste: string; modelChoice?: string; modelEffort?: string | null },
  ) => void;
};

/**
 * "Start a Dark Desk file".
 *
 * ONE PRESS, ONE WRITE: the dialog opens the file (`openDarkInvestigation`,
 * which stores the Limits dial as `investigations.budget` in hops) and stops
 * there. The engine's first round is deliberately NOT started from here -- the
 * drawn foot note says the editor watches the activity log live and can stop it
 * any time, and a dialog that ran the round itself would hold the editor on a
 * frozen button for the length of a Quick look, with no log and no stop. The
 * screen starts the round on the file page, where those two things exist, and
 * is handed the material and the pick to do it with.
 *
 * Mounted by: `/desk/dark` (`desk.dark.tsx`, phase 2c) as the New file control
 * (which hands over a `seed`), and the lead rows' More menu on `/desk` and
 * `/desk/queue` (which hand over a `prefill`). Props: `open`, `onClose`,
 * `prefill`, `seed`, `onOpened`.
 *
 * PREFILL: the lead row's "Send to Dark Desk" already knows the headline and the
 * link, and `darkProblem` wants a tip of eight characters or more, so the editor
 * who pressed that row should not have to paste them back in. The prefill goes
 * through the same factory `useDialogState` reseeds from on every open (see the
 * `prefill` note on `DarkFileDialogProps`), which is also why the factory is
 * memoized on the two strings rather than on the object: a caller passing an
 * inline literal would otherwise get a fresh factory each render.
 */
export function DarkFileDialog({ open, onClose, onOpened, prefill, seed, defaultLimit, defaultModel: modelOverride, defaultEffort: effortOverride }: DarkFileDialogProps) {
  const press = usePress();
  const modelFromModels = useFirstRunPickerDefault("dark") ?? "auto";
  const defaultModel = modelOverride ?? modelFromModels;
  const defaultEffort = effortOverride ?? defaultModelEffort(defaultModel);
  // The factory must be stable -- `useDialogState` reseeds on every open -- so
  // it is memoized on the seed and on the prefill's two strings rather than
  // rebuilt on each render. A caller passing an inline object literal for
  // `prefill` would otherwise hand over a new factory every render, which is
  // why the fields are read out here; `seed` is a string and needs no such care
  // beyond winning over the prefill when a caller somehow passes both.
  const prefillQuestion = prefill?.question;
  const prefillTip = prefill?.tip;
  const prefillExplanation = prefill?.explanation;
  const factory = React.useCallback(
    () =>
      seed
        ? darkFileFromSeed(seed, defaultModel, defaultEffort, defaultLimit)
        : darkFileSeed({ question: prefillQuestion, tip: prefillTip, explanation: prefillExplanation }, defaultModel, defaultEffort, defaultLimit),
    [seed, prefillQuestion, prefillTip, prefillExplanation, defaultModel, defaultEffort, defaultLimit],
  );
  const [state, set] = useDialogState<DarkFileState>(factory, open, press.clear);

  const onPrimary = () =>
    press.run(async () => {
      const request = darkRequest(state);
      const opened = await openDarkInvestigation({ data: request.open });
      if (!opened.ok) return { problem: opened.error };
      announceToDesk(`Opened "${opened.title}".`);
      onOpened?.(opened.investigationId, request.run);
      onClose();
      return undefined;
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Start a Dark Desk file"
      subtitle="For a question that needs an investigation. Nothing here prints on its own."
      footNote="You'll watch its activity log live and can stop it any time."
      primaryLabel="Open the file"
      onPrimary={onPrimary}
      primaryDisabled={press.busy || darkProblem(state) !== null}
    >
      <DarkFileBody
        state={state}
        set={set}
        problem={press.problem ?? darkProblem(state)}
        note={press.note}
        ModelPicker={DialogModelPicker}
        Choice={Choice}
      />
    </Dialog>
  );
}

/* ------------------------------------------------------------------ hold --- */

export type HoldLeadDialogProps = {
  leadId: number;
  headline?: string;
  open: boolean;
  onClose: () => void;
  onDone?: (note: string) => void;
};

/**
 * "Hold this lead" -- with the reason the desk learns from, or without.
 *
 * "Hold, no reason" is a real press with its own record (`{key:"none"}` and its
 * own time), so a later reader can tell "the editor chose not to say why" from
 * "nobody opened the dialog". Waiting on the AI follow-up records the reason and
 * says plainly that nothing will chase it: `MODEL_JOBS["follow-up"]` is
 * `built:false`, so a quiet success there would be a control that does nothing.
 *
 * Mounted by: the lead row's More menu here, and `/desk/queue`'s row actions.
 */
export function HoldLeadDialog({ leadId, headline, open, onClose, onDone }: HoldLeadDialogProps) {
  const press = usePress();
  const [state, set] = useDialogState<HoldState>(holdInitial, open, press.clear);
  /*
    Unit UI1a3, finding 4: WHICH press is out, not just "one is". `usePress`
    reports a single `busy` for the whole dialog -- it is shared by twelve
    dialogs and none of the others has two destructive presses -- so this
    dialog records the press it fired itself. Without it both "Hold with this
    reason" and "Hold, no reason" drew "Holding…" with a spinner, which says
    two controls were activated when the editor pressed one.
  */
  const [pressed, setPressed] = React.useState<"primary" | "alt" | null>(null);

  const done = (text: string): PressAnswer => {
    announceToDesk(text);
    if (onDone) {
      onDone(text);
      onClose();
      return undefined;
    }
    return { note: text };
  };

  const hold = (withReason: boolean) => () =>
    press.run(async () => {
      setPressed(withReason ? "primary" : "alt");
      try {
        const answer = await holdLead({
          data: { id: leadId, ...holdRequest(state, withReason) },
        });
        if (!answer.ok) return { problem: answer.error };
        return done(
          answer.notice ??
            `Held${headline ? ` "${headline}"` : ""}. It waits in Held with its score; Undo stays on the row.`,
        );
      } finally {
        setPressed(null);
      }
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Hold this lead"
      subtitle="It leaves the open list and waits in Held. Tell the desk why so the AI learns what to hold."
      footNote="Released leads return to the open list with their score. Undo stays on the row."
      primaryLabel="Hold with this reason"
      onPrimary={hold(true)}
      primaryDisabled={press.busy || holdProblem(state, true) !== null}
      altLabel="Hold, no reason"
      onAlt={hold(false)}
      altDisabled={press.busy}
      /*
        Unit UI1a2: the press says what it is doing. Its DONE is the row's --
        `done()` announces the hold and closes, and the lead then reads "Held"
        with "Bring back"/"Release" where Hold was -- and its FAILED is
        `HoldBody`'s own `press.problem`, which is already printed inside the
        dialog rather than beside a button that has closed with it.
      */
      {...dialogPressProps(pressed, "Holding…")}
    >
      <HoldBody
        state={state}
        set={set}
        problem={press.problem ?? holdProblem(state, true)}
        note={press.note}
        Choice={Choice}
      />
    </Dialog>
  );
}

/* -------------------------------------------------------------- headline --- */

export type HeadlineDialogProps = {
  leadId: number;
  /** The headline the story has now, which "Keep mine" saves. */
  current: string;
  open: boolean;
  onClose: () => void;
  onDone?: (note: string) => void;
  /**
   * Unit CP: the line "Use this headline" saved, handed to the screen.
   *
   * The screen's headline box is where a chosen headline lands -- the same box
   * the inline suggestions used to fill -- so the dialog has to say which line
   * it wrote. A note string the screen then parses would be a note that can
   * drift from what was saved.
   */
  onSaved?: (headline: string) => void;
};

/**
 * "Headline" -- keep it, take a suggestion, or type a new one.
 *
 * The model row IS wired here (the reference draws it, and `suggestHeadlines`
 * now takes the pick), so the row the editor sees is the model that runs.
 * The drawn foot note names a model and an elapsed time; `suggestHeadlines`
 * returns neither, so the foot keeps the half that is true.
 *
 * Mounted by: the story screen, opened by the "Suggest headlines" press beside
 * its headline box (`Desk Story.dc.html:97`, whose `doHeads` action is
 * "headlines"). Props: `leadId`, `current`, `open`, `onClose`, `onDone`,
 * `onSaved`.
 */
export function HeadlineDialog({
  leadId,
  current,
  open,
  onClose,
  onDone,
  onSaved,
}: HeadlineDialogProps) {
  const press = usePress();
  const factory = React.useCallback(() => headlineInitial(current), [current]);
  const [state, set] = useDialogState<HeadlineState>(factory, open, press.clear);

  const done = (text: string): PressAnswer => {
    announceToDesk(text);
    if (onDone) {
      onDone(text);
      onClose();
      return undefined;
    }
    return { note: text };
  };

  const onSuggested = () =>
    press.run(async () => {
      const asked = await suggestHeadlines({
        data: { leadId, ...headlineSuggestRequest(state) },
      });
      if (!asked.ok) return { problem: asked.error };
      if (!asked.options.length) return { problem: "The AI offered no headlines. Your own line still works." };
      set({ suggestions: asked.options, choice: asked.options[0] ?? state.choice });
      return { note: `${asked.options.length} suggestions. Pick one, or type your own.` };
    });

  const onPrimary = () =>
    press.run(async () => {
      const written = headlineChoice(state);
      const saved = await chooseHeadline({ data: { id: leadId, headline: written } });
      if (!saved.ok) return { problem: saved.error };
      onSaved?.(saved.headline);
      return done(`Headline saved: ${saved.headline}`);
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Headline"
      subtitle="Pick a suggestion, keep yours, or type a new one. You can also type over the headline directly on the story."
      footNote="Nothing changes until you press Use this headline."
      primaryLabel="Use this headline"
      onPrimary={onPrimary}
      primaryDisabled={press.busy || headlineProblem(state) !== null}
      altLabel="Suggest 3 more"
      onAlt={onSuggested}
      altDisabled={press.busy}
    >
      <HeadlineBody
        state={state}
        set={set}
        problem={press.problem ?? headlineProblem(state)}
        note={press.note}
        ModelPicker={DialogModelPicker}
        Choice={Choice}
      />
    </Dialog>
  );
}

/* --------------------------------------------------- More ▾ (lead) menu --- */

export type MoreLeadDialogProps = {
  leadId: number;
  headline: string;
  open: boolean;
  onClose: () => void;
  /** The four rows this unit does not own. Absent = the row says where to go. */
  onEdit?: () => void;
  onMerge?: () => void;
  onFollowUp?: () => void;
  onKill?: () => void;
};

/**
 * "More for this lead" -- the six-row menu, and the two of its rows this unit
 * can actually carry out.
 *
 * Hold and Dark Desk open this unit's own dialogs, drawn one at a time (the
 * menu closes as the other opens). Edit, Merge, Follow-up and Kill belong to
 * other lanes; when the mounting screen passes no handler for one, the row says
 * so in words rather than closing the menu and doing nothing.
 *
 * Mounted by: the lead row's More ▾ control on `/desk`, `/desk/queue` and the
 * story screen. Props: `leadId`, `headline`, `open`, `onClose`, and whichever of
 * the four handlers that screen owns.
 */
export function MoreLeadDialog({
  leadId,
  headline,
  open,
  onClose,
  onEdit,
  onMerge,
  onFollowUp,
  onKill,
}: MoreLeadDialogProps) {
  const press = usePress();
  const [child, setChild] = React.useState<"hold" | "dark" | null>(null);
  const clearMessages = press.clear;

  React.useEffect(() => {
    if (open) {
      setChild(null);
      clearMessages();
    }
  }, [open, clearMessages]);

  const hand = (label: string, handler?: () => void) => () => {
    if (!handler) {
      press.fail(`Open this lead's page to ${label}.`);
      return;
    }
    handler();
    onClose();
  };

  const onAction = (action: MoreLeadAction) => {
    if (action === "hold") {
      setChild("hold");
      return;
    }
    if (action === "dark") {
      setChild("dark");
      return;
    }
    if (action === "edit") return hand("edit the lead", onEdit)();
    if (action === "merge") return hand("merge it with a printed story", onMerge)();
    if (action === "follow-up") return hand("start a follow-up", onFollowUp)();
    if (action === "kill") return hand("kill it with a reason", onKill)();
  };

  return (
    <>
      <Dialog
        open={open && child === null}
        onClose={onClose}
        title="More for this lead"
        subtitle={headline}
        primaryLabel="Done"
        onPrimary={onClose}
      >
        <MoreLeadMenu onAction={onAction} />
        {press.problem ? (
          <p className="astra-msg warn" role="status">
            {press.problem}
          </p>
        ) : null}
      </Dialog>
      <HoldLeadDialog
        leadId={leadId}
        headline={headline}
        open={open && child === "hold"}
        onClose={onClose}
      />
      <DarkFileDialog open={open && child === "dark"} onClose={onClose} />
    </>
  );
}

/* ----------------------------------------------------------- kill pattern --- */

type KillPatternResult = {
  source: { id: number; url: string; name: string };
  badSource: number;
  killedFromSource: number;
  examples: { id: number; headline: string; reason?: string | null }[];
};

export type SourceKillPatternProps = {
  sourceId: number;
  onClose?: () => void;
};

/**
 * The kill pattern under one source row: counted, never changed.
 *
 * READ-ONLY by construction. `sourceKillPattern` counts the leads killed from
 * this source whose recorded reason is one of the bad-source reasons, and it
 * writes nothing at all -- there is no weight, score or status for this view to
 * touch, which is the brief's "show the pattern only". Both numbers are printed
 * (`killPatternLine`), because a source with nine kills and none of them its
 * fault is a source to keep.
 *
 * Mounted by: `/desk/sources`, under each row of the watch list (phase 2c).
 */
export function SourceKillPattern({ sourceId, onClose }: SourceKillPatternProps) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<KillPatternResult | null>(null);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    sourceKillPattern({ data: { sourceId } })
      .then((answer) => {
        if (!alive) return;
        if (!answer.ok) {
          setError(answer.error);
          return;
        }
        setResult(answer);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [sourceId]);

  return (
    <SourceKillPatternBody
      loading={loading}
      error={error}
      result={result}
      line={result ? killPatternLine(result) : KILL_PATTERN_EMPTY}
      onClose={onClose ?? (() => undefined)}
    />
  );
}

/* ----------------------------------------------------------- the triggers --- */

export type TriggerProps = {
  /** The label the screen wants. Defaults to the design's own verb. */
  label?: string;
  tone?: "solid" | "ghost" | "quiet" | "danger" | "quiet-danger" | "invert";
  disabled?: boolean;
};

/**
 * The nine triggers, each a small button that mounts its own dialog.
 *
 * One shape for all of them: a screen that already has the control mounts the
 * dialog and keeps it, and a screen that does not drops the button in. Both are
 * exported for exactly that reason.
 */

export function NewStoryButton({ label = "New story", tone = "solid", disabled }: TriggerProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <InkButton tone={tone} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </InkButton>
      <NewStoryDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function AddLeadButton({
  label = "Add a lead",
  tone = "ghost",
  disabled,
  onDone,
}: TriggerProps & { onDone?: (note: string) => void }) {
  const [open, setOpen] = React.useState(false);
  /*
    FB6, owner report 7d. `AddLeadDialog` has always announced a filed lead to
    its screen through `onDone`, and this wrapper -- the door the desk home and
    the Queue both use -- dropped it on the floor. So a lead filed from here was
    written to the database, announced in the toast, and then simply not on the
    list it was filed from until a reload: the global `refetchOnWindowFocus:
    false` (root.tsx) means nothing else was ever going to fetch it. The prop is
    forwarded now, and both screens pass the invalidation.
  */
  return (
    <>
      <InkButton tone={tone} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </InkButton>
      <AddLeadDialog open={open} onClose={() => setOpen(false)} onDone={onDone} />
    </>
  );
}

export function AddSourcesButton({ label = "Add sources", tone = "ghost", disabled }: TriggerProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <InkButton tone={tone} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </InkButton>
      <AddSourcesDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function AddToStoryButton({
  leadId,
  label = "Add to this story",
  tone = "ghost",
  disabled,
}: TriggerProps & { leadId: number }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <InkButton tone={tone} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </InkButton>
      <AddToStoryDialog leadId={leadId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function DarkFileButton({ label = "Start a Dark Desk file", tone = "solid", disabled }: TriggerProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <InkButton tone={tone} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </InkButton>
      <DarkFileDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function HoldLeadButton({
  leadId,
  headline,
  label = "Hold",
  tone = "quiet",
  disabled,
}: TriggerProps & { leadId: number; headline?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <InkButton tone={tone} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </InkButton>
      <HoldLeadDialog
        leadId={leadId}
        headline={headline}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

export function HeadlineButton({
  leadId,
  current,
  label = "Headline",
  tone = "ghost",
  disabled,
}: TriggerProps & { leadId: number; current: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <InkButton tone={tone} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </InkButton>
      <HeadlineDialog
        leadId={leadId}
        current={current}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

export function MoreLeadButton({
  leadId,
  headline,
  label = "More ▾",
  tone = "quiet",
  disabled,
  onEdit,
  onMerge,
  onFollowUp,
  onKill,
}: TriggerProps & { leadId: number; headline: string } & Pick<
    MoreLeadDialogProps,
    "onEdit" | "onMerge" | "onFollowUp" | "onKill"
  >) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <InkButton tone={tone} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </InkButton>
      <MoreLeadDialog
        leadId={leadId}
        headline={headline}
        open={open}
        onClose={() => setOpen(false)}
        onEdit={onEdit}
        onMerge={onMerge}
        onFollowUp={onFollowUp}
        onKill={onKill}
      />
    </>
  );
}

/** The kill pattern's own toggle, for a source row that has room for one button. */
export function SourceKillPatternButton({
  sourceId,
  label = "Kill pattern",
  tone = "quiet",
  disabled,
}: TriggerProps & { sourceId: number }) {
  const [shown, setShown] = React.useState(false);
  return (
    <>
      <InkButton
        tone={tone}
        disabled={disabled}
        onClick={() => setShown((current) => !current)}
      >
        {shown ? "Hide kill pattern" : label}
      </InkButton>
      {shown ? <SourceKillPattern sourceId={sourceId} onClose={() => setShown(false)} /> : null}
    </>
  );
}
