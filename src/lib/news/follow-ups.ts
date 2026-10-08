import { ensureSchemaOnce, getSql, withTransaction, type Sql } from "../db.ts";
import { parseNotes, packNotes } from "./notes.ts";
import { sanitizeJsonLeaves, storableText } from "./storable-text.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import {
  AGENT_METHOD_LABELS,
  EMPTY_FINDING,
  findingNoteLine,
  isAgentKind,
  isFollowUpSchedule,
  nextRunAt,
  packFinding,
  parseFinding,
  type CreateAiFollowUpInput,
  type FollowUpAction,
  type FollowUpFinding,
} from "./follow-up-copy.ts";
import type { FollowUpRow, FollowUpState, FollowUpStatus } from "./types.ts";

/*
  The vocabulary -- the agent kinds, the schedules, the finding, the card state
  and the four filters -- lives in ./follow-up-copy.ts, with no runtime import
  a browser cannot resolve, so the redesigned screen can use it. Re-exported
  here so every existing `from "./follow-ups.ts"` import kept working when it
  moved; that is why the list below repeats names this file also imports.
*/
export {
  AGENT_KINDS,
  AGENT_METHOD_LABELS,
  CARD_STATE_CHIP,
  EMPTY_FINDING,
  FOLLOW_UP_FILTERS,
  FOLLOW_UP_FILTER_LABELS,
  FOLLOW_UP_SCHEDULES,
  POSTING_DAYS,
  POSTING_HOUR,
  SCHEDULE_LABELS,
  findingNoteLine,
  followUpCardState,
  followUpTargets,
  isAgentKind,
  isFollowUpSchedule,
  matchesFollowUpFilter,
  methodLine,
  nextRunAt,
  packFinding,
  parseFinding,
  scheduleForAgent,
} from "./follow-up-copy.ts";
export type {
  CreateAiFollowUpInput,
  FollowUpAction,
  FollowUpCardState,
  FollowUpFilter,
  FollowUpFinding,
  FollowUpSchedule,
} from "./follow-up-copy.ts";

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
  // migrations/0101_ai_follow_ups.sql, statement for statement. One statement
  // per entry: `getSql().query()` goes through the extended protocol, which
  // refuses a batch ("cannot insert multiple commands into a prepared
  // statement"), so the file's statements are listed here rather than pasted
  // whole. `scripts/migrate.mjs` sends the file itself over the simple
  // protocol, so the migration path is unaffected.
  //
  // The whole list goes through `ensureSchemaOnce`, so the `alter table ...
  // add constraint` statements in 0101 -- ACCESS EXCLUSIVE, and so queued
  // behind the nightly `pg_dump` -- run once per database and not once per
  // page load. See `paper-settings-read-lock.test.ts` and `questions/BP.md`.
  await ensureSchemaOnce(sql, "follow-ups", [
    `
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
  `,
    "create index if not exists follow_ups_newsroom_status_due on follow_ups (newsroom_id, status, due_on)",
    ...AI_FOLLOW_UP_STATEMENTS,
  ]);
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
  This inlines the 22-column list by hand. The shim in src/lib/db.ts has no
  `unsafe()`, and a tagged template would bind an interpolated column list as
  one parameter, so a shared constant is not available to a query builder here.
  The column set is covered by a test: follow-ups.test.ts writes every 0101
  column and reads it back through `performListFollowUps`, so a column missing
  here fails there rather than silently on the screen.

  AGENT ROWS ONLY. `agent_kind is not null` is the read half of retiring the
  manual workflow (0.6.81, unit CU; the data half is
  migrations/0106_retire_manual_follow_ups.sql): a row without an agent kind is
  a manual ask -- who to call, what they owe, when -- and there is no screen
  left that draws one, no way to create one and no way to work one. Filtering
  here rather than in each screen is what makes "a manual row cannot reach any
  view" a property of the one query every view goes through, instead of three
  render-time filters that a fourth view could forget. The rows themselves stay
  in the table for the record (the migration only closes them).

  The `status` filter that used to be the second branch went with the manual
  workflow: its only legal values were open | answered | dropped, no caller
  passed one, and the screen narrows what it was given with
  `matchesFollowUpFilter` client-side. The order lost its `due_on` clause for
  the same reason -- no insert has set `due_on` since the manual create was the
  only writer, so `(due_on is null), due_on` sorted nothing and the clause is
  now `created_at desc`, which is what it already resolved to.
