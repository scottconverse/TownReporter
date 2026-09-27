import { Dialog } from "@/components/dialog";
import type { EvidenceCheckReview } from "@/components/draft-reconcile-control";

/**
 * Compare versions, drawn as `dialog-12-compare.png`.
 *
 * Unit BH2 decision 6. The two decisions it offers and the calls they make are
 * the ones the evidence-check panel already offers -- `onKeepChecked` and
 * `onRestoreOriginal`, wired by the story page to the same handlers
 * `DraftReconcileControl` receives as `onKeepChecked` / `onRestoreOriginal`. The
 * panel itself is untouched: `draft-reconcile-control.test.ts` pins its markup,
 * and rule 10 does not allow turning it into a portal to get a dialog.
 *
 * The drawing's one new thing is the word-level comparison -- a sentence the
 * check added is highlighted, a sentence it struck is struck through. That is
 * local and pure (no server, no model): `diffWords` below is a plain longest
 * common subsequence over the two texts.
 */

export type DiffToken = { text: string; state: "same" | "changed" };
export type WordDiff = { before: DiffToken[]; after: DiffToken[]; changed: boolean };

/** Tokenize on whitespace, keeping the whitespace as tokens so nothing is lost. */
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token !== "");
}

/**
 * Beyond this many tokens a quadratic table stops being worth it for a
 * side-by-side view. Past it the whole text is reported as changed on both
 * sides -- which is what it looks like anyway when a draft is rewritten end to
 * end, and it is still the truth (nothing here claims a token was the same).
 */
const DIFF_TOKEN_LIMIT = 1200;

function merge(tokens: DiffToken[], text: string, state: DiffToken["state"]): void {
  const last = tokens[tokens.length - 1];
  if (last && last.state === state) last.text += text;
  else tokens.push({ text, state });
}

/* Not exported: nothing outside this file diffs two versions, and a non-component
   export here is what `react-refresh/only-export-components` warns about (lint
   failed on it). The dialog renders the result; the test reads the rendered
   `.astra-diff-add` / `.astra-diff-del` spans rather than calling this. */
function diffWords(before: string, after: string): WordDiff {
  if (before === after) return { before: [{ text: before, state: "same" }], after: [{ text: after, state: "same" }], changed: false };
  const left = tokenize(before);
  const right = tokenize(after);
  if (left.length > DIFF_TOKEN_LIMIT || right.length > DIFF_TOKEN_LIMIT) {
    return { before: [{ text: before, state: "changed" }], after: [{ text: after, state: "changed" }], changed: true };
  }
  const width = right.length + 1;
  // lcs[i * width + j] = length of the longest common subsequence of left[i..]
  // and right[j..], filled from the end so the walk below can take the first
  // legal step.
  const lcs = new Uint32Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        left[i] === right[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  const beforeTokens: DiffToken[] = [];
  const afterTokens: DiffToken[] = [];
  let changed = false;
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      merge(beforeTokens, left[i], "same");
      merge(afterTokens, right[j], "same");
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      merge(beforeTokens, left[i], "changed");
      changed = true;
      i++;
    } else {
      merge(afterTokens, right[j], "changed");
      changed = true;
      j++;
    }
  }
  while (i < left.length) {
    merge(beforeTokens, left[i], "changed");
    changed = true;
    i++;
  }
  while (j < right.length) {
    merge(afterTokens, right[j], "changed");
    changed = true;
    j++;
  }
  return { before: beforeTokens, after: afterTokens, changed };
}

type ReviewFields = EvidenceCheckReview["original"];

const REVIEW_LABELS: Record<keyof ReviewFields, string> = {
  headline: "Headline",
  dek: "Dek",
  body: "Story body",
  topic: "Section",
};

function DiffSide({ tokens, side }: { tokens: DiffToken[]; side: "before" | "after" }) {
  return (
    <pre className="astra-diff-text">
      {tokens.map((token, index) =>
        token.state === "same" ? (
          <span key={index}>{token.text}</span>
        ) : side === "after" ? (
          <mark className="astra-diff-add" key={index}>
            {token.text}
          </mark>
        ) : (
          <del className="astra-diff-del" key={index}>
            {token.text}
          </del>
        ),
      )}
    </pre>
  );
}

export type CompareVersionsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Both versions of the draft, as the evidence check left them. */
  review: EvidenceCheckReview;
  /** The drawn column kickers; the drawing carries the two times in them. */
  originalLabel?: string;
  checkedLabel?: string;
  /** True while a version is being loaded, so neither decision can be pressed. */
  busy?: boolean;
  onKeepChecked: () => void;
  onRestoreOriginal: () => void;
};

export function CompareVersionsDialog({
  open,
  onOpenChange,
  review,
  originalLabel = "Your saved version",
  checkedLabel = "After evidence check",
  busy,
  onKeepChecked,
  onRestoreOriginal,
}: CompareVersionsDialogProps) {
  const changed = (Object.keys(REVIEW_LABELS) as (keyof ReviewFields)[]).filter(
    (key) => review.original[key] !== review.checked[key],
  );
  const findings = review.integrityNotes.trim();

  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      title="Compare versions"
      subtitle="Your saved version (left) and the version after the evidence check (right)."
      footNote="Yellow: added or changed by the check · struck through: removed. Findings stay listed under Checks either way."
      cancelLabel="Cancel"
      altLabel="Restore previous"
      onAlt={onRestoreOriginal}
      altDisabled={busy}
      primaryLabel="Keep checked version"
      onPrimary={onKeepChecked}
      primaryDisabled={busy}
      primaryTone="solid"
    >
      {changed.length === 0 ? (
        <p className="meta">The check found no wording changes to propose.</p>
      ) : null}
      {changed.map((key) => {
        const diff = diffWords(review.original[key] || "", review.checked[key] || "");
        return (
          <section className="astra-diff" key={key}>
            <h3 className="astra-diff-field">{REVIEW_LABELS[key]}</h3>
            <div className="astra-diff-grid">
              <div>
                <p className="astra-diff-kick">{originalLabel}</p>
                <DiffSide tokens={diff.before} side="before" />
              </div>
              <div>
                <p className="astra-diff-kick">{checkedLabel}</p>
                <DiffSide tokens={diff.after} side="after" />
              </div>
            </div>
          </section>
        );
      })}
      {findings ? (
        <section className="astra-findings">
          <h3 className="astra-diff-field">Verify before print</h3>
          <pre className="astra-diff-text">{findings}</pre>
        </section>
      ) : null}
    </Dialog>
  );
}
