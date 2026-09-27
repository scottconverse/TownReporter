/**
 * What each dialog looks like from the inside (Unit BK).
 *
 * Plain `createElement`, no JSX, and deliberately not importing `dialog.tsx`:
 * `node --experimental-strip-types` cannot load a `.tsx` file, and the only way
 * to render one of these in `node --test` is `renderToStaticMarkup` on a
 * module it can actually load. The `.tsx` shell (`editor-dialogs.tsx`) imports
 * both this file and `dialog.tsx` and puts them together; that is the only
 * place the phase-0 component is named (see `ChoiceRender`).
 *
 * The markup is the reference's, class for class: every class below is one of
 * the `.desk-ltr.astra-modal-layer .astra-*` rules in `src/styles.css`
 * (lines 2160-2498), which were converted from the reference's inline styles in
 * phase 0's wake. Nothing here invents a class, and nothing here sets a size:
 * the two things the audit scripts measure (the 14px informational floor and
 * WCAG AA contrast) are properties of those rules, so a dialog that only
 * chooses classes cannot miss either one on its own.
 *
 * The copy is the reference's too, from the `views` table in
 * `docs/design/handoff-2026-09-26/design/Desk Dialogs.dc.html` -- labels,
 * placeholders, the "optional" hints, button words. Where this file had to
 * choose (see the notes on each dialog) the choice is named in a comment.
 */
import { createElement, Fragment, type ReactNode } from "react";

import {
  ADD_TO_MODES,
  DARK_LIMITS,
  FIND_SOURCE_SCOPES,
  previewSplit,
  type SourcePreview,
} from "../../lib/news/editor-dialog-logic.ts";
import { HOLD_CHOICES } from "../../lib/news/kill-reasons.ts";
import {
  ADD_LEAD_THENS,
  MORE_LEAD_ITEMS,
  NEW_STORY_TABS,
  PASTE_MODES,
  SOURCE_TABS,
  type AddLeadState,
  type AddSourcesState,
  type AddToState,
  type DarkFileState,
  type HeadlineState,
  type HoldState,
  type NewStoryState,
} from "./editor-dialog-forms.ts";

/* ------------------------------------------------------------- the choices -- */

/**
 * The phase-0 `ChoiceCard`, passed in rather than imported.
 *
 * `ChoiceCard` lives in `dialog.tsx`, which is a `.tsx` file, which node's
 * type stripping cannot load -- so a `.ts` body that imported it could not be
 * rendered in a test at all. The shell passes the real one, so what the editor
 * gets IS the phase-0 component (same element, same `role="radio"`, same
 * `aria-checked`, same `.astra-choice-card` classes); a test passes a stub of
 * the same shape. The alternative was hand-rolling a second choice card here,
 * which is exactly the drift the brief's "use the phase 0 ChoiceCard" forbids.
 */
export type ChoiceRender = (props: {
  label: ReactNode;
  note?: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
}) => ReactNode;

/**
 * The effort options, in the order the reference lists them.
 *
 * Only meaningful with a named model: "Automatic" means the desk's own
 * resolution decides the effort too, and the row says so rather than showing a
 * second control whose value would be thrown away.
 */
const EFFORT_OPTIONS = ["low", "medium", "high", "xhigh", "max"] as const;

/* ----------------------------------------------------------------- pieces -- */

function tabs(
  items: readonly { key: string; label: string }[],
  active: string,
  onPick: (key: string) => void,
): ReactNode {
  return createElement(
    "div",
    { className: "astra-tabs", role: "tablist" },
    ...items.map((t) =>
      createElement(
        "button",
        {
          key: t.key,
          type: "button",
          role: "tab",
          "aria-selected": t.key === active,
          className: "astra-tab" + (t.key === active ? " on" : ""),
          onClick: () => onPick(t.key),
        },
        t.label,
      ),
    ),
  );
}

function field(
  label: string,
  hint: string,
  control: ReactNode,
  key: string,
): ReactNode {
  return createElement(
    "label",
    { className: "astra-field", key },
    createElement(
      "span",
      { className: "astra-field-label" },
      label,
      hint ? createElement("span", { className: "astra-field-hint" }, " ", hint) : null,
    ),
    control,
  );
}

