/**
 * The scoped-callsite consent wrapper (Scott's rule, outside Publish).
 *
 * The desk's server handles now answer a policy gate with
 * `{ ok:false, warning:{key,sentence}, error }` instead of throwing. The editor
 * must be TOLD the sentence, and only a second, explicit press may carry
 * `override:[key]` back to the SAME request. `withEditorWarningAction` is that
 * one place, so a route does not hand-roll it per button:
 *
 *     const result = await withEditorWarningAction(
 *       (override) => runScan({ data: { ...data, override } }),
 *       { action: "Run scan", kind: "run" },
 *       askEditorToOverride,          // opens the consent, resolves true/false
 *     );
 *
 * Rules, all behavioural and all tested:
 *
 *   - the request runs EXACTLY ONCE before consent;
 *   - a warning with no consent returns the refusal and stops — no retry;
 *   - an approval re-runs the SAME captured request with `override` including
 *     every key approved so far (sequential warnings retain prior approvals);
 *   - a cancel is not a retry and returns the refusal;
 *   - the loop can never spin: a key already in hand is not re-asked.
 *
 * The consent itself is a CHANNEL (`createWarningConsentChannel`) so the wrapper
 * is framework-free and testable, while `WarningConsentHost` (drawn with the
 * desk's existing Dialog and ActionButton) is the one React subscriber the desk shell mounts.
 */
import { warningFromAnswer, type EditorWarning, type WarningPressKind } from "./editor-warning.ts";

/** What the consent UI is asked to show for one warning. */
export type WarningConsentRequest = {
  /** The idle word of the press that warned: "Run scan". */
  action: string;
  /** The server's sentence. */
  sentence: string;
  /** The key the approval will send back. */
  key: string;
  /** How the second press finishes its sentence. */
  kind?: WarningPressKind;
  /** The model a `restart` press names. */
  model?: string;
};

/** What a caller tells the wrapper about the press it is making. */
export type WarningActionOptions = {
  action: string;
  kind?: WarningPressKind;
  model?: string;
};

/** How a caller asks the editor to approve; true means "…anyway was pressed". */
export type AskEditorToOverride = (request: WarningConsentRequest) => Promise<boolean>;

export type WarningConsentState = { request: WarningConsentRequest };
export type WarningConsentDecision = (approved: boolean) => void;

export type WarningConsentChannel = {
  /** The consent being shown, or null. */
  get(): WarningConsentState | null;
  subscribe(listener: () => void): () => void;
  /** Ask the editor; resolves true for "…anyway", false for cancel. */
  request(request: WarningConsentRequest): Promise<boolean>;
  /** The editor chose. Clears the head and shows the next queued request. */
  resolve(approved: boolean): void;
  cancelAll(): void;
};

/**
 * A queue of at most one visible consent. Two presses cannot both be waiting to
 * be approved at once, so the second request waits behind the first rather than
 * replacing its sentence mid-read.
 */
export function createWarningConsentChannel(): WarningConsentChannel {
  type Entry = { request: WarningConsentRequest; decide: WarningConsentDecision };
  const queue: Entry[] = [];
  let head: Entry | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const advance = () => {
    head = queue.shift() ?? null;
    notify();
  };

  return {
    get: () => (head ? { request: head.request } : null),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request(request) {
      return new Promise<boolean>((resolve) => {
        const entry: Entry = { request, decide: resolve };
        if (head) queue.push(entry);
        else {
          head = entry;
          notify();
        }
      });
    },
    resolve(approved) {
      if (!head) return;
      const decided = head;
      advance();
      decided.decide(approved);
    },
    cancelAll() {
      const pending = [...(head ? [head] : []), ...queue];
      head = null;
      queue.length = 0;
      notify();
      for (const entry of pending) entry.decide(false);
    },
  };
}

/** Is this answer a structured policy warning? */
function warningOf(answer: unknown): EditorWarning | null {
  return warningFromAnswer(answer);
}

/**
 * The desk's one consent channel.
 *
 * A single module-level channel is deliberate: the consent surface is mounted
 * once in the desk shell, so every screen shares it, and a wrapper that needs to
 * ask the editor does not have to be threaded a channel through the component
 * tree. It is a plain object (no React), so tests read it directly.
 */
let sharedChannel: WarningConsentChannel | null = null;

export function deskWarningConsent(): WarningConsentChannel {
  if (!sharedChannel) sharedChannel = createWarningConsentChannel();
  return sharedChannel;
}

/** The desk's consent, as the `ask` argument `withEditorWarningAction` wants. */
export function askEditorToOverride(request: WarningConsentRequest): Promise<boolean> {
  return deskWarningConsent().request(request);
}

/**
 * Run a scoped server action, turning a structured warning into an explicit
 * second press. `work` receives the `override` to send (undefined on the first
 * call). `ask` is the consent; it is only called when the answer warned.
 */
export async function withEditorWarningAction<T>(
  work: (override: string[] | undefined) => Promise<T>,
  options: WarningActionOptions,
  ask: AskEditorToOverride,
): Promise<T> {
  const approved: string[] = [];
  const override = (): string[] | undefined => (approved.length ? [...approved] : undefined);

  // The first call never carries an override.
  let answer = await work(override());
  for (;;) {
    const warning = warningOf(answer);
    if (!warning) return answer;
    if (approved.includes(warning.key)) return answer; // already approved; never spin
    approved.push(warning.key);
    const ok = await ask({
      action: options.action,
      sentence: warning.sentence,
      key: warning.key,
      kind: warning.key === "model-change-running" ? "restart" : warning.key.startsWith("rate-") ? "run" : options.kind,
      model: warning.key === "model-change-running" ? warning.sentence.match(/Stop and restart with (.+)\.$/)?.[1] ?? options.model : options.model,
    });
    if (!ok) return answer; // cancel: the refusal stands, nothing ran again
    answer = await work(override());
  }
}
