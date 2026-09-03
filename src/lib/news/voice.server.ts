import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

/**
 * The editorial voice, kept at arm's length.
 *
 * The voice file is the operator's own writing style, developed over months. It
 * is deliberately NOT in this repository, which is public, and this module
 * exists to make sure it stays that way by construction rather than by
 * remembering.
 *
 * Two rules, both enforced here:
 *
 *  1. The ordinary lookup returns only a path. Claude Code reads that path via
 *     `--system-prompt-file`. The separately authorized OpenAI Codex path may
 *     read the text through `readVoiceTextForOpenAiCodex`; that text travels
 *     over stdin and is never placed on a command line.
 *
 *  2. That matters more than it sounds. Command-line arguments are readable by
 *     every process on the machine — this session listed running processes and
 *     their full command lines earlier today, and another agent shares this box.
 *     Passing 98KB of private prose as an argument would both exceed Windows'
 *     32,767-character limit and publish it to anything that runs `ps`.
 *
 * Nothing here logs the path's contents, and errors name the setting rather
 * than quoting the file.
 */
export const VOICE_ENV = "TOWNREPORTER_VOICE_FILE";

export const VOICE_MISSING =
  `No editorial voice is configured. Set ${VOICE_ENV} in .env to the full path of ` +
  `the voice file, which must live outside this repository.`;

export type VoiceFile = {
  /** Absolute path. The ONLY thing that leaves this module. */
  path: string;
  bytes: number;
};

/**
 * Locate the voice file, or explain why not.
 *
 * Never throws: a missing voice must degrade to "you cannot write an editorial
 * yet", not to a stack trace on the desk.
 */
export async function findVoiceFile(): Promise<
  { ok: true; voice: VoiceFile } | { ok: false; error: string }
> {
  const raw = process.env[VOICE_ENV]?.trim();
  if (!raw) return { ok: false, error: VOICE_MISSING };

  const path = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);

  /*
    A relative path would resolve against the app's working directory, which is
    inside the public repo. Refuse rather than quietly read a file from there.
  */
  if (!isAbsolute(raw)) {
    return {
      ok: false,
      error: `${VOICE_ENV} must be an absolute path outside this repository. Got a relative path.`,
    };
  }

  /*
    Canonicalise BOTH sides before comparing.

    This was a lexical `startsWith` on the raw strings, which an audit noted
    could be walked around (ENG-009): an absolute path outside the checkout
    that is a symlink or a junction back to a file inside it passes the string
    test, and `stat` follows links — so the "outside this repository" promise
    was stronger than the check enforcing it.

    `realpath` resolves links on both sides and `relative` then answers the
    containment question properly, instead of a prefix match that would also
    treat a sibling directory sharing the repository's name as inside it.

    A path that does not exist yet cannot be canonicalised; that case falls
    through to the `stat` below, which reports it honestly.
  */
  let realCandidate = path;
  let realRepo = process.cwd();
  try {
    realCandidate = await realpath(path);
  } catch {
    /* not there yet — stat reports it below */
  }
  try {
    realRepo = await realpath(process.cwd());
  } catch {
    /* cwd resolves in practice */
  }

  const rel = relative(realRepo, realCandidate);
  const inRepo = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  if (inRepo) {
    return {
      ok: false,
      error:
        `${VOICE_ENV} resolves to a file inside this repository, which is public. ` +
        `Move the voice file somewhere outside it and update the path. ` +
        `A link that points back inside counts as inside.`,
    };
  }

  try {
    const info = await stat(realCandidate);
    if (!info.isFile()) return { ok: false, error: `${VOICE_ENV} does not point at a file.` };
    if (info.size < 500) {
      return { ok: false, error: `The voice file at ${VOICE_ENV} looks empty or truncated.` };
    }
    return { ok: true, voice: { path, bytes: info.size } };
  } catch {
    // The path itself is safe to name — it is a location, not the writing.
    return { ok: false, error: `Cannot read the voice file at ${path}.` };
  }
}

/**
 * The shared read behind every destination-specific voice-text export below.
 * Never exported directly -- each caller gets its own destination-named
 * wrapper so a future provider cannot inherit an existing authorization by
 * accident (see the two exports immediately below).
 */
async function readVoiceText(): Promise<
  { ok: true; text: string } | { ok: false; error: string }
> {
  const found = await findVoiceFile();
  if (!found.ok) return found;
  try {
    // Resolve again at the read boundary. Callers cannot use this helper to
    // send an arbitrary path, and a changed link is checked by findVoiceFile.
    const canonical = await realpath(found.voice.path);
    const text = await readFile(canonical, "utf8");
    if (Buffer.byteLength(text, "utf8") !== found.voice.bytes) {
      return { ok: false, error: `The editorial voice changed while it was being read. Try again.` };
    }
    return { ok: true, text };
  } catch {
    return { ok: false, error: `Cannot read the voice file configured by ${VOICE_ENV}.` };
  }
}

/**
 * Read the validated voice for the operator-authorized OpenAI Codex Opinion
 * path. Keep this as a destination-named function so a future provider cannot
 * inherit that authorization accidentally.
 */
export async function readVoiceTextForOpenAiCodex(): Promise<
  { ok: true; text: string } | { ok: false; error: string }
> {
  return readVoiceText();
}

/**
 * Read the validated voice for an explicit "Local model" Opinion pick.
 *
 * A local server speaks the OpenAI-compatible chat-completions protocol
 * only -- there is no `--system-prompt-file` equivalent over HTTP -- so its
 * voice travels as an ordinary system-message string instead of a file path,
 * the same way the Codex path above already sends it over stdin rather than
 * a file. Destination-named for the same reason `readVoiceTextForOpenAiCodex`
 * is: so a future provider cannot inherit this authorization accidentally.
 */
export async function readVoiceTextForLocalModel(): Promise<
  { ok: true; text: string } | { ok: false; error: string }
> {
  return readVoiceText();
}

/**
 * A guard for anything that builds a command line.
 *
 * Passing the voice as an argument is the one mistake that would leak it, so
 * this refuses loudly rather than truncating or hoping. Call it before spawning
 * anything with a large argument.
 */
export function assertNotAnArgument(value: string, what = "argument"): void {
  if (value.length > 8000) {
    throw new Error(
      `Refusing to pass ${value.length} characters as a command-line ${what}. ` +
        `Long prompts go through stdin or a --*-file flag; arguments are visible ` +
        `to every process on this machine.`,
    );
  }
}