*/
export async function performListFollowUps(
  context: { userId: string; newsroomId?: number },
  input: { limit?: number } = {},
): Promise<FollowUpRow[]> {
  await ensureFollowUpsSchema();
  const sql = await getSql();
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  return sql<FollowUpRow>`
    select f.id, f.newsroom_id, f.user_id, f.lead_id, f.article_id, f.who, f.what, f.due_on,
           f.status, f.nudged_at, f.answered_at, f.reply_text, f.created_at, f.updated_at,
           f.agent_kind, f.targets_json, f.schedule, f.model_choice, f.investigation_id,
           f.last_run_at, f.next_run_at, f.last_state, f.finding_json,
           l.headline as lead_headline, a.slug as article_slug, a.headline as article_headline,
           i.title as investigation_title
    from follow_ups f
    left join leads l on l.id = f.lead_id
    left join articles a on a.id = f.article_id
    left join investigations i on i.id = f.investigation_id and i.newsroom_id = f.newsroom_id
    where f.newsroom_id = ${owned(context)}
      and f.agent_kind is not null
    order by f.created_at desc
    limit ${limit}
  `;
}

/**
 * The findings an editor should see on Today: agent follow-ups that have found
 * something and are still being worked, newest finding first.
 *
 * This is the "surface it on Today" half of the brief's item 4, exported so
 * the Today screen (lane 3) can mount it without knowing anything about
 * `follow_ups`. The other half -- appending the finding to the story's
 * reporting notes -- happens once, in `performRecordFollowUpRun` above, at the
 * moment the agent records the run; this query reads `last_state = 'found'`
 * rather than searching the notes, so a finding the editor deleted from the
 * notes does not come back every time the rail loads.
 *
 * Stopped and done rows are excluded: the rail is a work list, and an agent
 * the editor has ended is not work. The finding itself is on the card in
 * `/desk/follow-ups` for as long as the row exists.
 *
 * Nothing here publishes, and nothing here can: the query reads one table.
 */
export async function performListFollowUpFindings(
  context: { userId: string; newsroomId?: number },
  input: { limit?: number } = {},
): Promise<FollowUpRow[]> {
  await ensureFollowUpsSchema();
  const sql = await getSql();
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  return sql<FollowUpRow>`
    select f.id, f.newsroom_id, f.user_id, f.lead_id, f.article_id, f.who, f.what, f.due_on,
           f.status, f.nudged_at, f.answered_at, f.reply_text, f.created_at, f.updated_at,
           f.agent_kind, f.targets_json, f.schedule, f.model_choice,
           f.last_run_at, f.next_run_at, f.last_state, f.finding_json,
           l.headline as lead_headline, a.slug as article_slug, a.headline as article_headline
    from follow_ups f
    left join leads l on l.id = f.lead_id
    left join articles a on a.id = f.article_id
    where f.newsroom_id = ${owned(context)}
      and f.agent_kind is not null
      and f.status in ('active', 'paused')
      and f.last_state = 'found'
    order by f.last_run_at desc nulls last, f.id desc
    limit ${limit}
  `;
}

/**
 * The manual write functions that were here -- `performCreateFollowUp`
 * (who/what/due), `performRecordFollowUpReply`, `performNudgeFollowUp` and
 * `performDropFollowUp` -- were removed in 0.6.81 (unit CU). They were the
 * server half of the human "seek a response" step, which DECISIONS.md:44
 * retires outright ("No human 'seek a response' step anywhere"; see also
 * DECISIONS.md:38, "Follow-ups are AI agents ... not a list of people to
 * call"). Nothing replaces them: an editor who wants a question watched
 * starts an agent (`performCreateAiFollowUp` below), and the four statuses
 * they wrote (open | answered | dropped) are only ever read now, by
 * migrations/0106_retire_manual_follow_ups.sql closing the rows that were
 * still open. The rows themselves are kept, and so is their table.
 */

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
type NormalizedAiFollowUp =
  | { ok: true; what: string; targets: string[]; modelChoice: string }
  | { ok: false; error: string };

