/**
 * The editor's new dialogs, as the screens import them.
 *
 *   import { NewStoryButton, AddLeadButton } from "@/components/dialogs";
 *
 * Every dialog is exported as the dialog (`NewStoryDialog`, takes `open` and
 * `onClose` and lets the screen keep its own control) and as a button that
 * mounts it (`NewStoryButton`, for a screen that just wants the control). Which
 * screen mounts which one, and with what props, is in the unit's report.
 *
 * NOT FOR `node --test`. This file reaches `editor-dialogs.tsx`, and the test
 * runner (`node --experimental-strip-types`) loads `.ts` and not `.tsx`; the
 * suites import `editor-dialog-forms.ts` and `editor-dialog-bodies.ts`
 * directly, which is the split that keeps every drawn dialog testable without a
 * browser. Importing this barrel from a `.ts` test would break that.
 */
export {
  AddLeadButton,
  AddLeadDialog,
  AddSourcesButton,
  AddSourcesDialog,
  AddToStoryButton,
  AddToStoryDialog,
  DarkFileButton,
  DarkFileDialog,
  HeadlineButton,
  HeadlineDialog,
  HoldLeadButton,
  HoldLeadDialog,
  MoreLeadButton,
  MoreLeadDialog,
  NewStoryButton,
  NewStoryDialog,
  SourceKillPattern,
  SourceKillPatternButton,
} from "./editor-dialogs";

export type {
  AddLeadDialogProps,
  AddSourcesDialogProps,
  AddToStoryDialogProps,
  DarkFileDialogProps,
  HeadlineDialogProps,
  HoldLeadDialogProps,
  MoreLeadDialogProps,
  NewStoryDialogProps,
  SourceKillPatternProps,
  TriggerProps,
} from "./editor-dialogs";
