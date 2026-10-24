/**
 * The line the desk prints when a model server did not answer.
 *
 * `connectionError` (ai.ts) writes "<label> is unreachable. Check that it is
 * running and that this machine is online." and appends the thrown cause in
 * parentheses. That sentence is stored and reprinted as-is on the job card and
 * the Models page chip, where "unreachable" reads as a verdict about the model
 * rather than a report about one failed call. The screen says it plainly
 * instead, and keeps the cause behind a technical-detail disclosure.
 *
 * The label is whatever stands between the previous trail hop (or the start of
 * the text) and the sentence, so a failover note's " -> <next model>" tail and
 * its arrows survive untouched. Nothing else in the text is rewritten.
 */
const UNREACHABLE =
  /(^|-> |→ |\n)([^\n]+?) is unreachable\. Check that it is running and that this machine is online\.(?: \(([^)]*)\))?/g;

export function plainServerWords(text: string): { text: string; detail: string | null } {
  let detail: string | null = null;
  const plain = text.replace(UNREACHABLE, (_whole, lead: string, label: string, cause: string | undefined) => {
    if (detail === null && cause) detail = cause;
    return `${lead}${label}: the model server did not answer. Check that it is running and that this machine is online.`;
  });
  return { text: plain, detail };
}
