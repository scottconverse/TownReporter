/**
 * Who does what: the desk's job vocabulary, and the one place that answers
 * "which model runs this job, and what does it fall back to".
 *
 * The registry (./provider-registry.ts) knows models per SURFACE -- story,
 * scan, opinion, dark, forced -- which is the right question to ask at the
 * moment an editor presses a button, and the wrong question to ask when
 * setting a paper up. The owner's ask (2026-09-26, KICKOFF section C) is per
 * JOB: the daily scan, lead scoring, drafting, the opinion, the evidence
 * check, headlines, Dark Desk research, AI follow-ups, OCR and transcripts.
 *
 * Everything in this file is pure. It is the resolution order, the option
 * lists, the effort validation and the status vocabulary; the table, the
 * reads and the writes live in ./model-assignments-store.ts and the
 * server functions in ./model-assignments.server.ts, so all of this is
 * testable without a database and so a route can import the vocabulary
 * without dragging a server function into the browser bundle.
 *
 * THREE RULES FROM THE BRIEF, KEPT HERE RATHER THAN IN THE SCREEN:
 *
 * 1. Options come only from `providersFor(surface)` plus the newsroom's
 *    `custom:<uuid>` connections. No model name is typed out in this file --
 *    the prototype's names (Codex Sol, Claude Opus, Gemini Pro) are
 *    illustrative, and a menu that could name a model the registry does not
 *    offer would be a second registry. `jobModelOptions` is the single
 *    builder; the custom half is appended by the caller, because the
 *    connections are a query, not a constant.
 * 2. A retired provider stays retired. `RETIRED_PROVIDER_IDS` are in no
 *    `providersFor` list, so in no job's menu and no job's default, and a row
 *    that stored one is not runnable. There is a test for exactly that.
 * 3. A content refusal is final and never falls back. That decision is not
 *    re-made here: `nextJobFallback` asks `looksLikeContentRefusal` in
 *    ./automatic-failover.ts, the same function the mid-run failover uses, so
 *    the desk has one definition of a refusal and not two.
 */

import { looksLikeContentRefusal } from "./automatic-failover.ts";
import {
  isCustomModelChoice,
  modelChoicesFor,
  type CustomModelChoice,
  type ModelChoiceOption,
} from "./model-choice.ts";
import {
  MODEL_EFFORT_LABELS,
  defaultModelEffort,
  modelEffortsFor,
  providerEntry,
  type ModelEffort,
  type ProviderKind,
  type ProviderSurface,
} from "./provider-registry.ts";

/** The ten jobs the design draws, in the order it draws them. */
export const MODEL_JOB_KEYS = [
  "scan",
  "lead-score",
  "story-draft",
  "opinion",
  "evidence-check",
  "headlines",
  "dark",
  "follow-up",
  "ocr",
  "transcript",
] as const;

export type ModelJobKey = (typeof MODEL_JOB_KEYS)[number];

export type ModelJob = {
  key: ModelJobKey;
  /** The row's name, as the design draws it. */
  label: string;
  /** The half-line under it, as the design draws it. */
  note: string;
  /**
   * Which registry surface this job's options come from. `forced` is the
   * surface for a run that must name ONE exact provider (a batch, a meeting
   * redraft, OCR, a transcript), which is why Automatic is absent from those
   * two rows' menus -- the same reason `FORCED_MODEL_CHOICES` has no
   * Automatic.
   */
  surface: ProviderSurface;
  /**
   * False when the desk has no backend for this job yet. The row is still
   * drawn -- an editor should see the plan -- but it says so instead of
   * offering a picker that would do nothing (brief, item 2: "Jobs with no
   * backend yet (`follow-up`) show the row but say 'Not built yet'").
   */
  built: boolean;
};

