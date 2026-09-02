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
async function defaultCandidateProbe(choice: CandidateChoice): Promise<CandidateProbe> {
  if (choice === "codex-frontier") {
    const { probeProvider } = await import("./ai.ts");
    const result = await probeProvider(choice);
    return result.ok ? { ...result, choice } : result;
  }

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
  return result.ok ? { ...result, choice } : result;
}

/** Free readiness check used by both the page and the commit boundary. */
export async function checkOpinionReadiness(
  choice: OpinionModelChoice,
  deps: OpinionReadinessDeps = {},
) {
  const problems: string[] = [];
  const voice = await (deps.findVoice ?? defaultVoiceProbe)();
  if (!voice.ok) problems.push(voice.error);

  const candidates =
    choice === "auto" ? (["codex-frontier", "claude-frontier"] as const) : ([choice] as const);
  let selected: CandidateProbe | undefined;
  const providerProblems: string[] = [];
  const probeCandidate = deps.probeCandidate ?? defaultCandidateProbe;
  for (const candidate of candidates) {
    const probe = await probeCandidate(candidate);
    if (probe.ok) {
      selected = probe;
      break;
    }
    providerProblems.push(opinionProviderProblem(probe.error));
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
