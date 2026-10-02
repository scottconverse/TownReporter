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
       `DRAWN_ROWS_WITHOUT_A_READ` (ops-cards.ts) and in the unit's report. One
       of the drawing's rows is in that list; the reason is recorded there. The
       other five that were, until unit CX3, all had a source on this machine
       and now read it -- a row that says "Not set" about a fact the desk has
       written down is worse than a missing read, because it looks like an
       answer.

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
  chip on the Writing models ladder: it is drawn only for a reader who may have
  the reads behind it (unit CX3, 0.6.81). The drawing draws `● Ready` / `! Slow`
  / `Key rejected` beside each rung; the two command-line rungs wear the login's
  own chip, from `getProviderStatuses()` (`WritingModelChip`, the same mapping
  the Models screen uses), and the two local rungs wear a chip built here from
  the live local-model catalog -- see `rungWords`. An editor, whose reads those
  are not, gets the ladder without chips and the card's own sentence saying
  whose they are, rather than a page of "Not set" where the desk has an answer.
*/

import type { HealthCheck, HealthState } from "@/lib/ops/health";
import type { DailyScanPolicy } from "@/lib/news/daily-scan";
import type { LocalCatalog } from "@/lib/news/local-models";
import type { MeetingOperatorSettings } from "@/lib/news/meeting-settings";
import type { NewsroomAccess } from "@/lib/news/membership";
import type { NamedOutletRead } from "@/lib/news/named-outlets.server";
import type { ProviderStatus } from "@/lib/news/provider-login";
import type { ProviderTimeSetting } from "@/lib/news/provider-settings";
import type { PaperConfig } from "@/lib/news/paper-settings";
import type { RoutineNoticeAutomation } from "@/lib/news/routine-notice-automation";
import type { RoutineNoticePolicy } from "@/lib/news/routine-notice-policy";
import type { SectionConfig } from "@/lib/news/section-types";
import type { TrashRow } from "@/lib/news/trash-store";
import type { YouTubeKeyState } from "@/lib/news/youtube-data-settings";
/* The chip vocabulary itself, so a rung's words and a row's words are the same
   four looks. Component-free (a type), so this file stays importable by the
   node test loader and by the client. */
import type { ChipTone } from "@/components/status-chip";
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
import { automaticLadder, providerEntry, type ProviderEntry } from "../news/provider-registry.ts";
import { TRASH_DAYS } from "../news/trash-store.ts";
import { formatAgo } from "../ops/health.ts";

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
  /*
    The two rows the drawing draws after Disk, from the two checks CX3 added to
    the health read: `backup` (the backup's own state file, ops/lib-backup.ps1)
    and `errors-24h` (failed desk jobs in the last day). Both are written to say
    what they know when they know nothing -- "No backup on record", "no
    successful backup yet" -- so this card does not have to turn an answer into
    "Not set". `NOT_SET` remains only for a health read that carried no such
    check at all, which is a read with no reading rather than a desk with none.
  */
  const backup = check("backup");
  const errors = check("errors-24h");
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
    {
      label: "Last backup",
      value: backup?.value ?? NOT_SET,
      tone: tone(backup?.state),
      help: backup?.note || undefined,
    },
    {
      label: "Errors in 24 h",
      value: errors?.value ?? NOT_SET,
      tone: tone(errors?.state),
      help: errors?.note || undefined,
    },
  ];
}

/**
 * Paper setup: the paper's own identity, as the reader sees it.
 *
 * `needsSetup` is the first-run answer (`firstRunSetupState`, which is the NOT
 * of the `onboarded` flag and nothing else). On an install nobody has set up,
 * `config` is the shipped fallback -- "Longmont, Colorado" and the build-time
 * editor address -- and printing it here showed a new owner somebody else's
 * town and inbox as if they were their own paper's (the auditor's finding on
 * main 8b9b5fca). So those three rows say Not set until setup is done. It is
 * deliberately NOT derived from whether the name or city is filled: the live
 * paper is onboarded with an empty name, city and state, which merge with the
 * shipped values, and it must read exactly as before.
 */
