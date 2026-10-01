/*
  ONE FACT, ONE LINE (FB7, item 5, A2c X3).

  "Its WHAT WE KNOW prints the same KCTV5 sentence five times."

  The duplicates are real rows, not a rendering bug: `investigate.ts` inserts a
  claim per planned claim per round and nothing dedupes `body`, so five rounds
  that each recorded the same sentence left five identical `claims` rows. The
  brief therefore said the same thing five times in WHAT WE KNOW, and -- worse
  -- the model was fed the same sentence five times, which is part of why it
  kept asking for records the file already held.

  The dedupe belongs at the two places the list is READ, not at the insert:
  the rows are the file's own audit of what each round found, and merging them
  on write would quietly rewrite the history of five rounds into one. Reading
  is where "say this once" is the requirement.

  Normalisation is deliberately conservative -- case and whitespace only. Two
  sentences that differ by a word are two facts even if they are near-identical
  in meaning; judging that is the model's job, and a desk that merged them by
  edit distance would be deleting an editor's record on a guess.
*/

/** Anything with a claim body; both the route's claims and the pack's facts. */
type Bodied = { body: string };

/** Collapse runs of whitespace and case, for comparing two lines. */
export function factLineKey(body: string): string {
  return body.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The first occurrence of each distinct fact, in the order they arrived.
 *
 * First, not last: the list is read top-down and the earliest record of a fact
 * is the one whose evidence line is most likely to be the original capture.
 * Order is otherwise untouched, because the list's order is the file's.
 */
export function dedupeFactLines<T extends Bodied>(facts: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const fact of facts) {
    const key = factLineKey(fact.body);
    // An empty body is not a fact worth printing, and five empty rows would
    // collapse to one blank line rather than to nothing at all.
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
  }
  return out;
}

/**
 * How many rows the dedupe removed, for the line that says so.
 *
 * A list that silently shrank is the same defect one level down: the editor
 * counted five facts yesterday. The count is reported where the list is drawn
 * so the shrinkage is visible rather than inferred.
 */
export function factLinesDropped(facts: readonly Bodied[]): number {
  return facts.length - dedupeFactLines(facts).length;
}
