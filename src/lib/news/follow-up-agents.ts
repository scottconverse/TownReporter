import {
  grokChat,
  parseJsonBlock,
  providerBudget,
  type EffectiveProviderChoice,
} from "./ai.ts";
import { createDarkRunBudget, type DarkRunBudget } from "./dark-run-budget.ts";
import {
  followUpTargets,
  nextRunAt,
  parseFinding,
  performClaimFollowUpRun,
  performReadFollowUp,
  performRecordFollowUpRun,
  performReleaseFollowUpRun,
  type FollowUpFinding,
} from "./follow-ups.ts";
import { readModelAssignments } from "./model-assignments-store.ts";
import { resolveJobModel, type JobModelResolution } from "./model-assignments.ts";
import { storyModelChoice } from "./model-choice.ts";
import {
  checkPageWatchFor,
  createPageWatchFor,
  listPageWatchesFor,
  readPageWatchCaptureFor,
  watchChangeText,
  type WatchIdentity,
} from "./page-watch.ts";
import { getPaperConfig } from "./paper-settings.ts";
import {
  compiledDocumentUrl,
  fetchPrimeGovMeetings,
  isPrimeGovUrl,
  portalOrigin,
  preferredDocuments,
  type PrimeGovMeeting,
} from "./primegov.ts";
import { JobCancelledError, progressReporterFor, throwIfJobCancelled, waitForModel, type DeskJob } from "./jobs.ts";
import {
  searchWithFallback,
  type SearchAttempt,
  type SearchRelevanceOptions,
  type WebHit,
} from "./search-web.ts";
import type { IngestDocument, OcrOptions } from "./ingest.ts";
import type { FollowUpRow } from "./types.ts";

/**
 * The three agents behind an AI follow-up: what a `recheck`, `search` or
 * `agenda` run actually does, and the worker that runs one.
 *
 * Everything an agent can reach the outside world with is a parameter
 * (`FollowUpAgentDeps`), which is what lets follow-up-agents.test.ts drive all
 * three to `found`, `no-change` and `could-not-check` without a network, a
 * model or a PDF. The defaults are the real ones: the page-watch engine's own
 * `ingestDocument`, `searchWithFallback`, `fetchPrimeGovMeetings`, and
 * `grokChat` behind the search judge.
 *
 * THE STATE VOCABULARY IS THE POINT. A run ends `found`, `no-change` or
 * `could-not-check` and never anything else -- `running` and `waiting` are the
 * scheduler's states, not an outcome of work. `no-change` means the agent got
 * where it was going and there was nothing new; `could-not-check` means it did
 * not get there, and it carries the REAL reason (`finding.reason`: the
 * page-watch engine's own error sentence, the search transport's own failure,
 * "this build can only watch PrimeGov portals"). The two are never collapsed:
 * a follow-up that has been quietly failing for a week must not read on the
 * card like a follow-up that has been quietly working, which is the whole
 * reason 0101 gives `last_state` five values instead of a boolean.
 *
 * IT NEVER PUBLISHES. No agent below writes an article, a draft or a lead. A
 * `found` reaches the story only as a line in the reporting notes, through
 * `performRecordFollowUpRun` (./follow-ups.ts) -- the same column and the same
 * helpers `saveReportingNotes` uses, and the one place in this feature that
 * touches a story at all.
 *
 * Cancellation and progress are phase 3's, not this file's: the agents call
 * `deps.step` (which the worker wires to `progressReporterFor`) and
 * `deps.throwIfCancelled` (wired to `throwIfJobCancelled`) at every boundary
 * between units of work, and the worker wraps each long call in `waitForModel`
 * so the card says what it is waiting on and the editor's Stop is heard while
 * the call is in flight. The hard cap on a run is `createDarkRunBudget`
 * (./dark-run-budget.ts, migration 0059) -- the same mechanism the Dark Desk
 * uses -- sized by `followUpRunLimits` below.
 */

/* ==========================================================================
   The seam
   ========================================================================== */

export type SearchJudgeInput = {
  question: string;
  hits: WebHit[];
  /** The resolved provider id for this run, so the judge call bills to it. */
  modelChoice: string;
  newsroomId: number;
  budget?: DarkRunBudget;
};

