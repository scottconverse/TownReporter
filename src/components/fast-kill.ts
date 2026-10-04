/**
 * The fast kill — one press on the row, and the reason one tap later.
 *
 * Owner, 2026-10-03: "killing a lead takes about half a dozen clicks … after
 * twenty leads I often skipped the reason." The drawn kill was More ▾ → "Kill
 * with a reason" → a dialog → a quick fill or typed sentence → "Kill with this
 * reason": four presses and a dialog for the press an editor makes twenty times
 * a sitting, and the reason was the part that got dropped, which is the part the
 * record needs.
 *
 * So the kill is ONE press on the row itself (`desk-leads.tsx`, the drawn
 * LeadRow's own inline Start story / Hold / Kill cell) and the reason is offered
 * AFTERWARDS, as the chips in `KILL_REASON_CHIPS`. Nothing about the reason is
 * required, which is the whole point: a press that demands a reason before it
 * will kill is the press the editor was skipping.
 *
 * WHY THE CHIPS ARE IN THE TOAST AND NOT ON THE ROW. A killed lead leaves the
 * Open tab — `openLeads` (`desk-copy.ts`) drops it, and the optimistic patch
 * (`desk-lead-status.ts`) takes its row out of the cached Open page in the same
 * paint as the press. A row that has left the screen cannot be the place a
 * follow-up press lands. The toast that reports the kill is the one surface
 * still on screen, still attached to that lead, and it is where the desk already
 * keeps the Undo for the same press ("the same pattern the Held Release + Undo
 * uses on the Queue").
 *
 * WHY THE PRESSES ARE VALUES AND NOT JUST HANDLERS. `killPress` and
 * `killUndoPress` are the two writes as DATA, so the round trip they drive can
 * be asserted against the real optimistic rule with no browser and no React tree
 * (`fast-kill.test.ts`). `killReasonPress` is the chip's press for the same
 * reason: the sentence that goes on the lead is read out of `KILL_REASON_CHIPS`
 * (its one owner) and handed to the screen's own mutation, so a chip cannot
 * write a reason the dialog would not also have written, and cannot quietly
 * write nothing.
 */
import { createElement, useState, type MouseEvent, type ReactNode } from "react";
import { KILL_REASON_CHIPS, killReasonChip, type KillReasonChip } from "../lib/news/kill-reasons.ts";

/**
 * The statuses a kill's Undo may put a lead back to: everywhere a lead can be
 * when an editor kills it.
 *
 * `drafted` is here and nowhere else in the kill path. A lead the desk drafted
 * is still on the Queue's Open tab and can be killed from its own row; before
 * this the Undo turned such a lead back into a fresh `new` one, orphaned from
 * the draft already written for it. It is not a status any press SETS -- the
 * desk's drafting pass writes it -- so it is reachable only as an Undo, and the
 * server checks both that (`restoreKilledLead`, `desk.ts`).
 */
export type RestoreStatus = "new" | "held" | "drafted";

/** The kill, as the write the screen's status mutation takes. */
export type KillPress = { id: number; status: "killed"; restore: RestoreStatus };

/** The way back, as the same shape. */
export type KillUndoPress = { id: number; status: RestoreStatus };

/**
 * Where a lead of this status goes when a kill of it is undone.
 *
 * The one rule, in one place: `drafted` is the lead's own answer, a held lead
 * goes back on hold, and everything else -- a `new` lead, and a status no row
 * press can produce -- goes back to `new`, which is where the Undo has always
 * put a killed lead. Spelled as a function rather than read off the row at Undo
 * time because the row is KILLED by then: the answer has to be taken when the
 * Kill is pressed and carried on the press.
 */
export function restoreStatus(status: string | null | undefined): RestoreStatus {
  return status === "drafted" ? "drafted" : status === "held" ? "held" : "new";
}

/**
 * The kill press: the lead's status, where it goes back to, and nothing else.
 *
 * No reason, no dialog, no second press. The reason is a separate, optional
 * write (see `killReasonPress`) because the editor's complaint was that the
 * reason stood between them and a kill.
 */
export function killPress(id: number, restore: RestoreStatus = "new"): KillPress {
  return { id, status: "killed", restore };
}

