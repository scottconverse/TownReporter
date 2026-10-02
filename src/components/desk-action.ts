/**
 * One press, four states, always an answer — the shared shape of every desk
 * action that takes time.
 *
 * This is the family `usePress` started (`dialogs/editor-dialogs.tsx`: a lock so
 * one press cannot spend twice, a turned error, an answer spoken through the
 * desk's live region). That shape was private to the dialogs, so the plain
 * buttons outside them grew their own: a label that flips here, an `isPending`
 * that is never drawn there, twenty-two mutations that report nothing at all on
 * failure (FB0-REPORT.md Table B). Two entry points share every rule below, so
 * there is one place to fix rather than a fourth pattern:
 *
 *   - `useDeskAction` — a plain button pressing once. Immediate `isPending` and
 *     a pending label, a done toast carrying the specific outcome, a failed
 *     toast carrying the real reason, and an optional Undo on the done toast
 *     for a reversible press. This is `usePress`, made visible.
 *   - `useDeskMutation` — the same rules around a React Query mutation, so a
 *     `useMutation` that reported nothing on failure reports it now without its
 *     press sites being rewritten.
 *
 * What "the real reason" means here, exactly: `deskErrorReason` (desk-toast.ts)
 * carries the sentence the server function already wrote for an editor, and
 * `failedLead` may only be words placed *before* it. There is no shape in this
 * module that can replace the reason with a generic apology, because a generic
 * apology is the silent failure with extra steps.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import { deskErrorReason, deskToast, type DeskUndo } from "@/components/desk-toast";
import { refusedAnswer } from "@/lib/news/refused-answer";

/** Where a press is between being pressed and answering. */
export type DeskPhase = "idle" | "pending" | "done" | "failed";

export type DeskActionCopy<Result, Variables = void> = {
  /** The word the button draws while it works: "Deleting…". */
  pending: string;
  /**
   * What the finished press says, in one specific sentence — the outcome, not
   * "Done". A press with nothing worth saying returns an empty string and gets
   * no toast.
   */
  done: (result: Result, variables: Variables) => string;
  /**
   * Words placed before the real reason on a failure: "Could not delete that
   * pack. ". The reason follows whatever this says, always.
   */
  failedLead?: string;
  /**
   * The press in a verb phrase -- "publish", "save the notes" -- for the
   * failures `deskErrorReason` has to build a sentence for rather than carry
   * through (a schema dump, a bare 500). Optional: a press that does not name
   * itself gets "do that", which is only ever read by an editor whose press
   * failed in one of those two ways.
   */
  what?: string;
  /**
   * The way back, for a press that can be taken back. Drawn on the done toast.
   * Returning null means this particular outcome is not reversible.
   */
  undo?: (result: Result, variables: Variables) => DeskUndo | null;
};

/**
 * What a settled press says. Pure, so the wording and the guarantee that a
 * failure carries its reason are testable without a browser or a React tree.
 */
export function deskActionDone<Result, Variables>(
  result: Result,
  variables: Variables,
  copy: Pick<DeskActionCopy<Result, Variables>, "done" | "undo">,
): { message: string; undo: DeskUndo | null } {
  return {
    message: copy.done(result, variables),
    undo: copy.undo?.(result, variables) ?? null,
  };
}

/**
 * Did the answer itself refuse, rather than the call failing?
 *
 * This desk's server functions answer `{ok:false, error}` far more often than
 * they throw — `createAiFollowUp`, `followUpAction`, `saveDailyScanPolicy` and
 * most of the rest — so a mutation whose only failure handling is `onError`
 * stays silent for the most common failure there is. A refusal is read from the
 * result here, once, for both entry points; `null` means the answer did not
 * refuse and there is nothing to report.
 */
export function deskAnswerFailure(result: unknown): string | null {
  return refusedAnswer(result);
}

/**
 * The sentence a failed press shows: whatever the caller wanted said first,
 * then the real reason. Kept pure and separate from the toast so the failure
 * path cannot be quietly shortened to a generic sentence without a test
 * noticing.
 */
