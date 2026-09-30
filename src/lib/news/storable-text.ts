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
 * they were editing. `sanitizeJsonLeaves` is not a third policy: it is
 * `storableText` applied to a whole JSON structure, for the columns that are
 * stringified on the way in and re-parsed as jsonb on the way out.
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
 * Model-written data on its way into a JSON column: every string leaf through
 * `storableText`.
 *
 * `JSON.stringify` is NOT a guard, and that is the whole reason this function
 * exists. A real U+0000 in a string comes back out of `JSON.stringify` as the
 * JSON escape -- six characters, no NUL byte anywhere -- so a value written to
 * a `text` column looks clean and the INSERT succeeds. The failure is one step
 * later: as soon as that column is read back through `::jsonb` (a
 * `result_json` receipt merged with `||`, a `research_json` projected for the
 * desk screen), Postgres PARSES the escape and refuses the whole statement
 * with "unsupported Unicode escape sequence" -- jsonb, unlike text, has
 * nowhere to put a NUL. The write looked fine; the read is what dies, and it
 * dies far from the model call that put the byte there.
 *
 * So the guard goes on the value BEFORE the stringify, at the write: walk the
 * structure, run every string leaf through `storableText`, and leave
 * everything that is not a string -- numbers, booleans, null, and the keys
 * themselves -- exactly as it is. Plain objects and arrays are copied; anything
 * else (a Date, a class instance) is passed through untouched rather than
 * flattened into `{}` by an `Object.entries` walk it was never meant for.
 *
 * `storableText`, not `postgresText`: this is what the desk or a model WROTE,
 * never a captured page, so the byte is dropped rather than replaced. See the
 * module docstring.
 */
export function sanitizeJsonLeaves<T>(value: T): T {
  if (typeof value === "string") return storableText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonLeaves(item)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const proto: unknown = Object.getPrototypeOf(value);
    /*
      Plain objects only. `Object.entries(new Date())` is empty, so recursing
      into anything that is not a plain record would silently turn a Date into
      `{}` -- a corruption this function would then be the cause of.
    */
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = sanitizeJsonLeaves(item);
    return out as unknown as T;
  }
  return value;
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