/**
 * The validation both the create and the edit path perform, in one place: two
 * copies of a rule about what a follow-up may say is two chances for the dialog
 * to accept something the row cannot run.
 */
function normalizeAiFollowUp(input: CreateAiFollowUpInput): NormalizedAiFollowUp {
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
  return { ok: true as const, what, targets, modelChoice };
}

export async function performCreateAiFollowUp(
  context: { userId: string; newsroomId?: number },
  input: CreateAiFollowUpInput,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  await ensureFollowUpsSchema();
  const checked = normalizeAiFollowUp(input);
  if (!checked.ok) return checked;
  const { what, targets, modelChoice } = checked;
  const sql = await getSql();
  const investigationId = input.investigationId ?? null;
  if (investigationId != null) {
    if (!Number.isSafeInteger(investigationId) || investigationId < 1) {
      return { ok: false as const, error: "Choose a Dark Desk file in this newsroom." };
    }
    const file = await sql<{ id: number }>`
      select id from investigations where id = ${investigationId} and newsroom_id = ${owned(context)} limit 1
    `;
    if (!file[0]) return { ok: false as const, error: "Choose a Dark Desk file in this newsroom." };
  }
  const rows = await sql<{ id: number }>`
    insert into follow_ups
      (user_id, newsroom_id, lead_id, article_id, investigation_id, who, what, status,
       agent_kind, targets_json, schedule, model_choice, last_state, next_run_at)
    values (
      ${context.userId}, ${owned(context)}, ${input.leadId ?? null}, ${input.articleId ?? null}, ${investigationId},
      ${AGENT_METHOD_LABELS[input.agentKind]}, ${what}, 'active',
      ${input.agentKind}, ${JSON.stringify(targets)}, ${input.schedule}, ${modelChoice},
      'waiting', ${nextRunAt(input.schedule)?.toISOString() ?? null}
    )
    returning id
  `;
  return { ok: true as const, id: rows[0]!.id };
}

/**
 * Edit an agent: the question, the method, where to look, how often.
 *
 * The drawn card offers Edit on four of its five states, so this is not an
 * optional path -- and it is the same validation as create, because an edit
 * that could turn a runnable follow-up into an unrunnable one would be a way
 * to kill an agent from a dialog that looks like it is fixing a typo.
 *
 * `next_run_at` is re-baselined ONLY when the schedule actually changed. An
 * editor who fixes a typo in the question must not push the next run out by
 * another interval -- that would make editing a way to postpone an agent
 * indefinitely -- and an editor who changes "every 2 hours" to "daily" must
 * not have two hours of the old cadence left on the clock.
 *
 * The `agent_kind is not null` predicate is what keeps this off manual asks:
 * they have their own dialog, and a follow-up with no method has no schedule
 * for the line above to mean anything about.
 *
 * THE STORY IS THE ONE FIELD THIS CAN ADD LATE, and only ever add. An agent
 * made from the Follow-ups screen starts unlinked (that dialog has no story
 * picker), so its finding lands on the card and nowhere else; the card's "Add
 * to story" and the dialog's Story field are how it gets a story afterwards.
 * The update therefore coalesces rather than assigns -- an edit that does not
 * mention a story must not unlink the one a previous edit set -- and, when a
 * story is attached to a row whose last run already FOUND something, that
 * finding is written into the new story's notes here. Without that second half
 * the button would attach a story to a finding and leave the finding behind.
 * It fires only on the transition from unlinked to linked, so editing a linked
 * follow-up cannot append the same finding twice.
 */
