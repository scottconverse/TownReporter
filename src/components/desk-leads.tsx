import { useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Chip, DeskMoreMenu, InkButton, Score, type DeskMoreItem } from "@/components/desk-chrome";
import { ActionButton, rowActionPhase } from "@/components/action-button";
import { formatAge, parseUrlList } from "@/lib/paper";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import {
  editorTitle,
  cameBackLabel,
  DEVELOPING_LABEL,
  dupAiReason,
  killedAsDuplicateNote,
  killRecordLine,
  printedDuplicateLine,
  type PrintedDup,
} from "@/lib/news/desk-copy";
import type { LeadRow } from "@/lib/news/types";
import { ModelPicker } from "@/components/model-picker";
import { useFirstRunPickerSeed } from "@/components/first-run-picker-default";
import { modelChoiceLabel, type StoryModelChoice } from "@/lib/news/model-choice";
import { defaultModelEffort, type ModelEffort } from "@/lib/news/provider-registry";
import { Notice } from "@/components/states";

/**
 * Live screenshot, 0.6.1 (2026-09-02): the "seen again ×N" stamp rendered in
 * the muted meta line next to the age and origin text, and the editor
 * scrolled right past it -- it read as bookkeeping, not as something that
 * changed what the lead meant. It is exactly that: the scanner found this
 * story again after a kill, and it did NOT get refiled as a new lead
 * because of it (see findMatchingLead in lib/news/lead-match.ts). That is
 * worth a real badge in the KILLED/PRINTED family on the right side of the
 * row, and a one-line explanation the first time the Killed tab shows one
 * (wired in desk.queue.tsx using this same copy).
 */
export const SEEN_AGAIN_EXPLAINER =
  "Came back: the scanner found this story again after you killed it. It was not refiled. Back returns it to New.";

