import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Chip, DeskMoreMenu, InkButton, Score, type DeskMoreItem } from "@/components/desk-chrome";
import { formatAge, parseUrlList } from "@/lib/paper";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import {
  cameBackLabel,
  DEVELOPING_LABEL,
  killedAsDuplicateNote,
  killRecordLine,
  printedDuplicateLine,
  type PrintedDup,
} from "@/lib/news/desk-copy";
import type { LeadRow } from "@/lib/news/types";
import { ModelPicker } from "@/components/model-picker";
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
  dup,
  onHold,
  onBack,
  onKill,
  onKillAsDuplicate,
  onDelete,
  deleteSelected = false,
  onDeleteSelect,
  onDraft,
  drafting = false,
  draftNotice = null,
  batchSelected = false,
  batchDisabled = false,
  onBatchSelect,
  roomy = false,
  more,
}: {
  lead: LeadRow;
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
  onDeleteSelect?: (selected: boolean) => void;
  onDraft?: (modelChoice: StoryModelChoice, modelEffort: ModelEffort | null) => void;
  drafting?: boolean;
  draftNotice?: { kind: "ok" | "err"; text: string } | null;
  batchSelected?: boolean;
  batchDisabled?: boolean;
  onBatchSelect?: (selected: boolean) => void;
  roomy?: boolean;
  /**
   * Redesign phase 2a (README "3. Queue": "More ▾ opens the lead menu").
   *
   * Secondary actions, so the row's first line is the two or three presses an
   * editor makes all day. Opt-in: a screen that passes nothing renders exactly
   * the row it rendered before this prop existed, and every item here calls a
   * handler the row's visible buttons already call -- the menu adds no action
   * the desk cannot do.
   *
   * Unit BN widened this from `{label, onSelect}` to the menu's own
   * `DeskMoreItem`: the drawn lead menu's "Start an AI follow-up" is a button
   * that owns its own dialog (`AddFollowUpButton`), which a word-and-a-handler
   * pair cannot mount. Widening is additive -- every existing caller passes
   * exactly the two fields it passed before.
   */
  more?: DeskMoreItem[];
}) {
  const { formatShortDate } = usePaperDateFormatters();
  const [confirming, setConfirming] = useState(false);
  const [modelChoice, setModelChoice] = useState<StoryModelChoice>("auto");
  const [modelEffort, setModelEffort] = useState<ModelEffort | null>(defaultModelEffort("auto"));
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
    One "More ▾" per row, holding every action this row used to print inline:
    Open, The piece, Hold, Back, Kill, Kill as duplicate, Delete and the draft
    control. The drawing's actions cell is Start story + More ▾ and nothing
    else (README 282-289), and the row's own checkbox is the one selection box.
    The menu's words are the old buttons' words, so the desk's own walks still
    find them by name; they now open the menu first.
  */
  const items: DeskMoreItem[] = [
    {
      label: "Open",
      content: (
        <Link to="/desk/story/$leadId" params={{ leadId: String(lead.id) }} className="more-item">
          Open
        </Link>
      ),
    },
  ];
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
  if (!closed && !held && onHold) items.push({ label: "Hold", onSelect: onHold });
  if ((held || closed) && onBack) items.push({ label: "Back", onSelect: onBack });
  if (!closed && onKill) items.push({ label: "Kill", danger: true, onSelect: onKill });
  /*
    Unit AK item 4: "Kill as duplicate" says what it is doing. The three states
    are pinned here rather than left to the row vanishing on the next refetch.
  */
  if (dup && !closed && onKillAsDuplicate) {
    items.push({
      label: "Kill as duplicate",
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
              ariaLabel={`Try killing ${lead.headline} as a duplicate again`}
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
            ariaLabel={`Kill ${lead.headline} as a duplicate of ${dup.headline}`}
          >
            {dupKill === "saving" ? "Saving…" : "Kill as duplicate"}
          </InkButton>
        ),
    });
  }
  /*
    Delete is not Kill: a killed lead stays under Killed, which is right for
    "not this one" and wrong for a lead filed against the wrong person. It
    still asks once, in the menu, and still says the copy is kept for 30 days.
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
      items.push({
        label: "Yes, delete",
        danger: true,
        onSelect: () => {
          setConfirming(false);
          onDelete();
        },
      });
      items.push({ label: "Keep", keepOpen: true, onSelect: () => setConfirming(false) });
    } else {
      items.push({
        label: "Delete",
        danger: true,
        keepOpen: true,
        onSelect: () => setConfirming(true),
      });
    }
  }
  if (!closed && onDraft) {
    items.push({
      label: "Draft with a chosen model",
      content: (
        <div className="queue-draft-controls">
          <InkButton
            small
            disabled={drafting}
            onClick={() => onDraft(modelChoice, modelEffort)}
            ariaLabel={`${lead.status === "drafted" ? "Redraft" : "Draft"} ${lead.headline} with ${modelChoiceLabel(modelChoice)}`}
          >
            {drafting ? "Queuing…" : lead.status === "drafted" ? "Redraft with AI" : "Draft with AI"}
          </InkButton>
          <details>
            <summary className="meta">Model: {modelChoiceLabel(modelChoice)} · change</summary>
            <ModelPicker
              value={modelChoice}
              onChange={(choice) => {
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
  if (more) items.push(...more);
  return (
    <div
      className={"lead-row" + (lead.status === "killed" ? " dead" : "") + (roomy ? " roomy" : "")}
    >
      {/*
        The row's one selection box (defect 1): the design's checkbox in the
        first column. The old "Select for deletion" and "Include in batch
        draft" boxes were a second and third way to select the same row; the
        bulk bar above the table is what they feed, and both of its presses
        take this box's state.

        BF4, defect 2: the drawing draws the box SMALL inside the column -- a
        24px square with a 2px edge, filled ink with a background-colored tick
        when the lead is picked (`Desk Screens.dc.html`). The desk drew a 44px
        native box that filled the whole track, which read as a button, not a
        tick. The 44px *press area* is kept by making this element the label
        around the input, so a press anywhere in the box toggles it; the drawn
        square is `.queue-box` inside it. See `.queue-check` in desk-astra.css.
      */}
      {onDeleteSelect ? (
        <label className="queue-check">
          <input
            type="checkbox"
            className="queue-pick"
            checked={deleteSelected}
            aria-label={`Select ${lead.headline} for deletion`}
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
          <span className="meta">{lead.topic}</span>
          <LeadFlags lead={lead} dup={dup} />
        </div>
        <Link to="/desk/story/$leadId" params={{ leadId: String(lead.id) }} className="hl-link">
          {lead.headline}
        </Link>
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
              aria-label={`Include ${lead.headline} in the batch draft`}
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
                  {lead.possible_duplicate.headline}
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
              {dup.headline}
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
        {closed ? null : held ? (
          onBack ? (
            <InkButton tone="quiet" small onClick={onBack}>
              Release
            </InkButton>
          ) : null
        ) : (
          <Link
            to="/desk/story/$leadId"
            params={{ leadId: String(lead.id) }}
            className="btn solid small"
          >
            Start story
          </Link>
        )}
        <DeskMoreMenu ariaLabel={`More actions for ${lead.headline}`} items={items} />
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
          {printedDuplicateLine(dup.headline)}
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
        */
        <Link
          to="/desk/story/$leadId"
          params={{ leadId: String(lead.id) }}
          className="chip maybe-same"
          title={
            lead.dup_kind === "developing"
              ? `This story came back with facts the killed lead "${lead.possible_duplicate.headline}" did not have. Open it to compare.`
              : `Possible duplicate of ${lead.possible_duplicate.headline} (${lead.possible_duplicate.status}). Open it to compare.`
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
