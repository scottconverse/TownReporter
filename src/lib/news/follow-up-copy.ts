import type { FollowUpAgentKind, FollowUpRow, FollowUpState } from "./types.ts";

/**
 * The follow-up vocabulary, in a module a browser can load.
 *
 * `./follow-ups.ts` is the write side of this feature, and it imports
 * `getSql`/`withTransaction` from `../db.ts` -- PGlite behind an
 * `import.meta.glob` migration pass. None of that can survive in the client
 * bundle, so a screen that wants to draw "Re-check pages · every 2 hours" or
 * decide which of the four filters a row belongs to cannot import it. The
 * words, the schedules and the state rules therefore live here, with a
 * type-only import and no runtime dependency at all, and `./follow-ups.ts`
 * re-exports every one of them so no existing import path changed.
 *
 * Nothing here touches the database or decides anything about time other than
 * arithmetic on the arguments it is handed. `nextRunAt` reads the clock only
 * when told to, which is what lets a test pin a Tuesday.
 */

/* ==========================================================================
   What an agent can be told to do (mirrors the 0101 check constraint)
   ========================================================================== */

export const AGENT_KINDS = ["recheck", "search", "agenda"] as const;

export function isAgentKind(value: unknown): value is FollowUpAgentKind {
  return typeof value === "string" && (AGENT_KINDS as readonly string[]).includes(value);
}

/** The method half of the card's method line, per the drawn screen. */
export const AGENT_METHOD_LABELS: Record<FollowUpAgentKind, string> = {
  recheck: "Re-check pages",
  search: "Search public records",
  agenda: "Watch for next agenda",
};

/**
 * The third field of the "New AI follow-up" dialog, as the screen asks for it:
 * the editor picks a method, and the method is what decides how often the
 * agent looks. There is no schedule picker in the drawing, so this mapping IS
 * the schedule the editor chose -- "Re-check these pages on a schedule" is the
 * two-hour row, "Daily until found" and "Checks when the body usually posts"
 * say their own cadence in the option's note.
 */
export function scheduleForAgent(agentKind: FollowUpAgentKind): FollowUpSchedule {
  switch (agentKind) {
    case "recheck":
      return "2h";
    case "agenda":
      return "posting-days";
    default:
      return "daily";
  }
}

/* ==========================================================================
   How often an agent runs
   ========================================================================== */

export const FOLLOW_UP_SCHEDULES = ["2h", "6h", "12h", "daily", "weekly", "posting-days"] as const;
export type FollowUpSchedule = (typeof FOLLOW_UP_SCHEDULES)[number];

export function isFollowUpSchedule(value: unknown): value is FollowUpSchedule {
  return typeof value === "string" && (FOLLOW_UP_SCHEDULES as readonly string[]).includes(value);
}

const SCHEDULE_HOURS: Record<string, number> = {
  "2h": 2,
  "6h": 6,
  "12h": 12,
  daily: 24,
  weekly: 24 * 7,
};

/** The schedule half of the card's method line, per the drawn screen. */
export const SCHEDULE_LABELS: Record<FollowUpSchedule, string> = {
  "2h": "every 2 hours",
  "6h": "every 6 hours",
  "12h": "every 12 hours",
  daily: "daily",
  weekly: "weekly",
  "posting-days": "Tue & Fri",
};

/**
 * The bodies a newsroom actually watches post on Tuesdays and Fridays, which
 * is the vocabulary the design chose for the agenda agent ("Watch for next
 * agenda · Tue & Fri"). These are the LOCAL server days, not the body's own
 * timezone, and the hour is a fixed 06:00 local -- a real portal schedule
 * would be read per body, and this build does not. Named as a limitation in
 * the phase 6 report rather than hidden behind a plausible-looking default.
 */
export const POSTING_DAYS = [2, 5] as const; // 0 = Sunday; 2 = Tuesday, 5 = Friday
export const POSTING_HOUR = 6;

export function methodLine(agentKind: FollowUpAgentKind, schedule: string): string {
  const when = isFollowUpSchedule(schedule) ? SCHEDULE_LABELS[schedule] : schedule || "no schedule";
  return `${AGENT_METHOD_LABELS[agentKind]} · ${when}`;
}