export async function performUpdateAiFollowUp(
  context: { userId: string; newsroomId?: number },
  input: CreateAiFollowUpInput & { id: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureFollowUpsSchema();
  const checked = normalizeAiFollowUp(input);
  if (!checked.ok) return checked;
  const { what, targets, modelChoice } = checked;
  const sql = await getSql();
  const next = nextRunAt(input.schedule)?.toISOString() ?? null;
  const [before] = await sql<{ lead_id: number | null; last_state: FollowUpState | null; finding_json: string | null }>`
    select lead_id, last_state, finding_json from follow_ups
    where id = ${input.id} and newsroom_id = ${owned(context)} and agent_kind is not null
  `;
  const rows = await sql`
    update follow_ups
    set what = ${what}, agent_kind = ${input.agentKind}, targets_json = ${JSON.stringify(targets)},
        schedule = ${input.schedule}, model_choice = ${modelChoice},
        lead_id = coalesce(${input.leadId ?? null}, lead_id),
        article_id = coalesce(${input.articleId ?? null}, article_id),
        next_run_at = case when schedule <> ${input.schedule} then ${next} else next_run_at end,
        updated_at = now()
    where id = ${input.id} and newsroom_id = ${owned(context)} and agent_kind is not null
    returning id
  `;
  if (!rows.length) return { ok: false as const, error: "That follow-up is gone." };
  if (before && !before.lead_id && input.leadId && before.last_state === "found") {
    const finding = parseFinding(before.finding_json);
    await appendFindingNote(context, input.leadId, findingNoteLine(finding));
  }
  return { ok: true as const };
}

/**
 * One line appended to a story's reporting notes, through the editor's own
 * column: `notes_json`, parsed and packed by the same helpers, inside a
 * transaction that locks the lead row `for update` exactly as
 * `saveReportingNotes` does. An agent that wrote notes from a copy it read
 * before an editor saved would erase the editor's edit.
 *
 * `src: "machine"` is what the notes block reads to mark a line as found by
 * the desk rather than typed by the editor. Two callers use this: a run that
 * ends `found`, and an edit that attaches a story to a follow-up that had
 * already found something.
 *
 * `tx` IS THE CALLER'S TRANSACTION, and for the run path it must be: the note
 * is the second half of a run's result, and the fence that refuses a stopped
 * run's result (see `performRecordFollowUpRun`) lives in the same transaction
 * as this write. Split them and there is a window where the fence has already
 * passed and the note has not been written yet -- a Stop landing there would
 * leave a stopped follow-up's finding in the editor's notes, which is the one
 * thing this whole path exists to prevent.
 */
async function appendFindingNoteIn(
  tx: Sql,
  context: { userId: string; newsroomId?: number },
  leadId: number,
  text: string,
): Promise<boolean> {
  const noteText = text.trim().slice(0, 600);
  if (!noteText) return false;
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
}

/** `appendFindingNoteIn` for a caller that is not already in a transaction. */
async function appendFindingNote(
  context: { userId: string; newsroomId?: number },
  leadId: number,
  text: string,
): Promise<boolean> {
  return withTransaction((tx) => appendFindingNoteIn(tx, context, leadId, text));
}

/**
 * What a run's result write did. `stopped` on the refusal says WHICH refusal
 * this was: the editor's Stop (the run may not record, and the worker ends the
 * job as cancelled) rather than a row that is no longer there.
 */
export type FollowUpRecordResult =
  | { ok: true; noteWritten: boolean }
  | { ok: false; error: string; stopped: boolean };

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
 *
 * THE FENCE. `status <> 'stopped'` is in the WHERE of the one statement that
 * moves the row, and the notes write is inside the SAME transaction, which
 * makes "a stopped follow-up never writes a finding or a note" a property of
 * the database rather than of the worker's timing:
 *
 *  - Stop commits first: this UPDATE matches no row, nothing is written, and
 *    the caller is told `stopped: true` so the job ends as cancelled. There is
 *    no checkpoint to lose a race with, because there is no checkpoint here --
 *    this is the write itself refusing.
 *  - This transaction gets there first: Stop's own `update follow_ups` blocks
 *    on the row lock until this commits, so the note is written and the finding
 *    exists BEFORE the row is stopped. That is not a lost write, it is a run
 *    that finished first, and its finding is exactly what Stop must preserve.
 *
 * Either order, the note and the finding are on the same side of the Stop as
 * the `follow_ups` row. The separate `appendFindingNote` a run used to call
 * could not give that: it was a second transaction, so a Stop landing between
 * the two writes left a stopped follow-up's finding in the editor's notes.
 * `follow-up-stop.postgres.test.ts` is the cross-process proof, and it fails
 * if the WHERE clause below loses its `status <> 'stopped'`.
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
): Promise<FollowUpRecordResult> {
  await ensureFollowUpsSchema();
  /*
    The agent's finding, as the card and the story will both read it.

    `finding_json` is a `text` column, so a NUL in the model's title, summary
    or reason does NOT fail the write -- `JSON.stringify` inside `packFinding`
    turns it into an escape and the INSERT succeeds. It fails later, and
    somewhere else: `findingNoteLine` copies the same words into the story's
    `notes_json`, and `meeting-activity.ts` reads that column back through
    `::jsonb`, which is where the escape finally refuses to parse. The guard has
    to be on the values, before they are packed, which is what
    `sanitizeJsonLeaves` does -- the same walk `storableText` would do field by
    field, and it leaves `changed` (a boolean) alone.
  */
  const finding = sanitizeJsonLeaves({
    ...EMPTY_FINDING,
    ...(input.finding ?? {}),
    checkedAt: input.finding?.checkedAt ?? new Date().toISOString(),
  });
  const newsroomId = owned(context);
  return withTransaction(async (tx) => {
    const rows = await tx<{ id: number; lead_id: number | null; article_id: number | null }>`
      update follow_ups
      set last_state = ${input.state}, last_run_at = now(), finding_json = ${packFinding(finding)},
          next_run_at = ${input.nextRunAt ?? null}, updated_at = now()
      where id = ${input.id} and newsroom_id = ${newsroomId}
        and status <> 'stopped'
      returning id, lead_id, article_id
    `;
    const row = rows[0];
    if (!row) {
      /*
        Nothing was written. Read the row back to say WHY: a `stopped` row is
        the editor's Stop landing after the run's last checkpoint, which the
        worker turns into the job's own cancelled terminal state; an absent row
        is a follow-up that is gone, which is not a cancel. Read in the same
        transaction, so it is the state that refused the write.
      */
      const [present] = await tx<{ status: FollowUpStatus }>`
        select status from follow_ups where id = ${input.id} and newsroom_id = ${newsroomId}
      `;
      if (!present) return { ok: false as const, error: "That follow-up is gone.", stopped: false };
      return {
        ok: false as const,
        error: "The editor stopped this follow-up before the run could record its result.",
        stopped: present.status === "stopped",
      };
    }
    if (input.state !== "found") return { ok: true as const, noteWritten: false };

    // An article row knows its lead; a follow-up started from the story page has
    // only the article. Resolve to the lead, then write through the notes column.
    let leadId = row.lead_id;
    if (!leadId && row.article_id) {
      const articleRows = await tx<{ lead_id: number | null }>`
        select lead_id from articles where id = ${row.article_id} and newsroom_id = ${newsroomId}
      `;
      leadId = articleRows[0]?.lead_id ?? null;
    }
    if (!leadId) return { ok: true as const, noteWritten: false };

    // The extra line is the caller's, and the caller is the model-reading part of
    // the run -- so it gets the same guard as the finding's own fields before it
    // reaches `notes_json`.
    const written = await appendFindingNoteIn(
      tx,
      context,
      leadId,
      storableText(input.note ?? findingNoteLine(finding)),
    );
    return { ok: true as const, noteWritten: written };
  });
}

