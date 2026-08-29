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
const CONTROL = new RegExp(
  // NUL through backspace, vertical tab and form feed, then SO through US, and DEL.
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]",
  "g",
);

export function storableText(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(CONTROL, "");
}