export function LeadRowView({
  lead,
  sectionName,
  dup,
  onHold,
  onBack,
  onKill,
  onKillAsDuplicate,
  onDelete,
  deleteSelected = false,
  deletePending = false,
  deleteReason = null,
  bulkDeleteReason = null,
  onDeleteSelect,
  onDraft,
  drafting = false,
  draftNotice = null,
  batchSelected = false,
  batchDisabled = false,
  onBatchSelect,
  roomy = false,
  selected = false,
  backPending = false,
  onHoldWithReason,
  onEdit,
  onDarkDesk,
  followUp,
  onKillWithReason,
}: {
  lead: LeadRow;
  /** The newsroom's configured display name for the stored section key. */
  sectionName?: string;
  dup?: PrintedDup | null;
  onHold?: () => void;
  onBack?: () => void;
  onKill?: () => void;
  /**
   * Unit AK item 4: kill this lead as a duplicate of the piece it is flagged
   * against, in one press, recording why. Rejects to say it failed -- the row
   * shows saving/saved/failed in place, because a press that silently does
   * nothing is what this unit was opened about.
   */
  onKillAsDuplicate?: () => Promise<void>;
  /**
   * Remove the lead entirely.
   *
   * Kill is not delete. A killed lead stays under Killed, which is right for
   * "not this one" and wrong for a lead filed against the wrong person or a
   * scan that swept up something private. Confirmed in place, because a
   * two-click delete on a row this small is the whole safety net it needs.
   */
  onDelete?: () => void;
  deleteSelected?: boolean;
  /**
   * Unit UI1a2: this row's own delete, as the shared piece draws it.
   *
   * `Delete` was one of the eight scoped controls with no working / done /
   * failed state: the menu closed, the call went out, and the row said nothing
   * while it was in flight and nothing if it failed (the screen's own
   * `deleteError` line is at the top of the page, not at the menu the editor
   * just pressed). Both facts are the SCREEN's -- the mutation is its -- so
   * they arrive here as props, exactly as `backPending` does for Release/Back.
   */
  deletePending?: boolean;
  /** The desk's own reason the delete failed, printed beside the press. */
  deleteReason?: string | null;
  /** A bulk refusal belongs beside this lead's controls, outside its menu. */
  bulkDeleteReason?: string | null;
  onDeleteSelect?: (selected: boolean) => void;
  /**
   * FB6, item 5: the Release/Bring-back press is in flight.
   *
   * `Release` was the report's clearest SILENT FAIL on this screen (Table B,
   * Queue: "the only row-level way back for Held" -- "nothing" at 100 ms, no
   * success, no error), and `Back` on a killed lead was the same and buried a
   * level deep in the menu. Both are on the row now and both draw this, which
   * the screen owns because the mutation is the screen's.
   */
  backPending?: boolean;
  onDraft?: (modelChoice: StoryModelChoice, modelEffort: ModelEffort | null) => void;
  drafting?: boolean;
  draftNotice?: { kind: "ok" | "err"; text: string } | null;
  batchSelected?: boolean;
  batchDisabled?: boolean;
  onBatchSelect?: (selected: boolean) => void;
  roomy?: boolean;
  /**
   * FB6, item 4: the keyboard cursor is on this row.
   *
   * The Queue's J/K move a `.sel` down the table exactly as Today's do. The
   * state comes in as a prop rather than being read off a lead id inside the
   * row, because the cursor is the SCREEN's (an index into the rows on screen,
   * clamped on every render) and the row has no idea what else is drawn.
   */
  selected?: boolean;
  /**
   * Redesign phase 2a (README "3. Queue": "More ▾ opens the lead menu"), then
   * unit BN's drawn order.
   *
   * Secondary actions, so the row's first line is the two or three presses an
   * editor makes all day. Opt-in: a screen that passes none of these renders
   * exactly the row it rendered before they existed, and every one of them
   * calls a handler the screen owns -- the menu adds no action the desk cannot
   * do.
   *
   * BN2 item 2 replaced the `more?: DeskMoreItem[]` escape hatch with these
   * four named slots, because the drawn menu's order is
   *   Edit · Hold with a reason · Merge with a printed story · Send to Dark
   *   Desk · Start an AI follow-up · Kill with a reason   then Open · Draft
   * with a chosen model · Delete
   * and "Merge with a printed story" belongs *between* two of the rows that
   * array used to hold. A caller-supplied list could not put a row the row
   * itself owns into the middle of itself, and the row owns Merge because only
   * it holds the possible-duplicate match and the three-state duplicate press
   * (`scripts/lead-badge-render.test.mjs` pins that press's markup). `hold`,
   * `dark` and `kill` are still handlers the screen owns: on the Queue they all
   * open a dialog -- or, until phase 2b lands, an immediate status change --
   * which is why none of them is the row's own plain `onHold`/`onKill`.
   */
  onHoldWithReason?: () => void;
  /**
   * "Edit the lead" -- design review note 2 (0.6.80). Drawn first of the six
   * (`MORE_LEAD_ITEMS[0]`), and back in the menu now that something edits a
   * lead (`EditLeadDialog`, `updateLead` in `desk.ts`). Opens a dialog rather
   * than calling a handler directly, the same shape as `onDarkDesk` below --
   * the screen owns the dialog's `open` state, this row only asks for it.
   */
  onEdit?: () => void;
  /** "Send to Dark Desk" -- opens the drawn Dark Desk file. */
  onDarkDesk?: () => void;
  /**
   * "Start an AI follow-up" is a button that owns its own dialog
   * (`AddFollowUpButton`), which a word-and-a-handler pair cannot mount, so it
   * comes in as a node. It is passed rather than imported here so this row's
   * render tests keep their module list: they stub the menu and nothing under
   * `@/components/dialogs`.
   */
  followUp?: ReactNode;
  /** "Kill with a reason" -- the last of the drawn six. */
  onKillWithReason?: () => void;
}) {
  const { formatShortDate } = usePaperDateFormatters();
  const [confirming, setConfirming] = useState(false);
  const [modelChoice, setModelChoice] = useState<StoryModelChoice>("auto");
  const [modelEffort, setModelEffort] = useState<ModelEffort | null>(defaultModelEffort("auto"));
  /*
    F3b: this row's own "Draft with AI" used to open on Automatic and send that
    as an explicit pick, which outranks the paper's stored writing model -- the
    same gap as the desk pages, on the Queue's row. Seeded here too, so one
    fresh install does not get a local default on five screens and Automatic on
    the sixth. The owner's own touch wins, and every other paper is unchanged
    (see first-run-picker-default.ts).
  */
  const modelChoiceTouched = useRef(false);
  useFirstRunPickerSeed({
    surface: "story",
    current: modelChoice,
    touched: () => modelChoiceTouched.current,
    apply: (choice) => {
      setModelChoice(choice);
      setModelEffort(defaultModelEffort(choice));
    },
  });
  /*
   * Unit AK item 4: "Kill as duplicate" says what it is doing. The press used
   * to have no equivalent at all -- the badge said "≈ PRINTED" and there was
   * nothing to press -- so the three states are pinned here rather than left
   * to the row vanishing on the next refetch.
   */
  const [dupKill, setDupKill] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const score = lead.newsworthiness ?? 0;
  const held = lead.status === "held";
  const closed = lead.status === "killed" || lead.status === "published";
  /*
    The evidence cell. The drawing prints the EvidenceMeter's squares and
    "3 opened · 1 could not"; the desk has no per-lead "could not open" figure
    anywhere -- capture_events.fetch_outcome is keyed by investigation and URL,
    and scan_runs counts at run level -- so the failure clause is dropped
    rather than invented. The design's own EvidenceMeter drops it too when
    nothing failed.
  */
  const sources = parseUrlList(lead.source_urls).length;
  /*
    One "More ▾" per row, holding every action this row used to print inline.
    The drawing's actions cell is Start story + More ▾ and nothing else (README
    282-289), and the row's own checkbox is the one selection box. The menu's
    words are the old buttons' words, so the desk's own walks still find them by
    name; they now open the menu first.

    BN2 item 2: the drawn menu's own six rows come first, in the design's order
    (`MORE_LEAD_ITEMS`, `editor-dialog-forms.ts`), then the three the drawing
    gives the row anyway -- Open, the draft control, Delete.

    "Edit the lead" was the sixth drawn row and, until design review note 2
    (0.6.80), was left out here: BN question 3 hid it because nothing in the
    app edited a lead, and a press that only said so would have been a row
    that does nothing. `EditLeadDialog` + `updateLead` (desk.ts) are that
    something now, so it is back, first in the drawing's own order --
    `MORE_LEAD_ITEMS[0]`. It is left off a closed lead (killed or published)
    the same way Hold and Kill are below: `updateLeadForEditor` refuses both
    with a plain sentence, and a control the desk would only refuse is not
    offered.
  */
  const items: DeskMoreItem[] = [];
  if (!closed && onEdit) items.push({ label: "Edit the lead", onSelect: onEdit });
  if (onHoldWithReason) items.push({ label: "Hold with a reason", onSelect: onHoldWithReason });
  /*
    BN2 item 3: the drawn "Merge with a printed story" -- and the one row of the
    drawn six whose press this app already has.

    THE WORDS ARE THE DRAWING'S, THE PRESS IS THE DESK'S. The drawing's row reads
    "Merge with a printed story" over the note "Adds this as an update to
    '<headline>'", and the design wires its button to the `add-to` dialog. This
    app has no press that adds a lead's material to the *printed* story: the
    `add-to` dialog (`AddToStoryDialog`) weaves into the story belonging to the
    lead it is given, and is mounted on that lead's own screen for exactly that
    reason. What the desk does have is the duplicate-resolution press this row
    already carries -- `onKillAsDuplicate`, the Queue's half of the Compare panel
    (`desk.story.$leadId.tsx`'s `killAsDuplicateOfPrior`, same
    `duplicateKillReason(prior.headline)`), whose server path is
    `resolveLeadDuplicate` behind `leadDuplicateResolutionInput`
    (`request-input.ts:960`) via `setLeadStatus`.

    So the row is drawn where the drawing puts it, on the drawing's condition
    ("only when the lead has a possible duplicate"), and its *button* keeps the
    word the press actually does. Calling the press "Merge" would promise the
    editor an update to the printed piece and instead close their lead, which is
    the one thing this menu must not do; the Compare panel already keeps the
    opposite discipline for the same press ("Same story — kill this one"). The
    label below is the drawn row's name -- it is this item's key and its name in
    the list, not a word printed to the editor.

    Unit AK item 4: the three states are pinned here rather than left to the row
    vanishing on the next refetch.
  */
  if (dup && !closed && onKillAsDuplicate) {
    items.push({
      label: "Merge with a printed story",
      content:
        dupKill === "saved" ? (
          <span className="meta dup-kill-note" role="status">
            {killedAsDuplicateNote(dup.headline)}
          </span>
        ) : dupKill === "failed" ? (
          <>
            <span className="meta dup-kill-note" role="status">
              That did not save.
            </span>
            <InkButton
              tone="quiet-danger"
              small
              onClick={() => {
                setDupKill("saving");
                void Promise.resolve(onKillAsDuplicate()).then(
                  () => setDupKill("saved"),
                  () => setDupKill("failed"),
                );
              }}
              ariaLabel={`Try killing ${editorTitle(lead.headline)} as a duplicate again`}
            >
              Try again
            </InkButton>
          </>
        ) : (
          <InkButton
            tone="quiet-danger"
            small
            disabled={dupKill === "saving"}
            onClick={() => {
              setDupKill("saving");
              void Promise.resolve(onKillAsDuplicate()).then(
                () => setDupKill("saved"),
                () => setDupKill("failed"),
              );
            }}
            ariaLabel={`Kill ${editorTitle(lead.headline)} as a duplicate of ${editorTitle(dup.headline)}`}
          >
            {dupKill === "saving" ? "Saving…" : "Kill as duplicate"}
          </InkButton>
        ),
    });
  }
  if (onDarkDesk) items.push({ label: "Send to Dark Desk", onSelect: onDarkDesk });
  if (followUp) items.push({ label: "Start an AI follow-up", content: followUp });
  if (onKillWithReason) {
    items.push({ label: "Kill with a reason", danger: true, onSelect: onKillWithReason });
  }
  items.push({
    label: "Open",
    content: (
      <Link to="/desk/story/$leadId" params={{ leadId: String(lead.id) }} className="more-item">
        Open
      </Link>
    ),
  });
  if (dup) {
    items.push({
      label: "The piece",
      content: (
        <Link to="/articles/$slug" params={{ slug: dup.slug }} className="more-item">
          The piece
        </Link>
      ),
    });
  }
  if ((held || closed) && onBack) items.push({ label: "Back", onSelect: onBack });
  /*
    The row's own plain Hold and Kill. On the Queue neither is passed -- "Hold
    with a reason" and "Kill with a reason" above are that screen's rows, and a
    second pair of words for the same press is what BF3 took out. They stay for
    a screen that has no dialog to open.
  */
  if (!closed && !held && onHold) items.push({ label: "Hold", onSelect: onHold });
  if (!closed && onKill) items.push({ label: "Kill", danger: true, onSelect: onKill });
  if (!closed && onDraft) {
    items.push({
      label: "Draft with a chosen model",
      content: (
        <div className="queue-draft-controls">
          <InkButton
            small
            disabled={drafting}
            onClick={() => onDraft(modelChoice, modelEffort)}
            ariaLabel={`${lead.status === "drafted" ? "Redraft" : "Draft"} ${editorTitle(lead.headline)} with ${modelChoiceLabel(modelChoice)}`}
          >
            {drafting ? "Queuing…" : lead.status === "drafted" ? "Redraft with AI" : "Draft with AI"}
          </InkButton>
          <details>
            <summary className="meta">Model: {modelChoiceLabel(modelChoice)} · change</summary>
            <ModelPicker
              value={modelChoice}
              onChange={(choice) => {
                modelChoiceTouched.current = true;
                setModelChoice(choice);
                setModelEffort(defaultModelEffort(choice));
              }}
              effort={modelEffort}
              onEffortChange={setModelEffort}
              disabled={drafting}
              compact
            />
          </details>
        </div>
      ),
    });
  }
  /*
    Delete is not Kill: a killed lead stays under Killed, which is right for
    "not this one" and wrong for a lead filed against the wrong person. It
    still asks once, in the menu, and still says the copy is kept for 30 days.
    Last, as the drawing draws it.
  */
  if (onDelete) {
    if (confirming) {
      items.push({
        label: "delete-warning",
        content: (
          <p className="del-warn">
            Deletes this lead and any draft on it.
            {lead.status === "published"
              ? " The printed story stays on the paper — remove that under Published."
              : ""}
          </p>
        ),
      });
      /*
        Unit UI1a2. The confirm press is the one that does the work, so it is
        the one that carries the states: "Deleting…" with a spinner and the
        button disabled while the call is out, and the desk's own reason in red
        beside it if the delete is refused. Its DONE is the ROW leaving the
        list, which the list's own removal and the Undo on the done toast
        already say -- there is no second green "Deleted" competing with them.
      */
      items.push({
        label: "Yes, delete",
        danger: true,
        content: (
          <ActionButton
            tone="danger"
            small
            phase={rowActionPhase({ isPending: deletePending, problem: deleteReason })}
            workingLabel="Deleting…"
            reason={deleteReason}
            /*
              Unit UI1a3, finding 2: the confirmation STAYS ARMED until the
              press has settled. Clearing `confirming` here replaced the only
              `ActionButton` that consumes `deletePending` and `deleteReason`
              with the initial "Delete" button in the same paint as the click --
              so on a slow request the editor never saw "Deleting." and on a
              refused one never saw the reason. The row's own departure on
              success is what unmounts this; a failure leaves it armed and
              pressable, exactly as the source-removal path already does.
            */
            onAct={() => onDelete()}
          >
            Yes, delete
          </ActionButton>
        ),
      });
      items.push({
        label: "Keep",
        keepOpen: true,
        content: (
          <ActionButton
            tone="quiet"
            small
            phase="idle"
            disabled={deletePending}
            disabledReason={deletePending ? "The delete is still being saved." : null}
            onAct={() => setConfirming(false)}
          >
            Keep
          </ActionButton>
        ),
      });
    } else {
      items.push({
        label: "Delete",
        danger: true,
        keepOpen: true,
        content: (
          <ActionButton
            tone="danger"
            small
            phase="idle"
            onAct={() => setConfirming(true)}
          >
            Delete
          </ActionButton>
        ),
      });
    }
  }
  return (
    <div
      /*
        Unit BY: the drawing tints the row that is picked for the bulk bar --
        `Desk Screens.dc.html:284` builds `rowStyle` with
        `+ (selected ? "background:var(--panel)" : "")`. The desk drew no
        picked state at all, so the tick in the first column was the row's only
        sign it was in the bulk bar's set (BF4 parked this). The state is the
        one selection box's own `deleteSelected`; `.lead-row.picked` is
        desk-astra.css.
      */
      className={
        "lead-row" +
        (lead.status === "killed" ? " dead" : "") +
        (roomy ? " roomy" : "") +
        (deleteSelected ? " picked" : "") +
        (selected ? " sel" : "")
      }
    >
      {/*
        The row's one selection box (defect 1): the design's checkbox in the
        first column. The old "Select for deletion" and "Include in batch
        draft" boxes were a second and third way to select the same row; the
        bulk bar above the table is what they feed, and both of its presses
        take this box's state.

        BF4, defect 2 / UI1b-9: the drawing draws the box SMALL inside the
        column -- a 24px square with a 2px edge (`Desk Screens.dc.html`), filled
        ink with a background-colored tick when the lead is picked. The desk
        drew a 44px native box that filled the whole track, which read as a
        button, not a tick. The 44px *press area* is this label, so a press
        anywhere in it toggles the input; the 24px drawn mark is the INPUT
        itself (an outline at rest, a fill when picked, never a filled square at
        rest -- the designer's ruling on PR 173) and `.queue-box` is only the
        tick glyph over it. See `.queue-check` in desk-astra.css.
      */}
      {onDeleteSelect ? (
        <label className="queue-check">
          <input
            type="checkbox"
            className="queue-pick"
            checked={deleteSelected}
            aria-label={`Select ${editorTitle(lead.headline)} for deletion`}
            onChange={(event) => onDeleteSelect(event.target.checked)}
          />
          <span className="queue-box" aria-hidden="true">
            {deleteSelected ? "✓" : null}
          </span>
        </label>
      ) : (
        <span className="queue-pick" aria-hidden="true" />
      )}
      <Score v={score} />
      <div className="lead-cell">
        <div className="lead-chips">
          {/* Unit BF3: the chip line is DRAWN status-first (NEW / HELD /
              ≈ PRINTED / Seen again, then the section). The markup keeps the
              section span first, because `scripts/lead-badge-render.test.mjs`
              pins that order ("meta line should render before the lead-flags
              rail") -- the drawn order is put on with `order` in
              `desk-astra.css` instead of by moving this node. */}
          <span className="meta">{sectionName ?? lead.topic}</span>
          <LeadFlags lead={lead} dup={dup} />
        </div>
        {/* UI1b-3: the row's list title. A heading, because that is the plain
            form the design system allows a link to take (README section 6) --
            an underlined link floating on its own is still a control with no
            edge. Same shape as the today-card's `<h3 className="today-card-hl">`
            link on Today. */}
        <h3 className="hl-head">
          <Link to="/desk/story/$leadId" params={{ leadId: String(lead.id) }} className="hl-link">
            {editorTitle(lead.headline)}
          </Link>
        </h3>
        {/*
          BF4, defect 1: the Queue row is chips + headline, as drawn. The "why"
          summary line the desk printed under the headline is not in the
          drawing's row, and it is what made every row ~113px against the
          drawing's ~75. It stays reachable -- the lead page prints it as
          `.side-why` (desk.story.$leadId.tsx), which is where the row's own
          "More ▾ → Open" goes -- so the reason the lead was filed is one press
          away rather than gone. A row that is not `roomy` still draws it: the
          prop is opt-in and only the Queue's table passes it.
        */}
        {roomy ? null : <p className="lead-why">{lead.why}</p>}
        {onBatchSelect ? (
          <label className="meta">
            <input
              type="checkbox"
              checked={batchSelected}
              disabled={batchDisabled}
              aria-label={`Include ${editorTitle(lead.headline)} in the batch draft`}
              onChange={(event) => onBatchSelect(event.target.checked)}
            />{" "}
            Include in batch draft
          </label>
        ) : null}
        {lead.possible_duplicate_of ? (
          <p className="meta dup-context">
            {lead.status === "held"
              ? lead.dup_kind === "developing"
                ? `${DEVELOPING_LABEL} — `
                : "Held for review — "
              : ""}
            {lead.possible_duplicate ? (
              <>
                {lead.dup_kind === "developing" ? "new facts against " : "possible duplicate of "}
                <Link
                  to="/desk/story/$leadId"
                  params={{ leadId: String(lead.possible_duplicate.id) }}
                  className="inline-link"
                >
                  {editorTitle(lead.possible_duplicate.headline)}
                </Link>{" "}
                · {lead.possible_duplicate.status}
                {/*
                  Unit AK item 2: the old kill reason travels with the finding,
                  so the editor judging "is this new?" reads what the desk
                  killed the first time without opening the other lead.
                */}
                {lead.dup_kind === "developing" &&
                (lead.possible_duplicate.killed_at || lead.possible_duplicate.kill_reason) ? (
                  <> · {killRecordLine({
                    killedAt: lead.possible_duplicate.killed_at,
                    reason: lead.possible_duplicate.kill_reason,
                  })}</>
                ) : null}
              </>
            ) : "the earlier lead is unavailable; compare it only if it is restored."}
          </p>
        ) : null}
        {draftNotice ? <Notice kind={draftNotice.kind}>{draftNotice.text}</Notice> : null}
        {dup ? (
          <p className="meta dup-match">
            matches:{" "}
            <Link to="/articles/$slug" params={{ slug: dup.slug }} className="inline-link">
              {editorTitle(dup.headline)}
            </Link>{" "}
            · published {formatShortDate(dup.publishedAt)}
          </p>
        ) : null}
      </div>
      <span className="queue-evidence">
        <span className="ev-squares" aria-hidden="true">
          {Array.from({ length: Math.min(sources, 10) }, (_, i) => (
            <i key={i} />
          ))}
        </span>
        <b>{sources} opened</b>
      </span>
      <span className="queue-filed">{formatAge(lead.created_at)}</span>
      <div className="lead-actions row-acts queue-acts">
        {/*
          FB6, item 5: the way back belongs ON THE ROW.

          A killed lead's only way back was "More ▾ → Back" -- one level deep,
          in a menu, with "nothing" at 100 ms, no success and no error sentence
          (FB0-Report Table B, Queue, "More ▾ Back (killed rows)": NO UNDO +
          SILENT FAIL); the row's own action cell rendered `null` for it, so the
          cell an editor's eye goes to was empty. It is "Bring back" beside the
          row now, and the menu item stays where it was.

          Published keeps the empty cell: a printed story is taken down from
          Published, not from here, and a "Bring back" on it would promise
          something this press does not do.
        */}
        {lead.status === "killed" ? (
          onBack ? (
            <InkButton tone="quiet" small pending={backPending} pendingLabel="Bringing it back…" onClick={onBack}>
              Bring back
            </InkButton>
          ) : null
        ) : held ? (
          onBack ? (
            <InkButton tone="quiet" small pending={backPending} pendingLabel="Releasing…" onClick={onBack}>
              Release
            </InkButton>
          ) : null
        ) : closed ? null : (
          <Link
            to="/desk/story/$leadId"
            params={{ leadId: String(lead.id) }}
            className="btn solid small"
          >
            Start story
          </Link>
        )}
        <DeskMoreMenu ariaLabel={`More actions for ${editorTitle(lead.headline)}`} items={items} />
        {bulkDeleteReason ? <p className="action-reason" role="alert">{bulkDeleteReason}</p> : null}
      </div>
    </div>
  );
}

