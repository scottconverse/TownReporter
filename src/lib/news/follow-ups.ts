import { getSql, withTransaction } from "../db.ts";
import { parseNotes, packNotes } from "./notes.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import type {
  FollowUpAgentKind,
  FollowUpRow,
  FollowUpState,
  FollowUpStatus,
} from "./types.ts";

/**
 * The Follow-ups object (Direction A, stage 1: docs/design/DIRECTION-A-BUILD-NOTES-2026-09-06.md).
 *
 * Written with relative imports only (no `@/...` aliases) on purpose, the
 * same reason model-request-commit.server.ts is: desk.ts pulls in modules
 * that plain `node --test` cannot resolve (see lead-queue-order.test.ts's
 * docstring), so this file lives apart from it and desk.ts's
 * `createServerFn` wrappers import these `perform*` functions rather than
 * defining the logic inline. That is also what lets follow-ups.test.ts and
 * schema-parity.test.ts import this file directly.
 *
 * `ensureFollowUpsSchema` mirrors migrations/0042_follow_ups.sql and
 * migrations/0101_ai_follow_ups.sql column-for-column so the schema-parity
 * test can diff the two sides; called at the top of every `perform*` function
 * below the same way desk.ts's `ensureDraftMemoColumn` is, so a plain
 * `node --test` run (no Vite migration glob) and a fresh PGLite preview both
 * have the table before it's queried.
 *
 * The two migrations are replayed in order, 0042 then 0101, rather than one
 * merged create: the upgrade of an existing 0042-shaped table is the same
 * statement sequence as the creation of a fresh one, so there is exactly one
 * description of the final schema on this side and no chance of the two paths
 * converging on different constraints. 0101's `drop constraint if exists
 * follow_ups_status_check` depends on Postgres's auto-naming of 0042's inline
 * check, which is what the real migration depends on too.
 */
