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
import { SECTION_REQUIRED } from "../../lib/news/import-review.ts";
import {
  PASTE_ONE_DISCLOSURE,
  PASTE_ONE_ORIGIN,
  bodyFromPaste,
} from "../../lib/news/paste-one-story.ts";
import { extractLinks } from "../../lib/news/import-stories.ts";
import { LIMITS } from "../../lib/news/request-input.ts";

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
 * Automatic is an explicit editor choice. It means the recommended fallback
 * ladder, while an empty value means the server can use the job assignment.
 *
 * Unit BW3: a saved custom connection (`custom:<uuid>`) is a real pick the
 * server resolves (`model-choice.ts` `isCustomModelChoice`), and it is NOT in
 * `modelRowFor` -- the registry this file reads is static and the connections
 * live in the database. It arrives in the row through the shell, which merges
 * what `getCustomAiConnectionsFn` answered (the same merge `model-picker.tsx`
 * does), so dropping it here would be the editor picking their own connection
 * and the press quietly spending a built-in model instead. Anything else the
 * row cannot carry is still dropped.
 */
export function modelPick(surface: "story" | "scan" | "opinion" | "dark", value: string, effort: string | null): ModelPick {
  if (!value) return {};
  const rows = modelRowFor(surface);
  if (!rows.some((r) => r.value === value) && !/^custom:/.test(value)) return {};
  return value === "auto" ? { modelChoice: "auto" } : { modelChoice: value, modelEffort: effort };
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
  /**
   * Tabs (b) and (c): the section the editor's own text is filed under.
   *
   * Unit BW3, measured, not guessed: a draft cannot be written without one.
   * `saveDraftForEditor` writes `topic` on every save (`draft-edit.server.ts:48`
   * update, `:61` insert) and the `drafts` trigger fires on `insert or update of
   * topic` (`sections.server.ts:47`), where `resolve_story_section` raises
   * "Section not found in this newsroom: " for any key that is not a row of
   * `newsroom_sections` -- including the empty string (`sections.server.ts:38`).
   * Both tabs planned `topic: ""`, so both tabs' save was a 500. The rule is the
   * old one-story paste panel's, in its own words: the section is asked for
   * before the story is filed, and the placeholder is a question, not an answer
   * (`desk.index.tsx:366-371`, `paste-one-story.server.test.ts:139-154`).
   */
  section: string;
  /** Tab (c)'s "What should the AI do?". */
  pasteMode: "nothing" | "clean" | "check";
  /**
   * Tab (a): how far the drafter may look.
   *
   * Unit BW3: the old composer's "Research & section" disclosure offered this
   * (`DraftScopePicker`, `desk.index.tsx:1314`) and it is part of the request --
   * `writeStoryInput.researchScope` (`request-input.ts:879`), where the server
   * reads an absent value as "public" (`desk.ts:1588`). A press that could not
   * say "supplied" would run public research -- real searches and link
   * following (`report.ts:1337/1347`) -- for an editor who attached their own
   * documents and did not ask for any.
   */
  researchScope: "public" | "supplied";
  model: string;
  effort: string | null;
};

/**
 * The two scopes tab (a) offers, in `DraftScopePicker`'s own words and values.
 *
 * The desk's picker and this dialog must agree on the vocabulary: the value is
 * what `writeStoryFromInput` receives and what the desk's own control writes.
 */