/**
 * The right-hand column of a lead row: its status, and every warning the desk
 * has about it.
 *
 * Extracted in phase 2a, when Today grew the drawn compact row (`.today-lead`,
 * grid `52px | 1fr | auto`) and needed the same badges the Queue row shows.
 * Two screens printing the same lead is exactly how one of them ends up
 * saying something the other does not, so neither owns this: both render it.
 */
export function LeadFlags({ lead, dup }: { lead: LeadRow; dup?: PrintedDup | null }) {
  const { formatShortDate } = usePaperDateFormatters();
  return (
    <div className="lead-flags">
      <Chip s={lead.status} />
      {/*
        The scan's section list is what the model files under, and when its
        reply named none of them the desk wrote a fallback key
        (`schema.ts`) with nothing on the row to say so. An editor saw a
        section the machine guessed, in the same type as one it chose.
      */}
      {lead.topic_unchosen ? (
        <span
          className="chip topic-unchosen"
          title="The scan filed this lead under a section the model did not choose. Open the story and confirm the section it belongs in."
        >
          Section not chosen — pick one
        </span>
      ) : null}
      {lead.origin === "import" ? (
        <span className="chip imported" title="Read out of a report you pasted, not written by the desk.">
          Imported
        </span>
      ) : null}
      {dup ? (
        /*
          Unit AK item 4: "≈ PRINTED" named nothing and went nowhere. The
          badge now says what it means and links the piece it means, which is
          the whole of the complaint that opened this unit.
        */
        <Link
          to="/articles/$slug"
          params={{ slug: dup.slug }}
          className="chip dup"
          title={`Covers ground published ${formatShortDate(dup.publishedAt)}. Open the piece, or kill this lead as a duplicate.`}
        >
          {printedDuplicateLine(dup.headline, dup.aiWhy)}
        </Link>
      ) : null}
      {lead.resurfaced_count && lead.resurfaced_count > 0 ? (
        /*
          Unit AK item 7: the same count, in words. A killed lead that came
          back says "Came back 3 times" instead of "seen again ×3".
        */
        <span className="chip seen-again">
          {cameBackLabel(lead.resurfaced_count)}
          {lead.last_resurfaced_at ? ` · ${formatShortDate(lead.last_resurfaced_at)}` : ""}
        </span>
      ) : null}
      {lead.possible_duplicate ? (
        /*
          Unit AK item 5: this opens THIS lead's page, where both sides of the
          pair are loaded and the Compare view renders -- the old chip opened
          the other lead, whose page knew nothing about the pair and said so
          by saying nothing at all.

          U28: the link only exists at all when the desk's own duplicate check
          either was not asked or agreed -- a "no" clears `possible_duplicate_of`
          before the row is written (lead-filing.ts), so there is no chip to
          gate here. What this does carry is the model's sentence, which is the
          difference between "the desk thinks these might be the same" and
          "the desk asked, and here is why".
        */
        <Link
          to="/desk/story/$leadId"
          params={{ leadId: String(lead.id) }}
          className="chip maybe-same"
          title={
            lead.dup_kind === "developing"
              ? `This story came back with facts the killed lead "${lead.possible_duplicate.headline}" did not have. Open it to compare.`
              : `Possible duplicate of ${lead.possible_duplicate.headline} (${lead.possible_duplicate.status}). Open it to compare.${
                  lead.dup_ai_same === true && dupAiReason(lead.dup_ai_why)
                    ? ` AI: ${dupAiReason(lead.dup_ai_why)}`
                    : ""
                }`
          }
        >
          {lead.dup_kind === "developing" ? "New facts · compare" : "Possible duplicate · compare"}
        </Link>
      ) : lead.possible_duplicate_of ? (
        <span className="chip maybe-same" title="The earlier lead is unavailable.">
          Possible duplicate · unavailable
        </span>
      ) : null}
    </div>
  );
}
