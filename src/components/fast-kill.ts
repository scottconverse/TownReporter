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

/**
 * The hold, as the same shape.
 *
 * A hold has no reason, no chips and no dialog on the row: the press carries the
 * lead's id and where the toast's own Undo will put it back (`undoHoldPress`).
 *
 * `restore` is the status the row held a moment before the Hold -- read off the
 * row at the press, like a kill's -- and the way back READS it rather than
 * guessing `new`. Guessing is what the held lead of TIA-2 showed: a lead the desk
 * had already drafted came back as a fresh one.
 */
export type HoldPress = { id: number; status: "held"; restore?: RestoreStatus };

/** The hold press: the lead's id, and where its Undo goes back to. */
export function holdPress(id: number, restore?: RestoreStatus): HoldPress {
  return { id, status: "held", restore };
}

/**
 * The way back from a hold, as the request the desk's restore write takes.
 *
 * Not a `setLeadStatus` call, and that is the whole of TIA-2: the ordinary status
 * input raises the drafted warning for any lead with a written draft, so the
 * ordinary held lead -- the one the walker had on screen -- was refused and came
 * back held with nothing said. `restoreKilledLead` is the write that may undo a
 * hold: it requires the lead to be held right now, it is not gated on a draft,
 * and it takes an explicit status so the press can name where it goes back to.
 *
 * `status` is omitted when the press had none (a hold on a row that named no
 * prior status), and the server then answers `new`, where this Undo has always
 * sent it. `override` carries the keys the editor already approved on the Hold
 * press, so the same lead is not asked twice about the same draft.
 */
export function holdUndoPress(press: HoldPress, override?: string[]): KillUndoPress & { override?: string[] } {
  return { id: press.id, status: press.restore, override };
}

/**
 * The way back, as the same shape. `keepRecord` is set only by Bring back (the
 * Killed pile), which keeps the kill's time and reason on the lead; an Undo
 * leaves it unset and takes the kill off the lead.
 */
export type KillUndoPress = { id: number; status?: RestoreStatus; keepRecord?: boolean };

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
export function killUndoPress(id: number, restore?: RestoreStatus): KillUndoPress {
  return { id, status: restore };
}

/**
 * The press a Kill or Hold leaves behind, as the value the next U reads.
 *
 * THU-3: the Queue's U used to ask the ROW what to take back -- "is this lead
 * held?" first, and a kill only if not -- so a U pressed after a Hold took back
 * a Kill that had come before it, and a U pressed after a Kill could take back a
 * Hold instead. The question the editor is asking is "undo what I just did", and
 * only the press that came last can answer it.
 *
 * So each press stamps where it goes back to and which press it was -- this type
 * -- and `undoPressFor` turns whatever was stamped last into the one request the
 * restore write takes. The rule lives here, beside the two presses it reads,
 * rather than on the screen, so it can be exercised without a browser and cannot
 * drift between the screen's two entry points (the toast's Undo and the U key).
 * A Hold with no restore stamps none, and the server answers `new`, which is
 * where a hold's Undo has always put it.
 */
export type LastPress =
  | { kind: "kill"; id: number; restore: RestoreStatus }
  | { kind: "hold"; id: number; restore?: RestoreStatus };

/**
 * Where a Hold press goes back to, read off the lead's OWN row.
 *
 * THU-3's third finding, and the reason the rule is here rather than on the
 * screen. The Queue's U key holds the lead `shown` names for the cursor -- a
 * projection with a headline and an id, and NO STATUS. When the key's H stamped
 * `lastPress` straight from that object it carried `restore: undefined`, so the
 * way back was sent with no destination and the server had to guess `new`; the
 * row's own Hold, which reads the lead itself, knew the answer all along.
 *
 * So the one Hold any entry point makes reads the status from the LEAD, and this
 * is that read: the two statuses a Hold can hide are the two it puts back --
 * `drafted` is still on the lead, and a held lead (this screen holding it a
 * moment ago, or the row arriving on hold) goes back to `new`. Anything else is
 * `undefined`, which the server answers with `new`, where a hold's Undo has
 * always put it.
 *
 * `id` is separate from `lead` because the key path has the id before it has the
 * row: `holdLeadById` looks the row up by id and hands it here.
 */
export function holdStamp(id: number, lead: { status?: string } | undefined): LastPress {
  return { kind: "hold", id, restore: holdStampRestore(lead?.status) };
}

/** The restore a hold's stamp carries for a lead of this status. */
export function holdStampRestore(status: string | null | undefined): RestoreStatus | undefined {
  return status === "drafted" ? "drafted" : status === "held" ? "new" : undefined;
}

/** The request the U press sends for the press that came last, or null when nothing was pressed. */
export function undoPressFor(press: LastPress | null | undefined): KillUndoPress | null {
  if (!press) return null;
  return press.kind === "hold"
    ? holdUndoPress(holdPress(press.id, press.restore))
    : killUndoPress(press.id, press.restore);
}

/**
 * Bring back from the Killed pile: the same way back, but the lead keeps its
 * kill record (when it was killed and why), so its history line can say so.
 */
export function bringBackPress(id: number, restore?: RestoreStatus): KillUndoPress {
  return { id, status: restore, keepRecord: true };
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
