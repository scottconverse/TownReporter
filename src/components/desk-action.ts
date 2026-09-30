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

import {
  deskErrorReason,
  deskToast,
  type DeskUndo,
} from "@/components/desk-toast";

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
  if (!result || typeof result !== "object") return null;
  if (!("ok" in result) || (result as { ok: unknown }).ok !== false) return null;
  const error = (result as { error?: unknown }).error;
  return typeof error === "string" && error.trim()
    ? error.trim()
    : "The desk refused that press and said nothing about why.";
}

/**
 * The sentence a failed press shows: whatever the caller wanted said first,
 * then the real reason. Kept pure and separate from the toast so the failure
 * path cannot be quietly shortened to a generic sentence without a test
 * noticing.
 */
export function deskActionFailure(error: unknown, copy: { failedLead?: string }): string {
  return `${copy.failedLead ?? ""}${deskErrorReason(error)}`;
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
   * The press's own follow-up: the invalidations, the close, the navigate. It
   * runs after the done toast, so a screen that is about to change says what
   * happened before it changes. It does NOT run when the answer refused
   * (`{ok:false}`): a refused press changed nothing, and a follow-up that
   * assumed otherwise would be the desk inventing the outcome it just reported
   * the absence of.
   */
  after?: (data: Data, variables: Variables) => void | Promise<void>;
};

/**
 * The same rules around a React Query mutation.
 *
 * The return value is React Query's own `UseMutationResult`, so every existing
 * press site keeps working untouched — `mutate`, `isPending` and `variables`
 * mean exactly what they meant. The only change a converted mutation sees is
 * that a failure now says why.
 */
export function useDeskMutation<Data, Variables>(
  options: DeskMutationOptions<Data, Variables>,
): UseMutationResult<Data, Error, Variables> {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  return useMutation<Data, Error, Variables>({
    mutationFn: (variables: Variables) => optionsRef.current.mutationFn(variables),
    onSuccess: (data: Data, variables: Variables) => {
      const refusal = deskAnswerFailure(data);
      if (refusal) {
        deskToast(deskActionFailure(refusal, optionsRef.current), { tone: "err" });
        return;
      }
      const { message, undo } = deskActionDone(data, variables, optionsRef.current);
      if (message) deskToast(message, { tone: "ok", undo });
      void optionsRef.current.after?.(data, variables);
    },
    onError: (error: Error) => {
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

/** Is this press the desk's Save key? Cmd+S on a Mac, Ctrl+S everywhere else. */
export function isSaveShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
): boolean {
  if (!event.metaKey && !event.ctrlKey) return false;
  // Shift+Ctrl+S and Alt+Ctrl+S belong to the browser and the OS.
  if (event.altKey || event.shiftKey) return false;
  return event.key.toLowerCase() === "s";
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
      if (!isSaveShortcut(event)) return;
      // The browser's "Save page as…" is never what the editor meant.
      event.preventDefault();
      saveRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