export const MODEL_JOBS: readonly ModelJob[] = [
  {
    key: "scan",
    label: "Daily scan & lead filing",
    note: "Reads watched sources, files leads",
    surface: "scan",
    built: true,
  },
  {
    key: "lead-score",
    label: "Lead scoring & duplicates",
    note: "Scores leads, spots ≈ printed",
    surface: "scan",
    built: true,
  },
  {
    key: "story-draft",
    label: "Story drafting",
    note: "Writes the first draft from records",
    surface: "story",
    built: true,
  },
  {
    key: "opinion",
    label: "Opinion writing",
    note: "Editorials in the paper's voice",
    surface: "opinion",
    built: true,
  },
  {
    key: "evidence-check",
    label: "Evidence check",
    note: "Checks the draft against captures",
    surface: "story",
    built: true,
  },
  {
    key: "headlines",
    label: "Headline suggestions",
    note: "Three options on request",
    surface: "story",
    built: true,
  },
  {
    key: "dark",
    label: "Dark Desk research",
    note: "Investigations; never prints",
    surface: "dark",
    built: true,
  },
  {
    key: "follow-up",
    label: "AI follow-ups",
    note: "Re-checks pages, looks for answers",
    surface: "scan",
    /*
      Turned on in redesign phase 6: ./follow-up-agents.ts is the backend that
      was missing when phase 5 drew this row as "Not built yet". The `scan`
      surface is still what an `auto` assignment falls back to -- a follow-up
      is a background check with the same shape as the daily scan, not a
      writing job.
    */
    built: true,
  },
  {
    key: "ocr",
    label: "Document reading & OCR",
    note: "PDFs, scans, long packets",
    surface: "forced",
    built: true,
  },
  {
    key: "transcript",
    label: "Video & meeting transcripts",
    note: "YouTube captions, recordings",
    surface: "forced",
    built: true,
  },
];

export function isModelJobKey(value: unknown): value is ModelJobKey {
  return typeof value === "string" && (MODEL_JOB_KEYS as readonly string[]).includes(value);
}

export function modelJob(key: string): ModelJob | null {
  return MODEL_JOBS.find((job) => job.key === key) ?? null;
}

/** Rank 0 is the first choice; 1 and 2 are the fallbacks, in that order. */
export const FIRST_CHOICE_RANK = 0;
export const FALLBACK_RANKS = [1, 2] as const;

/** One row of `model_assignments`, in the shape the reader returns it. */
export type ModelAssignmentRow = {
  jobKey: ModelJobKey;
  rank: number;
  providerId: string;
  effort: string | null;
};

/**
 * A value a job may hold: a registry id offered for that job's surface, a
 * custom connection, or Automatic. A retired id has no entry, so it is in none
 * of those, so it fails here and the desk says why instead of running it.
 */
export function isOfferedForJob(jobKey: string, providerId: string): boolean {
  const job = modelJob(jobKey);
  if (!job) return false;
  if (isCustomModelChoice(providerId)) return true;
  return jobModelOptions(jobKey).some((option) => option.value === providerId);
}

/**
 * The menu a job's three selects share.
 *
 * `modelChoicesFor` is `providersFor(surface)` with Automatic prepended on the
 * surfaces that have it, which is precisely the brief's rule; building the
 * list from the registry rather than from a literal is what keeps the retired
 * Grok out and keeps a newly-registered provider in without touching this
 * file.
 */
export function jobModelOptions(jobKey: string): readonly ModelChoiceOption[] {
  const job = modelJob(jobKey);
  if (!job) return [];
  return modelChoicesFor(job.surface);
}

/**
 * Append the newsroom's own API connections to a job's menu.
 *
 * Custom connections are data, not registry entries, so they arrive from a
 * query and are appended at the edge -- and a stored value this build can no
 * longer resolve is kept, labelled, rather than silently dropped. A `<select>`
 * whose value is in no option renders EMPTY, which reads as "no model chosen";
 * the ModelPicker makes the same call for the same reason.
 *
 * The labelled option covers a retired registry id as well as a deleted
 * connection. Both are the same problem for the editor -- the row says a model
 * they chose and the desk cannot offer it -- and `resolveJobModel` is what
 * decides whether it can still RUN: a retired id does not resolve, so the run
 * falls to the surface default and the row's notice says so.
 */
