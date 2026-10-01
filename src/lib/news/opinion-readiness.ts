import {
  opinionModelChoice,
  OPINION_AUTOMATIC_LADDER,
  opinionProviderProblem,
  type OpinionModelChoice,
} from "./model-choice.ts";
import type { LocalModelOverride } from "./ai.ts";

type VoiceProbe = { ok: true; voice: { path: string } } | { ok: false; error: string };

type CandidateChoice = Exclude<OpinionModelChoice, "auto">;
type CandidateProbe =
  | { ok: true; label: string; choice: CandidateChoice | "configured"; localModel?: LocalModelOverride }
  | { ok: false; error: string };

/**
 * Which models Opinion writes with, and which of them this failure is about
 * (units U24, U24b, U29).
 *
 * The stand-in editorial day's finding: /desk/opinion said "AI is not
 * available. No model is set up yet…" minutes after a draft ran on DeepSeek.
 * The sentence was true of Opinion and read as true of the desk, because it
 * never said which models it meant.
 *
 * U24's first draft of this sentence listed four paths and said none of them
 * was set up, which was too broad in the other direction: a local model and a
 * saved connection are offered as EXPLICIT PICKS (`OPINION_MODEL_CHOICES`),
 * never walked by Automatic, so "a local model is not set up" reads as a
 * verdict on a path this failure never tried. U24b narrows it to the truth:
 * Automatic's own ladder, in the order it walks it
 * (`OPINION_AUTOMATIC_LADDER`), and the other two named as what they are --
 * choices the editor can pick by name.
 *
 * U29 (owner decision 2026-09-30) added DeepSeek v4.1 Flash as that ladder's
 * FIRST rung and made it nameable in Opinion's own menu, so the old closing
 * sentence -- "the desk's story writer is a different list and is not used for
 * Opinion" -- stopped being true: DeepSeek IS the model the story desk drafts
 * with. It is replaced by what is actually true and worth knowing: the same
 * model writes both desks' work, and Opinion reaches it first.
 *
 * Written to be true in every state this can be shown in: it is only ever
 * appended when EVERY rung's probe failed, so "none of them answered" is a
 * fact about the attempts, and each rung's own sentence (see
 * `opinionProviderProblem`) says what is missing for that one.
 */
export const OPINION_MODEL_UNIVERSE =
  "Opinion's Automatic writes with DeepSeek v4.1 Flash, then Codex Sol, then Claude Sonnet, and none of them answered. Two more models are yours to pick by name in Opinion's model menu: a local model, or a saved connection. DeepSeek is also the model the desk's story writer drafts with, and Opinion reaches it first.";

/**
 * The first rung of Opinion's Automatic ladder that answers right now, or
 * null when none does.
 *
 * This is what "Automatic" MEANS, and why it is asked at two moments rather
 * than assumed once: a run that starts on a rung the desk cannot reach spends
 * nothing and gets nothing. It matters more since unit U29, because the head
 * of Opinion's ladder is now DeepSeek v4.1 Flash on an Ollama endpoint a
 * given machine may not have -- a desk running only Claude Code used to be
 * able to take `OPINION_AUTOMATIC_LADDER[0]` on faith, and cannot any more.
 *
 * The walk is `OPINION_AUTOMATIC_LADDER`'s order, read from the registry, so
 * reordering or retiring a rung changes what this resolves without the
 * callers being touched. `probe` is injected: the job passes the same
 * `probeProvider` its document pass uses, and a test passes a fake.
 */
export async function firstReadyOpinionRung(
  probe: (choice: CandidateChoice) => Promise<{ ok: boolean }>,
): Promise<CandidateChoice | null> {
  for (const rung of OPINION_AUTOMATIC_LADDER) {
    const ready = await probe(rung);
    if (ready.ok) return rung;
  }
  return null;
}

export type OpinionReadinessDeps = {
  findVoice?: () => Promise<VoiceProbe>;
  probeCandidate?: (choice: CandidateChoice, newsroomId?: number) => Promise<CandidateProbe>;
};

async function defaultVoiceProbe(): Promise<VoiceProbe> {
  const { findVoiceFile } = await import("./voice.server.ts");
  return findVoiceFile();
}

