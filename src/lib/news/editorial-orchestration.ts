import {
  RESEARCH_INSTRUCTIONS,
  buildEditorialPack,
  buildWritingPack,
  parseEditorial,
  type Editorial,
  type EditorialPointer,
} from "./editorial.ts";
import { opinionModelChoice, type OpinionModelChoice } from "./model-choice.ts";

export type WriteEditorialInput = {
  userId: string;
  newsroomId: number;
  subject: string;
  pointers: EditorialPointer[];
  ourStory?: { headline: string; url: string; dek?: string };
  askedFor?: string;
  /** For the record on the draft: what this was written from. */
  sourceKind: string;
  sourceRef: string;
  leadId?: number | null;
  modelChoice?: OpinionModelChoice;
  /** Present only for a queued Opinion job whose filing must complete atomically. */
  completion?: { requestId: number; jobId: number };
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

type CommonChatInput = {
  system: string;
  user: string;
  model: string;
  timeoutMs: number;
};

type CodexChatInput = CommonChatInput & {
  systemPromptText?: string;
  webSearch?: boolean;
};

export type EditorialOrchestrationRuntime = {
  findVoiceFile: () => Promise<
    { ok: true; voice: { path: string; bytes: number } } | { ok: false; error: string }
  >;
  readVoiceTextForOpenAiCodex: () => Promise<
    { ok: true; text: string } | { ok: false; error: string }
  >;
  codexChat: (input: CodexChatInput) => Promise<ChatResult>;
  runClaudePair: (context: {
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
  codexModel: string;
};

const REFUSAL_OPENING = [
  /^\s*EDITORIAL_REFUSAL\s*:/i,
  /\b(?:i|we)\s+(?:can(?:not|'t)|won't|will not|am unable to|are unable to)\s+(?:provide|write|produce|draft|create|deliver|endorse|advocate|adopt|take)\b/i,
  /\bas an (?:ai|artificial intelligence|language model)\b/i,
  /\b(?:cannot|can't|won't|will not|unable to)\b.{0,180}\b(?:editorial|op-?ed|advocacy|policy position|recommendation)\b/is,
];

/**
 * Transport success is not editorial success. This gate is deliberately
 * provider-neutral: a refusal or assistant note from any model must never be
 * normalized into the newspaper's headline and offered for publication.
 */
export function validateEditorialDelivery(raw: string, editorial: Editorial): string | null {
  const normalized = String(raw ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
  const opening = normalized.slice(0, 1_200);
  const summarySubstitute =
    /\b(?:summary|overview)\s+(?:below|that follows)\b/i.test(opening) &&
    /\b(?:instead|rather than|not (?:an?|the))\b/i.test(opening);

  if (REFUSAL_OPENING.some((pattern) => pattern.test(opening)) || summarySubstitute) {
    return "The selected model declined to produce the requested editorial. Nothing was filed.";
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
    subject: input.subject,
    pointers: input.pointers,
    ourStory: input.ourStory,
    askedFor: input.askedFor,
  });

  const runPair = async (choice: EffectiveOpinionModelChoice): Promise<ChatResult> => {
    if (choice === "claude-frontier") {
      return runtime.runClaudePair({ input, found, researchPack });
    }

    const research = await runtime.codexChat({
      system: RESEARCH_INSTRUCTIONS,
      user: researchPack,
      model: runtime.codexModel,
      timeoutMs: runtime.timeoutMs(),
      webSearch: true,
    });
    if (!research.ok) return research;

    const voice = await runtime.readVoiceTextForOpenAiCodex();
    if (!voice.ok) return voice;
    return runtime.codexChat({
      system: "",
      systemPromptText: voice.text,
      user: buildWritingPack({
        subject: input.subject,
        ourStory: input.ourStory,
        askedFor: input.askedFor,
        research: research.text,
      }),
      model: runtime.codexModel,
      timeoutMs: runtime.timeoutMs(),
    });
  };

  const requested = opinionModelChoice(input.modelChoice);
  const candidates: EffectiveOpinionModelChoice[] =
    requested === "auto" ? ["codex-frontier", "claude-frontier"] : [requested];
  const failures: string[] = [];

  for (const candidate of candidates) {
    const out = await runPair(candidate);
    if (!out.ok) {
      failures.push(out.error);
      continue;
    }

    const editorial = parseEditorial(out.text);
    const invalid = validateEditorialDelivery(out.text, editorial);
    if (invalid) {
      failures.push(invalid);
      continue;
    }

    const filed = await runtime.fileEditorial(input, editorial, candidate);
    if (!filed.ok) return filed;
    return { ...filed, modelChoice: candidate };
  }

  if (requested !== "auto") return { ok: false, error: failures[0] ?? "The model failed." };
  const detail = failures.filter(Boolean).join(" ");
  return {
    ok: false,
    error:
      `Automatic could not produce an editorial with Codex Sol or Claude Opus. ${detail} Nothing was filed.`
        .replace(/\s+/g, " ")
        .trim(),
  };
}
