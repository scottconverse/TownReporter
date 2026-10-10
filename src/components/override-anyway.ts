import { createElement, type ReactNode } from "react";

/**
 * The one warn-then-override press (audit override items).
 *
 * A warnable limit answers the first call with
 * `{ ok: false, warning: { key, sentence } }`. This draws that sentence beside
 * a "<action> anyway" button; pressing it calls the SAME action again carrying
 * `override: [key]`. Pure props, no hooks -- and built with `createElement`
 * rather than JSX so `node --test` can render it with `renderToStaticMarkup`
 * and read both the sentence and the button's word.
 *
 * Some limits (a judgment with no readable capture, audit item 14) also require
 * the editor's own note before the override is accepted. `noteRequired` draws
 * that field and holds the button back until it is filled.
 */
export function OverrideAnyway({
  warning,
  actionWord,
  busy = false,
  noteRequired = false,
  note = "",
  noteLabel = "Your note",
  notePlaceholder,
  onNoteChange,
  onOverride,
}: {
  warning: { key: string; sentence: string };
  /** The action's own word; the button reads "<actionWord> anyway". */
  actionWord: string;
  busy?: boolean;
  noteRequired?: boolean;
  note?: string;
  noteLabel?: string;
  notePlaceholder?: string;
  onNoteChange?: (value: string) => void;
  onOverride: () => void;
}): ReactNode {
  const noteId = `override-note-${warning.key}`;
  const ready = !busy && (!noteRequired || Boolean(note.trim()));
  return createElement(
    "div",
    { className: "mt-3 border border-rule bg-paper-2 p-4", role: "alert" },
    createElement("p", { key: "sentence", className: "text-sm text-ink" }, warning.sentence),
    noteRequired
      ? [
          createElement(
            "label",
            {
              key: "note-label",
              className: "mt-3 block text-sm font-medium text-ink",
              htmlFor: noteId,
            },
            noteLabel,
          ),
          createElement("textarea", {
            key: "note",
            id: noteId,
            className: "mt-1 min-h-20 w-full border border-rule bg-paper p-3 text-sm",
            value: note,
            placeholder: notePlaceholder,
            disabled: busy,
            onChange: (event: { target: { value: string } }) => onNoteChange?.(event.target.value),
          }),
        ]
      : null,
    createElement(
      "div",
      { key: "press", className: "mt-3" },
      createElement(
        "button",
        { type: "button", className: "btn", disabled: !ready, onClick: onOverride },
        busy ? "Working…" : `${actionWord} anyway`,
      ),
    ),
  );
}