/**
 * When this schedule next comes due, from `from` (default: now).
 *
 * Null means "never": an unrecognized schedule has no next run rather than
 * running on every tick. That is the safer failure -- an agent that stops is
 * visible on the screen as a follow-up whose schedule line says something the
 * build does not know, where a run-every-5-minutes agent would look busy while
 * burning the model budget.
 *
 * `posting-days` is the only one that is not a fixed interval, so it is the
 * only one that reads a calendar: the next Tue or Fri at 06:00 local, strictly
 * after `from`.
 */
export function nextRunAt(schedule: string, from: Date = new Date()): Date | null {
  const hours = SCHEDULE_HOURS[schedule];
  if (hours) return new Date(from.getTime() + hours * 3_600_000);
  if (schedule !== "posting-days") return null;
  for (let ahead = 0; ahead <= 7; ahead++) {
    const day = new Date(from.getTime());
    day.setDate(day.getDate() + ahead);
    if (!(POSTING_DAYS as readonly number[]).includes(day.getDay())) continue;
    day.setHours(POSTING_HOUR, 0, 0, 0);
    if (day.getTime() > from.getTime()) return day;
  }
  return null;
}

/* ==========================================================================
   The last run's result
   ========================================================================== */

/**
 * The last run's result, as the card's "latest result" line and as the note
 * appended to the story. Every field is written by the agent that ran; none of
 * it is inferred here.
 *
 * `reason` is why a `could-not-check` could not check -- the real one, from
 * the page-watch lease's error or the search transport's, not a generic
 * "failed". `summary` is what a `found` found. `changed` says whether a
 * re-check saw the page move rather than only that it ran.
 */
export type FollowUpFinding = {
  title: string;
  summary: string;
  url: string;
  reason: string;
  checkedAt: string;
  changed: boolean;
};

export const EMPTY_FINDING: FollowUpFinding = {
  title: "",
  summary: "",
  url: "",
  reason: "",
  checkedAt: "",
  changed: false,
};

/** Tolerant by design: a `{}` default, a legacy row, or hand-written JSON all read. */
export function parseFinding(raw: string | null | undefined): FollowUpFinding {
  if (!raw) return { ...EMPTY_FINDING };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_FINDING };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ...EMPTY_FINDING };
  const row = parsed as Record<string, unknown>;
  const str = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
  return {
    title: str(row.title, 200),
    summary: str(row.summary, 600),
    url: str(row.url, 500),
    reason: str(row.reason, 300),
    checkedAt: str(row.checkedAt, 40),
    changed: row.changed === true,
  };
}

export function packFinding(finding: Partial<FollowUpFinding> | null | undefined): string {
  return JSON.stringify({ ...EMPTY_FINDING, ...(finding ?? {}) });
}

