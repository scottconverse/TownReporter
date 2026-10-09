# Dark Desk: built app vs. design

- **Compared:** build `881cbfe8` (0.6.82), captured 2026-10-02, against this package's design.
- **Image:** `screens/built-app-2026-10-02/dark-desk-1440-light-design-vs-build.jpg`, with the design on the left and the build on the right.

Fix in this order.

## 0. Remove the dollar limits (visible, copy)

The Start-a-file pop-up reads "2 hours or $3" and "8 hours or $15". Those dollar figures came from the designer's v3 drawing. The owner never set them, nothing stores or enforces a dollar budget, and the product uses subscription and local models, which have no per-run cost.

**Fix:** remove the dollar part of the text. The levels read:
- Quick look · up to 10 records, 20 minutes
- Standard · up to 30 records, 2 hours
- Deep · up to 100 records, 8 hours

Update `src/components/dialogs/dark-file.test.ts` (lines 60–61) to match. The stored limit (`investigations.budget`, in hops) is unchanged.

## 0b. One model picker on the open file (visible)

The open file needs the shared `ModelPicker` (`scope="dark"`, with `onEffortChange`) above the Scope · Depth · Limit strip, so the editor can change the model for Keep digging and Challenge the case without leaving the file. `dark.ts` already remembers which model dug a file, so pass that in as the value. Don't build a new control: reuse the component that `dark-dials-panel.tsx` and `page-watch-panel.tsx` already use.

## 1. Opens on "No file open" (visible)

The built page shows "No file open" even when there are 7 open files.

**Fix:** on load, open the most recently touched file (`rememberOpen` already tracks the last-opened row). Show the empty state only when no files exist.

## 2. The rail has no cap (visible)

The build lists 7 open files, 5 signals and 3 set-aside files in full. Each row has its own More button, and the file area stays empty beside a long column.

**Fix:** at most 5 rows per group, then a **Show all N** link. Keep one action per row (open the file). Move the per-row More into the open file's header.

## 3. The rail is in the wrong order, and a group may be missing (visible)

**Fix:** use this order: Open files → Signals to review → **Waiting on an AI follow-up** → Set aside. "Waiting on an AI follow-up" must exist even when empty; hide it only if the editor has never started an AI follow-up.

## 4. Set aside shows full investigation text (minor)

**Fix:** show one line, the title plus "Set aside Sep 24". The full text appears when the file is opened.

## 5. Settings are not behind a Settings button (visible)

The build shows a "How hard to dig" disclosure (`dark-dials-panel.tsx`) inline.

**Fix:** add a quiet **Settings** button in the header that opens the panel described in the spec, with two sections: How hard to dig and Watched pages.

## 6. Timestamps (minor)

**Fix:** where any Dark Desk row or log shows an ISO time or date, write it in paper style: "7:02 a.m.", "Sept. 26".

## 7. Decide buttons (check)

Confirm that the five Decide actions exist with these labels and styles:
- **Start an AI follow-up:** Primary. It links to Follow-ups today; it should open the New AI follow-up pop-up with the file's question filled in.
- **Keep investigating:** Secondary.
- **Wait and watch:** Secondary.
- **Send to the queue:** Secondary.
- **Close: no finding:** Quiet.

The build currently marks "Send to the queue" as ghost (`onQueue`). Make it Secondary, because it is a real action.

## Matches the design

- The open file's question, activity log and case file structure.
- "Nothing here prints."
- The Start-a-file pop-up fields.
- "Next 10" paging inside the record reader.

## Captures still needed from the build

- A file **while it runs** (live log and job card).
- A **stalled** run and a **failed** run.
- The page with **no files**.
- Phone width (390px) with a file open.