export function deskActionFailure(
  error: unknown,
  copy: { failedLead?: string; what?: string },
): string {
  return `${copy.failedLead ?? ""}${deskErrorReason(error, copy.what)}`;
}

export type DeskAction<Result> = {
  phase: DeskPhase;
  /** True from the press until the answer. Draw the button disabled on this. */
  isPending: boolean;
  /** The label to draw instead of the button's own word while pending. */
  pendingLabel: string;
  /** The real reason the last press failed, or null. */
  problem: string | null;
  /** Press it. A second press while one is in flight is ignored. */
  run: (work: () => Promise<Result>) => Promise<void>;
  /** Back to idle, with nothing said. */
  reset: () => void;
};

/**
 * A plain button's press, from press to answer.
 *
 * `run` sets the pending phase before it awaits anything, so the button is
 * disabled and relabelled in the same paint as the click — there is no frame
 * where a slow press looks like a dead one. The lock is a ref rather than the
 * phase because two clicks can be delivered before React re-renders.
 */
export function useDeskAction<Result>(copy: DeskActionCopy<Result>): DeskAction<Result> {
  const [phase, setPhase] = useState<DeskPhase>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const lock = useRef(false);
  /*
    The copy object is usually written inline at the call site, so it is a new
    object every render. Held in a ref so `run` itself stays stable and an event
    handler captured in a parent's closure still presses the current wording.
  */
  const copyRef = useRef(copy);
  useEffect(() => {
    copyRef.current = copy;
  });

  const run = useCallback(async (work: () => Promise<Result>) => {
    if (lock.current) return;
    lock.current = true;
    setProblem(null);
    setPhase("pending");
    try {
      const result = await work();
      const refusal = deskAnswerFailure(result);
      if (refusal) {
        const sentence = deskActionFailure(refusal, copyRef.current);
        setProblem(sentence);
        deskToast(sentence, { tone: "err" });
        setPhase("failed");
        return;
      }
      const { message, undo } = deskActionDone(result, undefined, copyRef.current);
      if (message) deskToast(message, { tone: "ok", undo });
      setPhase("done");
    } catch (err) {
      const sentence = deskActionFailure(err, copyRef.current);
      setProblem(sentence);
      deskToast(sentence, { tone: "err" });
      setPhase("failed");
    } finally {
      lock.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    setProblem(null);
    setPhase("idle");
  }, []);

  return {
    phase,
    isPending: phase === "pending",
    pendingLabel: copy.pending,
    problem,
    run,
    reset,
  };
}

export type DeskMutationOptions<Data, Variables> = DeskActionCopy<Data, Variables> & {
  mutationFn: (variables: Variables) => Promise<Data>;
  /**
   * The press's own follow-up: the invalidations, the close, the navigate.
   *
   * B7R, item 3. It is AWAITED, so the whole of it is part of the press: the
   * button stays pending and the done toast is not raised until it settles.
   * It used to be fired and forgotten (`void after(...)`), which let the press
   * settle while the follow-up was still running -- the row read "Accept"
   * again while the Sources screen was still filing the source under its
   * sections -- and turned a follow-up that threw into an unhandled promise
   * nobody reported. Success is now announced when the action is over, not
   * when the first half of it is.
   *
   * A rejection here is reported through the same error toast as a failed
   * call, carrying the real reason, because from the editor's side it is the
   * same thing: the press did not finish. It is reported ONCE and then
   * rethrown -- see `DeskFollowUpError` -- so the caller that awaits
   * `mutateAsync` learns the press failed rather than carrying on as if it had
   * finished (L5 of the batch-7 pre-merge audit).
   *
   * It does NOT run when the answer refused (`{ok:false}`): a refused press
   * changed nothing, and a follow-up that assumed otherwise would be the desk
   * inventing the outcome it just reported the absence of.
   */
  after?: (data: Data, variables: Variables) => void | Promise<void>;
  /**
   * Suppress this mutation's own toasts while this says so.
   *
   * M7 of the batch-6 pre-merge audit. A bulk press that fans out over twenty
   * leads through this mutation would otherwise raise twenty toasts -- and the
   * twenty-first press buries the first, so a partial failure scrolls away
   * before it can be read. The caller doing the fan-out owns the outcome: it
   * sets this while its batch is in flight and reports the whole batch in one
   * sentence with one Undo, rather than leaving the editor to count toasts.
   *
   * A predicate and not a boolean because the fan-out is asynchronous: the
   * caller flips its own ref either side of the batch, and this is read at the
   * moment each item settles.
   */
  muted?: () => boolean;
  /**
   * The press's optimistic half: change the screen before the server answers.
   *
   * FB6, item 2 (README "Interactions & behavior": "optimistic Held/Killed with
   * Undo until the server confirms"). A row that only changes when the round
   * trip lands is the "line going back and forth" the owner opened this unit
   * about, so a Hold or a Kill moves the row in the same paint as the press and
   * the server's answer is a confirmation rather than the first sign of life.
   *
   * Whatever this returns is handed back to `rollback` if the press fails -- so
   * the natural return is the previous state, in whatever shape the caller can
   * put back. It runs inside React Query's `onMutate`, which is why the
   * mutation's own `isPending` is already true by the time it runs: the button
   * is disabled and the row has moved in the same commit.
   *
   * The one shape this must not take is "return the old value and let the hook
   * guess what to do with it": a hook that both owns the change and knows how to
   * undo it would have to know what the change was, and the screens disagree
   * (Today holds lead rows, the Queue holds a windowed page of them). The
   * caller's two callbacks are the whole contract.
   */
  optimistic?: (variables: Variables) => unknown;
  /**
   * Put back what `optimistic` changed, when the press did NOT take.
   *
   * Called for both ways a press fails -- a thrown call and an answer that
   * refused with `{ok:false}` -- because from the editor's side they are the
   * same thing: the row moved and the desk says it did not. `context` is
   * whatever `optimistic` returned for this press.
   */
  rollback?: (context: unknown, variables: Variables) => void;
};

/**
 * A follow-up that failed AFTER its sentence was already shown.
 *
 * L5 of the batch-7 pre-merge audit. `onSuccess` catches the follow-up's
 * rejection so it can report it once instead of twice — but catching it also
 * made the mutation settle as a SUCCESS, and a press site that chains
 * `await mutateAsync(...).then(close)` then closed the dialog, navigated away
 * or re-enabled the row on a press that never finished. The answer the editor
 * saw and the answer the caller saw disagreed.
 *
 * Rethrowing is what makes them agree: react-query answers a rejection out of
 * `onSuccess` by dispatching "error" and rejecting the promise, so
 * `mutateAsync` rejects and `mutate`'s own callers see the failure state. The
 * wrapper exists so `onError` — which react-query calls on the way past — can
 * recognise a failure whose toast has already been raised and stay quiet.
 */
export class DeskFollowUpError extends Error {
  /**
   * Read instead of `instanceof`.
   *
   * A class that extends `Error` loses its prototype when it is downlevelled --
   * TypeScript's ES5 emit does `_super.call(this, message) || this`, and an
   * `Error.call` returns a FRESH Error, so the value the caller holds is not an
   * instance of this class at all. That is not hypothetical: this module is
   * transpiled to ES5 by the desk's own DOM harness, where `instanceof` here is
   * false and the identical failure gets reported twice. The flag is assigned in
   * the constructor, so it survives every target.
   */
  readonly deskFollowUpReported = true as const;
  constructor(
    message: string,
    readonly cause: unknown,
  ) {
    super(message);
    this.name = "DeskFollowUpError";
  }
}

/** Was this failure's sentence already shown? See `DeskFollowUpError`. */
export function isReportedFollowUpFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { deskFollowUpReported?: unknown }).deskFollowUpReported === true
  );
}

