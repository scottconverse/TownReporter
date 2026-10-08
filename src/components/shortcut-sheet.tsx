import { saveShortcutLabel } from "../lib/save-shortcut-label.ts";
import { Dialog } from "./dialog";
const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: "J / K", what: "Next / previous lead" },
  { keys: "S", what: "Start a story from the selected lead" },
  { keys: "H", what: "Hold the selected lead" },
  { keys: "X", what: "Kill the selected lead" },
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
            <dd>{s.what}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