function textarea(
  value: string,
  placeholder: string,
  onChange: (v: string) => void,
  height: 60 | 70 | 80 | 90 | 100 | 120 | 180,
  extra?: Record<string, unknown>,
): ReactNode {
  return createElement("textarea", {
    className: `astra-input h${height}`,
    placeholder,
    value,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    ...extra,
  });
}

function line(
  value: string,
  placeholder: string,
  onChange: (v: string) => void,
  extra?: Record<string, unknown>,
): ReactNode {
  return createElement("input", {
    className: "astra-input",
    type: "text",
    placeholder,
    value,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    ...extra,
  });
}

function choiceSet(
  label: string,
  items: readonly { key: string; label: string; note?: string }[],
  selected: string,
  onSelect: (key: string) => void,
  Choice: ChoiceRender,
): ReactNode {
  return createElement(
    "div",
    { className: "astra-choices" },
    createElement("span", { className: "astra-choices-label" }, label),
    createElement(
      "div",
      { className: "astra-choices", role: "radiogroup", "aria-label": label },
      ...items.map((c) =>
        createElement(Choice, {
          key: c.key,
          label: c.label,
          note: c.note || undefined,
          selected: c.key === selected,
          onSelect: () => onSelect(c.key),
        }),
      ),
    ),
  );
}

/**
 * The model row.
 *
 * The select carries every choice the desk already offers for this surface
 * (`modelChoicesFor`), not the four the reference happened to draw: the
 * assignment page and this row must agree on the vocabulary, or the pick lands
 * somewhere the server cannot resolve.
 */
function modelRow(
  rows: readonly { value: string; label: string }[],
  value: string,
  effort: string | null,
  onValue: (v: string) => void,
  onEffort: (v: string) => void,
  showEffort = true,
): ReactNode {
  const auto = !value || value === "auto";
  return createElement(
    "div",
    { className: "astra-model-row" },
    createElement("span", { className: "astra-model-row-label" }, "Model"),
    createElement(
      "select",
      {
        className: "astra-input",
        value: auto ? "auto" : value,
        "aria-label": "Model",
        onChange: (e: { target: { value: string } }) => onValue(e.target.value),
      },
      ...rows.map((r) => createElement("option", { key: r.value, value: r.value }, r.label)),
    ),
    /*
      The Dark Desk run takes a model and no effort (`darkRunInput`), so that
      dialog's row is drawn without the second select rather than with one whose
      value is thrown away.
    */
    showEffort
      ? createElement("span", { className: "astra-model-row-label" }, "Effort")
      : null,
    showEffort
      ? createElement(
          "select",
          {
            className: "astra-input",
            value: effort ?? "high",
            "aria-label": "Effort",
            disabled: auto,
            title: auto ? "Automatic sets the effort too" : undefined,
            onChange: (e: { target: { value: string } }) => onEffort(e.target.value),
          },
          ...EFFORT_OPTIONS.map((v) => createElement("option", { key: v, value: v }, v)),
        )
      : null,
    createElement(
      "span",
      { className: "astra-model-row-note" },
      auto ? "Automatic, per job in Server → Models" : "Set per job in Server → Models",
    ),
  );
}

/**
 * The drawn drop zone.
 *
 * `onFiles` is what makes it a control rather than a picture: the reference
 * draws the zone, and a file input with no handler is the one thing on this
 * screen that would look finished and do nothing. Dropping is wired too, on the
 * same path as choosing, because the zone says "Drop documents here".
 */