/** `targets_json` as the array of URLs it is. Tolerant for the same reason. */
export function followUpTargets(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

/**
 * The line a finding adds to the story's reporting notes. Built here, once, so
 * the card's latest-result line and the note in the story cannot describe the
 * same finding differently.
 *
 * `src: "machine"` is what makes the notes block mark it as found by the desk
 * rather than by the editor -- see ReportingNotes in ./notes.ts.
 */
export function findingNoteLine(finding: FollowUpFinding): string {
  const parts = [finding.title || "AI follow-up", finding.summary].filter(Boolean);
  const head = parts.join(" — ").slice(0, 500);
  return finding.url ? `${head} (${finding.url})` : head;
}

/** Validated in ./follow-ups.ts; the shape is here so the dialog can build one. */
export type CreateAiFollowUpInput = {
  leadId?: number | null;
  articleId?: number | null;
  what: string;
  agentKind: FollowUpAgentKind;
  schedule: FollowUpSchedule;
  targets?: string[];
  modelChoice?: string;
};

/* ==========================================================================
   The screen's own vocabulary
   ========================================================================== */

/** The status transitions the screen's action buttons perform. */
export type FollowUpAction = "pause" | "resume" | "stop" | "done" | "run-now";

/**
 * Which of the screen's four filters a row belongs to.
 *
 * They overlap on purpose, because that is what the drawn screen's segment
 * counts say: "Active · 5" is every agent still being worked (whatever its
 * last outcome), and "Found something · 1" / "Could not check · 1" are the
 * same rows seen by outcome. A stopped or done agent is in none of the first
 * three, so the four filters together account for every agent row.
 */
export type FollowUpFilter = "active" | "found" | "could-not-check" | "stopped";

export const FOLLOW_UP_FILTERS: FollowUpFilter[] = ["active", "found", "could-not-check", "stopped"];

export const FOLLOW_UP_FILTER_LABELS: Record<FollowUpFilter, string> = {
  active: "Active",
  found: "Found something",
  "could-not-check": "Could not check",
  stopped: "Stopped",
};

export function matchesFollowUpFilter(row: FollowUpRow, filter: FollowUpFilter): boolean {
  const live = row.status === "active" || row.status === "paused";
  switch (filter) {
    case "active":
      return live;
    case "found":
      return live && row.last_state === "found";
    case "could-not-check":
      return live && row.last_state === "could-not-check";
    case "stopped":
      return row.status === "stopped" || row.status === "done";
  }
}

/**
 * The state the card is DRAWN in -- one of the seven the design gives a color,
 * a chip and a set of buttons to, plus `stopping`, which the design has no card
 * for and this build needs (see below).
 *
 * Terminal status wins over `last_state`, because a stopped agent whose last
 * run found something is a stopped card: the editor ended it, and offering
 * "Pause" beside "Stopped" would be offering a button that does nothing. That
 * ordering is the whole of the rule and the reason this is a function rather
 * than a chain of ternaries in the component.
 *
 * `manual` is not a drawing state: an agent_kind of null is a manual ask, and
 * since 0.6.81 (unit CU) the manual workflow is retired -- the component that
 * drew those rows (`FollowUpItem`) is deleted with its reply/nudge/drop
 * buttons, and `listFollowUps` no longer returns a row without an agent_kind,
 * so no screen hands one in. It stays in the union so the answer for such a row
 * is still honest rather than the nearest agent state, which would show an
 * editor's old ask as an agent's finding. The rows themselves are kept by
 * migrations/0106_retire_manual_follow_ups.sql.
 */
export type FollowUpCardState =
  | "manual"
  | "found"
  | "running"
  | "waiting"
  | "no-change"
  | "could-not-check"
  | "stopping"
  | "stopped"
  | "done";

/** Is this run still going (or still waiting to)? The job's own two states. */
function runOpen(run: { status: string } | null | undefined): boolean {
  return Boolean(run && (run.status === "queued" || run.status === "running"));
}

/**
 * `stopping` is the one state the row cannot answer by itself: Stop has
 * committed -- the follow-up IS stopped, and no further run will ever be picked
 * -- but the run it had in flight has not reached its terminal state yet. It is
 * a property of the pair (row, live run), which is why the job is an argument
 * even though every other state reads off the row alone.
 *
 * Without it the card lies for as long as the worker takes to notice: the chip
 * would say "Stopped" while a progress bar underneath was still moving. With
 * it the card says "Stopping…" until the job is finished, and the next poll
 * (2 s while a job is open -- see `useFollowUpJobs`) turns it into "Stopped"
 * with no extra state anywhere. A card with no run in flight goes straight to
 * "Stopped", which is the honest answer when there was nothing to stop.
 */
export function followUpCardState(
  row: {
    agent_kind: FollowUpAgentKind | null;
    status: string;
    last_state: FollowUpState | null;
  },
  run?: { status: string } | null,
): FollowUpCardState {
  if (!row.agent_kind) return "manual";
  if (row.status === "stopped") return runOpen(run) ? "stopping" : "stopped";
  if (row.status === "done") return "done";
  switch (row.last_state) {
    case "running":
      return "running";
    case "found":
      return "found";
    case "no-change":
      return "no-change";
    case "could-not-check":
      return "could-not-check";
    default:
      // null (never run) and `waiting` are the same card: the agent is between
      // runs and its next one is on the schedule.
      return "waiting";
  }
}

/** Which `last_state` a card state corresponds to, for the chip. */
export const CARD_STATE_CHIP: Record<
  Exclude<FollowUpCardState, "manual" | "stopped" | "done">,
  string
> = {
  found: "Found an answer",
  running: "Running now",
  waiting: "Waiting",
  "no-change": "Checked · no change",
  "could-not-check": "Could not check",
  stopping: "Stopping…",
};

/* ==========================================================================
   What the card SAYS
   ========================================================================== */

/**
 * A time of day as every drawn card writes it: "7:48 a.m.", "6:00 a.m.".
 *
 * Lowercase meridiem with the periods is the house style on these cards, and
 * the desk's own screens write it that way too. Built by hand rather than with
 * `toLocaleTimeString` because the locale decides the meridiem's case and
 * spacing, so the same card would read differently on two machines.
 *
 * An unparseable or missing timestamp gives "", never "Invalid Date": a row
 * whose `last_run_at` is null has not run, and the caller drops the sentence
 * rather than printing a placeholder.
 */
export function clockLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const hour24 = at.getHours();
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const minutes = String(at.getMinutes()).padStart(2, "0");
  return `${hour}:${minutes} ${hour24 < 12 ? "a.m." : "p.m."}`;
}

