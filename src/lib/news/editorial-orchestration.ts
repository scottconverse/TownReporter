import {
  buildEditorialPack,
  parseEditorial,
  type Editorial,
  type EditorialPointer,
  type NewsroomIdentity,
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
  /** The paper this runs in, for the desk note; the Longmont default when absent. */
  paper?: NewsroomIdentity;
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

export type EditorialOrchestrationRuntime = {
  findVoiceFile: () => Promise<
    { ok: true; voice: { path: string; bytes: number } } | { ok: false; error: string }
  >;
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
};

const REFUSAL_OPENING = [
  /^\s*EDITORIAL_REFUSAL\s*:/i,
  /^(?:(?:i am|i'm) sorry[,.]?\s*)?(?:i|we)\s+(?:can(?:not|'t)|won't|will not|am unable to|are unable to)\s+(?:provide|write|produce|draft|create|deliver)\s+(?:(?:the|a|an|your|that|this|requested|complete|full|advocacy|political|persuasive)\s+)*(?:editorial|op-?ed|article|piece|column)\b/i,
  /^as an (?:ai|artificial intelligence|language model)\b/i,
];

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
    paper: input.paper,
    subject: input.subject,
    pointers: input.pointers,
    ourStory: input.ourStory,
    askedFor: input.askedFor,
  });

  /*
    One provider, one pair. Opinion is Claude-only -- see OPINION_MODEL_CHOICES
    for why Codex left this ladder. A stored request that still says
    "codex-frontier" (none exist in production) normalises to Automatic and
    lands here rather than failing.
  */
  const runPair = async (): Promise<ChatResult> =>
    runtime.runClaudePair({ input, found, researchPack });

  const requested = opinionModelChoice(input.modelChoice);
  const candidates: EffectiveOpinionModelChoice[] = ["claude-frontier"];
  const failures: string[] = [];

  for (const candidate of candidates) {
    const out = await runPair();
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
      `Claude Opus could not produce an editorial. ${detail} Nothing was filed.`
        .replace(/\s+/g, " ")
        .trim(),
  };
}
