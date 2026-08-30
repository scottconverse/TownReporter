/**
 * Make fetched text safe to store.
 *
 * Postgres rejects a NUL byte anywhere in a `text` value — "invalid byte
 * sequence for encoding UTF8: 0x00" — and it is not an exotic input: PDFs,
 * some HTML, and anything served with a mislabelled encoding carry them
 * routinely. A single NUL in one fetched page killed an entire dark desk round
 * three minutes in, after twenty-one documents had already been read, and took
 * the whole investigation down with it.
 *
 * Also strips the other C0 control characters, which cannot appear in valid
 * text — keeping tab, newline and carriage return, which can.
 *
 * Applied where text ENTERS the app rather than at each insert. There are a
 * dozen places this text eventually gets written, and the next one added would
 * not know to call a sanitizer.
 */
/*
  On the no-control-regex rule: this is the sanitiser, so matching control
  characters is the entire job. The rule stays on everywhere else on
  purpose: it is what catches a `\b` that lost a backslash on its way to
  disk and became a literal backspace, which is exactly how the reader-
  privacy check on the Server page came to match nothing at all and report
  a clean result unconditionally.
*/
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp(
  // NUL through backspace, vertical tab and form feed, then SO through US, and DEL.
  // eslint-disable-next-line no-control-regex
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]",
  "g",
);

export function storableText(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(CONTROL, "");
}