/** Opinion's Claude path is the native CLI, not the separate Anthropic API path. */
async function probeClaudeFrontier(): Promise<CandidateProbe> {
  const { resolveClaudeCode } = await import("./ai.ts");
  if (!resolveClaudeCode()) {
    return {
      ok: false,
      error:
        "Claude Code is unavailable. Open Claude Code on this machine, sign in, then try again.",
    };
  }
  const { probeClaudeCode } = await import("./ai-claude-code.server.ts");
  const result = await probeClaudeCode("Claude Opus");
  return result.ok ? { ...result, choice: "claude-frontier" } : result;
}

/**
 * Dispatches by candidate instead of always probing Claude.
 *
 * Before this, every candidate -- including an explicit "local-model" pick --
 * ran the SAME Claude Code CLI probe regardless of `choice`, because the only
 * caller ever passed the single hardcoded "claude-frontier" candidate below.
 * That is audit finding "Opinion 'Local model' pick silently uses Claude":
 * readiness checked (and the commit boundary then persisted and queued)
 * Claude even when the editor picked something else. Every candidate Opinion
 * can offer besides Claude speaks the same generic OpenAI-compatible
 * transport every other surface uses, so it is probed the same way Story and
 * Scan probe an explicit pick: `probeProvider(choice)` in ai.ts.
 */
async function defaultCandidateProbe(
  choice: CandidateChoice,
  newsroomId?: number,
): Promise<CandidateProbe> {
  if (choice === "claude-frontier") return probeClaudeFrontier();
  const { probeProvider } = await import("./ai.ts");
  const result = await probeProvider(choice, newsroomId, undefined, "opinion");
  if (!result.ok) return result;
  // `probeProvider` can answer "configured" for Automatic's internal gateway
  // pin; an explicit named pick never goes through that path, so normalise
  // back to the candidate that was actually asked for.
  return { ...result, choice: result.choice === "configured" ? "configured" : choice };
}

/** Free readiness check used by both the page and the commit boundary. */
export async function checkOpinionReadiness(
  choice: OpinionModelChoice,
  deps: OpinionReadinessDeps = {},
  newsroomId?: number,
) {
  const problems: string[] = [];
  const voice = await (deps.findVoice ?? defaultVoiceProbe)();
  if (!voice.ok) problems.push(voice.error);

  // Automatic may start when any rung of its ladder is ready -- DeepSeek v4.1
  // Flash first, then Codex Sol, then Claude Sonnet (OPINION_AUTOMATIC_LADDER,
  // read from the registry). Explicit choices probe only themselves and remain
  // fixed at runtime.
  const candidates: readonly CandidateChoice[] =
    choice === "auto" ? OPINION_AUTOMATIC_LADDER : ([choice] as const);
  let selected: CandidateProbe | undefined;
  const providerProblems: string[] = [];
  const probeCandidate = deps.probeCandidate ?? defaultCandidateProbe;
  for (const candidate of candidates) {
    const probe = await probeCandidate(candidate, newsroomId);
    if (probe.ok) {
      selected = probe;
      break;
    }
    providerProblems.push(opinionProviderProblem(probe.error, candidate));
  }
  if (!selected) {
    /*
      Unit U24: which models Opinion has at all, then what is missing for each
      rung it just tried. Automatic only -- an editor who picked one model on
      purpose is owed that model's own answer, not a list of the others.
    */
    if (choice === "auto") problems.push(OPINION_MODEL_UNIVERSE);
    problems.push(...providerProblems);
  }
  // Automatic must remain Automatic on the queued request. Readiness proves
  // that at least one rung can start; runtime owns pair-level fallthrough when
  // the first ready provider later errors or returns an invalid editorial.
  const effectiveChoice =
    choice === "auto"
      ? "auto"
      : selected?.ok && selected.choice !== "configured"
        ? opinionModelChoice(selected.choice)
        : choice;
  return {
    ready: problems.length === 0,
    why: problems.join(" "),
    problems,
    effectiveChoice,
    ...(selected?.ok && selected.localModel ? { localModel: selected.localModel } : {}),
  };
}
