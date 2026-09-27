/**
 * What each dialog's state becomes when its primary button is pressed.
 *
 * A dialog has three things that can be silently wrong and none of them are
 * pixels: whether the press is allowed yet, which server function it calls,
 * and whether a model is about to be spent on it. All three are decided here,
 * in plain functions with plain arguments, so `node --test` can press every
 * button without a browser, a React tree, or a model.
 *
 * The bodies (`editor-dialog-bodies.ts`) render these; the shells
 * (`editor-dialogs.tsx`) hold the state and call the server. Nothing in this
 * file imports React.
 *
 * THE MODEL ROW IS PART OF THE REQUEST, NOT DECORATION. Every AI path carries
 * `modelChoice`/`modelEffort` taken from the row the editor saw, and every
 * no-AI path carries neither -- so an editor who picked "No AI" cannot be
 * charged for a model call by a request builder that forgot to check.
 */
import { modelChoiceLabel, modelChoicesFor } from "../../lib/news/model-choice.ts";
import { ADD_TO_MODES, DARK_LIMITS, FIND_SOURCE_SCOPES, hopsForLimit } from "../../lib/news/editor-dialog-logic.ts";
import { HOLD_CHOICES } from "../../lib/news/kill-reasons.ts";

/* ------------------------------------------------------------ model rows -- */

export type ModelRow = { value: string; label: string };
export type ModelPick = { modelChoice?: string; modelEffort?: string | null };

/**
 * The picker rows for one surface, plus the Automatic default.
 *
 * `modelChoicesFor` is the desk's own vocabulary for a surface (the same one
 * `model-picker.tsx` and the desk routes draw), so a dialog cannot offer a
 * model the assignment page does not know about.
 */
export function modelRowFor(surface: "story" | "scan" | "opinion" | "dark"): ModelRow[] {
  return modelChoicesFor(surface).map((c) => ({ value: c.value, label: c.label }));
}

/** The default label the row shows when the editor has not touched it. */
export function automaticLabel(surface: "story" | "scan" | "opinion" | "dark"): string {
  const first = modelRowFor(surface)[0];
  return first ? modelChoiceLabel(first.value) : "Automatic";
}

/**
 * The pick, or nothing at all.
 *
 * "auto" is the absent pick, so it is dropped rather than sent: the server's
 * own resolution already falls through to `model_assignments` and the surface
 * default, and sending "auto" explicitly would skip the editor's assignments
 * for this job -- the one thing the brief's resolution order puts second.
 */
export function modelPick(surface: "story" | "scan" | "opinion" | "dark", value: string, effort: string | null): ModelPick {
  if (!value || value === "auto") return {};
  const rows = modelRowFor(surface);
  if (!rows.some((r) => r.value === value)) return {};
  return { modelChoice: value, modelEffort: effort };
}

/* ------------------------------------------------------------- validation -- */

/** The one shape a problem has: a sentence for the editor, or null. */
export type Problem = string | null;

/* ------------------------------------------------------------------------- */

export type NewStoryTab = "ai" | "self" | "paste";

export type NewStoryState = {
  tab: NewStoryTab;
  /** Tab (a). */
  links: string;
  sourceText: string;
  assignment: string;
  /** Tab (b). */
  headline: string;
  summary: string;
  story: string;
  sources: string;
  /** Tab (c). */
  originalLink: string;
  creditLine: string;
  pastedStory: string;
  /** Tab (c)'s "What should the AI do?". */
  pasteMode: "nothing" | "clean" | "check";
  model: string;
  effort: string | null;
};

export const NEW_STORY_TABS: readonly { key: NewStoryTab; label: string }[] = [
  { key: "ai", label: "AI drafts from material" },
  { key: "self", label: "Write it myself" },
  { key: "paste", label: "Paste a finished story" },
];