export function withCustomConnections(
  options: readonly ModelChoiceOption[],
  connections: readonly { id: string; name: string; modelId?: string | null }[],
  /**
   * Every stored value this menu has to be able to SHOW. One select carries
   * one, but the Models screen has three per job, so it passes all three --
   * a `<select>` whose value matches no option renders empty, and an empty
   * fallback reads as "no fallback chosen" when in fact one is stored.
   */
  current?: string | readonly string[] | null,
): ModelChoiceOption[] {
  /*
    Two casts, both for the same reason: `ModelChoiceOption.value` is typed as
    the stored-choice union, and neither a connection's id nor a stored value
    this build cannot resolve is a member of it. The alternative -- widening the
    union in ./model-choice.ts to accept any string -- would cost every consumer
    of that type its exhaustiveness, to describe a menu built at runtime.
  */
  const out: ModelChoiceOption[] = [
    ...options,
    ...connections.map((connection): ModelChoiceOption => ({
      value: `custom:${connection.id}` as CustomModelChoice,
      label: connection.name,
      detail: connection.modelId ?? "",
    })),
  ];
  const wanted = typeof current === "string" ? [current] : (current ?? []);
  for (const value of wanted) {
    if (!value || out.some((option) => option.value === value)) continue;
    out.push({
      value: value as CustomModelChoice,
      label: isCustomModelChoice(value) ? "Custom API connection" : "No longer offered",
      detail: "Unavailable — choose another model",
    });
  }
  return out;
}

/* ------------------------------------------------------------------------- *
 * The lines the screen shows (unit BG2)
 *
 * The design draws these selects with short lines -- "Codex Sol · sign-in",
 * "None", "Default" -- and the build was showing the registry's full sentence
 * plus "Not set — use the desk's default" instead. A native `<select>` clips
 * the selected option and no CSS wraps it, so the lines below are measured
 * rather than chosen: see `JOB_OPTION_LABEL_MAX`.
 * ------------------------------------------------------------------------- */

/** The three slots of a job's plan, in the order the design draws them. */
export const JOB_SLOT_NAMES = ["first", "fallback1", "fallback2"] as const;
export type JobSlotName = (typeof JOB_SLOT_NAMES)[number];

/**
 * What an empty slot says, as the design draws it.
 *
 * An empty first choice is not "unset" -- it is the desk's default at work,
 * so it reads "Default". An empty fallback is genuinely nothing, so it reads
 * "None". Both are one word on purpose: the old sentence was 203px of text, and
 * the selects are 200px at 1280.
 */
export function jobSlotEmptyLabel(slot: JobSlotName): string {
  return slot === "first" ? "Default" : "None";
}

/**
 * How a provider is connected, in the two or three words the design uses:
 * a sign-in, an API key, or a model on this computer. The Connections tab
 * prints the same word on each card's second line.
 */
export const CONNECTION_WORD: Readonly<Record<ProviderKind, string>> = {
  "claude-code": "sign-in",
  codex: "sign-in",
  openai: "API",
  anthropic: "API",
  local: "on this computer",
};

export function connectionWord(kind: ProviderKind): string {
  return CONNECTION_WORD[kind];
}

/**
 * The longest option line a who-does-what select is known to show.
 *
 * Measured, not guessed (unit BG2): every model select on that row is now at
 * least 200px wide, which is what the longest line the design draws there --
 * "Claude Sonnet · sign-in" -- needs to be painted whole (166.7px of advance
 * width at Bricolage Grotesque 700 15px, plus the 16px of side padding, the
 * 2px of border and the 15px of dropdown arrow Chromium keeps back). The
 * ceiling is the second line of defence: a provider whose name is long enough
 * to overflow even that box loses its "· sign-in" half rather than its last
 * letters. `model-assignments.test.ts` walks every option of every job against
 * this, so such a provider fails there rather than reaching a screenshot.
 */