/**
 * What the judge concluded. `ok: false` is a judge that could not answer --
 * not a judge that answered "no". The caller turns it into `could-not-check`
 * with the error as the reason, because a model call that failed silently must
 * never be recorded as "nothing changed".
 */
export type SearchJudgeResult =
  | { ok: true; answers: boolean; url: string; title: string; summary: string }
  | { ok: false; error: string };

export type FollowUpAgentDeps = {
  fetch?: (url: string, options: OcrOptions) => Promise<IngestDocument>;
  search?: (question: string, newsroomId: number) => Promise<SearchAttempt>;
  judge?: (input: SearchJudgeInput) => Promise<SearchJudgeResult>;
  meetings?: (origin: string) => Promise<PrimeGovMeeting[]>;
  /**
   * Wraps one long call so the card can say what it is waiting on and Stop is
   * heard mid-call. Defaults to phase 3's `waitForModel`, which the worker
   * supplies (it is the only layer that knows the job id).
   */
  model?: <T>(label: string, run: () => Promise<T>) => Promise<T>;
  step?: (step: string) => Promise<void>;
  throwIfCancelled?: () => Promise<void>;
  budget?: DarkRunBudget;
};

export type FollowUpAgentInput = {
  id: number;
  userId: string;
  newsroomId: number;
  /** The question, as the editor wrote it -- the search agent's query and the
   * name a re-check watch is created under. */
  what: string;
  /** `followUpTargets(row.targets_json)`. */
  targets: string[];
  /** The provider this run resolved to (per-follow-up pick, else the
   * `follow-up` assignment, else the surface default). */
  modelChoice: string;
  /** What the last run found -- "is this still the same URL?" lives here. */
  lastFinding: FollowUpFinding;
};

export type FollowUpAgentOutcome = {
  state: "found" | "no-change" | "could-not-check";
  finding: Partial<FollowUpFinding>;
};

/** The one phrase every agent writes, so the job's chip row means something. */
export const FOLLOW_UP_STAGES = ["Running the check", "Recording the result"] as const;
export const FOLLOW_UP_STAGE_START = FOLLOW_UP_STAGES[0];
export const FOLLOW_UP_STAGE_RECORD = FOLLOW_UP_STAGES[1];

/** All three agents take the same arguments and answer the same shape. */
export type FollowUpAgentRun = (
  input: FollowUpAgentInput,
  deps?: FollowUpAgentDeps,
) => Promise<FollowUpAgentOutcome>;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url.slice(0, 60);
  }
}

function couldNotCheck(reason: string, finding: Partial<FollowUpFinding> = {}): FollowUpAgentOutcome {
  return { state: "could-not-check", finding: { ...finding, reason: reason.slice(0, 300), changed: false } };
}

/** Same page, ignoring the query string and a trailing slash -- the search
 * agent's "still the same result" comparison, and the agenda agent's. */