export function paperSetupRows(
  config: PaperConfig,
  sections: SectionConfig,
  needsSetup = false,
): OpsRow[] {
  const town = [config.city, config.state].map((part) => part?.trim()).filter(Boolean).join(", ");
  const visible = sections.sections.filter((section) => section.visible).length;
  return [
    { label: "Name", value: needsSetup ? NOT_SET : config.name.trim() || NOT_SET, tone: "plain" },
    { label: "Town", value: needsSetup ? NOT_SET : town || NOT_SET, tone: "plain" },
    {
      label: "Editor email",
      value: needsSetup ? NOT_SET : config.editorEmail?.trim() || NOT_SET,
      tone: "plain",
    },
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
 * The second value is the read's own `lastCaptureAt` -- `max(captured_at)` over
 * `meeting_capture_records`, the moment a capture started. Nothing else on this
 * machine holds it: `listMeetingActivity` orders by that column but selects the
 * video's `published` date, which is a publication date where a recording time
 * belongs. `captured_at` is nullable (migrations/0067), so a desk whose records
 * all lack one reads "None yet" rather than a time invented from `created_at`
 * -- the read answered, it answered "nothing recorded", and that is a different
 * fact from "no read here".
 */
export function meetingCaptureRows(settings: MeetingOperatorSettings, now = new Date()): OpsRow[] {
  const last = settings.lastCaptureAt;
  return [
    { label: "Bodies watched", value: String(settings.channels.length), tone: "plain" },
    {
      label: "Last capture",
      value: last ? formatAgo(last, now) : "None yet",
      tone: "plain",
      /* The read's own timestamp, unrounded: the row says how long ago, the
         hover says exactly when. */
      help: last || undefined,
    },
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
 *
 * "Transcripts" is the one drawn row left on `NOT_SET` (unit CX3, and the one
 * entry in `DRAWN_ROWS_WITHOUT_A_READ`): this machine stores no YouTube
 * transcript and no transcript test result to read. See the entry's `why`.
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

/**
 * Named outlets: how many the paper credits, and how many overrides it holds.
 *
 * Overrides are per draft where they act -- both reads inside `desk.ts` are
 * scoped to one `draft_id`, which is what the publish gate needs -- but the
 * table is this paper's record and is append-only by trigger
 * (migrations/0086), so the paper-wide count is a fact the desk has and the row
 * prints it. A paper with none prints 0: the table answered.
 */
export function namedOutletsRows(read: NamedOutletRead): OpsRow[] {
  const outlets = read.stored ?? read.shipped;
  return [
    { label: "Outlets", value: String(outlets.length), tone: "plain" },
    { label: "Overrides", value: String(read.overrides), tone: "plain" },
  ];
}

/**
 * Editors & access: the owner account, and the invites that are open.
 *
 * "Invites open" is the count of doors that are actually open -- minted, unused,
 * unexpired, the same predicate `signupOpenFor` acts on -- so a used or expired
 * link is not counted as one. 0 is an answer, not an absence: this desk has no
 * invite waiting. "Not set" stays on the owner row, where it means the one thing
 * it should: there is no account holding the desk to print.
 */
export function editorsAccessRows(access: NewsroomAccess): OpsRow[] {
  const owner = access.owner;
  return [
    {
      label: "Owner",
      value: owner?.email.trim() || NOT_SET,
      tone: "plain",
      help: owner?.name?.trim() || undefined,
    },
    { label: "Invites open", value: String(access.invitesOpen), tone: "plain" },
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
  /**
   * The drawing's fourth column, when this reader may have it. Undefined for
   * an editor (the reads behind it are the owner's) and for a rung no read
   * covers, which is a rung with no chip rather than a rung with a made-up
   * one.
   */
  chip?: OpsRungChip;
};

/**
 * A rung's readiness, in the two shapes the desk can honestly back it with.
 *
 * `status` is a login's own answer, handed through untouched so the page can
 * render it with `WritingModelChip` -- the mapping the Models screen already
 * uses, kept in one place. `words` is a chip this module builds for a rung no
 * login covers, out of the live local catalog and the same four tones
 * (`ChipTone`, components/status-chip.tsx).
 */
export type OpsRungChip =
  | { source: "status"; status: ProviderStatus }
  | { source: "words"; tone: ChipTone; label: string; help: string };

/**
 * What the page must have read before a ladder can wear its chips.
 *
 * Three reads, and every one of them is already on this page under the query
 * key its own screen uses: the per-provider time settings (the paper's switch
 * and the machine's, both already read for Time budgets), this machine's two
 * Claude Code / Codex logins (`getProviderStatuses`), and the live local-model
 * catalog (`localModelCatalog`).
 */
export type OpsModelRead = {
  times: ProviderTimeSetting[];
  statuses: ProviderStatus[];
  catalog: LocalCatalog;
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
 * Which of this machine's two logins a rung rides, by the rung's own kind.
 *
 * The pairing is the one the Models screen draws, read the other way round
 * (`desk.models.tsx`: `status.provider === "claude" ? "claude-code" : "codex"`),
 * and it is written down once here because the Server page needs the same
 * pairing to put a login's chip on the ladder's rung for that login's model.
 * A kind that is not in this map rides no login -- a local server, a gateway,
 * an API key -- and gets no chip from the status read.
 */
const LOGIN_FOR_KIND: Record<string, string | undefined> = {
  "claude-code": "claude",
  codex: "codex",
};

/** What the desk calls the local servers it finds, in words a reader knows. */
const SERVER_WORD: Record<string, string> = {
  lmstudio: "LM Studio",
  ollama: "Ollama",
  llamacpp: "llama.cpp",
  "openai-compatible": "the server at that address",
};

/**
 * The words a rung wears when no login's status covers it.
 *
 * Ordered so that every sentence is one this desk can back:
 *
 *   - switched off for this paper, or for this machine: `Turned off`, the same
 *     word `WritingModelChip` prints for a login that is off.
 *   - an address an installation setting named: `Set by hand`. The desk's own
 *     local look covers three fixed ports, so it has not visited this one and
 *     says nothing about what is there.
 *   - watched, and nothing at the other end: `Not answering`. This one is a
 *     claim about a probe that ran, which is why `endpointWatched` comes first.
 *   - answering, but the rung needs a model in memory and none is loaded:
 *     `No model loaded` -- the amber `slow` look, the same one
 *     `WritingModelChip` wears for a measured bad fact (a failed test), and the
 *     same fact `ai.ts`'s preflight skips the rung on
 *     (`requiresLoadedLocalModel`).
 *   - answering with what it needs: `Ready`.
 *
 * The drawing's `! Slow` is not among them: nothing on this read measures
 * speed, and a chip that cannot be acted on is worse than one fewer chip.
 */
function rungWords(
  setting: ProviderTimeSetting,
  needsLoadedModel: boolean,
  catalog: LocalCatalog | null,
): OpsRungChip & { source: "words" } {
  const off = { tone: "quiet" as const, label: "Turned off" };
  if (!setting.enabled) {
    return { source: "words", ...off, help: `${setting.label} is switched off for this paper.` };
  }
  if (setting.switchedOffByOperator) {
    return {
      source: "words",
      ...off,
      help: `${setting.label} is switched off for this installation. A start-up setting turns it back on.`,
    };
  }
  if (!setting.endpoint) {
    /* Unreachable for a rung: both local rungs ship an address. */
    return {
      source: "words",
      tone: "quiet",
      label: "Not read",
      help: `Nothing on this page has checked where ${setting.label} calls.`,
    };
  }
  if (!setting.endpointWatched) {
    return {
      source: "words",
      tone: "quiet",
      label: "Set by hand",
      help: `${setting.label} calls ${setting.endpoint}, an address this installation named. The desk's own local look visits the three default ports instead, so it cannot say what is there.`,
    };
  }
  const where = setting.endpoint;
  const server = catalog?.servers.find((s) => s.baseUrl === where);
  const named = server ? (SERVER_WORD[server.kind] ?? server.kind) : "the server";
  if (!server || !server.reachable) {
    return {
      source: "words",
      tone: "quiet",
      label: "Not answering",
      help: `Nothing answered at ${where} when the desk last looked. A run moves on to the next model.`,
    };
  }
  if (needsLoadedModel && catalog?.defaultModel?.baseUrl !== where) {
    return {
      source: "words",
      tone: "slow",
      label: "No model loaded",
      help: `${named} answered at ${where}, but no chat model is loaded in memory there. A run skips this rung until one is.`,
    };
  }
  return {
    source: "words",
    tone: "ready",
    label: "Ready",
    help: needsLoadedModel
      ? `${named} is answering at ${where} with a chat model loaded.`
      : `${named} is answering at ${where}.`,
  };
}

/**
 * The chip beside one rung, or undefined for a rung no read covers.
 *
 * A command-line rung wears its LOGIN's answer, handed through as a status so
 * the page renders it with the one chip mapping this product has. A local rung
 * has no login and no status -- `getProviderStatuses` loops the two command
 * lines and nothing else -- so it gets words built from the live catalog.
 *
 * Undefined only for a rung missing from the time settings, which cannot
 * happen while `providerTimeSettings` maps the whole registry; the caller
 * draws no chip rather than inventing one.
 */
function rungChip(entry: ProviderEntry, read: OpsModelRead): OpsRungChip | undefined {
  const login = LOGIN_FOR_KIND[entry.kind];
  const status = login ? read.statuses.find((s) => s.provider === login) : undefined;
  if (status) return { source: "status", status };
  const setting = read.times.find((t) => t.providerId === entry.id);
  if (!setting) return undefined;
  return rungWords(setting, Boolean(entry.requiresLoadedLocalModel), read.catalog);
}

/**
 * Writing models: the order Automatic tries, from the registry the runs
 * themselves read, with each rung's readiness chip when the page has a read
 * for it.
 *
 * `automaticLadder()` is the same list `automaticOrderSentence()` and the
 * models screen walk, so this card cannot print an order the desk no longer
 * has. The unnumbered row is the by-name model the drawing names, resolved
 * through the registry -- if that entry ever leaves the registry the row is
 * dropped rather than printed with a stale name.
 *
 * Called with no read, the lines are the order alone: that is the ladder an
 * editor gets, whose chips come from reads the server refuses them.
 */
export function writingModelLines(read?: OpsModelRead): OpsModelLine[] {
  const lines: OpsModelLine[] = [];
  const add = (entry: ProviderEntry, n: string, note: string) => {
    const chip = read ? rungChip(entry, read) : undefined;
    lines.push(chip ? { n, name: entry.label, note, chip } : { n, name: entry.label, note });
  };
  for (const id of automaticLadder()) {
    const entry = providerEntry(id);
    /* Unreachable: every id in the ladder came off the registry. */
    if (!entry) continue;
    add(entry, String(entry.ladderRank), entry.detail);
  }
  const byName = providerEntry(DRAWN_BY_NAME_PROVIDER);
  if (byName) add(byName, "—", BY_NAME_NOTE);
  return lines;
}
