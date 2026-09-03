import {
  opinionModelChoice,
  opinionProviderProblem,
  type OpinionModelChoice,
} from "./model-choice.ts";

type VoiceProbe = { ok: true; voice: { path: string } } | { ok: false; error: string };

type CandidateChoice = Exclude<OpinionModelChoice, "auto">;
type CandidateProbe =
  | { ok: true; label: string; choice: CandidateChoice | "configured" }
  | { ok: false; error: string };

export type OpinionReadinessDeps = {
  findVoice?: () => Promise<VoiceProbe>;
  probeCandidate?: (choice: CandidateChoice) => Promise<CandidateProbe>;
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
async function defaultCandidateProbe(choice: CandidateChoice): Promise<CandidateProbe> {
  if (choice === "claude-frontier") return probeClaudeFrontier();
  const { probeProvider } = await import("./ai.ts");
  const result = await probeProvider(choice);
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
) {
  const problems: string[] = [];
  const voice = await (deps.findVoice ?? defaultVoiceProbe)();
  if (!voice.ok) problems.push(voice.error);

  /*
    Automatic has always been Claude-only for Opinion (see
    OPINION_MODEL_CHOICES and local-model's missing `ladderRank` in
    provider-registry.ts): it probes the same single rung an explicit
    "claude-frontier" pick would. An explicit pick of any other offered
    candidate (today just "local-model"; Codex is excluded, see
    OPINION_MODEL_CHOICES) probes THAT candidate, and only that candidate --
    never a substitute. This is the fix for the bug documented on
    `defaultCandidateProbe` above.
  */
  const candidates: readonly CandidateChoice[] =
    choice === "auto" ? (["claude-frontier"] as const) : ([choice] as const);
  let selected: CandidateProbe | undefined;
  const providerProblems: string[] = [];
  const probeCandidate = deps.probeCandidate ?? defaultCandidateProbe;
  for (const candidate of candidates) {
    const probe = await probeCandidate(candidate);
    if (probe.ok) {
      selected = probe;
      break;
    }
    providerProblems.push(opinionProviderProblem(probe.error, candidate));
  }
  if (!selected) problems.push(...providerProblems);
  // Automatic must remain Automatic on the queued request. Readiness proves
  // that at least one rung can start; runtime owns pair-level fallthrough when
  // the first ready provider later errors or returns an invalid editorial.
  const effectiveChoice =
    choice === "auto"
      ? "auto"
      : selected?.ok && selected.choice !== "configured"
        ? opinionModelChoice(selected.choice)
        : choice;
  return { ready: problems.length === 0, why: problems.join(" "), problems, effectiveChoice };
}