export function sameTarget(a: string, b: string): boolean {
  if (!a || !b) return false;
  const key = (value: string) => {
    try {
      const url = new URL(value);
      return `${url.hostname.replace(/^www\./i, "")}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
    } catch {
      return value.trim().toLowerCase();
    }
  };
  return key(a) === key(b);
}

/* ==========================================================================
   recheck: the manual page-watch engine, run by an agent
   ========================================================================== */

/**
 * A `watchOutcome` mapped to a state. The two vocabularies are different
 * lengths on purpose and the mapping is total: `changed` and `moved` are
 * findings; `unchanged` and `first-capture` are a healthy run that learned
 * nothing new (a first capture has no previous version to differ from, so it
 * cannot be a finding); EVERYTHING else -- `refused-*`, `needs-ocr`, `blocked`,
 * `unavailable`, `failed`, `no-readable-text` -- is a page the agent could not
 * read, and the reason for it comes from the monitor's own `watch_last_error`.
 *
 * The list is closed rather than a default-carrying switch, so a sixth outcome
 * added to `watchOutcome` upstream lands as `could-not-check` here -- the
 * honest failure for a state this build has not been taught.
 */
export function watchOutcomeState(outcome: string): "found" | "no-change" | "could-not-check" {
  if (outcome === "changed" || outcome === "moved") return "found";
  if (outcome === "unchanged" || outcome === "first-capture") return "no-change";
  return "could-not-check";
}

/** What a re-check found, in the card's words. `moved` cannot name where the
 * page went: `checkPageWatchFor` reports the redirect happened, not its
 * target, so the summary says exactly that rather than inventing a URL. */
async function recheckFinding(
  who: WatchIdentity,
  watchId: number,
  checkId: number,
  url: string,
  outcome: string,
  what: string,
): Promise<Partial<FollowUpFinding>> {
  const current = await readPageWatchCaptureFor(who, { watchId, checkId });
  const previous = await readPageWatchCaptureFor(who, { watchId, checkId, previous: true });
  let summary = "";
  if (outcome === "moved") {
    summary = "The page now redirects somewhere else.";
  } else if (current && previous) {
    summary = watchChangeText(previous.full_text, current.full_text).slice(0, 600);
  }
  return {
    title: current?.title?.trim() || what,
    summary: summary || "The page changed since the last capture.",
    url,
    reason: "",
    changed: outcome === "changed",
  };
}

export async function runRecheckAgent(
  input: FollowUpAgentInput,
  deps: FollowUpAgentDeps = {},
): Promise<FollowUpAgentOutcome> {
  const who: WatchIdentity = { userId: input.userId, newsroomId: input.newsroomId };
  // A re-check needs a page. The dialog refuses to create a `recheck` with no
  // links, so an empty list here is a row edited behind the app's back -- it
  // says so rather than reporting a silent `no-change` on nothing.
  if (!input.targets.length) return couldNotCheck("No page was saved to re-check.");
  const failures: string[] = [];
  const checkedHosts: string[] = [];

  for (const url of input.targets) {
    if (deps.budget && !deps.budget.consumeDocumentRead()) {
      failures.push("the run reached its document-read limit");
      break;
    }
    await deps.throwIfCancelled?.();
    await deps.step?.(`Checking ${hostOf(url)}`);

    const made = await createPageWatchFor(who, {
      url,
      name: input.what.slice(0, 200),
      reason: input.what,
      modelChoice: input.modelChoice,
    });
    if (!made.ok) {
      failures.push(`${hostOf(url)}: ${made.error}`);
      continue;
    }
    let checked: Awaited<ReturnType<typeof checkPageWatchFor>>;
    try {
      const run = () => checkPageWatchFor(who, made.id, { fetch: deps.fetch });
      checked = deps.model ? await deps.model("the page reader", run) : await run();
    } catch (e) {
      if (e instanceof JobCancelledError) throw e;
      failures.push(`${hostOf(url)}: ${e instanceof Error ? e.message.slice(0, 200) : "the page could not be read"}`);
      continue;
    }
    if (!checked.ok) {
      failures.push(`${hostOf(url)}: ${checked.error}`);
      continue;
    }

    const state = watchOutcomeState(checked.state);
    if (state === "found") {
      return {
        state: "found",
        finding: await recheckFinding(who, made.id, checked.checkId, url, checked.state, input.what),
      };
    }
    if (state === "no-change") {
      checkedHosts.push(url);
      await deps.step?.(`${hostOf(url)}: nothing changed`);
      continue;
    }
    // The reason is the monitor's own error, written by the page-watch engine
    // when it finished the check -- not a paraphrase of the outcome code.
    const watch = (await listPageWatchesFor(who)).find((w) => w.id === made.id);
    const reason = (watch?.watch_last_error ?? "").trim();
    failures.push(`${hostOf(url)}: ${reason || `the page could not be read (${checked.state})`}`);
  }

  if (failures.length) {
    return couldNotCheck(failures.slice(0, 2).join(" · "), { url: input.targets[0] });
  }
  return {
    state: "no-change",
    finding: {
      title: input.what,
      summary:
        checkedHosts.length === 1
          ? `${hostOf(checkedHosts[0]!)} is unchanged since the last capture.`
          : `${checkedHosts.length} pages checked; none changed.`,
      url: checkedHosts[0] ?? input.targets[0] ?? "",
      reason: "",
      changed: false,
    },
  };
}

/* ==========================================================================
   search: the existing research tools, scoped to the question
   ========================================================================== */

const SEARCH_JUDGE_SYSTEM = [
  "You decide whether a set of web search results answers one specific question a local newsroom is following up.",
  "You do not guess and you do not browse. If none of the results answers the question, answer false.",
  "Answer with one JSON object and nothing else:",
  '{"answers": true|false, "url": "<the single best result URL, or \\"\\">", "title": "<its title>", "summary": "<one sentence, at most 240 characters, saying what it establishes, or why none of them answers it>"}',
  "Only set answers to true when a result actually establishes the fact asked for. A related page, a directory listing or an older story about the same topic is false.",
].join("\n");

/** The query: the editor's question, as written. Truncated to what a search
 * provider will take, and stripped of the trailing question mark that some
 * providers treat as a literal token. */
export function searchQuestionFor(what: string): string {
  return what.trim().replace(/\?+\s*$/, "").slice(0, 180);
}

async function defaultSearch(question: string, newsroomId: number): Promise<SearchAttempt> {
  // The paper's own city and state are the locality tokens, the same way the
  // scan's search paths bias their queries -- "the budget" is not a useful
  // query for a paper in one town, and "the budget <that town>" is.
  const paper = await getPaperConfig(newsroomId).catch(() => null);
  const options: SearchRelevanceOptions | undefined = paper
    ? { officialDomains: [], localityStopwords: [paper.city, paper.state].filter(Boolean) as string[] }
    : undefined;
  return searchWithFallback(question, undefined, options);
}

async function judgeSearchHits(input: SearchJudgeInput): Promise<SearchJudgeResult> {
  const listing = input.hits
    .slice(0, 8)
    .map((hit, index) => `${index + 1}. ${hit.title} — ${hit.url}\n   ${(hit.snippet ?? "").slice(0, 200)}`)
    .join("\n");
  const budget = input.budget;
  const handle = budget?.startModelCall({ stage: "search-judge", provider: input.modelChoice, model: input.modelChoice });
  if (budget && !handle) return { ok: false, error: "the run reached its model-call limit" };
  const { callMs } = providerBudget(input.modelChoice, null);
  try {
    const ai = await grokChat(
      SEARCH_JUDGE_SYSTEM,
      `Question: ${input.question}\n\nResults:\n${listing || "(no results)"}`,
      600,
      {
        timeoutMs: Math.min(callMs, budget?.remainingMs() ?? callMs),
        choice: storyModelChoice(input.modelChoice) as EffectiveProviderChoice,
        newsroomId: input.newsroomId,
        noTools: true,
      },
    );
    if (!ai.ok) {
      handle?.finish({ result: "provider-failed" });
      return { ok: false, error: ai.error.slice(0, 200) };
    }
    const parsed = parseJsonBlock<{
      answers?: unknown;
      url?: unknown;
      title?: unknown;
      summary?: unknown;
    }>(ai.text);
    if (!parsed) {
      handle?.finish({ result: "unreadable" });
      return { ok: false, error: "the model's answer could not be read" };
    }
    const url = typeof parsed.url === "string" ? parsed.url.slice(0, 500) : "";
    const summary = typeof parsed.summary === "string" ? parsed.summary.slice(0, 240) : "";
    handle?.finish({ result: parsed.answers === true && url ? "answers" : "no-answer" });
    // A true with no URL is not usable as a finding: the card links to the
    // result, and a finding nobody can open is not one.
    return {
      ok: true,
      answers: parsed.answers === true && url.length > 0,
      url,
      title: typeof parsed.title === "string" ? parsed.title.slice(0, 200) : "",
      summary,
    };
  } catch (e) {
    handle?.finish({ result: "failed" });
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "the model call failed" };
  }
}

export async function runSearchAgent(
  input: FollowUpAgentInput,
  deps: FollowUpAgentDeps = {},
): Promise<FollowUpAgentOutcome> {
  const question = searchQuestionFor(input.what);
  if (!question) return couldNotCheck("There is no question to search for.");
  if (deps.budget && !deps.budget.consumeSearch()) {
    return couldNotCheck("The run reached its search limit.");
  }
  await deps.throwIfCancelled?.();
  await deps.step?.(`Searching for ${question.slice(0, 60)}`);

  let attempt: SearchAttempt;
  try {
    const run = () => (deps.search ?? defaultSearch)(question, input.newsroomId);
    attempt = deps.model ? await deps.model("the search provider", run) : await run();
  } catch (e) {
    if (e instanceof JobCancelledError) throw e;
    return couldNotCheck(e instanceof Error ? e.message.slice(0, 200) : "The search could not be run.");
  }
  const hits = attempt.hits.filter((hit) => hit.url).slice(0, 8);
  // A provider that failed and a provider that found nothing are different
  // things, and `SearchAttempt` already says which: only a real zero-result
  // answer gets the zero-results sentence.
  if (!hits.length) {
    return couldNotCheck(
      attempt.error
        ? attempt.error.slice(0, 200)
        : `No search provider returned results (${attempt.state}).`,
    );
  }

  await deps.step?.(`Reading ${hits.length} result${hits.length === 1 ? "" : "s"}`);
  let verdict: SearchJudgeResult;
  try {
    const run = () =>
      (deps.judge ?? judgeSearchHits)({
        question,
        hits,
        modelChoice: input.modelChoice,
        newsroomId: input.newsroomId,
        budget: deps.budget,
      });
    verdict = deps.model ? await deps.model(`the ${input.modelChoice} judge`, run) : await run();
  } catch (e) {
    if (e instanceof JobCancelledError) throw e;
    return couldNotCheck(e instanceof Error ? e.message.slice(0, 200) : "The results could not be read.");
  }
  if (!verdict.ok) {
    // Not `no-change`: the judge failing is the agent being unable to check.
    return couldNotCheck(`Could not tell whether the results answer it: ${verdict.error}`);
  }
  if (!verdict.answers) {
    return {
      state: "no-change",
      finding: {
        title: question,
        summary:
          verdict.summary ||
          `${hits.length} result${hits.length === 1 ? "" : "s"} checked; none of them answers it.`,
        url: hits[0]!.url,
        reason: "",
        changed: false,
      },
    };
  }
  // The same answer as last time is not news. Without this every search
  // follow-up reports `found` on every run forever, and "Found something"
  // stops meaning anything.
  if (sameTarget(input.lastFinding.url, verdict.url)) {
    return {
      state: "no-change",
      finding: {
        title: verdict.title || question,
        summary: `Still the same result: ${verdict.summary || verdict.url}`.slice(0, 600),
        url: verdict.url,
        reason: "",
        changed: false,
      },
    };
  }
  return {
    state: "found",
    finding: {
      title: verdict.title || hits[0]!.title || question,
      summary: verdict.summary || `A result answers it: ${verdict.url}`,
      url: verdict.url,
      reason: "",
      changed: true,
    },
  };
}

/* ==========================================================================
   agenda: a meeting body's portal, on its posting days
   ========================================================================== */

/**
 * The newest meeting that has a document, and the best document on it. Reads
 * the same portal API the scan's meeting capture does (`fetchPrimeGovMeetings`
 * / `preferredDocuments` / `compiledDocumentUrl`), so a follow-up and a scan
 * looking at the same body see the same posting.
 *
 * Only PrimeGov portals: `isPrimeGovUrl` is the same guard the scan uses, and
 * a portal this build cannot read is a `could-not-check` with that sentence,
 * not a silent no-change. Exported for the test that asserts that refusal.
 */
export async function newestPostedDocument(
  origin: string,
  meetings: PrimeGovMeeting[],
): Promise<{ url: string; title: string; summary: string } | null> {
  const posted = meetings
    .filter((meeting) => (meeting.documentList ?? []).length > 0)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
  if (!posted) return null;
  const doc = preferredDocuments(posted)[0];
  if (!doc) return null;
  return {
    url: compiledDocumentUrl(origin, doc),
    title: posted.title || `Meeting of ${posted.date}`,
    summary: `${doc.templateName || "A document"} was posted for the ${posted.date} meeting.`,
  };
}

export async function runAgendaAgent(
  input: FollowUpAgentInput,
  deps: FollowUpAgentDeps = {},
): Promise<FollowUpAgentOutcome> {
  if (!input.targets.length) return couldNotCheck("No meeting portal was saved to watch.");
  const failures: string[] = [];
  let quiet: Partial<FollowUpFinding> | null = null;

  for (const target of input.targets) {
    let origin: string;
    try {
      const parsed = new URL(target);
      if (!isPrimeGovUrl(parsed)) {
        failures.push(`${parsed.hostname}: this build can only watch PrimeGov portals`);
        continue;
      }
      origin = portalOrigin(parsed);
    } catch {
      failures.push(`${target.slice(0, 80)}: that is not a link`);
      continue;
    }
    await deps.throwIfCancelled?.();
    await deps.step?.(`Reading the ${hostOf(origin)} portal`);
    if (deps.budget && !deps.budget.consumeDocumentRead()) {
      failures.push("the run reached its document-read limit");
      break;
    }

    let meetings: PrimeGovMeeting[];
    try {
      const run = () => (deps.meetings ?? fetchPrimeGovMeetings)(origin);
      meetings = deps.model ? await deps.model(`the ${hostOf(origin)} portal`, run) : await run();
    } catch (e) {
      if (e instanceof JobCancelledError) throw e;
      failures.push(
        `${hostOf(origin)}: ${e instanceof Error ? e.message.slice(0, 200) : "the portal could not be read"}`,
      );
      continue;
    }
    if (!meetings.length) {
      failures.push(`${hostOf(origin)}: the portal listed no meetings`);
      continue;
    }
    const newest = await newestPostedDocument(origin, meetings);
    if (!newest) {
      failures.push(`${hostOf(origin)}: no meeting has a posted document yet`);
      continue;
    }
    if (sameTarget(input.lastFinding.url, newest.url)) {
      quiet = {
        title: newest.title,
        summary: `Still the same posting: ${newest.summary}`,
        url: newest.url,
        reason: "",
        changed: false,
      };
      continue;
    }
    return { state: "found", finding: { ...newest, reason: "", changed: true } };
  }

  if (quiet) return { state: "no-change", finding: quiet };
  return couldNotCheck(failures.slice(0, 2).join(" · "), { url: input.targets[0] });
}

/* ==========================================================================
   The worker
   ========================================================================== */

/** The job key the phase 5 assignment table uses for this feature. */
export const FOLLOW_UP_JOB_KEY = "follow-up";

/**
 * The hard cap on one run, named in the phase 6 report: ten minutes, and the
 * shorter of that and the resolved provider's own wall budget. A follow-up is
 * a background check, not a Dark Desk investigation -- if it has not finished
 * in ten minutes it has failed, and the card should say so rather than hold a
 * job slot all afternoon.
 *
 * The mechanism is `createDarkRunBudget` (./dark-run-budget.ts, migration
 * 0059), the same one the Dark Desk sizes from `providerBudget(...).wallMs`.
 * The counts are small on purpose: one search agent needs one search and at
 * most one model call, and a multi-page re-check is a handful of document
 * reads.
 */
export const FOLLOW_UP_HARD_CAP_MS = 10 * 60_000;
export const FOLLOW_UP_USAGE_LIMITS = {
  modelCalls: 3,
  searches: 3,
  documentReads: 6,
} as const;

export function followUpRunLimits(choice: string) {
  const wall = providerBudget(choice, null).wallMs;
  return {
    elapsedMs: Math.min(Number.isFinite(wall) && wall > 0 ? wall : FOLLOW_UP_HARD_CAP_MS, FOLLOW_UP_HARD_CAP_MS),
    ...FOLLOW_UP_USAGE_LIMITS,
  };
}

/**
 * Which model runs this follow-up: its own saved pick, else the `follow-up`
 * row in `model_assignments`, else the scan surface's default -- the phase 5
 * order, and the reason `model_choice` defaults to `auto` rather than to a
 * provider id.
 *
 * `auto` is passed as no explicit pick rather than as the literal string:
 * `resolveJobModel` treats an offered value as a decision, and offering it
 * "auto" would stop it reading the assignment table at all.
 */
export async function resolveFollowUpModel(row: Pick<FollowUpRow, "newsroom_id" | "model_choice">): Promise<JobModelResolution> {
  const pick = (row.model_choice ?? "").trim();
  const assignments = await readModelAssignments(row.newsroom_id).catch(() => []);
  return resolveJobModel({
    jobKey: FOLLOW_UP_JOB_KEY,
    explicit: pick && pick !== "auto" ? pick : null,
    assignments,
  });
}

/** The sentence a run that hit the budget records, so the card says which cap
 * it hit rather than only that it stopped. */
export function budgetStopReason(budget: DarkRunBudget): string {
  switch (budget.stopReason) {
    case "elapsed-time-limit":
      return `The run reached its ${Math.round(budget.limits.elapsedMs / 60_000)} minute limit.`;
    case "search-limit":
      return "The run reached its search limit.";
    case "document-read-limit":
      return "The run reached its document-read limit.";
    case "model-call-limit":
      return "The run reached its model-call limit.";
    default:
      return "";
  }
}

export function agentFor(agentKind: string): FollowUpAgentRun | null {
  if (agentKind === "recheck") return runRecheckAgent;
  if (agentKind === "search") return runSearchAgent;
  if (agentKind === "agenda") return runAgendaAgent;
  return null;
}

/**
 * Run one `follow-up` job. This is what `realWork` in ./jobs.ts dispatches to.
 *
 * The order is the order the states require: read the row, CLAIM it (the only
 * moment exclusivity can be decided -- the job may have sat in the queue for
 * minutes while the editor stopped the follow-up), resolve the model, size the
 * budget, run the agent, then record. A cancel or a crash between the claim
 * and the record goes through `performReleaseFollowUpRun`, so the row never
 * keeps `last_state: 'running'` after its worker is gone; a job-level failure
 * that is not a cancel is re-thrown and recorded by `executeJob` as well.
 *
 * `deps` exists so the test can drive the whole worker -- queue coalescing,
 * cancel, budget, the notes write -- with fakes and no network.
 */
export async function performFollowUpRun(
  job: DeskJob,
  deps: { agents?: FollowUpAgentDeps; now?: () => number } = {},
): Promise<void> {
  const context = { userId: job.user_id, newsroomId: job.newsroom_id };
  const row = await performReadFollowUp(context, job.subject_id);
  if (!row || !row.agent_kind) return;
  const agent = agentFor(row.agent_kind);
  if (!agent) {
    await performReleaseFollowUpRun(context, row.id, `This build does not know the ${row.agent_kind} method.`);
    return;
  }
  if (row.status !== "active") {
    // Stopped or paused between the scheduler's pick and this run.
    await performReleaseFollowUpRun(context, row.id, "The follow-up was not active when its run started.");
    return;
  }
  if (!(await performClaimFollowUpRun(job.newsroom_id, row.id))) return;

  const step = progressReporterFor(job);
  const budget = createDarkRunBudget(followUpRunLimits(row.model_choice), { now: deps.now });
  const throwIfCancelled = () => throwIfJobCancelled(job.id);
  const model =
    deps.agents?.model ??
    (<T,>(label: string, run: () => Promise<T>) => waitForModel({ jobId: job.id, label, run }));

  try {
    await step(FOLLOW_UP_STAGE_START);
    const outcome = await agent(
      {
        id: row.id,
        userId: job.user_id,
        newsroomId: job.newsroom_id,
        what: row.what,
        targets: followUpTargets(row.targets_json),
        modelChoice: row.model_choice,
        lastFinding: parseFinding(row.finding_json),
      },
      { ...deps.agents, budget, step, throwIfCancelled, model },
    );

    // A run that hit a cap did not fail to check -- it stopped checking. The
    // state is `could-not-check` with the cap's own sentence, unless the agent
    // already found something before the cap closed (a finding is a finding).
    const stopped = outcome.state === "found" ? "" : budgetStopReason(budget);
    const final = stopped
      ? { state: "could-not-check" as const, finding: { ...outcome.finding, reason: stopped.slice(0, 300) } }
      : outcome;

    await step(FOLLOW_UP_STAGE_RECORD);
    await performRecordFollowUpRun(context, {
      id: row.id,
      state: final.state,
      finding: final.finding,
      nextRunAt: nextRunAt(row.schedule)?.toISOString() ?? null,
    });
  } catch (e) {
    await performReleaseFollowUpRun(
      context,
      row.id,
      e instanceof JobCancelledError ? "The editor stopped this run." : "The run failed before it could finish.",
    );
    throw e;
  }
}
