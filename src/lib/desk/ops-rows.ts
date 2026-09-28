/*
  What each Server card's drawn rows SAY, given what the desk has read.

  Unit CX2. `ops-cards.ts` says which rows the drawing draws and in what order;
  this module fills them in, and `src/routes/desk.ops.tsx` draws the result. The
  split matters because the values are the part that can be wrong: every builder
  here is a pure function of one read, so the row a card prints can be asserted
  against real data in a unit test instead of only inspected in a screenshot.

  Three rules, and each one is why some code below looks the way it does:

    1. A row prints a value only where a read really has one. Where the desk has
       never stored the fact, the row prints `NOT_SET` -- never a zero, never a
       dash that reads as a zero -- and the row is named in
       `DRAWN_ROWS_WITHOUT_A_READ` (ops-cards.ts) and in the unit's report. Six
       of the drawing's rows are in that list; the reasons are recorded there.

    2. A builder is called only with data that arrived. The page shows a
       skeleton while a read is in flight and the read's own error while it
       failed, so "no data yet" never reaches here and never has to be told
       apart from "the desk has none".

    3. Tone carries the state, and the words carry the state too. The drawing
       colors a row's value with the same chip vocabulary the rest of the desk
       uses (`Chip`, components/status-chip.tsx); a reader who cannot see the
       color still reads "OK" or "Check". A row with nothing to report is
       `plain` -- no green chip on a healthy disk, because the drawing draws
       none, and because a page where everything is green says nothing.

  The one place this module is deliberately not the drawing's is the readiness
  chip on the Writing models ladder: the drawing draws `● Ready` per rung, and
  no read in this app answers that question per rung -- `getProviderStatuses()`
  answers it per *connection* (this machine's Claude Code and Codex logins), and
  a rung is a model, not a connection. The chips stay on that card's own screen,
  where the connections are listed, and this card lists the order instead.
*/

import type { HealthCheck, HealthState } from "@/lib/ops/health";
import type { DailyScanPolicy } from "@/lib/news/daily-scan";
import type { MeetingOperatorSettings } from "@/lib/news/meeting-settings";
import type { NewsroomAccess } from "@/lib/news/membership";
import type { NamedOutletRead } from "@/lib/news/named-outlets.server";
import type { ProviderTimeSetting } from "@/lib/news/provider-settings";
import type { PaperConfig } from "@/lib/news/paper-settings";
import type { RoutineNoticeAutomation } from "@/lib/news/routine-notice-automation";
import type { RoutineNoticePolicy } from "@/lib/news/routine-notice-policy";
import type { SectionConfig } from "@/lib/news/section-types";
import type { TrashRow } from "@/lib/news/trash-store";
import type { YouTubeKeyState } from "@/lib/news/youtube-data-settings";
/*
  The two value imports below are relative, and the `import type` lines above
  keep the alias, because the unit tests run this module through Node's own
  type-stripping loader (`scripts/run-tests-safe.mjs`), which erases `import
  type` but resolves neither `@/` nor an extensionless path. Measured:
  `node --experimental-strip-types -e "import('@/lib/news/trash-store')"` ->
  `ERR_MODULE_NOT_FOUND: Cannot find package '@/lib'`; the same specifier
  written relative resolves. Every other unit-tested module in this tree does
  the same (`src/lib/news/daily-scan.ts` imports `"../db.ts"`).
*/
import { automaticLadder, providerEntry } from "../news/provider-registry.ts";
import { TRASH_DAYS } from "../news/trash-store.ts";

/** The plain words a drawn row prints when the desk has no value for it. */
export const NOT_SET = "Not set";

/**
 * `plain` is the drawing's bold value; `ok`, `warn` and `fail` are the chip
 * looks from components/status-chip.tsx (`ready`, `slow`, `signin`).
 */
export type OpsRowTone = "plain" | "ok" | "warn" | "fail";

export type OpsRow = {
  /** The drawing's own label. */
  label: string;
  value: string;
  tone: OpsRowTone;
  /** The read's longer answer, where it has one, read on hover. */
  help?: string;
};

/** The state words the desk already uses (`WORD`, desk.ops.tsx). */
const HEALTH_WORD: Record<HealthState, string> = {
  ok: "OK",
  warn: "Check",
  down: "Down",
  unknown: "Unknown",
};

/**
 * Loud when something is wrong, quiet when it is not.
 *
 * A healthy row prints as plain bold text, the way the drawing draws `Disk`
 * and `Last backup`; only a row that needs attention carries a chip. The one
 * exception is the row the drawing itself marks as a status -- Database,
 * drawn `✓ OK` in the drawing's green -- and that one always wears its state.
 */
function tone(state: HealthState | undefined, always = false): OpsRowTone {
  if (state === "down") return "fail";
  if (state === "warn") return "warn";
  if (always) return state === "ok" ? "ok" : "plain";
  return "plain";
}

export type OpsHealth = { checks: HealthCheck[] };