function dropZone(
  title: string,
  note: string,
  hint: string,
  onFiles?: (files: File[]) => void,
): ReactNode {
  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length) onFiles?.(files);
  };
  return createElement(
    "div",
    {
      className: "astra-drop",
      onDragOver: (e: { preventDefault: () => void }) => e.preventDefault(),
      onDrop: (e: { preventDefault: () => void; dataTransfer: { files: FileList } }) => {
        e.preventDefault();
        if (onFiles) take(e.dataTransfer.files);
      },
    },
    createElement("span", { className: "astra-drop-title" }, title),
    createElement("span", { className: "astra-drop-note" }, note),
    createElement(
      "label",
      { className: "astra-drop-file" },
      hint,
      createElement("input", {
        type: "file",
        multiple: true,
        style: { display: "none" },
        "aria-label": hint,
        onChange: (e: { target: { files: FileList | null; value: string } }) => {
          take(e.target.files);
          /* The same input again must fire again: a cancelled pick leaves the
             value set, and re-picking the same file then never fires. */
          e.target.value = "";
        },
      }),
    ),
  );
}

/** The source preview table: the count, the split, then one row per line. */
export function sourcePreviewTable(preview: SourcePreview): ReactNode {
  /*
    The tick marks the row that WILL BE ADDED, which is the drawing's own
    reading: `Desk Dialogs.dc.html` fills the 22px box and tints its label
    `--ink2` for the five rows it is about to add, and leaves the box empty and
    the label `--warn` for the one it already watches, labelled "Already
    watched". The stylesheet's `.on` is that filled state, so new rows carry it
    and watched rows carry nothing -- the earlier build had the two swapped.
  */
  return createElement(
    "div",
    { className: "astra-preview" },
    createElement(
      "div",
      { className: "astra-preview-head" },
      createElement("span", null, `Preview · ${preview.found} found`),
      createElement("span", { className: "astra-preview-count" }, previewSplit(preview)),
    ),
    ...preview.rows.map((r, i) =>
      createElement(
        "div",
        { className: "astra-preview-row", key: `${r.url}-${i}` },
        createElement(
          "span",
          {
            className: "astra-preview-mark" + (r.isNew ? " on" : ""),
            "aria-hidden": "true",
          },
          r.isNew ? "✓" : "",
        ),
        createElement("span", { className: "astra-preview-url" }, r.url),
        createElement(
          "span",
          { className: "astra-preview-kind" + (r.isNew ? " on" : "") },
          r.isNew ? r.kind : "Already watched",
        ),
      ),
    ),
  );
}

/** The one place a dialog says what went wrong, or what happened. */
export function message(text: string | null, tone: "warn" | "ok" | "danger" = "warn"): ReactNode {
  if (!text) return null;
  return createElement(
    "p",
    { className: `astra-msg ${tone}`, role: tone === "ok" ? "status" : "alert" },
    text,
  );
}

function fields(children: ReactNode[]): ReactNode {
  return createElement("div", { className: "astra-fields" }, ...children);
}

/* ---------------------------------------------------------------- new story -- */

export type NewStoryBodyProps = {
  state: NewStoryState;
  set: (patch: Partial<NewStoryState>) => void;
  problem: string | null;
  note: string | null;
  models: readonly { value: string; label: string }[];
  /** The drop zone on tab (a): documents the drafter reads. */
  onFiles?: (files: File[]) => void;
  Choice: ChoiceRender;
};