export const NEW_STORY_SCOPES: readonly {
  value: "public" | "supplied";
  label: string;
  note: string;
}[] = [
  {
    value: "public",
    label: "Research public sources",
    note: "Follows supplied links and searches for relevant public evidence.",
  },
  {
    value: "supplied",
    label: "Use only supplied material",
    note: "Reads your text and the documents you attached. No discovery or external searches.",
  },
];

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
export function newStoryProblem(state: NewStoryState, documentCount = 0): Problem {
  if (state.tab === "ai") {
    /*
      Unit BW3: attached documents count as material.

      This is the old composer's rule, in its own words -- `desk.index.tsx:
      1236-1240` shuts the press only when the text is short AND there is no
      document (`(storyInput.length < 8 && !storyDocuments.length)`). The drawn
      tab's drop zone accepts files and the request carries them as
      `documentIds`, so a press with a document attached and nothing typed is
      the case an editor who uploaded a packet actually performs; before this
      the button stayed disabled and the walk could not press it at all.
    */
    if (!state.sourceText.trim() && !state.links.trim() && documentCount === 0) return "Paste the material or point at it. The AI needs something to read.";
    if (state.assignment.trim().length < 8) return "Say what the story is. That is what the AI works from.";
    return null;
  }
  if (state.tab === "self") {
    if (state.headline.trim().length < 8) return "Headline needs a full sentence.";
    if (state.summary.trim().length < 8) return "Say why this is news.";
    if (state.story.trim().length < 40) return "The story needs some text.";
    // The section is not a nicety here either: the save below writes `topic`,
    // and the database refuses a draft with no section (see `section` above).
    if (!state.section.trim()) return SECTION_REQUIRED;
    return null;
  }
  if (state.pastedStory.trim().length < 40) return "Paste the story text.";
  if (state.pasteMode !== "nothing" && state.originalLink.trim() && !/^https?:\/\//i.test(state.originalLink.trim())) {
    return "The original link has to start with http:// or https://.";
  }
  // Same rule, same words as the review screen's own card check
  // (`cardProblems`, `import-review.ts:283`): asked before the story is filed,
  // because after the press there is nothing to file it under.
  if (!state.section.trim()) return SECTION_REQUIRED;
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
 * The pasted story's text: the paste with the headline line taken off the top
 * when the headline IS that line.
 *
 * Step G of the paste walk (`paste-one-story.ts:87`, the rule the import screen
 * files its one card under): every story pasted this way used to open in the
 * editor with its own headline repeated as the body's first line. Only the case
 * where `pastedHeadline` returned the first line gets the line removed -- when
 * the first line was too short to be a headline the headline is a sentence the
 * desk derived, and taking that line off would drop a paragraph of the story
 * the editor pasted.
 */
export function pastedBody(text: string): string {
  const headline = pastedHeadline(text);
  const first = (text.trim().split(/\r?\n/).find((l) => l.trim()) ?? "").trim().slice(0, 180);
  return first && first === headline ? bodyFromPaste(text) : text;
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
            // Tab (a)'s scope row, sent the way the old composer sent it --
            // `researchScope` is optional on the wire, so this is the same call
            // the desk made before, with the editor's own answer in it.
            researchScope: state.researchScope,
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
    // The editor's own section, on both writes: `fileLead`'s own rule would
    // otherwise file the lead under its "council" default and this save would
    // then move the draft off it (`topic` is written on every save,
    // `draft-edit.server.ts:48`), so the two rows would disagree.
    const topic = state.section.trim().slice(0, 40);
    return {
      steps: [
        { call: "fileLead", input: { headline, why: summary, topic, ...(url ? { url } : {}) } },
        { call: "saveDraft", input: { headline, dek: summary, body: state.story, topic } },
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
  const topic = state.section.trim().slice(0, 40);
  /*
    Unit BW3: every page the pasted story cites, not only its original link.

    The reader sees the DRAFT's `source_urls` (`publishLead`, `desk.ts:3659`),
    and this tab's save writes none of them, so a story pasted with its links in
    the body published with an empty Sources section under a paper that
    promises "Sources shown" -- the same defect the hand-filed lead had
    (`desk.ts:486-493`). The links are the paste's own markdown links, the same
    set `pasteOneStoryCard` keeps (`paste-one-story.ts:171`), capped and
    length-checked against the wire's own limits so one over-long link cannot
    turn the whole save into a parse error.
  */
  const cited = extractLinks(state.pastedStory)
    .map((l) => l.url)
    .filter((u) => u.length <= LIMITS.url)
    .slice(0, LIMITS.importLinks);
  const steps: NewStoryStep[] = [
    {
      call: "fileLead",
      input: {
        headline,
        why: link ? `Pasted in full from ${link}` : "Pasted in full from a story written elsewhere.",
        topic,
        ...(link && /^https?:\/\//i.test(link) ? { url: link } : {}),
        ...(cited.length ? { urls: cited } : {}),
        /*
          Who wrote it. The old one-story paste panel asked this question and
          defaulted to "A person" (`desk.index.tsx:348`, `paste-one-story.ts:49`),
          and the answer is what the reader sees under the story
          (`ai-disclosure.tsx:33`). The drawn tab draws no such control -- see
          the BW3 report -- so it sends the same default the panel sent.
        */
        disclosureKey: PASTE_ONE_DISCLOSURE,
        /*
          And it is an editor's paste, not model prose. The desk's evidence
          gate turns on that one flag (`draft-evidence.ts:36`): unmarked, a
          story pasted here and then corrected could not be published at all
          ("The story changed after its evidence was gathered"), because the
          gate would ask the editor to compare their own words against claims
          nothing extracted. `fileLead` writes it onto `research_json`, the same
          mark the import path writes (`import-stories.server.ts:432`).
        */
        importedText: true,
        /*
          Unit BW5: and it is the import path's story, not the desk's own.

          The Queue draws its Imported chip off this one word
          (`desk-leads.tsx:516`), and the one-story paste panel this tab
          replaces filed through `importFinishedStories`, which wrote
          `origin = 'import'` (`import-stories.server.ts:402`). Filed through
          `fileLead` with no origin, every paste that panel marked Imported
          would arrive unmarked -- the row would still be there and the mark
          the editor reads it by would not. See `PASTE_ONE_ORIGIN`.
        */
        origin: PASTE_ONE_ORIGIN,
      },
    },
    {
      call: "saveDraft",
      input: {
        headline,
        dek: state.creditLine.trim() || link,
        body: pastedBody(state.pastedStory),
        topic,
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
    ...(then.ai
      ? modelPick(then.key === "score" ? "scan" : "story", state.model, state.effort)
      : {}),
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
      `desk.ts`'s addSource: `kindFromSourceUrl`, `tierFromKind`). The reference draws
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
    /*
      Unit CY item 9: the dialog draws an Effort select beside the model, so
      both halves travel together. `modelPick` is the same helper the other
      surfaces use, which means "auto" still sends nothing at all (the server's
      own resolution, `defaultModelEffort`, is what an untouched row means) and
      a pick the row cannot carry is still dropped rather than half-sent.
    */
    run: { paste: state.tip.trim(), ...modelPick("dark", state.model, state.effort) },
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
    /*
      Unchosen, and drawn as a question (`SECTION_REQUIRED`), so a story is
      never filed under a section nobody picked -- the old one-story paste
      panel's rule, kept here because the save cannot happen without one.
    */
    section: "",
    /*
      Public, because that is what the desk does when nobody says otherwise:
      `writeStoryInput.researchScope` is optional and `desk.ts:1588` reads an
      absent one as "public". The dialog opens on the desk's own default rather
      than on a narrower scope the editor never chose.
    */
    researchScope: "public",
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

/**
 * The two fields a caller may already know when it opens the file. Only the
 * question and the starting point: the Limits dial and the model pick are the
 * editor's calls, and a caller that guessed them would be choosing how much
 * money to spend.
 */
export type DarkFilePrefill = { question?: string; tip?: string };

/**
 * Unit BN2, item 4: the state the dialog opens on, seeded with what the caller
 * already knows. A lead row knows its headline and where the story came from,
 * and `darkProblem` wants a starting point of eight characters, so the editor
 * who pressed that row should not have to paste them back in.
 *
 * An absent field is left exactly as `darkFileInitial` leaves it: `undefined`
 * means "the caller did not know this one", not "the editor should see an
 * empty box they must notice is empty". The dialog reseeds from this on every
 * open (`useDialogState`), so one row's prefill never leaks into the next open.
 */
export function darkFileSeed(prefill?: DarkFilePrefill): DarkFileState {
  const seed = darkFileInitial();
  if (prefill?.question !== undefined) seed.question = prefill.question;
  if (prefill?.tip !== undefined) seed.tip = prefill.tip;
  return seed;
}

/**
 * A hypothesis the editor asked for on another screen, seeded into the dialog.
 *
 * `/desk/dark` reads a hand-over out of `sessionStorage` (an import's review
 * screen, a lead's "Send to Dark Desk") and opens the dialog already holding
 * it, so the editor sees the question and the material before a file exists.
 * The whole paste is the tip -- nothing the editor wrote is dropped -- and the
 * first line is the question, which is how the screen's own paste box titled
 * files before this dialog replaced it (`paste.split("\n")[0]`), so a hand-over
 * files the same title it always did.
 */
export function darkFileFromSeed(seed: string): DarkFileState {
  return { ...darkFileInitial(), question: seed.split("\n")[0] ?? "", tip: seed };
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