/**
 * The status transitions the screen's action buttons perform, less the three
 * that are not a plain status write: "run-now" (the scheduler's path) and
 * "stop" / "resume" (both of which have to read `desk_jobs` as well, and are
 * delegated to ./follow-up-stop.server.ts below).
 */
const ACTION_STATUS: Record<"pause" | "done", FollowUpStatus> = {
  pause: "paused",
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
    /*
      Due now, and active: "Run now" on a paused card also resumes it, which is
      what the drawn Waiting card's three buttons (Run now, Edit, Stop) imply --
      there is no fourth way back from paused.

      NOT from `stopped` or `done`, and that is what makes Stop mean stop. The
      predicate is the screen's own vocabulary turned round: `cardActions` offers
      Run now only on a card whose status is active or paused (a stopped card
      offers Resume), and `startFollowUpRun` reads the row before it gets here.
      Without it, a Stop committing between that read and this write would be
      overwritten by `status = 'active'` -- a stopped agent resurrected by a
      press that had already been refused. Resume is the one way back, and it is
      a status the editor asks for by name.
    */
    const rows = await sql`
      update follow_ups
      set status = 'active', next_run_at = now(), updated_at = now()
      where id = ${id} and newsroom_id = ${owned(context)} and agent_kind is not null
        and status in ('active', 'paused')
      returning id
    `;
    if (rows.length) return { ok: true as const };
    const [present] = await sql<{ status: FollowUpStatus }>`
      select status from follow_ups
      where id = ${id} and newsroom_id = ${owned(context)} and agent_kind is not null
    `;
    return present
      ? {
          ok: false as const,
          error: "That follow-up has been stopped or finished. Resume it first if you want it to run again.",
        }
      : { ok: false as const, error: "That follow-up is gone." };
  }
  if (action === "pause" || action === "done") {
    const rows = await sql`
      update follow_ups set status = ${ACTION_STATUS[action]}, updated_at = now()
      where id = ${id} and newsroom_id = ${owned(context)} and agent_kind is not null
      returning id
    `;
    return rows.length ? { ok: true as const } : { ok: false as const, error: "That follow-up is gone." };
  }

  /*
    STOP AND RESUME ARE DELEGATED, and they are still Stop and Resume. Both have
    to read or write `desk_jobs` as well as `follow_ups`: Stop cancels the runs
    the editor ended (in the same transaction, or the two halves land apart) and
    Resume is refused while a run for the follow-up is still going. That work
    lives in ./follow-up-stop.server.ts, which this file cannot import
    statically: `desk.ts` re-exports this module to the desk screens, and
    `desk_jobs`' own module dynamically imports every `*.server.ts` worker in
    the app, so a static edge to it fails the production build's
    import-protection pass. A `.server`-named dynamic import is dropped from the
    browser build, which is the same reason `follow-up-run.server.ts` is named
    that way.
  */
  const { performFollowUpResume, performFollowUpStop } = await import("./follow-up-stop.server.ts");
  return action === "stop" ? performFollowUpStop(context, id) : performFollowUpResume(context, id);
}