export function NewStoryBody(p: NewStoryBodyProps): ReactNode {
  const s = p.state;
  const set = p.set;
  const parts: ReactNode[] = [
    tabs(NEW_STORY_TABS, s.tab, (key) => set({ tab: key as NewStoryState["tab"] })),
  ];

  if (s.tab === "ai") {
    parts.push(
      createElement(
        "div",
        { key: "body" },
        dropZone(
          "Drop documents here",
          "PDF, Word, text, images (OCR), subtitles · up to 20 files, 100 MB each",
          "Choose files",
          p.onFiles,
        ),
        fields([
          field("Links", "optional", textarea(s.links, "https://… one per line (web pages, PDFs, YouTube)", (v) => set({ links: v }), 70), "links"),
          field("Source text", "optional", textarea(s.sourceText, "Paste long material here", (v) => set({ sourceText: v }), 90), "text"),
          field("Assignment", "", textarea(s.assignment, "What's the story? Angle, what to find out, what to ignore", (v) => set({ assignment: v }), 80), "assignment"),
        ]),
        modelRow(p.models, s.model, s.effort, (v) => set({ model: v }), (v) => set({ effort: v })),
      ),
    );
  } else if (s.tab === "self") {
    parts.push(
      createElement(
        "div",
        { key: "body" },
        fields([
          field("Headline", "", line(s.headline, "Your headline", (v) => set({ headline: v })), "headline"),
          field("Summary", "", textarea(s.summary, "One or two sentences", (v) => set({ summary: v }), 60), "summary"),
          field("Story", "", textarea(s.story, "Write here…", (v) => set({ story: v }), 180), "story"),
          field("Sources", "optional", textarea(s.sources, "Links to the records you used, one per line", (v) => set({ sources: v }), 60), "sources"),
        ]),
      ),
    );
  } else {
    parts.push(
      createElement(
        "div",
        { key: "body" },
        fields([
          field("Original link", "", line(s.originalLink, "Where it was first published", (v) => set({ originalLink: v })), "link"),
          field("Credit line", "", line(s.creditLine, "e.g. Reprinted with permission from…", (v) => set({ creditLine: v })), "credit"),
          field("Story text", "", textarea(s.pastedStory, "Paste the full story", (v) => set({ pastedStory: v }), 180), "paste"),
        ]),
        choiceSet(
          "What should the AI do?",
          PASTE_MODES,
          s.pasteMode,
          (key) => set({ pasteMode: key as NewStoryState["pasteMode"] }),
          p.Choice,
        ),
        s.pasteMode === "nothing"
          ? null
          : modelRow(p.models, s.model, s.effort, (v) => set({ model: v }), (v) => set({ effort: v })),
      ),
    );
  }

  parts.push(message(p.problem, "warn"), message(p.note, "ok"));
  return createElement(Fragment, null, ...parts);
}

/* ----------------------------------------------------------------- add lead -- */

export type AddLeadBodyProps = {
  state: AddLeadState;
  set: (patch: Partial<AddLeadState>) => void;
  problem: string | null;
  note: string | null;
  Choice: ChoiceRender;
};

/**
 * NO MODEL ROW HERE, and that is the drawing.
 *
 * `Desk Dialogs.dc.html`'s add-lead view is Link or tip, Why it might matter and
 * Then -- three controls and no picker -- and the reference's own "Add a lead"
 * rows are the same three. Adding a picker the design does not draw would be
 * this build inventing a control; where the editor has not chosen, the phase-5
 * order starts at `model_assignments` on the server, which is the rule for
 * every job in the desk. `AddLeadState.model`/`effort` survive because
 * `addLeadRequest` still drops them when they are "auto" -- so a future screen
 * that DOES draw the row can pass one without touching this body.
 */
export function AddLeadBody(p: AddLeadBodyProps): ReactNode {
  const s = p.state;
  const set = p.set;
  return createElement(
    Fragment,
    null,
    fields([
      field("Link or tip", "", textarea(s.paste, "Paste a URL, or describe what you heard", (v) => set({ paste: v }), 90), "paste"),
      field("Why it might matter", "optional", line(s.why, "Optional note for the AI", (v) => set({ why: v })), "why"),
    ]),
    choiceSet("Then", ADD_LEAD_THENS, s.then, (key) => set({ then: key as AddLeadState["then"] }), p.Choice),
    message(p.problem, "warn"),
    message(p.note, "ok"),
  );
}

/* -------------------------------------------------------------- add sources -- */

export type AddSourcesBodyProps = {
  state: AddSourcesState;
  set: (patch: Partial<AddSourcesState>) => void;
  problem: string | null;
  note: string | null;
  /** The parsed rows for the list/file tabs; the desk's own watcher list is the input. */
  preview: SourcePreview | null;
  models: readonly { value: string; label: string }[];
  /** The upload tab's drop zone: the file is read into lines by the shell. */
  onFiles?: (files: File[]) => void;
  Choice: ChoiceRender;
};

