import { saveShortcutLabel } from "../lib/save-shortcut-label.ts";
import { Dialog } from "./dialog";
const SHORTCUTS: { keys: string; what: string; note?: string }[] = [
  { keys: "J / K", what: "Next / previous lead" },
  /*
    F22 of the 2026-11-19 walk: S asks before it spends the writing model, and X
    leaves an Undo strip behind. The sheet says both, so the keys are not
    described as more or less than they are.

    The extra words live in their own `note` rather than inside `what`: the
    sentence each key keeps is the sentence it has always shown, and the note is
    drawn after it ("Start a story from the selected lead (asks first)").
  */
  { keys: "S", what: "Start a story from the selected lead", note: "asks first" },
  { keys: "H", what: "Hold the selected lead" },
  { keys: "X", what: "Kill the selected lead", note: "Undo offered" },
  { keys: "U", what: "Put the selected lead back to new" },
  { keys: "Enter", what: "Open the selected lead" },
  { keys: "N", what: "Start a new story" },
  { keys: "save", what: "Save in the story workbench" },
  { keys: "?", what: "This list" },
  { keys: "Esc", what: "Close this list or the phone menu" },
];

export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      subtitle="Keys are ignored while you are typing in a box."
      primaryLabel="Got it"
      onPrimary={onClose}
      cancelLabel="Close"
    >
      <dl className="astra-keys">
        {SHORTCUTS.map((s) => (
          <div key={s.keys}>
            <dt>
              <kbd>
                {s.keys === "save"
                  ? saveShortcutLabel(typeof navigator === "undefined" ? "" : navigator.platform)
                  : s.keys}
              </kbd>
            </dt>
            <dd>
              {s.what}
              {s.note ? ` (${s.note})` : null}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