/**
 * When the next check is due, as the drawn Waiting card writes it: "Wed 6:00
 * a.m.". A check later today says "today 6:00 a.m." instead of naming the day
 * it is already in.
 *
 * The weekday comes from `toLocaleDateString`, which is the one place a
 * locale is allowed to speak here: a weekday abbreviation is a word, not a
 * clock, so it does not have the case problem `clockLabel` avoids.
 */
export function nextCheckLabel(iso: string | null | undefined, from: Date = new Date()): string {
  if (!iso) return "";
  const clock = clockLabel(iso);
  if (!clock) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  if (at.toDateString() === from.toDateString()) return `today ${clock}`;
  return `${at.toLocaleDateString("en-US", { weekday: "short" })} ${clock}`;
}

/** The three timestamps the drawn cards' trailing sentence is built from. */
export type CardTimes = {
  /** `last_run_at`, as stored. */
  lastRunAt?: string | null;
  /** `next_run_at`, as stored. */
  nextRunAt?: string | null;
  /** The live run's `started_at`, in epoch ms, when one is in flight. */
  startedAt?: number | null;
  /**
   * "Now", for the two sentences that compare a timestamp with today ("today
   * 6:00 a.m." versus "Wed 6:00 a.m."). The screen passes its render clock; a
   * test pins one. Defaulted to the real clock when absent, so a caller that
   * does not care does not have to pass it.
   */
  from?: Date;
};

/**
 * The card's trailing sentence -- "last run 7:48 a.m.", "next check Wed 6:00
 * a.m.", "started 8:10 a.m." -- chosen by the card state, the same way the
 * drawn screen chooses it. Empty when the row has no timestamp to name, so the
 * caller can leave the sentence out rather than invent one.
 */
export function cardTimeLine(state: FollowUpCardState, times: CardTimes): string {
  switch (state) {
    case "running": {
      const started = times.startedAt ? clockLabel(new Date(times.startedAt).toISOString()) : "";
      return started ? `started ${started}` : "";
    }
    case "could-not-check":
      return times.lastRunAt ? `last tried ${clockLabel(times.lastRunAt)}` : "";
    case "waiting": {
      const next = nextCheckLabel(times.nextRunAt, times.from);
      return next ? `next check ${next}` : "";
    }
    default:
      if (times.lastRunAt) return `last run ${clockLabel(times.lastRunAt)}`;
      return times.nextRunAt ? `first check ${nextCheckLabel(times.nextRunAt, times.from)}` : "";
  }
}

/**
 * The card's result paragraph, for every state except `running` -- a run in
 * flight says what it is doing right now, which is the job's own step, and only
 * the component holding the job can know that.
 *
 * `could-not-check` composes the retry sentence out of the reason and the
 * schedule rather than storing it, because the reason is the agent's ("timed
 * out 3 times in a row") and the retry time is the clock's: a stored sentence
 * would still claim 2:00 p.m. after the next run moved it.
 */
export function cardResultLine(
  state: FollowUpCardState,
  finding: FollowUpFinding,
  times: CardTimes,
): string {
  switch (state) {
    case "found":
      return finding.summary || finding.title || "A finding was recorded — open it to read it.";
    case "no-change":
      return finding.summary || "The pages were the same as the last check.";
    case "could-not-check": {
      const reason = finding.reason || "The check could not be completed.";
      const retry = clockLabel(times.nextRunAt);
      // No full stop after the clock: the clock already ends in "p.m." or
      // "a.m.", and the composed sentence read "…at 2:00 p.m..".
      return retry ? `${reason} The agent will try again at ${retry}` : reason;
    }
    case "waiting":
      return finding.summary || "Nothing yet. The agent checks on its schedule and reports here.";
    case "stopping":
      /*
        True rather than reassuring: Stop has committed, and the result write
        that a run makes at its end is fenced on exactly that status, so this
        run cannot put a finding or a note anywhere. See
        `performRecordFollowUpRun` in ./follow-ups.ts.
      */
      return "Stopping — this run will not record anything more.";
    case "stopped":
      return finding.summary || finding.reason || "This agent was stopped. Nothing further will run.";
    case "done":
      return finding.summary || "This agent was marked done.";
    default:
      return "";
  }
}

