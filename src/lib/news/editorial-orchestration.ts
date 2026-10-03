import {
  buildEditorialPack,
  parseEditorial,
  type Editorial,
  type EditorialPointer,
  type NewsroomIdentity,
} from "./editorial.ts";
import {
  isCustomModelChoice,
  opinionModelChoice,
  OPINION_AUTOMATIC_LADDER,
  type OpinionModelChoice,
} from "./model-choice.ts";
import { providerEntry, providerRunsToolPass, type ModelEffort } from "./provider-registry.ts";
import {
  automaticFailoverReason,
  type AutomaticFailoverReason,
} from "./automatic-failover.ts";
import type { LocalModelOverride } from "./ai.ts";

export type WriteEditorialInput = {
  userId: string;
  newsroomId: number;
  subject: string;
  /** Complete private material pasted by the editor. */
  sourceText?: string;
  suppliedMaterialCap?: number;
  pointers: EditorialPointer[];
  ourStory?: { headline: string; url: string; dek?: string };
  askedFor?: string;
  /** For the record on the draft: what this was written from. */
  sourceKind: string;
  sourceRef: string;
  leadId?: number | null;
  /** The paper this runs in, for the desk note; the Longmont default when absent. */
  paper?: NewsroomIdentity;
  modelChoice?: OpinionModelChoice;
  modelEffort?: ModelEffort | null;
  /** Exact local endpoint/model preflighted when this queued request was created. */
  localModel?: LocalModelOverride;
  /** Immutable editor selection retained when an earlier Opinion stage switched. */
  requestedModelChoice?: OpinionModelChoice;
  requestedModelEffort?: ModelEffort | null;
  /** Present only for a queued Opinion job whose filing must complete atomically. */
  completion?: { requestId: number; jobId: number };
  /**
   * The queued job's own stage reporter, when this piece is one (unit U30).
   *
   * `performEditorialWork` binds it to `progressReporterFor(job)`, the FB1
   * shape: one sentence moves the card's "Now:" line AND lights the stage chip
   * the sentence names. The writer cannot build that itself -- it is handed an
   * id, not the job row the stage list was read off -- so the reporter is
   * threaded down here rather than looked up again. Absent in a direct call
   * (a test, an inline write), where the desk pass reports through
   * `setJobStage` or not at all.
   */
  onStage?: (stage: string) => Promise<void>;
};

export type EffectiveOpinionModelChoice = Exclude<OpinionModelChoice, "auto">;

export type FiledEditorialResult =
  | { ok: true; draftId: number; headline: string; words: number; hadAppendix: boolean }
  | { ok: false; error: string };

export type WriteEditorialResult =
  | {
      ok: true;
      draftId: number;
      headline: string;
      words: number;
      hadAppendix: boolean;
      modelChoice: EffectiveOpinionModelChoice;
    }
  | { ok: false; error: string };

type ChatResult = { ok: true; text: string } | { ok: false; error: string };

export type EditorialOrchestrationRuntime = {
  findVoiceFile: () => Promise<
    { ok: true; voice: { path: string; bytes: number } } | { ok: false; error: string }
  >;
  runClaudePair: (context: {
    input: WriteEditorialInput;
    found: { ok: true; voice: { path: string; bytes: number } };
    researchPack: string;
  }) => Promise<ChatResult>;
  runCodexPair?: (context: {
    input: WriteEditorialInput;
    found: { ok: true; voice: { path: string; bytes: number } };
    researchPack: string;
  }) => Promise<ChatResult>;
  /**
   * The one-pass pair, for every OpenAI-compatible writer: the "Local model"
   * pick, and (unit U29) Automatic's DeepSeek v4.1 Flash rung.
   *
   * A local/Ollama/llama.cpp server has no research-tool loop the way the
   * Claude Code CLI does (see EDITORIAL_TOOLS), so there is no gathering pass
   * for THE MODEL to run. Since unit U30 there is still research: the DESK runs
   * its own bounded pass first (searching, opening and capturing pages through
   * the Dark Desk's machinery -- see ./editorial-research.server.ts), the same
   * no-tool provider plans the queries and reads the captures back as findings,
   * and this pair then makes the one writing call it always made: the voice as
   * the system instructions, no tools, from the desk's record with every
   * capture's URL and id in it. Required (not optional) so a local pick can
   * never silently fall through to `runClaudePair` -- see the Opinion routing
   * fix, audit finding "Opinion 'Local model' pick silently uses Claude".
   */
  runLocalPair: (context: {
    input: WriteEditorialInput;
    found: { ok: true; voice: { path: string; bytes: number } };
    researchPack: string;
  }) => Promise<ChatResult>;
  /** Explicit custom picks receive the same authorized one-pass Opinion pack. */
  runCustomPair: (context: {
    input: WriteEditorialInput;
    found: { ok: true; voice: { path: string; bytes: number } };
    researchPack: string;
  }) => Promise<ChatResult>;
  fileEditorial: (
    input: WriteEditorialInput,
    editorial: Editorial,
    modelChoice: EffectiveOpinionModelChoice,
  ) => Promise<FiledEditorialResult>;
  timeoutMs: () => number;
  onTechnicalFallback?: (input: {
    previous: EffectiveOpinionModelChoice;
    next: EffectiveOpinionModelChoice;
    reason: AutomaticFailoverReason;
  }) => Promise<void>;
};

