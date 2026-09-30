/**
 * The one place the desk decides what PostgreSQL can hold.
 *
 * Postgres rejects a NUL byte anywhere in a `text` value -- "invalid byte
 * sequence for encoding UTF8: 0x00" -- and it is not an exotic input: PDFs,
 * some HTML, and anything served with a mislabelled encoding carry them
 * routinely, and a model asked for prose will occasionally emit one too. A
 * single NUL in one fetched page killed an entire dark desk round three
 * minutes in, after twenty-one documents had already been read, and took the
 * whole investigation down with it. A single NUL in one model-written headline
 * failed a whole scan transaction the same way.
 *
 * TWO functions, TWO policies. Which one to call is decided by where the text
 * came from, not by which module is writing it:
 *
 *   - `storableText` -- EDITORIAL and MODEL-WRITTEN text. Lead headlines,
 *     `why`, notes, queries, draft fields, run receipts' free text: anything a
 *     model or an editor produced. It STRIPS NUL and the other C0 controls
 *     (keeping tab, newline and carriage return, which real text needs). A
 *     stripped control character was never part of what was meant; keeping the
 *     prose clean is worth more than recording that a stray byte was there.
 *
 *   - `postgresText` -- CAPTURED EVIDENCE. Text fetched from a source page or
 *     attachment, and the failure messages about those fetches. It REPLACES
 *     NUL with U+FFFD so its position stays visible: a reader has to be able to
 *     see that the page had something there, and -- the reason this cannot be
 *     changed -- the stored text feeds the content hash that decides whether a
 *     watched page changed. Swapping the replacement for a deletion would
 *     change the hash of every page captured from then on and make every
 *     monitored page look as though it had just been edited.
 *
 * So: `storableText` for what the desk says, `postgresText` for what a source
 * said. Both live here so that the next writer added has one place to look,
 * rather than the local helper a previous author happened to leave in the file
 * they were editing.
 *
 * Neither function is a substitute for a parameterised query, and neither
 * touches the C1 controls, lone surrogates or invalid UTF-8 -- those are
 * separate problems this module does not claim to solve.
 */
/*
  On the no-control-regex rule: this is the sanitiser, so matching control
  characters is the entire job. The rule stays on everywhere else on
  purpose: it is what catches a `\b` that lost a backslash on its way to
  disk and became a literal backspace, which is exactly how the reader-
  privacy check on the Server page came to match nothing at all and report
  a clean result unconditionally.
*/
const CONTROL = new RegExp(
  // NUL through backspace, vertical tab and form feed, then SO through US, and DEL.
  // eslint-disable-next-line no-control-regex
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]",
  "g",
);

/**
 * Editorial and model-written text: strip what cannot be stored.
 *
 * Applied in two places, both of them deliberate. At the door, where text
 * ENTERS the app from a source that a model will later read (ingest.ts,
 * dark.ts, investigate.ts), so that the dozen columns it eventually reaches do
 * not each need to remember. And at the write, for text the MODEL produced --
 * a lead's fields, a run's summary, a proposed source's reason -- because a
 * model's output has no earlier door to be cleaned at.
 *
 * See the module docstring for why this deletes where `postgresText` replaces.
 */
export function storableText(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(CONTROL, "");
}

/**
 * Captured evidence text: make it storable WITHOUT changing the content hash.
 *
 * Only NUL is a hard error for Postgres; the other C0 controls it accepts, and
 * removing them here would move the hash of a page whose bytes have not
 * changed. U+FFFD is chosen over deletion for the same reason -- the position
 * of the byte is part of what the page said. See the module docstring.
 */
export function postgresText(value: string): string {
  return value.split("\u0000").join("\uFFFD");
}