export async function ensureFollowUpsSchema() {
  const sql = await getSql();
  await sql.query(`
    create table if not exists follow_ups (
      id serial primary key,
      newsroom_id integer not null default 1,
      user_id text not null,
      lead_id integer,
      article_id integer,
      who text not null,
      what text not null,
      due_on date,
      status text not null default 'open' check (status in ('open', 'answered', 'dropped')),
      nudged_at timestamptz,
      answered_at timestamptz,
      reply_text text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await sql.query(
    "create index if not exists follow_ups_newsroom_status_due on follow_ups (newsroom_id, status, due_on)",
  );
  // migrations/0101_ai_follow_ups.sql, statement for statement. One `sql.query`
  // per statement: `getSql().query()` goes through the extended protocol,
  // which refuses a batch ("cannot insert multiple commands into a prepared
  // statement"), so the file's statements are listed here rather than pasted
  // whole. `scripts/migrate.mjs` sends the file itself over the simple
  // protocol, so the migration path is unaffected.
  for (const statement of AI_FOLLOW_UP_STATEMENTS) await sql.query(statement);
}

/** 0101's statements, in the file's order. */
const AI_FOLLOW_UP_STATEMENTS = [
  "alter table follow_ups add column if not exists agent_kind text",
  "alter table follow_ups add column if not exists targets_json text not null default '[]'",
  "alter table follow_ups add column if not exists schedule text not null default ''",
  "alter table follow_ups add column if not exists model_choice text not null default 'auto'",
  "alter table follow_ups add column if not exists last_run_at timestamptz",
  "alter table follow_ups add column if not exists next_run_at timestamptz",
  "alter table follow_ups add column if not exists last_state text",
  "alter table follow_ups add column if not exists finding_json text not null default '{}'",
  "alter table follow_ups drop constraint if exists follow_ups_status_check",
  "alter table follow_ups add constraint follow_ups_status_check check (status in ('open', 'answered', 'dropped', 'active', 'paused', 'stopped', 'done'))",
  "alter table follow_ups drop constraint if exists follow_ups_agent_kind_check",
  "alter table follow_ups add constraint follow_ups_agent_kind_check check (agent_kind in ('recheck', 'search', 'agenda'))",
  "alter table follow_ups drop constraint if exists follow_ups_last_state_check",
  "alter table follow_ups add constraint follow_ups_last_state_check check (last_state in ('found', 'no-change', 'could-not-check', 'running', 'waiting'))",
  "create index if not exists follow_ups_newsroom_due on follow_ups (newsroom_id, status, next_run_at)",
];

function owned(context: { newsroomId?: number }) {
  return context.newsroomId ?? DEFAULT_NEWSROOM_ID;
}

/*
  The two branches below inline the same 22-column list by hand. The shim in
  src/lib/db.ts has no `unsafe()`, and a tagged template would bind an
  interpolated column list as one parameter, so a shared constant is not
  available to a query builder here. The duplication is covered by a test:
  follow-ups.test.ts writes every 0101 column and reads it back through
  `performListFollowUps`, so a column missing from a branch fails there rather
  than silently on the screen.
*/
export async function performListFollowUps(
  context: { userId: string; newsroomId?: number },
  input: { status?: FollowUpStatus; limit?: number } = {},
): Promise<FollowUpRow[]> {
  await ensureFollowUpsSchema();
  const sql = await getSql();
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const rows = input.status
    ? await sql<FollowUpRow>`
        select f.id, f.newsroom_id, f.user_id, f.lead_id, f.article_id, f.who, f.what, f.due_on,
               f.status, f.nudged_at, f.answered_at, f.reply_text, f.created_at, f.updated_at,
               f.agent_kind, f.targets_json, f.schedule, f.model_choice,
               f.last_run_at, f.next_run_at, f.last_state, f.finding_json,
               l.headline as lead_headline, a.slug as article_slug, a.headline as article_headline
        from follow_ups f
        left join leads l on l.id = f.lead_id
        left join articles a on a.id = f.article_id
        where f.newsroom_id = ${owned(context)} and f.status = ${input.status}
        order by (f.due_on is null), f.due_on asc, f.created_at desc
        limit ${limit}
      `
    : await sql<FollowUpRow>`
        select f.id, f.newsroom_id, f.user_id, f.lead_id, f.article_id, f.who, f.what, f.due_on,
               f.status, f.nudged_at, f.answered_at, f.reply_text, f.created_at, f.updated_at,
               f.agent_kind, f.targets_json, f.schedule, f.model_choice,
               f.last_run_at, f.next_run_at, f.last_state, f.finding_json,
               l.headline as lead_headline, a.slug as article_slug, a.headline as article_headline
        from follow_ups f
        left join leads l on l.id = f.lead_id
        left join articles a on a.id = f.article_id
        where f.newsroom_id = ${owned(context)}
        order by (f.status = 'open') desc, (f.due_on is null), f.due_on asc, f.created_at desc
        limit ${limit}
      `;
  return rows;
}

export async function performCreateFollowUp(
  context: { userId: string; newsroomId?: number },
  input: { leadId?: number | null; articleId?: number | null; who: string; what: string; dueOn?: string | null },
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  await ensureFollowUpsSchema();
  const who = input.who.trim().slice(0, 200);
  const what = input.what.trim().slice(0, 400);
  if (!who || !what) return { ok: false as const, error: "Who and what are both required." };
  const sql = await getSql();
  const rows = await sql<{ id: number }>`
    insert into follow_ups (user_id, newsroom_id, lead_id, article_id, who, what, due_on)
    values (
      ${context.userId}, ${owned(context)}, ${input.leadId ?? null}, ${input.articleId ?? null},
      ${who}, ${what}, ${input.dueOn ?? null}
    )
    returning id
  `;
  return { ok: true as const, id: rows[0]!.id };
}

/**
 * One follow-up by id, in the same shape the list returns -- including the
 * three joined display columns, so the worker can name the story in a progress
 * line without a second query.
 *
 * This is the read the run path uses. `follow-up-agents.ts` and
 * `follow-up-scheduler.ts` deliberately never select from `follow_ups`
 * themselves: the day a column is added, this function and
 * `performListFollowUps` are the only two places that have to learn about it.
 * Null means "gone, or not this newsroom's".
 */
export async function performReadFollowUp(
  context: { userId: string; newsroomId?: number },
  id: number,
): Promise<FollowUpRow | null> {
  await ensureFollowUpsSchema();
  const sql = await getSql();
  const rows = await sql<FollowUpRow>`
    select f.id, f.newsroom_id, f.user_id, f.lead_id, f.article_id, f.who, f.what, f.due_on,
           f.status, f.nudged_at, f.answered_at, f.reply_text, f.created_at, f.updated_at,
           f.agent_kind, f.targets_json, f.schedule, f.model_choice,
           f.last_run_at, f.next_run_at, f.last_state, f.finding_json,
           l.headline as lead_headline, a.slug as article_slug, a.headline as article_headline
    from follow_ups f
    left join leads l on l.id = f.lead_id
    left join articles a on a.id = f.article_id
    where f.id = ${id} and f.newsroom_id = ${owned(context)}
  `;
  return rows[0] ?? null;
}

export async function performRecordFollowUpReply(
  context: { userId: string; newsroomId?: number },
  input: { id: number; replyText: string; repliedOn?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureFollowUpsSchema();
  const replyText = input.replyText.trim().slice(0, 2000);
  if (!replyText) return { ok: false as const, error: "Add what they said before saving." };
  const sql = await getSql();
  const rows = await sql<{ id: number; lead_id: number | null; who: string }>`
    update follow_ups
    set status = 'answered', answered_at = now(), reply_text = ${replyText}, updated_at = now()
    where id = ${input.id} and newsroom_id = ${owned(context)}
    returning id, lead_id, who
  `;
  const row = rows[0];
  if (!row) return { ok: false as const, error: "That follow-up is gone." };
  if (row.lead_id) {
    const when = input.repliedOn ?? new Date().toISOString().slice(0, 10);
    const leadRows = await sql<{ notes_json: string | null }>`
      select notes_json from leads where id = ${row.lead_id} and newsroom_id = ${owned(context)}
    `;
    if (leadRows[0]) {
      const notes = parseNotes(leadRows[0].notes_json);
      notes.found.push({ t: `Reply from ${row.who} (${when}): ${replyText}` });
      await sql`
        update leads set notes_json = ${packNotes(notes)}
        where id = ${row.lead_id} and newsroom_id = ${owned(context)}
      `;
    }
  }
  return { ok: true as const };
}

export async function performNudgeFollowUp(
  context: { userId: string; newsroomId?: number },
  id: number,
): Promise<{ ok: true }> {
  await ensureFollowUpsSchema();
  const sql = await getSql();
  await sql`
    update follow_ups set nudged_at = now(), updated_at = now()
    where id = ${id} and newsroom_id = ${owned(context)} and status = 'open'
  `;
  return { ok: true as const };
}

export async function performDropFollowUp(
  context: { userId: string; newsroomId?: number },
  id: number,
): Promise<{ ok: true }> {
  await ensureFollowUpsSchema();
  const sql = await getSql();
  await sql`
    update follow_ups set status = 'dropped', updated_at = now()
    where id = ${id} and newsroom_id = ${owned(context)}
  `;
  return { ok: true as const };
}

/* ==========================================================================
   Redesign phase 6: AI follow-ups (migrations/0101_ai_follow_ups.sql).

   A follow-up with an `agent_kind` is not an ask the editor works; it is an
   agent that works. This half of the file is the vocabulary and the row-level
   writes that vocabulary needs -- schedules, the finding, the run record and
   the status transitions the screen's action buttons perform. The agents
   themselves (what a `recheck`, `search` or `agenda` run actually DOES) live
   in ./follow-up-agents.ts, and the thing that decides when one runs lives in
   ./follow-up-scheduler.ts. Both import from here rather than touching
   `follow_ups` themselves, so there is one place that knows the table's shape.

   It never publishes. Nothing in this section reads or writes `articles`,
   `drafts` or any publish path: a finding goes to the story's reporting notes
   (`leads.notes_json`, the same column and the same parse/pack helpers
   saveReportingNotes uses) and stops there. performRecordFollowUpRun's test
   asserts an article's status and published_at are untouched by a run.
   ========================================================================== */

/** What an agent can be told to do. Mirrors the 0101 check constraint. */
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

/** How often an agent runs. Mirrors what `nextRunAt` understands. */
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
 * Null means "never": an unrecognised schedule has no next run rather than
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

const EMPTY_FINDING: FollowUpFinding = {
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

export type CreateAiFollowUpInput = {
  leadId?: number | null;
  articleId?: number | null;
  what: string;
  agentKind: FollowUpAgentKind;
  schedule: FollowUpSchedule;
  targets?: string[];
  modelChoice?: string;
};

const MAX_TARGETS = 8;

/**
 * Create an AI follow-up: the question, the method, where to look and how
 * often. `who` is filled from the method rather than asked for -- an agent has
 * no correspondent, and the manual card's "who" column has to hold something
 * honest for the row to render on the same list.
 *
 * Everything is validated here rather than at run time: an unknown
 * `agent_kind` or `schedule` would create a row that can never run, and a
 * target that is not an http(s) URL would be handed to the page-watch engine
 * to canonicalise into a 404. A caller that sends one gets a refusal, not a
 * silently dead follow-up.
 */
export async function performCreateAiFollowUp(
  context: { userId: string; newsroomId?: number },
  input: CreateAiFollowUpInput,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  await ensureFollowUpsSchema();
  const what = (input.what ?? "").trim().slice(0, 800);
  if (!what) return { ok: false as const, error: "Say what the follow-up should find out." };
  if (!isAgentKind(input.agentKind)) return { ok: false as const, error: "Unknown follow-up method." };
  if (!isFollowUpSchedule(input.schedule)) {
    return { ok: false as const, error: "Unknown schedule." };
  }
  const targets: string[] = [];
  for (const raw of (input.targets ?? []).slice(0, MAX_TARGETS)) {
    const target = typeof raw === "string" ? raw.trim() : "";
    if (!target) continue;
    if (!/^https?:\/\//i.test(target)) {
      return { ok: false as const, error: "Links to look at must start with http:// or https://" };
    }
    targets.push(target.slice(0, 500));
  }
  if (input.agentKind !== "search" && targets.length === 0) {
    return { ok: false as const, error: "Add at least one link to check." };
  }
  const modelChoice = (input.modelChoice ?? "auto").trim().slice(0, 120) || "auto";
  const sql = await getSql();
  const rows = await sql<{ id: number }>`
    insert into follow_ups
      (user_id, newsroom_id, lead_id, article_id, who, what, status,
       agent_kind, targets_json, schedule, model_choice, last_state, next_run_at)
    values (
      ${context.userId}, ${owned(context)}, ${input.leadId ?? null}, ${input.articleId ?? null},
      ${AGENT_METHOD_LABELS[input.agentKind]}, ${what}, 'active',
      ${input.agentKind}, ${JSON.stringify(targets)}, ${input.schedule}, ${modelChoice},
      'waiting', ${nextRunAt(input.schedule)?.toISOString() ?? null}
    )
    returning id
  `;
  return { ok: true as const, id: rows[0]!.id };
}

/**
 * The agent's own write, at the end of a run: what it found, what it could not
 * do, and when it runs again.
 *
 * On `found` it ALSO appends the finding to the linked story's reporting
 * notes, through the same column and the same parse/pack helpers
 * `saveReportingNotes` uses, inside a transaction that locks the lead row the
 * same way -- an agent that wrote notes from a copy it read before an editor
 * saved would erase the editor's edit. That is the whole of what a finding
 * does: notes and `last_state`. There is no publish path in this function and
 * the test for it asserts an article is byte-identical across a run.
 *
 * If the follow-up is not linked to a story (`lead_id` and `article_id` both
 * null) the state still moves and no note is written; the finding is on the
 * card, and the editor links it to a story from there. That is why
 * `noteWritten` is reported back rather than assumed.
 */
export async function performRecordFollowUpRun(
  context: { userId: string; newsroomId?: number },
  input: {
    id: number;
    state: FollowUpState;
    finding?: Partial<FollowUpFinding> | null;
    /** ISO string; omit to leave the existing next_run_at alone. */
    nextRunAt?: string | null;
    /** Extra line for the story's notes; defaults to the finding's own line. */
    note?: string | null;
  },
): Promise<{ ok: true; noteWritten: boolean } | { ok: false; error: string }> {
  await ensureFollowUpsSchema();
  const finding = { ...EMPTY_FINDING, ...(input.finding ?? {}), checkedAt: input.finding?.checkedAt ?? new Date().toISOString() };
  const sql = await getSql();
  const rows = await sql<{ id: number; lead_id: number | null; article_id: number | null }>`
    update follow_ups
    set last_state = ${input.state}, last_run_at = now(), finding_json = ${packFinding(finding)},
        next_run_at = ${input.nextRunAt ?? null}, updated_at = now()
    where id = ${input.id} and newsroom_id = ${owned(context)}
    returning id, lead_id, article_id
  `;
  const row = rows[0];
  if (!row) return { ok: false as const, error: "That follow-up is gone." };
  if (input.state !== "found") return { ok: true as const, noteWritten: false };

  const noteText = (input.note ?? findingNoteLine(finding)).trim().slice(0, 600);
  if (!noteText) return { ok: true as const, noteWritten: false };
  // An article row knows its lead; a follow-up started from the story page has
  // only the article. Resolve to the lead, then write through the notes column.
  let leadId = row.lead_id;
  if (!leadId && row.article_id) {
    const articleRows = await sql<{ lead_id: number | null }>`
      select lead_id from articles where id = ${row.article_id} and newsroom_id = ${owned(context)}
    `;
    leadId = articleRows[0]?.lead_id ?? null;
  }
  if (!leadId) return { ok: true as const, noteWritten: false };

  const written = await withTransaction(async (tx) => {
    const leadRows = await tx<{ notes_json: string | null }>`
      select notes_json from leads
      where id = ${leadId} and newsroom_id = ${owned(context)}
      for update
    `;
    if (!leadRows[0]) return false;
    const notes = parseNotes(leadRows[0].notes_json);
    notes.found.push({ t: noteText, src: "machine" });
    await tx`
      update leads set notes_json = ${packNotes(notes)}
      where id = ${leadId} and newsroom_id = ${owned(context)}
    `;
    return true;
  });
  return { ok: true as const, noteWritten: written };
}

/** The status transitions the screen's action buttons perform. */
export type FollowUpAction = "pause" | "resume" | "stop" | "done" | "run-now";

const ACTION_STATUS: Record<Exclude<FollowUpAction, "run-now">, FollowUpStatus> = {
  pause: "paused",
  resume: "active",
  stop: "stopped",
  done: "done",
};

export async function performFollowUpAction(
  context: { userId: string; newsroomId?: number },
  id: number,
  action: FollowUpAction,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureFollowUpsSchema();
  const sql = await getSql();
  if (action === "run-now") {
    // Due now, and active: "Run now" on a paused card also resumes it, which
    // is what the drawn Waiting card's three buttons (Run now, Edit, Stop)
    // imply -- there is no fourth way back from paused.
    const rows = await sql`
      update follow_ups
      set status = 'active', next_run_at = now(), updated_at = now()
      where id = ${id} and newsroom_id = ${owned(context)} and agent_kind is not null
      returning id
    `;
    return rows.length ? { ok: true as const } : { ok: false as const, error: "That follow-up is gone." };
  }
  const rows = await sql`
    update follow_ups set status = ${ACTION_STATUS[action]}, updated_at = now()
    where id = ${id} and newsroom_id = ${owned(context)} and agent_kind is not null
    returning id
  `;
  return rows.length ? { ok: true as const } : { ok: false as const, error: "That follow-up is gone." };
}

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
 * The agents the scheduler may run right now: active, due, with a known
 * method, oldest first. Nulls are excluded rather than sorted last -- a row
 * with no `next_run_at` is a manual ask or an agent whose schedule this build
 * does not know, and neither is due.
 *
 * `limit` is small and the caller runs them one at a time; this returns the
 * CANDIDATES, it does not claim them. `performClaimFollowUpRun` below is what
 * makes a pick exclusive, and the scheduler's open-job fence is what keeps two
 * runs from overlapping.
 *
 * A row already `running` is NOT due, even though its `next_run_at` is still
 * in the past: a run in flight does not reschedule itself until it records an
 * outcome, so without this predicate the scheduler would pick the same row on
 * every tick for as long as the run took. `performReconcileFollowUpRuns` in
 * ./follow-up-scheduler.ts is what clears a `running` row whose worker died.
 */
export async function performDueFollowUps(
  newsroomId: number,
  now: Date = new Date(),
  limit = 3,
): Promise<FollowUpRow[]> {
  await ensureFollowUpsSchema();
  const sql = await getSql();
  const rows = await sql<FollowUpRow>`
    select f.id, f.newsroom_id, f.user_id, f.lead_id, f.article_id, f.who, f.what, f.due_on,
           f.status, f.nudged_at, f.answered_at, f.reply_text, f.created_at, f.updated_at,
           f.agent_kind, f.targets_json, f.schedule, f.model_choice,
           f.last_run_at, f.next_run_at, f.last_state, f.finding_json
    from follow_ups f
    where f.newsroom_id = ${newsroomId}
      and f.status = 'active'
      and f.agent_kind is not null
      and f.last_state is distinct from 'running'
      and f.next_run_at is not null
      and f.next_run_at <= ${now.toISOString()}
    order by f.next_run_at asc, f.id asc
    limit ${Math.min(Math.max(limit, 1), 10)}
  `;
  return rows;
}

/**
 * Claim a due follow-up for a run: only one run per row, and only from
 * `active`.
 *
 * The claim is the `status = 'active'` predicate on the update, so a second
 * caller -- a second tick, or the editor's Run now arriving between the select
 * and the update -- matches no row and gets `false`. The WORKER makes this
 * call, as the first thing it does with a `follow-up` job, because that is the
 * last moment before real work starts and the only one that closes the gap
 * between "the scheduler chose this row" and "a run is actually happening":
 * the queue may have held the job for minutes, and the editor may have stopped
 * the follow-up in that time. A worker that gets `false` records nothing and
 * returns; the fence in ./follow-up-scheduler.ts keeps the queue from holding
 * two of them anyway. `last_state` moves to `running` here so a process that
 * dies mid-run leaves a row that says it was running rather than one that
 * looks idle -- `performReconcileFollowUpRuns` clears those.
 */
export async function performClaimFollowUpRun(
  newsroomId: number,
  id: number,
): Promise<boolean> {
  await ensureFollowUpsSchema();
  const sql = await getSql();
  const rows = await sql`
    update follow_ups
    set last_state = 'running', updated_at = now()
    where id = ${id} and newsroom_id = ${newsroomId}
      and status = 'active' and last_state is distinct from 'running'
    returning id
  `;
  return rows.length > 0;
}

/**
 * Put a follow-up back to waiting after a run that did not finish -- a cancel,
 * a crash, or a job that failed before the agent could record anything. The
 * reason is kept in the finding so the card can say why, and `next_run_at` is
 * pushed out by one interval so a repeatedly failing agent does not spin.
 */
export async function performReleaseFollowUpRun(
  context: { userId: string; newsroomId?: number },
  id: number,
  reason: string,
): Promise<void> {
  await ensureFollowUpsSchema();
  const sql = await getSql();
  const rows = await sql<{ schedule: string | null; finding_json: string | null }>`
    select schedule, finding_json from follow_ups
    where id = ${id} and newsroom_id = ${owned(context)}
  `;
  const row = rows[0];
  if (!row) return;
  const finding = { ...parseFinding(row.finding_json), reason: reason.slice(0, 300) };
  const next = nextRunAt(row.schedule ?? "");
  await sql`
    update follow_ups
    set last_state = 'waiting', last_run_at = now(), finding_json = ${packFinding(finding)},
        next_run_at = ${next?.toISOString() ?? null}, updated_at = now()
    where id = ${id} and newsroom_id = ${owned(context)}
  `;
}
