import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

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
 *  1. This module never returns the file's CONTENTS. It returns a path. The
 *     model CLI reads the file itself via `--system-prompt-file`.
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

  const inRepo = path.replace(/\\/g, "/").toLowerCase().startsWith(
    process.cwd().replace(/\\/g, "/").toLowerCase() + "/",
  );
  if (inRepo) {
    return {
      ok: false,
      error:
        `${VOICE_ENV} points inside this repository, which is public. ` +
        `Move the voice file somewhere outside it and update the path.`,
    };
  }

  try {
    const info = await stat(path);
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