/**
 * The agents the scheduler may run right now: active, due, with a known
 * method, oldest first. Nulls are excluded rather than sorted last -- a row
 * with no `next_run_at` is a manual ask or an agent whose schedule this build
 * does not know, and neither is due.
 *
 * `limit` is small and the caller runs them one at a time; this returns the
 * CANDIDATES, it does not claim them. `performClaimFollowUpRun` below makes a
 * pick exclusive, while the atomic desk-job claim is the final per-newsroom
 * fence against overlapping follow-ups and drafts.
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
 * returns; the desk-job claim independently prevents a second follow-up from
 * executing in the same newsroom. `last_state` moves to `running` here so a
 * process that dies mid-run leaves a row that says it was running rather than
 * one that looks idle -- `performReconcileFollowUpRuns` clears those.
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
  /*
    Same door as the run's own write above, reached from the other side: the
    finding is read back off the row, given the failure reason, and packed
    again -- so a NUL already stored in the row (written before this guard
    existed) would be carried straight back into `finding_json`. Both halves
    go through the walk.
  */
  const finding = sanitizeJsonLeaves({
    ...parseFinding(row.finding_json),
    reason: reason.slice(0, 300),
  });
  const next = nextRunAt(row.schedule ?? "");
  await sql`
    update follow_ups
    set last_state = 'waiting', last_run_at = now(), finding_json = ${packFinding(finding)},
        next_run_at = ${next?.toISOString() ?? null}, updated_at = now()
    where id = ${id} and newsroom_id = ${owned(context)}
  `;
}