/**
 * The same rules around a React Query mutation.
 *
 * The return value is React Query's own `UseMutationResult`, so every existing
 * press site keeps working untouched — `mutate`, `isPending` and `variables`
 * mean exactly what they meant. The only change a converted mutation sees is
 * that a failure now says why.
 */
/**
 * The caller's `optimistic` return value out of React Query's context wrapper.
 *
 * The wrapper exists because `onMutate` returning `undefined` and `onMutate`
 * returning a caller's `undefined` are the same thing to React Query, and the
 * rollback should be called either way -- a press that optimistically changed
 * nothing still has nothing to put back, and a `rollback` that is skipped
 * because a caller optimistically returned `undefined` would be a rule with an
 * exception nobody could see.
 */
function contextOf(mutationContext: unknown): unknown {
  return (mutationContext as { context?: unknown } | undefined)?.context;
}

export function useDeskMutation<Data, Variables = void>(
  options: DeskMutationOptions<Data, Variables>,
): UseMutationResult<Data, Error, Variables> {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  return useMutation<Data, Error, Variables>({
    mutationFn: (variables: Variables) => optionsRef.current.mutationFn(variables),
    /*
      THE OPTIMISTIC HALF (FB6). `onMutate` runs before the call and its return
      value is React Query's `context`, handed to both `onSuccess` and `onError`
      -- which is exactly the shape an optimist needs: the caller says what it
      changed and gets the same handle back to undo it. A callback that throws
      must not take the press down with it, so the failure is caught and the
      press carries on with no context to roll back.
    */
    onMutate: async (variables: Variables) => {
      try {
        return { context: await optionsRef.current.optimistic?.(variables) };
      } catch {
        return { context: undefined };
      }
    },
    /*
      ASYNC ON PURPOSE, and react-query is what makes it work: it awaits
      `onSuccess` before it dispatches "success", so `isPending` stays true for
      the whole of the follow-up. Everything the editor reads as "this press is
      still running" -- the disabled button, the pending label, the awaited
      `mutateAsync` -- covers the follow-up too, and the done toast is raised
      only once the action is actually over.

      A follow-up that fails is caught HERE, reported once, and RETHROWN as a
      `DeskFollowUpError`. The catch is what keeps it to one sentence —
      react-query answers a rejection from `onSuccess` by calling `onError`,
      which would report the same failure a second time — and `onError` below
      recognises the wrapper and stays quiet. The rethrow is L5 of the
      pre-merge audit: swallowing it settled the mutation as a SUCCESS, so a
      caller awaiting `mutateAsync` carried on as though the press had
      finished.
    */
    onSuccess: async (data: Data, variables: Variables, mutationContext: unknown) => {
      const refusal = deskAnswerFailure(data);
      if (refusal) {
        /*
          A REFUSAL IS A FAILED PRESS, and the row that already moved has to move
          back. The desk's server functions answer `{ok:false, error}` far more
          often than they throw, so a rollback wired only to `onError` would
          leave a held row held on the screen while the desk said it was not.
        */
        optionsRef.current.rollback?.(contextOf(mutationContext), variables);
        if (!optionsRef.current.muted?.())
          deskToast(deskActionFailure(refusal, optionsRef.current), { tone: "err" });
        return;
      }
      try {
        await optionsRef.current.after?.(data, variables);
      } catch (error) {
        /*
          NOT rolled back: the call itself took, so the row's new state is the
          true one. What failed here is the follow-up (the invalidations), and
          saying so is the whole of the report. Rethrown so `mutateAsync`
          callers see the failure; `onError` recognises it and stays quiet.
        */
        const sentence = deskActionFailure(error, optionsRef.current);
        if (!optionsRef.current.muted?.()) deskToast(sentence, { tone: "err" });
        throw new DeskFollowUpError(sentence, error);
      }
      if (!optionsRef.current.muted?.()) {
        const { message, undo } = deskActionDone(data, variables, optionsRef.current);
        if (message) deskToast(message, { tone: "ok", undo });
      }
    },
    onError: (error: Error, variables: Variables, mutationContext: unknown) => {
      // A follow-up failure: the call itself took, so the row keeps its new state
      // and the catch above already said what failed.
      if (isReportedFollowUpFailure(error)) return;
      optionsRef.current.rollback?.(contextOf(mutationContext), variables);
      if (optionsRef.current.muted?.()) return;
      deskToast(deskActionFailure(error, optionsRef.current), { tone: "err" });
    },
  });
}