export function AddSourcesBody(p: AddSourcesBodyProps): ReactNode {
  const s = p.state;
  const set = p.set;
  const parts: ReactNode[] = [
    tabs(SOURCE_TABS, s.tab, (key) => set({ tab: key as AddSourcesState["tab"] })),
  ];

  if (s.tab === "one") {
    parts.push(
      fields([
        field("Link", "", line(s.url, "https://…", (v) => set({ url: v })), "url"),
        field("Name", "", line(s.name, "What to call it", (v) => set({ name: v })), "name"),
        field("What to watch for", "optional", line(s.watchFor, "e.g. new agendas, budget items", (v) => set({ watchFor: v })), "watch"),
      ]),
      /*
        The reference draws one choice here ("Every daily scan") with a note.
        It is rendered as one selected ChoiceCard rather than a checked radio,
        because a set of one is what the desk's choice component already is and
        the phase-0 control carries the selected state in `aria-checked`.
      */
      choiceSet(
        "Check it",
        [{ key: "daily", label: "Every daily scan", note: "The desk checks sources once a day at scan time" }],
        "daily",
        () => {},
        p.Choice,
      ),
    );
  } else if (s.tab === "list") {
    parts.push(
      fields([
        field("Links", "", textarea(s.text, "Paste URLs, one per line. Names optional after a comma.", (v) => set({ text: v }), 120), "links"),
      ]),
      p.preview ? sourcePreviewTable(p.preview) : null,
    );
  } else if (s.tab === "file") {
    parts.push(
      dropZone(
        "Drop a CSV, OPML or sitemap",
        "CSV columns: url, name, frequency (optional) · OPML from any RSS reader",
        "Choose a file",
        p.onFiles,
      ),
      s.fileName
        ? createElement("p", { className: "astra-msg ok", role: "status" }, `Read ${s.fileName}.`)
        : null,
      p.preview ? sourcePreviewTable(p.preview) : null,
    );
  } else {
    parts.push(
      fields([
        field("What should the paper cover?", "", textarea(s.topic, "e.g. Longmont water, St. Vrain schools, Boulder County commissioners", (v) => set({ topic: v }), 80), "topic"),
      ]),
      choiceSet(
        "Search",
        FIND_SOURCE_SCOPES.map((sc) => ({ key: sc.key, label: sc.label })),
        s.scope,
        (key) => set({ scope: key }),
        p.Choice,
      ),
      modelRow(p.models, s.model, s.effort, (v) => set({ model: v }), (v) => set({ effort: v })),
    );
  }

  parts.push(message(p.problem, "warn"), message(p.note, "ok"));
  return createElement(Fragment, null, ...parts);
}

/* -------------------------------------------------------------- add to story -- */

export type AddToBodyProps = {
  state: AddToState;
  set: (patch: Partial<AddToState>) => void;
  problem: string | null;
  note: string | null;
  /** What the review press returned, if it has run. */
  review: { before: string; after: string } | null;
  documentNames: string[];
  /** The drop zone: documents are uploaded and attached to the story. */
  onFiles?: (files: File[]) => void;
  Choice: ChoiceRender;
};

/**
 * NO MODEL ROW HERE EITHER. The reference's add-to view is the drop zone, the
 * material and How -- "the AI weaves it in" carries its model in the note, not
 * in a picker, and the two no-AI modes could not use one. The weaving call
 * resolves through `model_assignments` on the server, like every other job.
 */
export function AddToBody(p: AddToBodyProps): ReactNode {
  const s = p.state;
  const set = p.set;
  const parts: ReactNode[] = [
    dropZone("Drop new documents", "They're added to this story's records", "Choose files", p.onFiles),
  ];
  if (p.documentNames.length) {
    parts.push(
      createElement(
        "p",
        { className: "astra-msg ok", role: "status" },
        `Attached: ${p.documentNames.join(", ")}`,
      ),
    );
  }
  parts.push(
    fields([
      field("New material", "", textarea(s.material, "Paste text, a link, or your own paragraph", (v) => set({ material: v }), 100), "material"),
    ]),
    choiceSet("How", ADD_TO_MODES, s.mode, (key) => set({ mode: key as AddToState["mode"] }), p.Choice),
  );
  if (p.review) {
    parts.push(
      createElement(
        "div",
        { className: "astra-compare" },
        createElement(
          "div",
          { className: "astra-compare-col" },
          createElement("span", { className: "astra-compare-head" }, "Now"),
          createElement("span", { className: "astra-compare-para" }, p.review.before || "(empty)"),
        ),
        createElement(
          "div",
          { className: "astra-compare-col" },
          createElement("span", { className: "astra-compare-head" }, "After your change"),
          createElement("span", { className: "astra-compare-para add" }, p.review.after),
        ),
      ),
      createElement(
        "span",
        { className: "astra-compare-foot" },
        "Yellow: added or changed. Nothing is saved until you press Add again.",
      ),
    );
  }
  parts.push(message(p.problem, "warn"), message(p.note, "ok"));
  return createElement(Fragment, null, ...parts);
}