/**
 * The press that takes a kill back.
 *
 * `restore` is the status the lead held before the kill, read from the row at
 * the moment of the press (`restoreStatus`). `new` is the default because that
 * is where the desk's Undo has always put a killed lead, and the caller that
 * does not know better than that should get the old behaviour rather than a
 * guess. Named here rather than spelled inline so the round trip has one
 * spelling and one test.
 */
export function killUndoPress(id: number, restore: RestoreStatus = "new"): KillUndoPress {
  return { id, status: restore };
}

/**
 * The chip's write: the same kill, carrying the reason.
 *
 * `data` rather than a bare object because that is the shape the desk's server
 * function is called with (`setLeadStatus({ data })`, `desk.ts`), which is what
 * makes the press testable as a value.
 */
export type KillReasonRequest = {
  data: { id: number; status: "killed"; killReason: string };
};

/** The write a chip makes, for a lead and a chip. */
export function killReasonRequest(leadId: number, chip: KillReasonChip): KillReasonRequest {
  return { data: { id: leadId, status: "killed", killReason: chip.reason } };
}

/**
 * One tap on a chip: turn its key into the write and send it.
 *
 * Returns the request it sent, or `null` for a key the desk does not have --
 * a chip whose key no longer exists must not become a kill with no reason,
 * which is what an empty write would look like on the record.
 */
export function killReasonPress(
  leadId: number,
  chipKey: string,
  save: (request: KillReasonRequest) => void,
): KillReasonRequest | null {
  const chip = killReasonChip(chipKey);
  if (!chip) return null;
  const request = killReasonRequest(leadId, chip);
  save(request);
  return request;
}

/** What the toast says once a reason is kept. */
export function killReasonKept(chip: KillReasonChip): string {
  return `Reason kept: ${chip.label}.`;
}

/**
 * How long the kill toast lives, in milliseconds.
 *
 * Longer than `DESK_TOAST_OK_MS` (5s) because this is the one toast that asks a
 * question: the editor has to read it, decide whether to say why, and reach for
 * a chip. It is not longer than the error life (12s) plus a little, because the
 * chips are an offer and not a form — a toast that outstays its welcome is a
 * toast that covers the next row. Undo stays on it for the whole life.
 */
export const KILL_TOAST_MS = 15_000;

/** The lead-in above the chips. Says a reason is optional, in words. */
export const KILL_CHIPS_ASK = "Say why, if you want to:";

/**
 * The one-tap reason chips, drawn on the kill toast under its sentence.
 *
 * Stateless apart from which chip was taken: once one is, the row of chips is
 * replaced by the sentence that says so, in the toast that reported the kill.
 * That is deliberate on two counts — the six chips stop inviting a second
 * answer to a question that has been answered, and the toast itself (and with
 * it the Undo for the kill) is left exactly where it was rather than being
 * replaced by a fresh toast that would drop it.
 *
 * `save` is the screen's own mutation, handed in rather than imported: this
 * module owns the WORDS and the PRESS, and the screen owns the write, the
 * invalidation and the failure sentence — the same split as every other control
 * in `desk-leads.tsx`.
 */
export function KillReasonChips({
  leadId,
  save,
}: {
  leadId: number;
  save: (request: KillReasonRequest) => void;
}): ReactNode {
  const [kept, setKept] = useState<string | null>(null);

  if (kept !== null) {
    return createElement("span", { className: "desk-chips desk-chips-kept" }, kept);
  }

  return createElement(
    "span",
    { className: "desk-chips" },
    createElement("span", { className: "desk-chips-ask" }, KILL_CHIPS_ASK),
    ...KILL_REASON_CHIPS.map((chip) =>
      createElement(
        "button",
        {
          key: chip.key,
          type: "button",
          className: "desk-chip",
          /*
            The chip's visible word is a fragment ("Old", "Thin") that says
            nothing out of a toast; the accessible name says what the press is.
          */
          "aria-label": `Reason: ${chip.label}`,
          onClick: (event: MouseEvent<HTMLButtonElement>) => {
            /*
              The toast's own dismiss-on-action and the card's pointer handling
              are sonner's; both are left alone here so the chip is a press on
              the desk's record and not a press on the toast. `desk-toast.ts`
              does the same for the Undo button it builds.
            */
            event.preventDefault();
            event.stopPropagation();
            if (killReasonPress(leadId, chip.key, save)) setKept(killReasonKept(chip));
          },
        },
        chip.label,
      ),
    ),
  );
}