/*
  ⌘S / Ctrl+S.

  README "Interactions & behavior": "⌘S saves in the story workbench". Both
  workbenches drew the badge (`astra-wb-kbd`, aria-hidden so the button's
  accessible name stays exactly "Save edits") and neither bound it: the key
  fell through to the browser and the editor got the Save-page dialog for a
  draft they thought they had saved (FB0-REPORT.md Table B, "⌘S badge … DEAD").
  It is bound now, not removed, because saving on both screens is manual --
  there is a "Save edits" press, an unsaved-changes state and an "Unsaved
  changes" line -- so the badge was describing a shortcut that ought to exist.
*/

/**
 * An open dialog, whichever way the desk draws one.
 *
 * A native `<dialog>` that has been shown carries `open`; the desk's own
 * overlays are `role=dialog` with Radix's `data-state=open`. Both mean a
 * surface owns the keyboard right now.
 */
export const DESK_DIALOG_OPEN_SELECTOR = "dialog[open], [role=dialog][data-state=open]";

/** Is a dialog open over the desk? `root` is injectable so this stays testable. */
export function deskDialogOpen(
  root: ParentNode | null = typeof document === "undefined" ? null : document,
): boolean {
  return root?.querySelector(DESK_DIALOG_OPEN_SELECTOR) != null;
}

