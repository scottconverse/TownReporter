import { Dialog } from "@/components/dialog";
import { InkButton } from "@/components/desk-chrome";

/**
 * "More for this story", drawn as `dialog-13-more-published.png`.
 *
 * Unit BH2 decision 4. One row per action, and a row with no handler is not
 * drawn at all -- the menu is a list of what this build can actually do, not a
 * list of what the design drew. Two of the drawing's five rows have nothing
 * behind them today:
 *
 *   - "Edit the story" opens the workbench. `desk.published.tsx` has no such
 *     press and no route to it from here; the only headline edit on that page is
 *     `updateArticleHeadline` behind "Edit headline". The story page is at
 *     `/desk/story/$leadId`, which the row would need a lead id for.
 *   - "Add an update" ("new information at the top, marked with the time") does
 *     not exist anywhere in the codebase. A grep for `addUpdate` and for
 *     "add an update" across `src/` finds this file and nothing else.
 *
 * So both are hidden until a lane wires them, which is why every row is a prop.
 * Unit BH2 leaves `desk.published.tsx` alone (another worker owns it); this
 * component and its mount point are named in the report instead.
 *
 * The "Unpublish" row's note is the drawing's "Back to Drafts; recoverable."
 * with one correction: the press that exists (`deleteArticle`) snapshots the
 * story into the recoverable trash and removes it from the paper. It does not
 * put the story back in Drafts, and the note now says what it does.
 */

export type PublishedMoreMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The story's headline, shown under the title. */
  headline: string;
  /** e.g. "printed Sep 25". Left off when the page does not know it. */
  printedLabel?: string;
  /** Opens the story in the workbench. Hidden when absent. */
  onEditStory?: () => void;
  /** Opens the correction dialog. */
  onAddCorrection?: () => void;
  /** Hides when absent -- there is no "add an update" path yet. */
  onAddUpdate?: () => void;
  /** Takes the story off the paper, keeping a recoverable copy. */
  onUnpublish?: () => void;
  /** Owner-only. Opens the legal removal dialog. */
  onLegalRemoval?: () => void;
};

export function PublishedMoreMenu({
  open,
  onOpenChange,
  headline,
  printedLabel,
  onEditStory,
  onAddCorrection,
  onAddUpdate,
  onUnpublish,
  onLegalRemoval,
}: PublishedMoreMenuProps) {
  const rows: {
    key: string;
    label: string;
    note: string;
    act: string;
    /**
     * The drawing paints the legal row -- its rule and its name -- in
     * `--danger` and leaves its press the same ink outline as the four rows
     * above it. That split is kept: the row is marked, the control is not, so
     * the row reads as the dangerous one without putting a red fill in a list
     * of five buttons.
     */
    danger?: boolean;
    run: () => void;
  }[] = [];
  if (onEditStory)
    rows.push({
      key: "edit",
      label: "Edit the story",
      note: 'Opens it in the workbench. Saving republishes with an "Updated" time.',
      act: "Edit",
      run: onEditStory,
    });
  if (onAddCorrection)
    rows.push({
      key: "correction",
      label: "Add a correction",
      note: "Posted on the story and in the public corrections log",
      act: "Correct",
      run: onAddCorrection,
    });
  if (onAddUpdate)
    rows.push({
      key: "update",
      label: "Add an update",
      note: "New information at the top, marked with the time",
      act: "Update",
      run: onAddUpdate,
    });
  if (onUnpublish)
    rows.push({
      key: "unpublish",
      label: "Unpublish",
      note: "Off the paper, with a recoverable copy kept in the trash.",
      act: "Unpublish",
      run: onUnpublish,
    });
  if (onLegalRemoval)
    rows.push({
      key: "legal",
      label: "Legal removal…",
      note: "Skips the trash. Requires a reason and shows the remaining cleanup.",
      act: "Start",
      danger: true,
      run: onLegalRemoval,
    });

  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      title="More for this story"
      subtitle={printedLabel ? `${headline} · ${printedLabel}` : headline}
      cancelLabel="Cancel"
      primaryLabel="Done"
      primaryTone="solid"
      onPrimary={() => onOpenChange(false)}
    >
      <div className="astra-menu">
        {rows.map((row) => (
          <div className={"astra-menu-row" + (row.danger ? " is-danger" : "")} key={row.key}>
            <span className="astra-menu-what">
              <b>{row.label}</b>
              <span className="astra-menu-note">{row.note}</span>
            </span>
            <InkButton
              tone="ghost"
              onClick={() => {
                // The menu closes first: whatever the row opens is a dialog of
                // its own, and two Radix dialogs open at once means two focus
                // traps arguing over the same page.
                onOpenChange(false);
                row.run();
              }}
            >
              {row.act}
            </InkButton>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