/**
 * The chip in the card's top line, and the tone its border is drawn in.
 *
 * The tones are the five the drawing defines (`found` a yellow fill, `run` a
 * 2px ink outline, `wait` a 1px grey one, `fail` a dashed danger outline,
 * `none` a quiet green one). A stopped or done agent is `wait`: the drawing has
 * no stopped card, and the neutral tone is what says "nothing is happening"
 * without claiming the last run's outcome still stands -- which is exactly why
 * `--ok` is not used for it.
 */
export type CardChipTone = "found" | "run" | "wait" | "fail" | "none";

export function cardChip(state: FollowUpCardState): { text: string; tone: CardChipTone } | null {
  if (state === "manual") return null;
  if (state === "stopped") return { text: "Stopped", tone: "wait" };
  if (state === "done") return { text: "Finished", tone: "wait" };
  // "Stopping…" wears the running tone, not the neutral one: the run really is
  // still going, and the chip would be claiming otherwise in the same breath as
  // the progress bar under it.
  const tone: CardChipTone =
    state === "found"
      ? "found"
      : state === "running" || state === "stopping"
        ? "run"
        : state === "could-not-check"
          ? "fail"
          : state === "no-change"
            ? "none"
            : "wait";
  return { text: CARD_STATE_CHIP[state], tone };
}

/**
 * The buttons a card shows, by state -- the drawing's four states plus the two
 * terminal ones it does not draw.
 *
 * `emphasis` is the drawing's own vocabulary (its `p` / `o` / `d` / default
 * letters) rather than a button component, so this stays a pure decision the
 * test can read and the component maps it to `InkButton`'s tones.
 *
 * "Add to story" disappears once there IS a story: the note is written into
 * that story's reporting notes the moment the story is attached
 * (`performUpdateAiFollowUp`), so offering the button again would append the
 * same finding a second time. The drawing's Found card has a story already and
 * still shows the button -- the difference is deliberate.
 */
export type CardActionKey =
  | "review"
  | "add-story"
  | "edit"
  | "pause"
  | "resume"
  | "stop"
  | "done"
  | "run-now";

export type CardActionEmphasis = "primary" | "outline" | "danger" | "quiet";

export type CardAction = {
  key: CardActionKey;
  label: string;
  emphasis: CardActionEmphasis;
};

const EDIT_ACTION: CardAction = { key: "edit", label: "Edit", emphasis: "quiet" };
const STOP_ACTION: CardAction = { key: "stop", label: "Stop", emphasis: "danger" };

export function cardActions(state: FollowUpCardState, hasStory: boolean): CardAction[] {
  switch (state) {
    case "found":
      return [
        { key: "review", label: "Review finding", emphasis: "primary" },
        ...(hasStory
          ? []
          : [{ key: "add-story", label: "Add to story", emphasis: "outline" } as CardAction]),
        { key: "done", label: "Mark done", emphasis: "quiet" },
      ];
    case "running":
      return [{ key: "pause", label: "Pause", emphasis: "quiet" }, EDIT_ACTION, STOP_ACTION];
    case "could-not-check":
      return [{ key: "run-now", label: "Retry now", emphasis: "primary" }, EDIT_ACTION, STOP_ACTION];
    case "waiting":
    case "no-change":
      return [{ key: "run-now", label: "Run now", emphasis: "outline" }, EDIT_ACTION, STOP_ACTION];
    case "stopping":
      /*
        The run is already dying, so there is nothing left to press and nothing
        that would not make the card contradict itself: Stop again would change
        nothing, Run now is refused (the follow-up is stopped), and Resume while
        the cancelled run is still unwinding would put the agent back on the
        clock with a job on its way to `failed`. Edit stays, because it is the
        one action that does not move the status.
      */
      return [EDIT_ACTION];
    case "stopped":
      return [{ key: "resume", label: "Resume", emphasis: "outline" }, EDIT_ACTION];
    case "done":
      return [EDIT_ACTION];
    default:
      return [];
  }
}