/* -------------------------------------------------------------- dark desk -- */

export type DarkFileBodyProps = {
  state: DarkFileState;
  set: (patch: Partial<DarkFileState>) => void;
  problem: string | null;
  note: string | null;
  models: readonly { value: string; label: string }[];
  Choice: ChoiceRender;
};

export function DarkFileBody(p: DarkFileBodyProps): ReactNode {
  const s = p.state;
  const set = p.set;
  return createElement(
    Fragment,
    null,
    fields([
      field("The question", "", textarea(s.question, "What are you trying to find out?", (v) => set({ question: v }), 60), "question"),
      field("The tip or starting point", "", textarea(s.tip, "Link, document, post or what you heard", (v) => set({ tip: v }), 60), "tip"),
      field("The ordinary explanation", "rule it out first", textarea(s.explanation, "What would make this a non-story?", (v) => set({ explanation: v }), 60), "explanation"),
    ]),
    choiceSet(
      "Limits",
      DARK_LIMITS.map((l) => ({ key: l.key, label: l.label })),
      s.limit,
      (key) => set({ limit: key }),
      p.Choice,
    ),
    modelRow(p.models, s.model, s.effort, (v) => set({ model: v }), (v) => set({ effort: v }), false),
    message(p.problem, "warn"),
    message(p.note, "ok"),
  );
}

/* --------------------------------------------------------------------- hold -- */

export type HoldBodyProps = {
  state: HoldState;
  set: (patch: Partial<HoldState>) => void;
  problem: string | null;
  note: string | null;
  Choice: ChoiceRender;
};

export function HoldBody(p: HoldBodyProps): ReactNode {
  const s = p.state;
  const set = p.set;
  /*
    The note comes first and the reasons second, which is the drawn order: the
    reference's hold entry lists `fields` (Note) separately from `choiceLabel`
    and renders the fields above the choices -- the same split the kill entry
    uses in the other direction with `fields2`. `dialog-08-hold.png` shows it.
  */
  return createElement(
    Fragment,
    null,
    fields([field("Note", "optional", line(s.note, "Optional", (v) => set({ note: v })), "note")]),
    choiceSet(
      "Why (optional)",
      HOLD_CHOICES.map((c) => ({ key: c.key, label: c.label, note: c.note })),
      s.choice,
      (key) => set({ choice: key }),
      p.Choice,
    ),
    message(p.problem, "warn"),
    message(p.note, "ok"),
  );
}

/* ----------------------------------------------------------------- headline -- */

export type HeadlineBodyProps = {
  state: HeadlineState;
  set: (patch: Partial<HeadlineState>) => void;
  problem: string | null;
  note: string | null;
  /**
   * The rows for "Suggest 3 more", which now carries the pick
   * (`headlineSuggestRequest`). The reference draws this row on the headline
   * view, so unlike Add-a-lead and Add-to-story there is one here -- and unlike
   * them it is a control the press actually reads.
   */
  models: readonly { value: string; label: string }[];
  Choice: ChoiceRender;
};