export const JOB_OPTION_LABEL_MAX = 24;

/**
 * The full drawn line for an option, before the ceiling is applied:
 * "Codex Sol · sign-in", "Automatic (ladder)", "Gemini · API".
 *
 * The connection word comes from the value's OWN registry entry, so a
 * provider added later gets the right word without this file changing -- and
 * a value this build cannot resolve keeps its label bare rather than
 * inventing a connection it does not know.
 */
function jobOptionLine(option: ModelChoiceOption): string {
  if (option.value === "auto") return "Automatic (ladder)";
  if (isCustomModelChoice(option.value)) {
    return `${option.label} · ${CONNECTION_WORD.openai}`;
  }
  const entry = providerEntry(option.value);
  return entry ? `${option.label} · ${connectionWord(entry.kind)}` : option.label;
}

/** The line the select shows, dropped to the bare name when it would clip. */
export function jobOptionLabel(option: ModelChoiceOption): string {
  const line = jobOptionLine(option);
  return line.length <= JOB_OPTION_LABEL_MAX ? line : option.label;
}

/**
 * The same line in full, with the provider's own half-line, for the option's
 * `title`. Dropping the connection word must not lose it: an editor who hovers
 * the option reads exactly what the long line said.
 */
export function jobOptionTitle(option: ModelChoiceOption): string {
  const line = jobOptionLine(option);
  const detail = option.detail?.trim();
  return detail && !line.includes(detail) ? `${line} — ${detail}` : line;
}

/**
 * The effort levels as the design draws them in the row: one lowercase word,
 * because the registry's sentence ("Medium — balanced") does not fit a 130px
 * box. The sentence is not lost -- `jobEffortOptionTitle` is the option's and
 * the select's `title`.
 */
