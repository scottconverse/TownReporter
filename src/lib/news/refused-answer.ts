/**
 * A settled answer that REFUSED, read in one place (unit UI1a3, finding 1).
 *
 * This desk's server functions answer `{ ok: false, error }` far more often
 * than they throw. React Query settles that answer as a SUCCESS, so a control
 * whose failure state is derived from `isError` alone goes back to idle with
 * the server's sentence nowhere near it -- which is exactly what the review bot
 * found on `acceptUnreviewedClaims` and `overrideNamedOutlet` (a stale evidence
 * token, a draft that no longer names the outlet), and what the same shape does
 * on half a dozen other presses.
 *
 * `deskAnswerFailure` (`components/desk-action.ts`) has always applied this rule
 * to the desk's own action family; it now delegates here, so there is one
 * implementation of "the desk refused, and this is what it said" rather than
 * two that can drift. It is deliberately pure and dependency-free -- no React,
 * no `@/` alias -- so a `node --experimental-strip-types` test can read it.
 */
export function refusedAnswer(answer: unknown): string | null {
  if (!answer || typeof answer !== "object") return null;
  if (!("ok" in answer) || (answer as { ok: unknown }).ok !== false) return null;
  const error = (answer as { error?: unknown }).error;
  return typeof error === "string" && error.trim()
    ? error.trim()
    : "The desk refused that press and said nothing about why.";
}