export function HeadlineBody(p: HeadlineBodyProps): ReactNode {
  const s = p.state;
  const set = p.set;
  /*
    Every suggestion carries the same note. The drawing gives each row its own
    ("leads with the conflict", "shorter, reader-first", "leads with the service
    info") because its three rows are the design's own mock text and the
    designer could read them; `suggestHeadlines` returns bare strings with no
    angle attached, so a per-row angle here would be the dialog inventing a
    claim about text it has not analysed. The first row used to hardcode
    "leads with the conflict" -- a false note whenever the model's first
    suggestion led with something else.
  */
  const items = [
    { key: "keep", label: `Keep mine: ${s.current}`, note: "Your current headline" },
    ...s.suggestions.map((text) => ({ key: text, label: text, note: "Suggested" })),
  ];
  return createElement(
    Fragment,
    null,
    s.suggestions.length
      ? choiceSet("Choose one", items, s.choice, (key) => {
          set({ choice: key, written: "" });
        }, p.Choice)
      : createElement(
          "p",
          { className: "astra-msg", role: "status" },
          "No suggestions yet. Press Suggest 3 more.",
        ),
    fields([
      field("Or write a new one", "", line(s.written, "Type a headline here; it replaces the choice above", (v) => set({ written: v })), "written"),
    ]),
    p.models.length
      ? modelRow(p.models, s.model, s.effort, (v) => set({ model: v }), (v) => set({ effort: v }))
      : null,
    message(p.problem, "warn"),
    message(p.note, "ok"),
  );
}

/* ------------------------------------------------------------ More ▾ (lead) -- */

/**
 * The More menu's rows. Not a dialog: the reference draws it as a list inside
 * a dialog shell with a single "Done" button, and this is the list.
 */
export function MoreLeadMenu(props: {
  onAction: (action: (typeof MORE_LEAD_ITEMS)[number]["action"]) => void;
}): ReactNode {
  return createElement(
    "div",
    { className: "astra-items" },
    ...MORE_LEAD_ITEMS.map((it) =>
      createElement(
        "button",
        {
          key: it.action,
          type: "button",
          className: "astra-item" + (it.danger ? " danger" : ""),
          onClick: () => props.onAction(it.action),
        },
        createElement(
          "span",
          { className: "astra-item-text" },
          createElement("span", { className: "astra-item-label" }, it.label),
          it.note ? createElement("span", { className: "astra-item-note" }, it.note) : null,
        ),
        createElement("span", { className: "astra-item-cta" }, it.button),
      ),
    ),
  );
}

/* ------------------------------------------------------------ kill pattern -- */

export type SourceKillPatternBodyProps = {
  loading: boolean;
  error: string | null;
  result: {
    source: { id: number; url: string; name: string };
    badSource: number;
    killedFromSource: number;
    /**
     * A kill for a bad source or an unreadable page, newest first.
     *
     * `reason` is optional because `performSourceKillPattern` answers
     * `{id, headline}`: the count is of kills whose reason is one of the
     * bad-source reasons (`kill-reasons.ts`), and the row prints the headline
     * and whatever reason the row has, if it has one.
     */
    examples: readonly { id: number; headline: string; reason?: string | null }[];
  } | null;
  line: string;
  onClose: () => void;
};

/**
 * The kill pattern under a source row. READ-ONLY: it shows the count and the
 * examples and offers no control that changes a weight, a score or a source --
 * the brief's "show the pattern only", and there is no write in the server
 * function behind it either.
 */
export function SourceKillPatternBody(p: SourceKillPatternBodyProps): ReactNode {
  if (p.loading) {
    return createElement("p", { className: "astra-msg", role: "status" }, "Reading the kill record…");
  }
  if (p.error) return message(p.error, "danger");
  if (!p.result) return null;
  const parts: ReactNode[] = [
    createElement("p", { className: "astra-msg", role: "status" }, p.line),
  ];
  if (p.result.examples.length) {
    parts.push(
      createElement(
        "div",
        { className: "astra-items" },
        ...p.result.examples.map((ex) =>
          createElement(
            "div",
            { className: "astra-item", key: ex.id },
            createElement(
              "span",
              { className: "astra-item-text" },
              createElement("span", { className: "astra-item-label" }, ex.headline),
              ex.reason ? createElement("span", { className: "astra-item-note" }, ex.reason) : null,
            ),
          ),
        ),
      ),
    );
  }
  return createElement(Fragment, null, ...parts);
}
