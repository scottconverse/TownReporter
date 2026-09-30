/**
 * Binds ⌘S / Ctrl+S to a save, and draws nothing.
 *
 * It exists as a component rather than as a bare `useSaveShortcut()` call for
 * one reason: the story workbenches return early while they are loading
 * (`if (isPending) return <WorkbenchSkeleton/>`), so a hook call has to sit
 * above those returns — where none of the state that decides whether saving is
 * allowed has been computed yet. Rendering this beside the "Save edits" button
 * puts the binding inside that button's own condition, so the key and the
 * button can never disagree about when saving is allowed, and the hook lives in
 * a component whose whole body is the hook.
 *
 * `enabled` is therefore the caller's `disabled` expression, and it is passed
 * even when the element is only rendered while enabled: `save.isPending` and a
 * running evidence check change while the button stays on screen.
 */
import { useSaveShortcut } from "@/components/desk-action";

export function SaveShortcut({
  save,
  enabled = true,
}: {
  save: () => void;
  enabled?: boolean;
}) {
  useSaveShortcut(save, enabled);
  return null;
}