/**
 * Health: exactly the drawing's four rows.
 *
 * The read carries more checks than the drawing draws (`Contents`, `Work
 * queue`, `Local launcher`, `Tunnel`), and the logs and the six machine actions
 * are behind this card's own buttons. Nothing here is dropped from the product:
 * it all lives on the card's screen, which is where an operator goes when one
 * of these four rows says Check.
 */
export function healthRows(health: OpsHealth): OpsRow[] {
  const check = (id: string) => health.checks.find((c) => c.id === id);
  const database = check("db");
  const disk = check("disk");
  return [
    {
      label: "Database",
      value: database ? HEALTH_WORD[database.state] : NOT_SET,
      tone: tone(database?.state, true),
      help: database?.value,
    },
    {
      label: "Disk",
      value: disk?.value ?? NOT_SET,
      tone: tone(disk?.state),
      help: disk?.note || undefined,
    },
    { label: "Last backup", value: NOT_SET, tone: "plain" },
    { label: "Errors in 24 h", value: NOT_SET, tone: "plain" },
  ];
}

/** Paper setup: the paper's own identity, as the reader sees it. */
export function paperSetupRows(config: PaperConfig, sections: SectionConfig): OpsRow[] {
  const town = [config.city, config.state].map((part) => part?.trim()).filter(Boolean).join(", ");
  const visible = sections.sections.filter((section) => section.visible).length;
  return [
    { label: "Name", value: config.name.trim() || NOT_SET, tone: "plain" },
    { label: "Town", value: town || NOT_SET, tone: "plain" },
    { label: "Editor email", value: config.editorEmail?.trim() || NOT_SET, tone: "plain" },
    { label: "Sections", value: `${visible} visible`, tone: "plain" },
  ];
}

/**
 * Recently deleted: the drawing's two rows.
 *
 * `Killed leads` is drawn as a sentence, not a count -- the drawing's value is
 * "Stay on the desk under Killed", which is where they are, and that is still
 * true of this desk. The count of drafted records is the number the desk can
 * really give, and it is the one the drawing prints a number for.
 */
export function recentlyDeletedRows(rows: TrashRow[]): OpsRow[] {
  const drafts = rows.filter((row) => row.kind === "draft").length;
  return [
    { label: "Drafts", value: `${drafts} · kept ${TRASH_DAYS} days`, tone: "plain" },
    { label: "Killed leads", value: "Stay on the desk under Killed", tone: "plain" },
  ];
}

/** Sections: how many the rail shows, and how many are put away. */
export function sectionsRows(sections: SectionConfig): OpsRow[] {
  const visible = sections.sections.filter((section) => section.visible).length;
  const hidden = sections.sections.length - visible;
  return [
    { label: "Visible", value: String(visible), tone: "plain" },
    { label: "Hidden or retired", value: String(hidden), tone: "plain" },
  ];
}