export const PASTE_MODES = [
  { key: "nothing", label: "Nothing: keep it exactly as pasted", note: "Formatting only", ai: false },
  { key: "clean", label: "Clean up formatting and suggest a headline", note: "Your text is unchanged", ai: true },
  { key: "check", label: "Check it against its sources", note: "Runs the evidence check", ai: true },
] as const;

/**
 * Whether the press is allowed yet.
 *
 * `why` is the Assignment box, because a lead cannot be listed without one and
 * the design draws no other line that could serve. What the press then DOES is
 * in `newStoryRequest` below.
 */
export function newStoryProblem(state: NewStoryState): Problem {
  if (state.tab === "ai") {
    if (!state.sourceText.trim() && !state.links.trim()) return "Paste the material or point at it. The AI needs something to read.";
    if (state.assignment.trim().length < 8) return "Say what the story is. That is what the AI works from.";
    return null;
  }
  if (state.tab === "self") {
    if (state.headline.trim().length < 8) return "Headline needs a full sentence.";
    if (state.summary.trim().length < 8) return "Say why this is news.";
    if (state.story.trim().length < 40) return "The story needs some text.";
    return null;
  }
  if (state.pastedStory.trim().length < 40) return "Paste the story text.";
  if (state.pasteMode !== "nothing" && state.originalLink.trim() && !/^https?:\/\//i.test(state.originalLink.trim())) {
    return "The original link has to start with http:// or https://.";
  }
  return null;
}

/* --- what each press of New story's primary actually does ------------------ */

/**
 * One step of a press, in the order the shell runs it.
 *
 * A list rather than one call, because two of the three tabs file a lead and
 * then write a draft onto it, and the second call needs the id the first one
 * returned -- a shape no single request object can hold without pretending the
 * id is known up front.
 */
export type NewStoryStep =
  | { call: "writeStory"; input: Record<string, unknown> }
  | { call: "fileLead"; input: Record<string, unknown> }
  | { call: "saveDraft"; input: Record<string, unknown> }
  | { call: "checkEvidence" }
  | { call: "suggestHeadlines"; input: Record<string, unknown> };

export type NewStoryPress = { steps: NewStoryStep[]; done: string };

/**
 * The lead's headline when the story was pasted in whole.
 *
 * The reference draws no headline field on tab (c) -- only Original link,
 * Credit line and Story text -- and a lead cannot be listed without one, so it
 * comes from the paste: the first line if it reads as a headline, and otherwise
 * the first sentence. That is `parseWriteStoryInput`'s own rule (the desk's
 * one-box path), applied here for the same reason it applies there.
 */
export function pastedHeadline(text: string): string {
  const first = (text.trim().split(/\r?\n/).find((l) => l.trim()) ?? "").trim();
  if (first.length >= 8) return first.slice(0, 180);
  const sentence = (text.trim().match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0] ?? text).trim();
  return sentence.slice(0, 180);
}

/**
 * The one URL `fileLead` takes, out of a box that holds several.
 *
 * `fileLead` accepts a single `url` and `saveDraft` has no sources field, so
 * tab (b)'s Sources box can only file its first link. The rest are not silently
 * lost -- they are in the story text the editor wrote -- but they are not the
 * draft's sources either, and the report says so.
 */
export function firstSourceUrl(sources: string): string | undefined {
  const line = sources
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^https?:\/\//i.test(l));
  return line ? line.split(/[,\s]/)[0] : undefined;
}

/**
 * What a press of New story's primary does, tab by tab.
 *
 * Tab (a) is `writeStoryFromInput`, the desk's existing one-box path: it parses
 * the text into a headline, a why-now line, a topic and the source URLs, files
 * the lead, and drafts it -- the sentence the reference prints in this tab's
 * foot. The Assignment box is the head of that text, so it supplies the
 * headline and is kept whole as the reporting scratch the drafter reads as
 * evidence. (`README.md`'s table calls tab (a) "the existing `/desk/import`
 * intake"; the tab's own copy in `Desk Dialogs.dc.html` does not, and the tab
 * is what this build follows.)
 *
 * Tabs (b) and (c) file a lead and write the editor's own text onto it, which
 * is `fileLead` then `saveDraft` -- the two functions the desk already saves a
 * draft with. (b)'s alternate press is the same two steps plus the evidence
 * check; (c) adds the check or the headline suggestions the "What should the AI
 * do?" choice names.
 */