const REFUSAL_OPENING = [
  /^\s*EDITORIAL_REFUSAL\s*:/i,
  /^(?:(?:i am|i'm) sorry[,.]?\s*)?(?:i|we)\s+(?:can(?:not|'t)|won't|will not|am unable to|are unable to)\s+(?:provide|write|produce|draft|create|deliver)\s+(?:(?:the|a|an|your|that|this|requested|complete|full|advocacy|political|persuasive)\s+)*(?:editorial|op-?ed|article|piece|column)\b/i,
  /^as an (?:ai|artificial intelligence|language model)\b/i,
];

/** Provider adapters can report a refusal as an error rather than a successful
 * text response. Automatic must not use another model to bypass it. */
function isProviderRefusal(error: string): boolean {
  const opening = error
    .replace(/[\u2018\u2019]/g, "'")
    .trim()
    .slice(0, 1_200);
  return (
    /\b(?:declined|refused) (?:this request|to (?:write|produce|draft|create|deliver))\b/i.test(
      opening,
    ) ||
    /\b(?:i|we) (?:cannot|can't|won't|will not|am unable to|are unable to) (?:provide|write|produce|draft|create|deliver)\b/i.test(
      opening,
    ) ||
    /EDITORIAL_REFUSAL\s*:/i.test(opening)
  );
}

/**
 * Transport success is not editorial success. This gate is deliberately
 * provider-neutral: a refusal or assistant note from any model must never be
 * normalized into the newspaper's headline and offered for publication.
 */
export function validateEditorialDelivery(raw: string, editorial: Editorial): string | null {
  // Refusing to generate the requested article is not the same as the
  // article refusing to endorse a proposal. Inspect delivery starts only;
  // quoted speech and ordinary disagreement inside the piece are content.
  const starts = [raw, editorial.headline, editorial.body].map((text) =>
    String(text ?? "")
      .replace(/[\u2018\u2019]/g, "'")
      .trim()
      .replace(/^(?:#{1,6}\s+|\*{1,2}|_)+/, "")
      .replace(/^OPINION\s*[:\u2014-]\s*/i, "")
      .slice(0, 1_200),
  );
  const refused = starts.some((opening) => {
    const summarySubstitute =
      /^(?:(?:the )?(?:summary|overview)\s+(?:below|that follows)|here(?:'s| is)\s+(?:a|the)\s+neutral (?:summary|overview))\b/i.test(
        opening,
      ) && /\b(?:instead|rather than|not (?:an?|the))\b/i.test(opening);
    return REFUSAL_OPENING.some((pattern) => pattern.test(opening)) || summarySubstitute;
  });

  if (refused) {
    const reason = String(raw)
      .match(/EDITORIAL_REFUSAL\s*:\s*([^\r\n]{1,500})/i)?.[1]
      ?.trim();
    return `The selected model declined to produce the requested editorial${reason ? `: ${reason}` : ""}. Nothing was filed.`;
  }
  const headline = editorial.headline.trim();
  if (!headline) return "The selected model returned no usable headline. Nothing was filed.";
  if (headline.length > 180) {
    return "The selected model returned an invalid editorial headline. Nothing was filed.";
  }
  if (DELIVERY_META.test(headline)) {
    return "The selected model returned an assistant note instead of an editorial. Nothing was filed.";
  }
  const words = editorial.body.split(/\s+/).filter(Boolean).length;
  if (words < 80) {
    return "The selected model returned an incomplete editorial. Nothing was filed.";
  }
  return null;
}

const DELIVERY_META =
  /\b(?:here(?:'s| is) (?:the|an?) (?:piece|editorial|draft)|requested (?:piece|editorial)|neutral summary|policy disclaimer)\b/i;

/** Pure provider/voice/file sequencing; production effects arrive only through runtime. */
export async function orchestrateEditorial(
  input: WriteEditorialInput,
  runtime: EditorialOrchestrationRuntime,
): Promise<WriteEditorialResult> {
  const found = await runtime.findVoiceFile();
  if (!found.ok) return { ok: false, error: found.error };

  const researchPack = buildEditorialPack({
    paper: input.paper,
    subject: input.subject,
    sourceText: input.sourceText,
    suppliedMaterialCap: input.suppliedMaterialCap,
    pointers: input.pointers,
    ourStory: input.ourStory,
    askedFor: input.askedFor,
  });

  /* Automatic tries the ladder in order. An explicit choice is preferred;
     only a classified technical failure may move it to the same
     ready-provider ladder. Provider refusals always stop. */
  const runPair = async (candidate: EffectiveOpinionModelChoice): Promise<ChatResult> => {
    const candidateInput = { ...input, modelChoice: candidate };
    if (isCustomModelChoice(candidate)) {
      return runtime.runCustomPair({ input: candidateInput, found, researchPack });
    }
    /*
      Which pair a candidate runs on is read from the REGISTRY, not from its
      id (unit U29). `providerRunsToolPass` is the question the two-pass flow
      turns on: a provider with a WebSearch/WebFetch loop gets the Claude or
      Codex pair (gathering pass first, then the writing pass); one without
      -- the "Local model" pick and Automatic's DeepSeek v4.1 Flash rung, both
      Ollama / llama.cpp endpoints -- has no gathering pass to run, so it gets
      the ONE-PASS pair. A local entry added to the ladder later inherits that
      behavior without this function being touched.
    */
    const entry = providerEntry(candidate);
    if (entry?.kind === "codex") {
      return runtime.runCodexPair
        ? runtime.runCodexPair({ input: candidateInput, found, researchPack })
        : { ok: false, error: "Codex is unavailable." };
    }
    return providerRunsToolPass(entry)
      ? runtime.runClaudePair({ input: candidateInput, found, researchPack })
      : runtime.runLocalPair({ input: candidateInput, found, researchPack });
  };

  const requested = opinionModelChoice(input.modelChoice);
  const candidates: readonly EffectiveOpinionModelChoice[] = requested === "auto"
    ? OPINION_AUTOMATIC_LADDER
    : [requested, ...OPINION_AUTOMATIC_LADDER.filter((choice) => choice !== requested)];
  const failures: string[] = [];
  let pendingFallback: { previous: EffectiveOpinionModelChoice; reason: AutomaticFailoverReason } | null = null;

  for (const candidate of candidates) {
    if (pendingFallback) {
      await runtime.onTechnicalFallback?.({ ...pendingFallback, next: candidate });
      pendingFallback = null;
    }
    const out = await runPair(candidate);
    if (!out.ok) {
      if (isProviderRefusal(out.error)) return { ok: false, error: out.error };
      failures.push(out.error);
      const reason = automaticFailoverReason(out.error);
      if (requested !== "auto" && !reason) return { ok: false, error: out.error };
      if (reason) pendingFallback = { previous: candidate, reason };
      continue;
    }

    const editorial = parseEditorial(out.text);
    const invalid = validateEditorialDelivery(out.text, editorial);
    if (invalid) {
      if (/declined to produce the requested editorial/i.test(invalid)) {
        return { ok: false, error: invalid };
      }
      failures.push(invalid);
      if (requested !== "auto") {
        return { ok: false, error: invalid };
      }
      continue;
    }

    const filed = await runtime.fileEditorial(input, editorial, candidate);
    if (!filed.ok) return filed;
    return { ...filed, modelChoice: candidate };
  }

  if (requested !== "auto") {
    const detail = failures.filter(Boolean).join(" ");
    return { ok: false, error: `No fallback Opinion provider could produce an editorial. ${detail} Nothing was filed.`.replace(/\s+/g, " ").trim() };
  }
  const detail = failures.filter(Boolean).join(" ");
  return {
    ok: false,
    error: `No automatic Opinion provider could produce an editorial. ${detail} Nothing was filed.`
      .replace(/\s+/g, " ")
      .trim(),
  };
}