export const JOB_EFFORT_WORDS: Readonly<Record<ModelEffort, string>> = {
  none: "none",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

export function jobEffortLabel(effort: ModelEffort): string {
  return JOB_EFFORT_WORDS[effort];
}

export function jobEffortOptionTitle(effort: ModelEffort): string {
  return MODEL_EFFORT_LABELS[effort];
}

/**
 * The effort levels this exact model takes. Empty means the provider sets it
 * and the desk sends nothing -- the same answer `ModelPicker` renders as
 * "This exact model does not declare safe per-run effort levels".
 */
export function jobEffortOptions(
  providerId: string | null | undefined,
  exactModel?: string | null,
): readonly ModelEffort[] {
  return modelEffortsFor(providerId, exactModel);
}

/**
 * A stored effort, checked against the model that will actually run.
 *
 * The brief's rule ("Validate effort with `modelEffortsFor(id, exactModel)`")
 * has a second half that matters more: a level the model does not take must
 * not be sent. So a level the list does not contain is dropped to
 * `defaultModelEffort`, and a model that declares no levels gets null -- the
 * provider's own default -- rather than the nearest level from another model.
 * That is what lets an assignment saved against a local model survive the
 * model on that server changing.
 */
export function cleanJobEffort(
  providerId: string | null | undefined,
  effort: unknown,
  exactModel?: string | null,
): ModelEffort | null {
  const options = jobEffortOptions(providerId, exactModel);
  if (!options.length) return null;
  if (typeof effort === "string" && options.includes(effort as ModelEffort)) {
    return effort as ModelEffort;
  }
  return defaultModelEffort(providerId, exactModel);
}

/** Where a resolved choice came from, said in words the screen can print. */
export type JobModelSource = "explicit" | "assignment" | "surface-default";

export type JobModelResolution = {
  providerId: string;
  effort: ModelEffort | null;
  source: JobModelSource;
  /** The rank the choice came from, or null for an explicit or default pick. */
  rank: number | null;
  /**
   * A sentence when the desk could not use what was saved and moved on. Null
   * when nothing had to be explained -- the ordinary case.
   */
  notice: string | null;
};

/** The choice a surface falls back to when a job has nothing saved. */
export function surfaceDefaultChoice(surface: ProviderSurface): string {
  return modelChoicesFor(surface)[0]?.value ?? "auto";
}

/**
 * The resolution order, exactly as the brief states it: an explicit per-run
 * pick, then `model_assignments`, then today's surface default and Automatic.
 *
 * Each step is skipped, with a notice, when what it holds cannot run -- a
 * stored id this build retired, or a job key a newer build wrote and this one
 * does not know. Skipping is the point: an assignment that cannot run must
 * not stop the desk from working, and it must not run something the registry
 * does not offer either.
 */
export function resolveJobModel(input: {
  jobKey: string;
  /** What the editor picked for THIS run, if anything. */
  explicit?: string | null;
  /** The rows saved for this job. */
  assignments?: readonly ModelAssignmentRow[];
  /** The exact model behind a local/custom choice, when it is known. */
  exactModel?: string | null;
}): JobModelResolution {
  const job = modelJob(input.jobKey);
  const surface: ProviderSurface = job?.surface ?? "story";
  const exactModel = input.exactModel ?? null;
  const explicit = typeof input.explicit === "string" && input.explicit.trim()
    ? input.explicit.trim()
    : null;
  const explicitOffered = explicit !== null && isOfferedForJob(input.jobKey, explicit);

  if (explicitOffered) {
    return {
      providerId: explicit,
      effort: cleanJobEffort(explicit, null, exactModel),
      source: "explicit",
      rank: null,
      notice: null,
    };
  }

  const rows = [...(input.assignments ?? [])]
    .filter((row) => isModelJobKey(row.jobKey) && row.jobKey === input.jobKey)
    .sort((a, b) => a.rank - b.rank);
  const usable = rows.find((row) => isOfferedForJob(input.jobKey, row.providerId)) ?? null;
  if (usable) {
    return {
      providerId: usable.providerId,
      effort: cleanJobEffort(usable.providerId, usable.effort, exactModel),
      source: "assignment",
      rank: usable.rank,
      notice: null,
    };
  }

  /*
    A saved row that cannot run is worth a sentence, and it is a different
    sentence from "nothing saved": the editor set this up and something moved
    under it. The id is quoted rather than looked up, because a retired id has
    no label in this build -- naming it is the only way the editor can find
    the row that needs replacing.
  */
  const stale = rows[FIRST_CHOICE_RANK] ?? rows[0] ?? null;
  return {
    providerId: surfaceDefaultChoice(surface),
    effort: null,
    source: "surface-default",
    rank: null,
    notice:
      explicit && !explicitOffered
        ? /*
            An explicit pick this build cannot offer -- a retired id, or a
            request from a client that cached an older menu. It is said out
            loud rather than swallowed: the run IS going to use something else,
            and "the model you asked for is not one this desk can use" is the
            only fact the caller does not already have. It wins over the stale
            assignment's sentence, which the next run without an explicit pick
            reports anyway.
          */
          `${explicit} is not a model this job can use, so the run is using the desk's default instead.`
        : stale
          ? `${stale.providerId} is no longer offered for this job, so it is running on the desk's default instead. Choose a first choice and save.`
          : null,
  };
}

export type JobFallback = {
  providerId: string;
  effort: ModelEffort | null;
  rank: number;
};

/**
 * The next fallback after a failed attempt, or null when the run is over.
 *
 * Null is the answer in two different situations, and the difference matters
 * to the editor:
 *
 * - **A content refusal.** The model read the request and declined it. Trying
 *   the next model would be asking a different model to do the thing the
 *   first one refused, which is not a fallback -- it is shopping for a
 *   different answer, and the owner's rule is that a refusal is final.
 *   `looksLikeContentRefusal` is the desk's one definition of that, shared
 *   with the mid-run failover so the two cannot disagree.
 * - **Nothing left to try.** Every rank is used or already attempted.
 *
 * Ranks below 1 are never returned: rank 0 is the first choice, which has
 * just failed, so returning it would be a loop rather than a fallback.
 */
export function nextJobFallback(input: {
  jobKey: string;
  /** The providers already attempted on this run, in order. */
  tried: readonly string[];
  assignments: readonly ModelAssignmentRow[];
  /** The failure text the desk recorded for the attempt that just ended. */
  detail?: string | null;
}): JobFallback | null {
  if (looksLikeContentRefusal(input.detail)) return null;
  const candidates = input.assignments
    .filter((row) => row.jobKey === input.jobKey && row.rank >= 1)
    .sort((a, b) => a.rank - b.rank);
  for (const row of candidates) {
    if (input.tried.includes(row.providerId)) continue;
    if (!isOfferedForJob(input.jobKey, row.providerId)) continue;
    return {
      providerId: row.providerId,
      effort: cleanJobEffort(row.providerId, row.effort),
      rank: row.rank,
    };
  }
  return null;
}

/**
 * The live status chip's vocabulary, as drawn: ✓ Ready, ! Slow,
 * Sign-in expired -- plus the states the design has no chip for and the desk
 * must still say out loud.
 *
 * "Default" is unit BG2's fix for a chip that lied: a job with nothing saved
 * said "✓ Ready", which is a claim about a first choice that does not exist.
 * What IS true there is that the desk's default runs the job, so the chip says
 * so and the cell beneath it names the model that default resolves to.
 */
export type JobStatusKind = "ready" | "slow" | "signin" | "unbuilt" | "none" | "default";

export const JOB_STATUS_LABEL: Readonly<Record<JobStatusKind, string>> = {
  ready: "✓ Ready",
  slow: "! Slow",
  signin: "Sign-in expired",
  unbuilt: "Not built yet",
  none: "—",
  default: "Default",
};

export type JobStatusFacts = {
  built: boolean;
  /** The resolved first choice, or null when nothing could be resolved. */
  providerId: string | null;
  /**
   * `providerAvailability()`: false means THIS machine cannot use that
   * provider right now (no local server answering, no CLI signed in). Undefined
   * means the answer has not arrived, and the desk does not accuse a provider
   * on a slow network call -- the run's own preflight is the backstop.
   */
  available?: boolean | null;
  /** A local first choice whose model is not in memory: the first call loads it. */
  localNotLoaded?: boolean;
  /**
   * `resolveJobModel({...}).source === "surface-default"`: the editor saved
   * nothing for this job and the desk's own default is what runs.
   */
  fromDefault?: boolean;
};

export function jobStatusKind(input: JobStatusFacts): JobStatusKind {
  if (!input.built) return "unbuilt";
  if (!input.providerId) return "none";
  /*
    A broken default is still a broken default: an expired sign-in or a cold
    local model is more useful to the editor than the fact that they did not
    choose it themselves, so those two are answered before "Default".
  */
  if (input.available === false) return "signin";
  if (input.localNotLoaded) return "slow";
  if (input.fromDefault) return "default";
  return "ready";
}

/**
 * What the chip means, in a sentence, for the chip's `title` and for the live
 * region. The design gives the chip three words; the reason a provider cannot
 * run is not always an expired sign-in (an unset-up local server is not), so
 * the specific answer is written here and read on hover rather than invented
 * into the chip.
 */
export function jobStatusHelp(input: JobStatusFacts): string {
  switch (jobStatusKind(input)) {
    case "unbuilt":
      return "This job has no backend yet, so there is nothing to run and nothing to assign. The row is here so the plan is visible.";
    case "none":
      return "No first choice could be resolved for this job.";
    case "signin":
      return "This machine cannot use the first choice right now: the sign-in has lapsed, or a local server is not answering. Test it on Connections, or pick another model.";
    case "slow":
      return "The first choice is a local model that is not in memory. The first call loads it, which can take a minute or more. TownReporter never loads a model for you.";
    case "default":
      return "Nothing saved for this job, so it runs on the desk's default model, named under this chip. Save a first choice to decide it yourself.";
    default:
      return "The first choice is ready to run.";
  }
}
