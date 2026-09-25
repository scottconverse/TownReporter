/**
 * Handing an unverified lead from an import to the Dark Desk.
 *
 * The owner's rule, 2026-09-25: a Black Desk hypothesis, or a Tier 3 packet, is
 * "Story idea, never a draft ... the editor can send it to Dark Desk (link to
 * the existing Dark Desk paste/start with the hypothesis + next check
 * pre-filled)".
 *
 * So this is not a new filing path and not a new Dark Desk run: it is the
 * ordinary "Start a file" box on `/desk/dark`, opened with its text already in
 * it. The paste rides in `sessionStorage` for the same reason the import paste
 * does (`import-review.ts:38`): a hypothesis is a couple of long paragraphs and
 * cannot ride in a URL. The Dark Desk takes it once and clears it, so returning
 * to that screen later opens its own empty box rather than silently re-opening
 * a file the editor has already sent.
 *
 * The desk never invents a check that was not written down. A hypothesis whose
 * body already carries its own `**Next check:**` gets no second one, and one
 * the report stated no check for gets none added.
 */

import { UNVERIFIED_FLAG } from "./import-stories.ts";

/** Where the review screen parks a hypothesis on its way to the Dark Desk. */
export const DARK_SEED_KEY = "townreporter.dark.seed";

/**
 * The text the Dark Desk's "Start a file" box opens with.
 *
 * The first line becomes the file's title (`desk.dark.tsx` reads
 * `paste.split("\n")[0]`), so the flag and the report's own label go there --
 * the digger opens the file already knowing this is unverified and which packet
 * it came out of. `body` is the hypothesis exactly as the report wrote it, and a
 * `Next check:` line is added only when the report stated one and its own body
 * does not already carry it.
 */
export function darkSeedFromCard(card: {
  headline: string;
  body: string;
  storyId: string;
  readinessNote: string;
}): string {
  const label = card.storyId.trim()
    ? `${UNVERIFIED_FLAG} · ${card.storyId.trim()}`
    : UNVERIFIED_FLAG;
  const lines = [`${label} — ${card.headline.trim()}`];
  const body = card.body.trim();
  if (body) lines.push("", body);
  const check = card.readinessNote.trim();
  if (check && !/next check/i.test(body)) lines.push("", `Next check: ${check}`);
  return lines.join("\n");
}
