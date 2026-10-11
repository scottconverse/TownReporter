import { lstat, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

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

export const VOICE_MISSING = "The paper's editorial voice has not been set. Add it on the Opinion screen, or choose Write anyway.";

export type VoiceMode = "paper" | "neutral";
const NEUTRAL_HOUSE_VOICE = `Write as a neutral local newspaper editorial desk. Use clear, direct language and distinguish verified facts from interpretation. Attribute opinions and evidence to their sources. Do not imply that the paper has a position beyond what the editor explicitly requested. Do not invent facts, quotes, or commitments.`;

function dataRoot(): string {
  const configured = process.env.TOWNREPORTER_DATA_ROOT?.trim() || process.env.TOWNREPORTER_DATA_DIR?.trim();
  return configured ? resolve(configured) : join(homedir(), ".townreporter-data");
}

function voicePath(mode: VoiceMode = "paper"): { path: string; error?: string } {
  if (mode === "neutral") return { path: join(dataRoot(), "editorial-neutral-voice.txt") };
  const raw = process.env[VOICE_ENV]?.trim();
  if (!raw) return { path: join(dataRoot(), "editorial-voice.txt") };
  if (!isAbsolute(raw)) {
    return { path: raw, error: `${VOICE_ENV} must be an absolute path outside this repository.` };
  }
  return { path: raw };
}

async function safeVoicePath(path: string): Promise<{ path: string; error?: string }> {
  if (!isAbsolute(path)) return { path, error: "The voice file path must be absolute." };
  const missing: string[] = [];
  let current = resolve(path);
  let candidate = current;
  for (;;) {
    try {
      candidate = await realpath(current);
      for (const part of missing) candidate = join(candidate, part);
      break;
    } catch {
      const parent = dirname(current);
      if (parent === current) break;
      missing.unshift(basename(current));
      current = parent;
    }
  }
  let repo = process.cwd();
  try {
    repo = await realpath(process.cwd());
  } catch {
    /* The process working directory normally resolves. */
  }
  const rel = relative(repo, candidate);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return {
      path: candidate,
      error: "The paper's editorial voice must be stored outside this public repository.",
    };
  }
  return { path: candidate };
}

async function prepareNeutralVoice(): Promise<
  { ok: true; path: string } | { ok: false; error: string }
> {
  const target = voicePath("neutral").path;
  try {
    if ((await lstat(target)).isSymbolicLink()) {
      return { ok: false, error: "The neutral house voice could not be prepared." };
    }
  } catch {
    /* The target has not been written yet. */
  }
  const safe = await safeVoicePath(target);
  if (safe.error) return { ok: false, error: safe.error };
  try {
    await mkdir(dirname(safe.path), { recursive: true, mode: 0o700 });
    const checked = await safeVoicePath(safe.path);
    if (checked.error) return { ok: false, error: checked.error };
    await writeFile(checked.path, NEUTRAL_HOUSE_VOICE, { encoding: "utf8", mode: 0o600 });
    return { ok: true, path: checked.path };
  } catch {
    return { ok: false, error: "The neutral house voice could not be prepared." };
  }
}

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
export async function findVoiceFile(mode: VoiceMode = "paper"): Promise<
  { ok: true; voice: VoiceFile } | { ok: false; error: string }
> {
  const neutral = mode === "neutral" ? await prepareNeutralVoice() : null;
  if (neutral && !neutral.ok) return neutral;
  const target = neutral?.ok ? { path: neutral.path } : voicePath(mode);
  if (target.error) return { ok: false, error: target.error };
  const safe = await safeVoicePath(target.path);
  if (safe.error) return { ok: false, error: safe.error };
  try {
    const info = await stat(safe.path);
    if (!info.isFile()) return { ok: false, error: `${VOICE_ENV} does not point at a file.` };
    if (mode === "paper" && info.size < 500) {
      return { ok: false, error: `The voice file at ${VOICE_ENV} looks empty or truncated.` };
    }
    return { ok: true, voice: { path: safe.path, bytes: info.size } };
  } catch {
    return { ok: false, error: mode === "paper" ? VOICE_MISSING : "The neutral house voice could not be prepared." };
  }
}

/** Read or replace the owner-managed voice without returning its filesystem path. */
export async function getPaperVoiceText(): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const found = await findVoiceFile();
  if (!found.ok) {
    if (found.error === VOICE_MISSING) return { ok: true, text: "" };
    return found;
  }
  try {
    const text = await readFile(found.voice.path, "utf8");
    return { ok: true, text };
  } catch {
    return { ok: false, error: "The paper's editorial voice could not be read." };
  }
}

export async function savePaperVoiceText(text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = text.trim();
  const byteLength = Buffer.byteLength(normalized, "utf8");
  if (byteLength < 500) return { ok: false, error: "Add at least 500 characters so the voice has enough direction." };
  if (byteLength > 200_000) return { ok: false, error: "The voice is over 200,000 bytes. Shorten it and save again." };
  const target = voicePath();
  if (target.error) return { ok: false, error: target.error };
  const safe = await safeVoicePath(target.path);
  if (safe.error) return { ok: false, error: safe.error };
  let temporary: string | undefined;
  try {
    await mkdir(dirname(safe.path), { recursive: true, mode: 0o700 });
    const checked = await safeVoicePath(safe.path);
    if (checked.error) return { ok: false, error: checked.error };
    temporary = `${checked.path}.tmp-${crypto.randomUUID()}`;
    await writeFile(temporary, normalized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, checked.path);
    return { ok: true };
  } catch {
    if (temporary) await unlink(temporary).catch(() => {});
    return { ok: false, error: "The paper's editorial voice could not be saved." };
  }
}

/**
 * The shared read behind every destination-specific voice-text export below.
 * Never exported directly -- each caller gets its own destination-named
 * wrapper so a future provider cannot inherit an existing authorization by
 * accident (see the two exports immediately below).
 */
async function readVoiceText(mode: VoiceMode = "paper"): Promise<
  { ok: true; text: string } | { ok: false; error: string }
> {
  if (mode === "neutral") {
    const neutral = await prepareNeutralVoice();
    return neutral.ok ? { ok: true, text: NEUTRAL_HOUSE_VOICE } : neutral;
  }
  const found = await findVoiceFile(mode);
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
    return { ok: false, error: "The paper's editorial voice could not be read." };
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
 * Read the validated voice for an OpenAI-compatible Opinion writer: the
 * explicit "Local model" pick, and Automatic's DeepSeek v4.1 Flash rung
 * (unit U29).
 *
 * A local/Ollama server speaks the OpenAI-compatible chat-completions
 * protocol only -- there is no `--system-prompt-file` equivalent over HTTP --
 * so its voice travels as an ordinary system-message string in the request
 * body instead of as a file path, while the Claude and Codex writers load the
 * file by path. The text is never an argument and never logged; the transport
 * that receives it puts it in the `system` message and nowhere else (see
 * ./ai.ts's OpenAI-compatible branch).
 *
 * Destination-named for the same reason `readVoiceTextForOpenAiCodex`
 * is: so a future provider cannot inherit this authorization accidentally.
 */
export async function readVoiceTextForLocalModel(mode: VoiceMode = "paper"): Promise<
  { ok: true; text: string } | { ok: false; error: string }
> {
  return readVoiceText(mode);
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