/** "6:00 a.m." from the stored 24-hour "06:00". */
export function clockText(localTime: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(localTime.trim());
  if (!match) return localTime.trim() || NOT_SET;
  const hours = Number(match[1]);
  const minutes = match[2];
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${minutes} ${hours < 12 ? "a.m." : "p.m."}`;
}

/** Daily scan: when it runs and how much it may read. */
export function dailyScanRows(policy: DailyScanPolicy): OpsRow[] {
  const runs = policy.paused
    ? "Paused"
    : policy.enabled
      ? `${clockText(policy.localTime)} daily`
      : "Off";
  return [
    { label: "Runs", value: runs, tone: policy.paused ? "warn" : "plain" },
    { label: "Files up to", value: `${policy.sourceCap} leads`, tone: "plain" },
  ];
}

/**
 * Meeting capture: how many bodies are watched, and when the desk last
 * recorded one.
 *
 * The second value is `NOT_SET` on purpose and is named in
 * `DRAWN_ROWS_WITHOUT_A_READ`: no read returns the capture time itself. The
 * settings read says what the desk watches, and `listMeetingActivity` orders by
 * capture time but selects the video's `published` date -- printing that under
 * "Last capture" would put a publication date where a recording time belongs.
 */
export function meetingCaptureRows(settings: MeetingOperatorSettings): OpsRow[] {
  return [
    { label: "Bodies watched", value: String(settings.channels.length), tone: "plain" },
    { label: "Last capture", value: NOT_SET, tone: "plain" },
  ];
}

/**
 * YouTube: whether the desk reads YouTube through Google's own service.
 *
 * The drawing prints a masked key (`···· 3c1e`). Nothing in this app can print
 * one: the key is write-only across the whole boundary, and the read answers
 * with a sentence instead (`YouTubeKeyState.wording`). That sentence is what
 * the row prints -- it is the desk's own words for this exact state, so the
 * card and the key screen cannot describe the same key two ways.
 */
export function youtubeRows(state: YouTubeKeyState): OpsRow[] {
  return [
    { label: "API key", value: state.wording, tone: state.hasKey ? "ok" : "plain" },
    { label: "Transcripts", value: NOT_SET, tone: "plain" },
  ];
}

/**
 * Routine notices: the notice kinds the owner has approved, and the last time
 * the desk handled them on its own.
 *
 * A kind counts as handled automatically when an approval for it is valid and
 * its source is still accepted. An approval that is not valid, or whose source
 * has since been retired or edited, is not the desk handling that kind quietly
 * -- it is a rule waiting to be looked at, and counting it would overstate what
 * runs without an editor.
 */
export function routineNoticeRows(policy: RoutineNoticePolicy, automation: RoutineNoticeAutomation): OpsRow[] {
  const keys = new Set(
    policy.approvals
      .filter((approval) => approval.valid && approval.sourceState === "accepted")
      .map((approval) => approval.formatKey),
  );
  const lastRun = automation.recentRuns[0];
  return [
    {
      label: "Handled automatically",
      value: `${keys.size} kinds`,
      tone: policy.paused ? "warn" : "plain",
      help: policy.paused
        ? "The owner has paused routine notices. Nothing runs on its own."
        : automation.enabled
          ? `Runs at ${clockText(automation.localTime)}.`
          : "The desk has the permissions, but routine editions are not switched on.",
    },
    {
      label: "Last run",
      value: lastRun ? lastRun.createdAt : "Not run yet",
      tone: "plain",
      help: lastRun ? `${lastRun.localDate} · ${lastRun.status}` : undefined,
    },
  ];
}

/** Named outlets: how many the paper credits. Overrides are per draft. */
export function namedOutletsRows(read: NamedOutletRead): OpsRow[] {
  const outlets = read.stored ?? read.shipped;
  return [
    { label: "Outlets", value: String(outlets.length), tone: "plain" },
    { label: "Overrides", value: NOT_SET, tone: "plain" },
  ];
}

/** Editors & access: the owner account, and the invites that are open. */
export function editorsAccessRows(access: NewsroomAccess): OpsRow[] {
  const owner = access.owner;
  return [
    {
      label: "Owner",
      value: owner?.email.trim() || NOT_SET,
      tone: "plain",
      help: owner?.name?.trim() || undefined,
    },
    { label: "Invites open", value: NOT_SET, tone: "plain" },
  ];
}

/** "10 min", "150 s", "2 min 30 s". */
export function secondsText(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/**
 * One answer's time allowance, in the drawing's words ("10 min per call",
 * "150 s per call").
 *
 * A group whose providers disagree prints the range rather than one
 * provider's number, so the card cannot claim a limit that half the group
 * does not have.
 */
export function perCallText(seconds: number[]): string {
  if (seconds.length === 0) return NOT_SET;
  const sorted = [...new Set(seconds)].sort((a, b) => a - b);
  if (sorted.length === 1) return `${secondsText(sorted[0])} per call`;
  return `${secondsText(sorted[0])}–${secondsText(sorted[sorted.length - 1])} per call`;
}

/**
 * Time budgets: the two groups the drawing draws.
 *
 * "Local models" is everything the desk runs on this machine without a
 * subscription -- the local kinds plus a configured gateway, which is an
 * endpoint the operator pointed at. "Subscription CLIs" is everything else,
 * which on this machine means the signed-in command-line tools.
 */
export function timeBudgetRows(times: ProviderTimeSetting[]): OpsRow[] {
  const local = times.filter((row) => row.kind === "local" || row.kind === "openai");
  const cli = times.filter((row) => row.kind !== "local" && row.kind !== "openai");
  return [
    { label: "Local models", value: perCallText(local.map((row) => row.callSeconds)), tone: "plain" },
    { label: "Subscription CLIs", value: perCallText(cli.map((row) => row.callSeconds)), tone: "plain" },
  ];
}

/** One rung of the Writing models ladder, as the drawing draws it. */
export type OpsModelLine = {
  /** The drawn number column: the rung's rank, or the em dash for a by-name model. */
  n: string;
  name: string;
  note: string;
};

/**
 * The note the drawing gives a model Automatic never reaches for.
 *
 * It is not decoration: a provider with no `ladderRank` is reachable only when
 * an editor picks it for a job (provider-registry.ts, on `claude-frontier`),
 * and that is what the drawing's "Only when you choose it by name" means.
 */
const BY_NAME_NOTE = "Only when you choose it by name";

/** The model the drawing draws in its unnumbered row, by its registry id. */
const DRAWN_BY_NAME_PROVIDER = "claude-frontier";

/**
 * Writing models: the order Automatic tries, from the registry the runs
 * themselves read.
 *
 * `automaticLadder()` is the same list `automaticOrderSentence()` and the
 * models screen walk, so this card cannot print an order the desk no longer
 * has. The unnumbered row is the by-name model the drawing names, resolved
 * through the registry -- if that entry ever leaves the registry the row is
 * dropped rather than printed with a stale name.
 */
export function writingModelLines(): OpsModelLine[] {
  const lines: OpsModelLine[] = [];
  for (const id of automaticLadder()) {
    const entry = providerEntry(id);
    /* Unreachable: every id in the ladder came off the registry. */
    if (!entry) continue;
    lines.push({ n: String(entry.ladderRank), name: entry.label, note: entry.detail });
  }
  const byName = providerEntry(DRAWN_BY_NAME_PROVIDER);
  if (byName) lines.push({ n: "—", name: byName.label, note: BY_NAME_NOTE });
  return lines;
}