/**
 * Is this press the desk's Save key? Cmd+S on a Mac, Ctrl+S everywhere else.
 *
 * M9 of the batch-6 pre-merge audit. The three fields beyond the modifier are
 * the ones that made a bound ⌘S do something the editor did not ask for:
 *
 *  - `repeat` -- a held key fires this event dozens of times a second, and each
 *    one is a save.
 *  - `isComposing` -- mid-IME, the `s` is part of a character being built, not
 *    a shortcut at all.
 *  - `defaultPrevented` -- something closer to the keystroke already claimed
 *    it. The desk's own dialogs handle keys on their own surfaces, and the
 *    last thing that should happen is the workbench behind them saving too.
 *
 * They are optional in the signature because the callers that only construct
 * the modifier half (tests, and anything synthesising a press) should not have
 * to spell out fields whose absence means "not a repeat".
 */
export function isSaveShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> &
    Partial<Pick<KeyboardEvent, "repeat" | "isComposing" | "defaultPrevented">>,
): boolean {
  if (!event.metaKey && !event.ctrlKey) return false;
  // Shift+Ctrl+S and Alt+Ctrl+S belong to the browser and the OS.
  if (event.altKey || event.shiftKey) return false;
  if (event.repeat || event.isComposing || event.defaultPrevented) return false;
  return event.key.toLowerCase() === "s";
}

/**
 * The whole decision: is this keystroke the desk's save, right now?
 *
 * Separate from `isSaveShortcut` because "a dialog is open" is not a property
 * of the key -- it is a property of the screen at the moment it was pressed --
 * and keeping the two apart is what lets both be tested without a browser.
 */
export function deskShouldSave(
  event: Parameters<typeof isSaveShortcut>[0],
  dialogOpen: boolean,
): boolean {
  return !dialogOpen && isSaveShortcut(event);
}

/**
 * Binds ⌘S to a save while `enabled`.
 *
 * `enabled` is the caller's own "the Save edits button is pressable right now",
 * so the key can never save something the button would refuse: a locked draft,
 * a story that is already on the paper, or a save already in flight.
 */
export function useSaveShortcut(save: () => void, enabled: boolean): void {
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    if (!enabled) return;
    function onKey(event: KeyboardEvent) {
      if (!deskShouldSave(event, deskDialogOpen())) return;
      // The browser's "Save page as…" is never what the editor meant.
      event.preventDefault();
      saveRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