export function newStoryRequest(
  state: NewStoryState,
  press: "primary" | "alt" = "primary",
  documentIds: readonly string[] = [],
): NewStoryPress {
  if (state.tab === "ai") {
    return {
      steps: [
        {
          call: "writeStory",
          input: {
            text: [state.assignment.trim(), state.links.trim(), state.sourceText.trim()]
              .filter(Boolean)
              .join("\n\n"),
            ...modelPick("story", state.model, state.effort),
            /*
              The tab's drop zone, handed to the drafter as documents it reads.
              Without this the zone would accept a file, the plan would drop it,
              and the editor would have watched a control do nothing --
              `writeStoryInput` has carried `documentIds` all along.
            */
            ...(documentIds.length ? { documentIds: [...documentIds] } : {}),
          },
        },
      ],
      done: "Drafting started from your material. Watch it under Running now; it lands in Drafts.",
    };
  }

  if (state.tab === "self") {
    const headline = state.headline.trim();
    const summary = state.summary.trim();
    const url = firstSourceUrl(state.sources);
    return {
      steps: [
        { call: "fileLead", input: { headline, why: summary, topic: "", ...(url ? { url } : {}) } },
        /*
          `topic` goes as "" because `draftEditInput` requires the key and
          `fileLead`'s own rule is `(data.topic || "council")` -- the section the
          desk files an untopiced story under. `leadId` is not here: it is the
          first step's answer, and the shell fills it in (`fillStepId`).
        */
        { call: "saveDraft", input: { headline, dek: summary, body: state.story, topic: "" } },
        ...(press === "alt" ? [{ call: "checkEvidence" as const }] : []),
      ],
      done:
        press === "alt"
          ? "Saved as your draft, and the evidence check is running. Watch it under Running now."
          : "Saved as your draft. It is in Drafts under your headline.",
    };
  }

  const headline = pastedHeadline(state.pastedStory);
  const link = state.originalLink.trim();
  const steps: NewStoryStep[] = [
    {
      call: "fileLead",
      input: {
        headline,
        why: link ? `Pasted in full from ${link}` : "Pasted in full from a story written elsewhere.",
        topic: "",
        ...(link && /^https?:\/\//i.test(link) ? { url: link } : {}),
      },
    },
    {
      call: "saveDraft",
      input: {
        headline,
        dek: state.creditLine.trim() || link,
        body: state.pastedStory,
        topic: "",
      },
    },
  ];
  /*
    "Clean up formatting and suggest a headline" runs the desk's own headline
    suggestions and nothing else: no existing path rewrites the formatting of a
    pasted story, and inventing one here would put a model between the editor's
    bytes and the saved draft. The choice's own note ("Your text is unchanged")
    is what the build does.

    The step carries the tab's model row because the row is drawn whenever a
    mode can spend a model (`suggestHeadlinesInput` takes the same optional pair
    as every other AI press). A row whose value the press dropped would be a
    control the editor sets and the desk ignores; absent is still the old call.
  */
  if (state.pasteMode === "clean") steps.push({ call: "suggestHeadlines", input: modelPick("story", state.model, state.effort) });
  if (state.pasteMode === "check") steps.push({ call: "checkEvidence" });
  return {
    steps,
    done:
      state.pasteMode === "check"
        ? "Saved as your draft, and the evidence check is running. Watch it under Running now."
        : "Saved as your draft. The credit line and link stay on the published page.",
  };
}

/**
 * The one step whose input cannot be complete when the press is planned.
 *
 * Tabs (b) and (c) file a lead and then write the editor's text onto THAT lead,
 * so `saveDraft` needs the id the filing returned. The planner therefore emits
 * the step without one and the shell fills it after the first call answers.
 * A step that is not a save is returned untouched, so the caller can run this
 * over every step of a press without deciding which ones it applies to.
 */
export function fillStepId(step: NewStoryStep, leadId: number): NewStoryStep {
  if (step.call !== "saveDraft") return step;
  return { call: "saveDraft", input: { ...step.input, leadId } };
}

/* --------------------------------------------------------------- add lead -- */

export type AddLeadThen = "score" | "draft" | "as-is";

export type AddLeadState = { paste: string; why: string; then: AddLeadThen; model: string; effort: string | null };

export const ADD_LEAD_THENS = [
  { key: "score", label: "Research and score it", note: "Files it in the Queue with evidence and a score", ai: true },
  { key: "draft", label: "Research and draft a story now", note: "Goes straight to Drafts", ai: true },
  { key: "as-is", label: "Just file it as-is", note: "No AI; you'll work it yourself", ai: false },
] as const;

export function addLeadProblem(state: AddLeadState): Problem {
  if (state.paste.trim().length < 8) return "Paste a URL, or describe what you heard.";
  return null;
}

export function addLeadRequest(state: AddLeadState) {
  const then = ADD_LEAD_THENS.find((t) => t.key === state.then) ?? ADD_LEAD_THENS[0];
  return {
    paste: state.paste.trim(),
    why: state.why.trim() || undefined,
    then: then.key,
    ...(then.ai ? modelPick("story", state.model, state.effort) : {}),
  };
}

/* ------------------------------------------------------------- add sources -- */

export type SourceTab = "one" | "list" | "file" | "ai";

export const SOURCE_TABS: readonly { key: SourceTab; label: string }[] = [
  { key: "one", label: "One link" },
  { key: "list", label: "Paste a list" },
  { key: "file", label: "Upload a file" },
  { key: "ai", label: "Ask AI to find sources" },
];

export type AddSourcesState = {
  tab: SourceTab;
  /** Tab "one". */
  url: string;
  name: string;
  watchFor: string;
  /** Tab "list" -- and the text a CSV/OPML/sitemap upload was read into. */
  text: string;
  /** The file picked on the upload tab: its name, for the row the editor sees. */
  fileName: string;
  /** Tab "ai". */
  topic: string;
  scope: string;
  model: string;
  effort: string | null;
};

export function sourcesProblem(state: AddSourcesState): Problem {
  if (state.tab === "one") {
    if (!/^https?:\/\//i.test(state.url.trim())) return "The link has to start with http:// or https://.";
    return null;
  }
  if (state.tab === "list") {
    return state.text.trim() ? null : "Paste the links, one per line.";
  }
  if (state.tab === "file") {
    return state.fileName ? null : "Choose a CSV, OPML or sitemap file.";
  }
  return state.topic.trim().length >= 4 ? null : "Say what the paper should cover.";
}

/**
 * What the primary press calls, and with what.
 *
 * Every member names the other tabs' keys as absent, so a test can read
 * `req.input.modelChoice` once it has checked `req.call` without a narrowing
 * dance -- and so that a test which does NOT check `call` first is reading a
 * declared absence rather than a key the type happened to allow. The keys are
 * optional-undefined and never set, so the object the server receives is the
 * three-key object it was before; `assert.deepEqual` sees no difference.
 */
export type SourcesRequest =
  | {
      call: "findSources";
      input: { topic: string; scope: string; modelChoice?: string; modelEffort?: string | null };
    }
  | {
      call: "addSource";
      input: {
        url: string;
        title: string;
        kind: string;
        tier: string;
        topic?: undefined;
        scope?: undefined;
        modelChoice?: undefined;
        modelEffort?: undefined;
      };
    }
  | {
      call: "addSourcesBulk";
      input: {
        text: string;
        topic?: undefined;
        scope?: undefined;
        modelChoice?: undefined;
        modelEffort?: undefined;
      };
    };

/** Which server function the primary press calls, so a test can assert it. */
export function sourcesRequest(state: AddSourcesState): SourcesRequest {
  if (state.tab === "ai") {
    return {
      call: "findSources" as const,
      input: {
        topic: state.topic.trim(),
        scope: (FIND_SOURCE_SCOPES.find((s) => s.key === state.scope) ?? FIND_SOURCE_SCOPES[0]).key,
        ...modelPick("scan", state.model, state.effort),
      },
    };
  }
  if (state.tab === "one") {
    /*
      "What to watch for" has nowhere to go, and this build does not pretend
      otherwise. `addSourceInput` is `{url,title,kind,tier}` -- `title` and
      `kind` are REQUIRED strings, which is why the name is sent even when it is
      empty and `kind`/`tier` go as "" for the server to fill from the URL (see
      `desk.ts`'s addSource: `kindFromSourceUrl`, tier "A"). The reference draws
      a "What to watch for" line beside them and there is no column for it: the
      `sources` table is (id, user_id, url, title, kind, tier, status, last_hash,
      last_fetched_at, last_error, created_at), `upsertSource` takes exactly the
      four, and no other writer of a source note exists in the desk -- a grep
      for a sources note/`watch_for` writer found none. So the field is drawn,
      the editor's words stay on screen, and the report names it as a drawn
      field with no store rather than a `reason` key that a strict `z.object`
      would strip on arrival.
    */
    return {
      call: "addSource" as const,
      input: { url: state.url.trim(), title: state.name.trim(), kind: "", tier: "" },
    };
  }
  /*
    The list tab and the file tab call the same thing, because a CSV, OPML or
    sitemap is read into lines by the caller and then it IS a list. Two calls
    would be two rules about duplicates.
  */
  return {
    call: "addSourcesBulk" as const,
    input: { text: state.text.trim() },
  };
}

/* ------------------------------------------------------------- add to story -- */

export type AddToState = {
  mode: "weave" | "update" | "as-is";
  material: string;
  documentIds: string[];
  /** The body the editor was shown by the review press, if it has happened. */
  reviewed: string | null;
  model: string;
  effort: string | null;
};

export function addToProblem(state: AddToState): Problem {
  if (!state.material.trim() && !state.documentIds.length) return "Paste something, or drop a document.";
  if (!state.material.trim()) return "Paste the material to add. Documents are attached to the story, not added to the text.";
  return null;
}

export function addToMode(key: string) {
  return ADD_TO_MODES.find((m) => m.key === key) ?? ADD_TO_MODES[0];
}

export function addToRequest(state: AddToState) {
  const mode = addToMode(state.mode);
  return {
    mode: mode.key,
    material: state.material.trim(),
    // Absent, not an empty array: the story's attach step is not asked to
    // attach nothing, and no key is sent that pretends otherwise.
    ...(state.documentIds.length ? { documentIds: state.documentIds } : {}),
    ...(mode.ai ? modelPick("story", state.model, state.effort) : {}),
  };
}

/**
 * The confirm press: the exact bytes the editor was shown, or nothing.
 *
 * Returning null when nothing has been reviewed is the guard that keeps the
 * two-press flow from collapsing into one: there is no code path that saves a
 * body the editor has not read.
 */
export function addToConfirm(state: AddToState): { saveText: string } | null {
  return state.reviewed === null ? null : { saveText: state.reviewed };
}

/* -------------------------------------------------------------- dark file -- */

export type DarkFileState = { question: string; tip: string; explanation: string; limit: string; model: string; effort: string | null };

export function darkProblem(state: DarkFileState): Problem {
  if (state.question.trim().length < 8) return "Say what you are trying to find out.";
  if (state.tip.trim().length < 8) return "Give the file a starting point.";
  return null;
}

/**
 * What "Open the file" sends, and the second call it makes.
 *
 * Two existing server functions, in the order the desk already uses them: the
 * open writes the row (and the Limits dial, as `investigations.budget` in hops)
 * and the run does the spending, with its own provider probe and preflight. A
 * dialog that ran the engine itself would be a second copy of both.
 */
export function darkRequest(state: DarkFileState) {
  const limit = DARK_LIMITS.find((l) => l.key === state.limit) ?? DARK_LIMITS[1];
  /*
    The ordinary explanation travels with the starting point.

    The reference draws three boxes -- the question, the tip, and "The ordinary
    explanation: what would make this a non-story? Rule it out first" -- and the
    open path takes one `paste`. Dropping the third box would be the editor
    typing a paragraph the desk then never reads, which is the one thing this
    unit's copy says never happens. So it is appended to the same material the
    engine is seeded with, labelled, rather than silently discarded: the
    question the editor wants ruled out is part of what the file is about.
  */
  const explanation = state.explanation.trim();
  return {
    open: {
      paste: [
        state.tip.trim(),
        explanation ? `The ordinary explanation, to rule out first: ${explanation}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      title: state.question.trim(),
      budget: hopsForLimit(limit.key),
    },
    run: { paste: state.tip.trim(), modelChoice: state.model === "auto" ? undefined : state.model },
    limit: limit.key,
  };
}

/* -------------------------------------------------------------------- hold -- */

export type HoldState = { choice: string; note: string };

export const HOLD_NONE = "none";

export function holdRequest(state: HoldState, withReason: boolean) {
  const key = withReason ? state.choice : HOLD_NONE;
  return { choice: key, note: withReason ? state.note.trim() || undefined : undefined };
}

export function holdProblem(state: HoldState, withReason: boolean): Problem {
  if (!withReason) return null;
  return HOLD_CHOICES.some((c) => c.key === state.choice) ? null : "Pick a reason, or press Hold, no reason.";
}

/* ---------------------------------------------------------------- headline -- */

export type HeadlineState = {
  choice: string;
  written: string;
  current: string;
  suggestions: string[];
  /**
   * The model row the reference draws beside "Suggest 3 more".
   *
   * `suggestHeadlines` used to take no pick and resolve its own; the dialog
   * draws the row, so the input carries the same optional pair every other AI
   * press here carries and the row is a control with a reader.
   */
  model: string;
  effort: string | null;
};

/**
 * "Suggest 3 more", as the request it is.
 *
 * `leadId` is not here -- the dialog is opened for one lead and the shell adds
 * the id it was mounted with, so this builder cannot be given the wrong one.
 */
export function headlineSuggestRequest(state: HeadlineState) {
  return {
    headline: state.current.trim() || undefined,
    ...modelPick("story", state.model, state.effort),
  };
}

/**
 * Which line "Use this headline" saves.
 *
 * The typed line wins when there is one: the design draws it as "Or write a
 * new one" under the choices, and a field the editor filled in that the button
 * then ignored would be a control that does nothing. "Keep mine" saves the
 * current headline, which is a real press -- it is how an editor undoes a
 * suggestion they had already clicked without saving.
 */
export function headlineChoice(state: HeadlineState): string {
  const written = state.written.trim();
  if (written) return written.slice(0, 180);
  if (state.choice === "keep") return state.current.trim().slice(0, 180);
  return String(state.choice || "").trim().slice(0, 180);
}

export function headlineProblem(state: HeadlineState): Problem {
  const chosen = headlineChoice(state);
  if (chosen.length < 8) return "Write a headline, or pick one of the suggestions.";
  return null;
}

/* ------------------------------------------------------------ kill pattern -- */

/**
 * The sentence under `<SourceKillPattern>`.
 *
 * Both numbers are printed, always, because they are different facts: a source
 * with nine kills and none of them its fault is a source to keep. A line that
 * showed only the bad-source count would say "0" for both, and the editor could
 * not tell that apart from a source nothing has ever been filed from.
 */
export function killPatternLine(result: { badSource: number; killedFromSource: number }): string {
  if (result.killedFromSource === 0) return "No leads killed from this source yet.";
  if (result.badSource === 0) {
    return `${result.killedFromSource} killed from this source, none for a bad source.`;
  }
  // The noun agrees with the total the sentence is about, not with the count
  // that precedes it: "1 of 1 lead", "2 of 4 leads".
  const source = result.killedFromSource === 1 ? "lead" : "leads";
  return `${result.badSource} of ${result.killedFromSource} ${source} killed from this source for a bad source or unreadable page.`;
}

export const KILL_PATTERN_EMPTY = "No leads killed from this source yet.";

/* ------------------------------------------------------- the drawn defaults -- */

/**
 * What each dialog looks like the moment it opens.
 *
 * Here rather than in the `.tsx` so "Cancel keeps state unchanged" is a thing a
 * test can state exactly: the only way a dialog is dirty after a cancel is if
 * one of these factories is impure or a request builder wrote to the object it
 * was handed, and both are checkable without a browser. The shell reseeds its
 * state from these on open, so a second open is the first open again.
 */
export function newStoryInitial(): NewStoryState {
  return {
    tab: "ai",
    links: "",
    sourceText: "",
    assignment: "",
    headline: "",
    summary: "",
    story: "",
    sources: "",
    originalLink: "",
    creditLine: "",
    pastedStory: "",
    pasteMode: "nothing",
    model: "auto",
    effort: null,
  };
}

export function addLeadInitial(): AddLeadState {
  return { paste: "", why: "", then: "score", model: "auto", effort: null };
}

export function addSourcesInitial(): AddSourcesState {
  return {
    tab: "one",
    url: "",
    name: "",
    watchFor: "",
    text: "",
    fileName: "",
    topic: "",
    scope: FIND_SOURCE_SCOPES[0].key,
    model: "auto",
    effort: null,
  };
}

export function addToInitial(): AddToState {
  return { mode: "weave", material: "", documentIds: [], reviewed: null, model: "auto", effort: null };
}

/** The Limits dial starts where the design draws it: Standard. */
export function darkFileInitial(): DarkFileState {
  return { question: "", tip: "", explanation: "", limit: DARK_LIMITS[1].key, model: "auto", effort: null };
}

export function holdInitial(): HoldState {
  return { choice: HOLD_CHOICES[0]?.key ?? "record-or-date", note: "" };
}

/** `current` is the headline the story has now, which the dialog was opened for. */
export function headlineInitial(current: string): HeadlineState {
  return { choice: "keep", written: "", current, suggestions: [], model: "auto", effort: null };
}

/* --------------------------------------------------------- More ▾ (lead) -- */

/**
 * The More menu's six rows, in the design's order.
 *
 * `action` is what the caller switches on: five of them open one of this
 * unit's dialogs, and one ("Edit the lead") is the existing lead editor, which
 * this unit does not build. `danger` is the last row's styling, which the
 * design marks separately.
 */
export type MoreLeadAction = "edit" | "hold" | "merge" | "dark" | "follow-up" | "kill";

export const MORE_LEAD_ITEMS: readonly {
  action: MoreLeadAction;
  label: string;
  note: string;
  button: string;
  danger?: boolean;
}[] = [
  { action: "edit", label: "Edit the lead", note: "Change the title, notes or section before drafting", button: "Edit" },
  { action: "hold", label: "Hold with a reason", note: "", button: "Hold" },
  { action: "merge", label: "Merge with a printed story", note: "Adds this as an update to a printed story", button: "Merge" },
  { action: "dark", label: "Send to Dark Desk", note: "Opens an investigation file from this lead", button: "Open file" },
  { action: "follow-up", label: "Start an AI follow-up", note: "Keep watching for what happens next", button: "Start" },
  { action: "kill", label: "Kill with a reason", note: "", button: "Kill", danger: true },
];
