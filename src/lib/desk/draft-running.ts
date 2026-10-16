/**
 * Whether the writer panel may say "A draft is running" and show the wait
 * words under it (TMA-6).
 *
 * `waiting` is true from the press itself, so the buttons stay disabled while
 * the press's call is open. But the call can still be open with no job made
 * yet -- the "Before you continue" consent is up, or the server has not
 * answered. Those are not a running draft, so the text waits for the server's
 * answer (`awaitingAck` goes false once it answers, or once a job is open).
 */
export function showDraftRunning(input: { waiting: boolean; awaitingAck: boolean }): boolean {
  return input.waiting && !input.awaitingAck;
}
