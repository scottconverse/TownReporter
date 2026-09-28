/**
 * The status chip the redesign draws in the top-right corner of a card.
 *
 * MOVED HERE VERBATIM from routes/desk.models.tsx (unit CX), for the reason
 * that file's own copies of ProviderStatusCard moved: the same chip is drawn on
 * two screens now. Models wears it on a job row and on a connection card;
 * Server wears it on each writing model's sign-in card, which is the drawn
 * `● Ready` / `! Slow` / `Key rejected` column of the Writing models card
 * (Desk Screens.dc.html, `isServer`). A second copy of a four-tone map is a
 * second place for "! Slow" and "Sign-in expired" to drift apart.
 *
 * `below` is the line under the chip, used where the chip's two words are not
 * the whole answer -- "Default" says the desk's own default runs this job, and
 * the line names the model that default resolves to.
 */

import type { CSSProperties } from "react";

/**
 * The four looks a card's chip can wear.
 *
 * Named after what the color MEANS rather than after a provider, so the same
 * four are available to a job's status chip and to a connection's, and neither
 * has to know the other's words.
 */
export type ChipTone = "ready" | "slow" | "signin" | "quiet";

/**
 * Not exported: nothing outside this file needs to know what a tone looks
 * like, and a second export that is not a component trips the repo's
 * react-refresh lint rule (eslint.config.mjs, `only-export-components`).
 */
function chipLook(tone: ChipTone): CSSProperties {
  if (tone === "ready") return { color: "var(--ok)", border: "1px solid var(--ok)" };
  if (tone === "slow") return { color: "var(--warn)", border: "2px solid var(--warn)" };
  if (tone === "signin") return { color: "var(--danger)", border: "2px dashed var(--danger)" };
  return { color: "var(--fg2)", border: "1px solid var(--fg2)" };
}

/**
 * One chip, in the card's top-right corner.
 *
 * A flex column so an optional second line costs the card's own columns no
 * width -- the same reason the job row's chip stacks. `title` carries the help
 * sentence: a chip is two words, and the sentence that explains them does not
 * fit on the card.
 */
export function Chip({
  tone,
  label,
  help,
  below,
}: {
  tone: ChipTone;
  label: string;
  help: string;
  below?: string;
}) {
  return (
    <div className="flex flex-col items-end gap-0.5" title={help}>
      <span
        className="text-sm font-extrabold"
        style={{ ...chipLook(tone), padding: "1px 8px", whiteSpace: "nowrap" }}
      >
        {label}
      </span>
      {below ? (
        <span className="text-sm text-ink-2" style={{ whiteSpace: "nowrap" }}>
          {below}
        </span>
      ) : null}
    </div>
  );
}
